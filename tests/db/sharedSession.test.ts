/**
 * The shared session copy written beside a booking.
 *
 * Create, edit, and cancel each append one outbound change. An attendance
 * change received from the other database is stored and is not appended.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  AttendanceStatus,
  DeliveryType,
  ParticipantRole,
  Role,
  SharedAttendanceStatus,
  SharedRole,
  SharedSessionStatus,
} from "@/generated/prisma/enums";
import { loadPrincipal } from "@/lib/policies/principal";
import { createFromPlan, plan, type BookingRequest } from "@/lib/services/booking";
import * as sessionOps from "@/lib/services/sessionOps";
import { applyInboundAttendance } from "@/lib/services/sharedSession";
import { newRef } from "@/lib/ref";
import { resolveCivil, timeToDb } from "@/lib/time";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-04-06";

describeDb("shared session copy", () => {
  let db: PrismaClient;
  let org: Awaited<ReturnType<typeof makeOrganization>>;
  let admin: Awaited<ReturnType<typeof loadPrincipal>>;
  let instructor: { id: bigint };
  let student: { id: bigint };
  let school: { id: bigint; ref: string; name: string };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });
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
      last: "Vasquez",
      email: "teo.vasquez@example.test",
      roles: [Role.STUDENT],
    });
    school = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Northgate High", timezone: NY },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: student.id, schoolId: school.id },
    });
    await db.instructorStudent.create({
      data: { organizationId: org.id, instructorId: instructor.id, studentId: student.id },
    });
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
    admin = await loadPrincipal(db, adminUser.id);
  });

  function request(overrides: Partial<BookingRequest> = {}): BookingRequest {
    return {
      title: "Algebra practice",
      deliveryType: DeliveryType.EXTERNAL_LINK,
      meetingUrl: "https://meet.example.test/room/abc",
      startDate: MONDAY,
      startTime: "16:00",
      durationMinutes: 60,
      timezone: NY,
      instructorId: instructor.id,
      studentIds: [student.id],
      schoolId: school.id,
      repeat: false,
      frequency: "weekly",
      weekdays: [],
      endMode: "count",
      occurrenceCount: null,
      ...overrides,
    };
  }

  async function book(booking: BookingRequest = request()) {
    const now = new Date(
      resolveCivil(booking.startDate, booking.startTime, booking.timezone).instant.getTime() -
        7 * 86_400_000,
    );
    const bookingPlan = await plan(db, org, admin, booking, now);
    return createFromPlan(db, org, admin, bookingPlan);
  }

  it("writes the shared rows and one outbound change when a session is booked", async () => {
    const { created } = await book();
    expect(created).toHaveLength(1);

    const sharedSchool = await db.sharedSchool.findUnique({ where: { slug: school.ref } });
    expect(sharedSchool?.name).toBe("Northgate High");
    expect(sharedSchool?.timezone).toBe(NY);

    const sharedStudent = await db.sharedUser.findUnique({
      where: { email: "teo.vasquez@example.test" },
    });
    expect(sharedStudent?.role).toBe(SharedRole.STUDENT);
    expect(sharedStudent?.schoolId).toBe(sharedSchool?.id);

    const sharedTutor = await db.sharedUser.findUnique({
      where: { email: "imani.okafor@example.test" },
    });
    expect(sharedTutor?.role).toBe(SharedRole.TUTOR);

    const session = await db.sharedSession.findFirst();
    expect(session?.title).toBe("Algebra practice");
    expect(session?.subject).toBe("General");
    expect(session?.duration).toBe(60);
    expect(session?.status).toBe(SharedSessionStatus.SCHEDULED);
    expect(session?.zoomJoinUrl).toBe("https://meet.example.test/room/abc");
    expect(session?.tutorId).toBe(sharedTutor?.id);

    const attendance = await db.sharedSessionAttendance.findMany();
    expect(attendance).toHaveLength(1);
    expect(attendance[0]?.status).toBe(SharedAttendanceStatus.UNMARKED);
    expect(attendance[0]?.studentId).toBe(sharedStudent?.id);

    const changes = await db.outboundChange.findMany();
    expect(changes).toHaveLength(1);
    expect(changes[0]?.kind).toBe("session.upsert");
    expect(changes[0]?.sessionId).toBe(session?.id);
    const payload = JSON.stringify(changes[0]?.payload);
    expect(payload).toContain("zoomJoinUrl");
    expect(payload).not.toContain("zoomStartUrl");
    expect(payload).not.toContain("classroomConfig");
    expect(payload).not.toContain("password");
  });

  it("appends another change when the session is edited or cancelled, without clearing attendance", async () => {
    const { created } = await book();
    const occurrence = created[0]!;
    await sessionOps.editDetails(db, admin, occurrence, { title: "Geometry practice" });
    const edited = await db.sharedSession.findFirst();
    expect(edited?.title).toBe("Geometry practice");

    const marked = await db.sharedSessionAttendance.findFirst();
    await db.sharedSessionAttendance.update({
      where: { id: marked!.id },
      data: { status: SharedAttendanceStatus.PRESENT },
    });

    await sessionOps.cancel(db, org, admin, occurrence, { reason: "participant_request" });
    const cancelled = await db.sharedSession.findFirst();
    expect(cancelled?.status).toBe(SharedSessionStatus.CANCELLED);
    const attendance = await db.sharedSessionAttendance.findFirst();
    expect(attendance?.status).toBe(SharedAttendanceStatus.PRESENT);

    const changes = await db.outboundChange.findMany({ orderBy: { id: "asc" } });
    expect(changes.map((change) => change.kind)).toEqual([
      "session.upsert",
      "session.upsert",
      "session.upsert",
    ]);
  });

  it("stores a received attendance mark once and does not queue it", async () => {
    await book();
    const session = await db.sharedSession.findFirstOrThrow();
    const sharedStudent = await db.sharedUser.findUniqueOrThrow({
      where: { email: "teo.vasquez@example.test" },
    });
    const before = await db.outboundChange.count();

    const applied = await applyInboundAttendance(db, {
      sourceId: "att_main_1",
      sessionId: session.id,
      studentId: sharedStudent.id,
      status: "PRESENT",
      joinedAt: new Date("2026-04-06T20:00:00.000Z"),
      leftAt: new Date("2026-04-06T21:00:00.000Z"),
    });
    expect(applied).toBe(true);

    const attendance = await db.sharedSessionAttendance.findFirstOrThrow();
    expect(attendance.status).toBe(SharedAttendanceStatus.PRESENT);
    const participant = await db.sessionParticipant.findFirstOrThrow({
      where: { userId: student.id, role: ParticipantRole.STUDENT },
    });
    expect(participant.attendance).toBe(AttendanceStatus.PRESENT);

    const again = await applyInboundAttendance(db, {
      sourceId: "att_main_1",
      sessionId: session.id,
      studentId: sharedStudent.id,
      status: "ABSENT",
    });
    expect(again).toBe(false);
    const still = await db.sharedSessionAttendance.findFirstOrThrow();
    expect(still.status).toBe(SharedAttendanceStatus.PRESENT);
    expect(await db.outboundChange.count()).toBe(before);
  });
});
