/**
 * Auto-created meetings on confirm: one session, a short series, a failed
 * create that writes nothing, and a pasted link that never asks the provider.
 *
 * Preview is the same `plan()` every other booking test uses — these only
 * assert that it does not call the provider.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, Role } from "@/generated/prisma/enums";
import { ServiceUnavailable, ValidationError } from "@/lib/errors";
import { meetingFromConfig } from "@/lib/meetings";
import { MockMeetingProvider } from "@/lib/meetings/mock";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import {
  type BookingOrganization,
  type BookingRequest,
  createFromPlan,
  plan,
} from "@/lib/services/booking";
import { timeToDb } from "@/lib/time";
import { newRef } from "@/lib/ref";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-04-06";

describeDb("booking meetings", () => {
  let db: PrismaClient;
  let org: BookingOrganization & { id: bigint };
  let admin: Principal;
  let instructor: { id: bigint };
  let student: { id: bigint };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = (await makeOrganization(db, { timezone: NY })) as typeof org;
    const adminUser = await makeUser(db, org.id, {
      first: "Rowan",
      last: "Mercer",
      email: "rowan.mercer@example.test",
      roles: [Role.ADMIN],
    });
    instructor = await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      email: "imani.okafor@example.test",
      roles: [Role.INSTRUCTOR],
    });
    student = await makeUser(db, org.id, {
      first: "Teo",
      last: "Vale",
      email: "teo.vale@example.test",
      roles: [Role.STUDENT],
    });
    admin = await loadPrincipal(db, adminUser.id);
    for (const weekday of ["mon", "tue", "wed", "thu", "fri"]) {
      await db.availabilityRule.create({
        data: {
          ref: newRef("avr"),
          organizationId: org.id,
          instructorId: instructor.id,
          weekday,
          startTime: timeToDb("08:00"),
          endTime: timeToDb("20:00"),
          timezone: NY,
        },
      });
    }
    await db.instructorStudent.create({
      data: { organizationId: org.id, instructorId: instructor.id, studentId: student.id },
    });
  });

  function booking(overrides: Partial<BookingRequest> = {}): BookingRequest {
    return {
      title: "Algebra practice",
      deliveryType: DeliveryType.EXTERNAL_LINK,
      startDate: MONDAY,
      startTime: "16:00",
      durationMinutes: 60,
      timezone: NY,
      instructorId: instructor.id,
      studentIds: [student.id],
      repeat: false,
      frequency: "weekly",
      weekdays: [],
      endMode: "count",
      occurrenceCount: null,
      createMeeting: true,
      ...overrides,
    };
  }

  function before(request: BookingRequest): Date {
    const startOfDay = new Date(`${request.startDate}T09:00:00.000Z`);
    return new Date(startOfDay.getTime() - 7 * 86_400_000);
  }

  it("preview does not ask the provider", async () => {
    const meetings = new MockMeetingProvider();
    await plan(db, org, admin, booking(), before(booking()));
    expect(meetings.created).toHaveLength(0);
  });

  it("writes one meeting onto a standalone session", async () => {
    const meetings = new MockMeetingProvider();
    const request = booking();
    const bookingPlan = await plan(db, org, admin, request, before(request));
    const { created } = await createFromPlan(db, org, admin, bookingPlan, {}, meetings);

    expect(created).toHaveLength(1);
    expect(created[0]!.meetingUrl).toBe("https://meet.example.test/zoom/1");
    expect(meetingFromConfig(created[0]!.classroomConfig)?.startUrl).toBe(
      "https://meet.example.test/zoom/1/host",
    );
    expect(meetingFromConfig(created[0]!.classroomConfig)?.provider).toBe("mock");
    expect(meetings.created).toHaveLength(1);
  });

  it("creates a different meeting for each occurrence of a series", async () => {
    const meetings = new MockMeetingProvider();
    const request = booking({
      repeat: true,
      weekdays: ["mon"],
      occurrenceCount: 2,
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));
    const { created } = await createFromPlan(db, org, admin, bookingPlan, {}, meetings);

    expect(created).toHaveLength(2);
    expect(created[0]!.meetingUrl).toBe("https://meet.example.test/zoom/1");
    expect(created[1]!.meetingUrl).toBe("https://meet.example.test/zoom/2");
    expect(created[0]!.meetingUrl).not.toBe(created[1]!.meetingUrl);
    expect(meetings.created).toHaveLength(2);
  });

  it("writes nothing and discards meetings already made when a later create fails", async () => {
    const meetings = new MockMeetingProvider();
    meetings.failAfter = 1;
    const request = booking({
      repeat: true,
      weekdays: ["mon"],
      occurrenceCount: 2,
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));

    await expect(
      createFromPlan(db, org, admin, bookingPlan, {}, meetings),
    ).rejects.toBeInstanceOf(ServiceUnavailable);

    expect(await db.sessionOccurrence.count()).toBe(0);
    expect(meetings.deleted).toEqual(["mock-1"]);
  });

  it("refuses auto-create when no provider is configured", async () => {
    const request = booking();
    const bookingPlan = await plan(db, org, admin, request, before(request));

    await expect(createFromPlan(db, org, admin, bookingPlan, {}, null)).rejects.toBeInstanceOf(
      ValidationError,
    );
    await expect(createFromPlan(db, org, admin, bookingPlan, {}, null)).rejects.toThrow(
      "Zoom is not configured",
    );
    expect(await db.sessionOccurrence.count()).toBe(0);
  });

  it("leaves a pasted link alone and never asks the provider", async () => {
    const meetings = new MockMeetingProvider();
    const request = booking({
      createMeeting: false,
      meetingUrl: "https://meet.example.test/room/abc",
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));
    const { created } = await createFromPlan(db, org, admin, bookingPlan, {}, meetings);

    expect(created[0]!.meetingUrl).toBe("https://meet.example.test/room/abc");
    expect(meetingFromConfig(created[0]!.classroomConfig)).toBeNull();
    expect(meetings.created).toHaveLength(0);
  });

  it("ignores a leftover pasted URL when auto-create is on", async () => {
    const meetings = new MockMeetingProvider();
    const request = booking({
      createMeeting: true,
      meetingUrl: "https://meet.example.test/room/stale",
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));
    const { created } = await createFromPlan(db, org, admin, bookingPlan, {}, meetings);

    expect(created[0]!.meetingUrl).toBe("https://meet.example.test/zoom/1");
  });

  it("asks the provider for each occurrence's own start", async () => {
    const meetings = new MockMeetingProvider();
    const request = booking({
      repeat: true,
      weekdays: ["mon"],
      occurrenceCount: 2,
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));
    await createFromPlan(db, org, admin, bookingPlan, {}, meetings);

    expect(meetings.specs).toHaveLength(2);
    expect(meetings.specs[0]!.start.getTime()).toBe(
      bookingPlan.sessions[0]!.occurrence.start.getTime(),
    );
    expect(meetings.specs[1]!.start.getTime()).toBe(
      bookingPlan.sessions[1]!.occurrence.start.getTime(),
    );
    expect(meetings.specs[0]!.start.getTime()).not.toBe(meetings.specs[1]!.start.getTime());
  });
});
