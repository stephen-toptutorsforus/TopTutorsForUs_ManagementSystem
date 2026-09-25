/**
 * Local reminders and the credit balance.
 *
 * Nothing is sent. A captured row is the message, and a student request
 * without a credit is refused while a staff booking is not.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, Role, SessionStatus } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import { newRef } from "@/lib/ref";
import {
  type BookingOrganization,
  type BookingRequest,
  createFromPlan,
  plan,
} from "@/lib/services/booking";
import { sweepCredits } from "@/lib/services/localNotices";
import * as sessionOps from "@/lib/services/sessionOps";
import { timeToDb } from "@/lib/time";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const LATER = "2026-10-20";

describeDb("local notices and credits", () => {
  let db: PrismaClient;
  let org: BookingOrganization & { id: bigint };
  let admin: Principal;
  let studentPrincipal: Principal;
  let instructor: { id: bigint };
  let student: { id: bigint };
  let parent: { id: bigint };

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
      first: "Nico",
      last: "Tutor",
      email: "nico.tutor@example.test",
      roles: [Role.INSTRUCTOR],
    });
    student = await makeUser(db, org.id, {
      first: "Ada",
      last: "North",
      email: "ada.north@example.test",
      roles: [Role.STUDENT],
    });
    parent = await makeUser(db, org.id, {
      first: "Cora",
      last: "South",
      email: "cora.south@example.test",
      roles: [Role.PARENT],
    });
    await db.user.update({
      where: { id: student.id },
      data: { phone: "+15555550100", creditBalance: 0 },
    });
    await db.user.update({
      where: { id: parent.id },
      data: { phone: "+15555550101" },
    });
    await db.guardianStudent.create({
      data: { organizationId: org.id, guardianId: parent.id, studentId: student.id },
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
    studentPrincipal = await loadPrincipal(db, student.id);
  });

  function request(): BookingRequest {
    return {
      title: "Practice hour",
      deliveryType: DeliveryType.IN_PERSON,
      startDate: LATER,
      startTime: "16:00",
      durationMinutes: 60,
      timezone: NY,
      instructorId: instructor.id,
      studentIds: [student.id],
      repeat: false,
    };
  }

  it("refuses a student request with no credits and lets staff book", async () => {
    await expect(plan(db, org, studentPrincipal, request())).rejects.toThrow(ValidationError);

    const booked = await createFromPlan(db, org, admin, await plan(db, org, admin, request()));
    expect(booked.created[0]!.status).toBe(SessionStatus.SCHEDULED);

    const messages = await db.capturedMessage.findMany({
      where: { sessionId: booked.created[0]!.id },
    });
    const instructorMail = messages.filter(
      (message) => message.address === "nico.tutor@example.test" && message.channel === "email",
    );
    expect(instructorMail.map((message) => message.kind).sort()).toEqual(["reminder", "reminder"]);
    expect(messages.some((message) => message.channel === "sms" && message.kind === "reminder")).toBe(
      true,
    );
    expect(
      messages.some(
        (message) =>
          message.address === "cora.south@example.test" && message.kind === "confirmation",
      ),
    ).toBe(true);
  });

  it("cancels a short student request inside a day and warns inside two", async () => {
    await db.user.update({ where: { id: student.id }, data: { creditBalance: 1 } });
    const booked = await createFromPlan(
      db,
      org,
      studentPrincipal,
      await plan(db, org, studentPrincipal, request()),
    );
    expect(booked.created[0]!.status).toBe(SessionStatus.REQUESTED);
    await db.user.update({ where: { id: student.id }, data: { creditBalance: 0 } });

    const start = booked.created[0]!.scheduledStart;
    await sweepCredits(db, org.id, new Date(start.getTime() - 36 * 3_600_000));
    const warned = await db.sessionOccurrence.findUnique({ where: { id: booked.created[0]!.id } });
    expect(warned!.status).toBe(SessionStatus.REQUESTED);
    expect(
      await db.capturedMessage.count({
        where: { sessionId: booked.created[0]!.id, kind: "credit_warning" },
      }),
    ).toBeGreaterThan(0);

    await sweepCredits(db, org.id, new Date(start.getTime() - 2 * 3_600_000));
    const cancelled = await db.sessionOccurrence.findUnique({
      where: { id: booked.created[0]!.id },
    });
    expect(cancelled!.status).toBe(SessionStatus.CANCELLED);
    const openReminders = await db.capturedMessage.count({
      where: { sessionId: booked.created[0]!.id, kind: "reminder", retiredAt: null },
    });
    expect(openReminders).toBe(0);
  });

  it("retires reminders when the session is cancelled", async () => {
    const booked = await createFromPlan(
      db,
      org,
      admin,
      await plan(db, org, admin, request()),
    );
    await sessionOps.cancel(db, org, admin, booked.created[0]!, { reason: "other" });
    const openReminders = await db.capturedMessage.count({
      where: { sessionId: booked.created[0]!.id, kind: "reminder", retiredAt: null },
    });
    expect(openReminders).toBe(0);
  });
});
