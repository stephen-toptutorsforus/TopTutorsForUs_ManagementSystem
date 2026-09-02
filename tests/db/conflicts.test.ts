/**
 * Conflict detection against a real database.
 *
 * The four kinds, the statuses that hold a slot, and the one case the database
 * cannot see for itself: a student booked twice, which lives in the participant
 * table and is therefore checked here or nowhere.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { DeliveryType } from "@/generated/prisma/enums";
import type { PrismaClient } from "@/generated/prisma/client";
import { check, ConflictKind } from "@/lib/conflicts";
import { resolveCivil, timeToDb } from "@/lib/time";

import {
  makeOrganization,
  makeUser,
  newRef,
  reset,
  TEST_DATABASE_URL,
  testClient,
} from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-06-01";

describeDb("conflict detection", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let instructor: { id: bigint };
  let student: { id: bigint };
  let location: { id: bigint };

  const at = (time: string) => resolveCivil(MONDAY, time, NY).instant;
  const kinds = (report: { conflicts: { kind: ConflictKind }[] }) =>
    report.conflicts.map((c) => c.kind);

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });
    instructor = await makeUser(db, org.id, { first: "Imani", last: "Okafor" });
    student = await makeUser(db, org.id, { first: "Teo", last: "Vasquez" });
    location = await db.location.create({
      data: { ref: newRef("loc"), organizationId: org.id, name: "Study Room A" },
    });

    for (const weekday of ["mon", "tue", "wed", "thu", "fri"]) {
      await db.organizationAvailability.create({
        data: {
          organizationId: org.id,
          weekday,
          startTime: timeToDb("08:00"),
          endTime: timeToDb("20:00"),
        },
      });
      await db.availabilityRule.create({
        data: {
          ref: newRef("avr"),
          organizationId: org.id,
          instructorId: instructor.id,
          weekday,
          startTime: timeToDb("09:00"),
          endTime: timeToDb("19:00"),
          timezone: NY,
        },
      });
    }
  });

  async function book(overrides: Record<string, unknown> = {}) {
    return db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title: "Fractions review",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: at("14:00"),
        scheduledEnd: at("15:00"),
        timezone: NY,
        status: "SCHEDULED",
        instructorId: instructor.id,
        ...overrides,
      },
    });
  }

  it("finds nothing wrong with a clear slot", async () => {
    const report = await check(db, org, {
      start: at("10:00"),
      end: at("11:00"),
      instructorId: instructor.id,
    });

    expect(report.conflicts).toEqual([]);
  });

  describe("the instructor", () => {
    it("reports an overlapping session, naming it", async () => {
      await book();

      const report = await check(db, org, {
        start: at("14:30"),
        end: at("15:30"),
        instructorId: instructor.id,
      });

      expect(kinds(report)).toContain(ConflictKind.INSTRUCTOR_BUSY);
      expect(report.conflicts[0]!.message).toContain("Fractions review");
      expect(report.conflicts[0]!.sessionRef).toMatch(/^ses_/);
    });

    it("does not report a back-to-back booking", async () => {
      await book();

      const report = await check(db, org, {
        start: at("15:00"),
        end: at("16:00"),
        instructorId: instructor.id,
      });

      expect(kinds(report)).not.toContain(ConflictKind.INSTRUCTOR_BUSY);
    });

    it("ignores a cancelled session", async () => {
      await book({ status: "CANCELLED" });

      const report = await check(db, org, {
        start: at("14:00"),
        end: at("15:00"),
        instructorId: instructor.id,
      });

      expect(kinds(report)).not.toContain(ConflictKind.INSTRUCTOR_BUSY);
    });

    it("does not report the session being edited against itself", async () => {
      // Rescheduling a session must not find it clashing with where it already
      // is.
      const existing = await book();

      const report = await check(db, org, {
        start: at("14:00"),
        end: at("15:00"),
        instructorId: instructor.id,
        excludeSessionId: existing.id,
      });

      expect(kinds(report)).not.toContain(ConflictKind.INSTRUCTOR_BUSY);
    });

    it("does not look across tenants", async () => {
      const other = await makeOrganization(db, { slug: "harbour-point" });
      await db.sessionOccurrence.create({
        data: {
          ref: newRef("ses"),
          organizationId: other.id,
          title: "Someone else's lesson",
          deliveryType: DeliveryType.EXTERNAL_LINK,
          scheduledStart: at("14:00"),
          scheduledEnd: at("15:00"),
          timezone: NY,
          status: "SCHEDULED",
          instructorId: instructor.id,
        },
      });

      const report = await check(db, org, {
        start: at("14:00"),
        end: at("15:00"),
        instructorId: instructor.id,
      });

      expect(kinds(report)).not.toContain(ConflictKind.INSTRUCTOR_BUSY);
    });
  });

  describe("the student", () => {
    it("reports a student booked twice, and names them", async () => {
      // The database's exclusion constraints cannot reach the participant
      // table, so this check is the only guard there is.
      const existing = await book({ instructorId: null });
      await db.sessionParticipant.create({
        data: {
          organizationId: org.id,
          sessionId: existing.id,
          userId: student.id,
          role: "STUDENT",
        },
      });

      const report = await check(db, org, {
        start: at("14:30"),
        end: at("15:30"),
        instructorId: null,
        studentIds: [student.id],
      });

      expect(kinds(report)).toEqual([ConflictKind.STUDENT_BUSY]);
      expect(report.conflicts[0]!.subjectLabel).toBe("Teo Vasquez");
      expect(report.conflicts[0]!.message).toContain("Teo Vasquez");
    });

    it("says nothing about a student who is free", async () => {
      const report = await check(db, org, {
        start: at("14:00"),
        end: at("15:00"),
        instructorId: null,
        studentIds: [student.id],
      });

      expect(report.conflicts).toEqual([]);
    });
  });

  describe("the room", () => {
    it("reports two in-person sessions in one location", async () => {
      await book({
        instructorId: null,
        locationId: location.id,
        deliveryType: DeliveryType.IN_PERSON,
      });

      const report = await check(db, org, {
        start: at("14:30"),
        end: at("15:30"),
        instructorId: null,
        locationId: location.id,
        deliveryType: DeliveryType.IN_PERSON,
      });

      expect(kinds(report)).toEqual([ConflictKind.LOCATION_BUSY]);
    });

    it("ignores the room when the proposed session is online", async () => {
      await book({
        instructorId: null,
        locationId: location.id,
        deliveryType: DeliveryType.IN_PERSON,
      });

      const report = await check(db, org, {
        start: at("14:30"),
        end: at("15:30"),
        instructorId: null,
        locationId: location.id,
        deliveryType: DeliveryType.EXTERNAL_LINK,
      });

      expect(report.conflicts).toEqual([]);
    });
  });

  describe("declared availability", () => {
    it("reports a booking outside the instructor's hours", async () => {
      // 08:30 is inside the organization's opening hours and outside the
      // instructor's, so the day is open and this is a question about the
      // person rather than about the organization.
      const report = await check(db, org, {
        start: at("08:30"),
        end: at("09:30"),
        instructorId: instructor.id,
      });

      expect(kinds(report)).toEqual([ConflictKind.OUTSIDE_AVAILABILITY]);
    });

    it("says the organization is shut when that is the actual reason", async () => {
      // The two need different actions — one is a conversation with the
      // instructor, the other with whoever sets the opening hours — so they are
      // different kinds. Reaching this one takes an instructor whose declared
      // window falls entirely outside the organization's, which leaves the day
      // with no windows at all rather than with windows this booking misses.
      const other = await makeUser(db, org.id, { first: "Dara", last: "Nwosu" });
      await db.availabilityRule.create({
        data: {
          ref: newRef("avr"),
          organizationId: org.id,
          instructorId: other.id,
          weekday: "mon",
          startTime: timeToDb("21:00"),
          endTime: timeToDb("23:00"),
          timezone: NY,
        },
      });

      const report = await check(db, org, {
        start: at("21:30"),
        end: at("22:30"),
        instructorId: other.id,
      });

      expect(kinds(report)).toEqual([ConflictKind.ORGANIZATION_CLOSED]);
    });

    it("can be asked not to check it at all", async () => {
      const report = await check(db, org, {
        start: at("07:00"),
        end: at("08:00"),
        instructorId: instructor.id,
        checkAvailability: false,
      });

      expect(report.conflicts).toEqual([]);
    });
  });

  it("reports every kind it finds at once", async () => {
    // A person fixing a booking should see the whole picture, not the first
    // problem and then the next one after they resubmit.
    const existing = await book({
      locationId: location.id,
      deliveryType: DeliveryType.IN_PERSON,
      scheduledStart: at("07:00"),
      scheduledEnd: at("08:00"),
    });
    await db.sessionParticipant.create({
      data: {
        organizationId: org.id,
        sessionId: existing.id,
        userId: student.id,
        role: "STUDENT",
      },
    });

    const report = await check(db, org, {
      start: at("07:00"),
      end: at("08:00"),
      instructorId: instructor.id,
      studentIds: [student.id],
      locationId: location.id,
      deliveryType: DeliveryType.IN_PERSON,
    });

    expect(new Set(kinds(report))).toEqual(
      new Set([
        ConflictKind.INSTRUCTOR_BUSY,
        ConflictKind.STUDENT_BUSY,
        ConflictKind.LOCATION_BUSY,
        ConflictKind.OUTSIDE_AVAILABILITY,
      ]),
    );
  });

  it("agrees with the database about which statuses hold a slot", async () => {
    // The service's list and the constraint predicates are two expressions of
    // one rule. If one changes without the other, the preview promises a
    // booking the insert refuses, or reports a clash the database allows.
    const constraints = await db.$queryRawUnsafe<{ def: string }[]>(
      `SELECT pg_get_constraintdef(c.oid) AS def
       FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
       WHERE t.relname = 'session_occurrence' AND c.contype = 'x'`,
    );

    expect(constraints).toHaveLength(2);
    for (const { def } of constraints) {
      for (const status of ["scheduled", "rescheduled", "in_progress"]) {
        expect(def).toContain(status);
      }
      // And nothing else holds a slot.
      for (const status of ["cancelled", "completed", "missed", "requested", "rejected"]) {
        expect(def).not.toContain(`'${status}'`);
      }
    }
  });
});
