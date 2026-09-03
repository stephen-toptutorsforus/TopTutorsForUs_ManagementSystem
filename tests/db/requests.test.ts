/**
 * Booking requests, approval, and the rescheduled status.
 *
 * Ported from `tests/test_requests.py`. Two behaviours worth pinning down,
 * because both are judgement calls a future change could quietly reverse:
 *
 * * A request does **not** hold its slot. Anyone could otherwise block an
 *   instructor's calendar simply by asking.
 * * Approval therefore re-checks conflicts, and can fail because the time went.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, Role, SessionStatus } from "@/generated/prisma/enums";
import { blocking, check } from "@/lib/conflicts";
import { ConflictError, Forbidden } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import { newRef } from "@/lib/ref";
import {
  type BookingOrganization,
  type BookingRequest,
  EditScope,
  createFromPlan,
  isBookable,
  needsApproval,
  plan,
} from "@/lib/services/booking";
import * as sessionOps from "@/lib/services/sessionOps";
import { civilDate, timeToDb } from "@/lib/time";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-04-06";

/**
 * Which statuses hold their slot. Named from the reference's own list rather
 * than re-derived, because the point of the last test here is that this list
 * and the database constraint's predicate are two expressions of one rule.
 */
const OCCUPYING_STATUSES: SessionStatus[] = [
  SessionStatus.SCHEDULED,
  SessionStatus.RESCHEDULED,
  SessionStatus.IN_PROGRESS,
];

describeDb("booking requests", () => {
  let db: PrismaClient;
  let org: BookingOrganization & { id: bigint };
  let admin: Principal;
  let parentPrincipal: Principal;
  let instructorPrincipal: Principal;
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

    // A tenant that requires approval, with a bookable instructor.
    org = (await makeOrganization(db, { timezone: NY })) as typeof org;
    org = (await db.organization.update({
      where: { id: org.id },
      data: {
        settings: {
          booking: {
            require_approval: true,
            who_can_book: ["admin", "regional_admin", "instructor", "student", "parent"],
          },
        },
      },
    })) as typeof org;

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
    const parent = await makeUser(db, org.id, {
      first: "Delphine",
      last: "Arceneaux",
      email: "delphine.arceneaux@example.test",
      roles: [Role.PARENT],
    });
    await db.guardianStudent.create({
      data: {
        organizationId: org.id,
        guardianId: parent.id,
        studentId: student.id,
        isPrimary: true,
      },
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
    parentPrincipal = await loadPrincipal(db, parent.id);
    instructorPrincipal = await loadPrincipal(db, instructor.id);
  });

  function booking(startTime = "16:00"): BookingRequest {
    return {
      title: "Reading practice",
      deliveryType: DeliveryType.EXTERNAL_LINK,
      meetingUrl: "https://meet.example.test/room/req",
      startDate: MONDAY,
      startTime,
      durationMinutes: 60,
      timezone: NY,
      instructorId: instructor.id,
      studentIds: [student.id],
    };
  }

  const NOW = new Date("2026-03-30T09:00:00.000Z");

  async function bookAs(principal: Principal, request = booking()) {
    const bookingPlan = await plan(db, org, principal, request, NOW);
    return createFromPlan(db, org, principal, bookingPlan);
  }

  const reload = (id: bigint) => db.sessionOccurrence.findUniqueOrThrow({ where: { id } });

  // --- Who needs approval --------------------------------------------------

  it("turns a parent booking into a request", async () => {
    const { created } = await bookAs(parentPrincipal);
    expect(created[0]!.status).toBe(SessionStatus.REQUESTED);
  });

  it("schedules an administrator booking immediately", async () => {
    // Asking an administrator to approve their own booking is ceremony.
    const { created } = await bookAs(admin);
    expect(created[0]!.status).toBe(SessionStatus.SCHEDULED);
  });

  it("schedules an instructor booking immediately", async () => {
    const { created } = await bookAs(instructorPrincipal);
    expect(created[0]!.status).toBe(SessionStatus.SCHEDULED);
  });

  it("requests nothing when the tenant does not require it", async () => {
    org = (await db.organization.update({
      where: { id: org.id },
      data: {
        settings: {
          booking: {
            require_approval: false,
            who_can_book: ["admin", "instructor", "student", "parent"],
          },
        },
      },
    })) as typeof org;
    const parent = await loadPrincipal(db, parentPrincipal.userId);

    expect(needsApproval(org, parent)).toBe(false);
    const { created } = await bookAs(parent);
    expect(created[0]!.status).toBe(SessionStatus.SCHEDULED);
  });

  // --- A request does not hold the slot ------------------------------------

  it("does not block the slot with a pending request", async () => {
    // Otherwise anyone could freeze a calendar by asking.
    await bookAs(parentPrincipal);

    const bookingPlan = await plan(db, org, admin, booking(), NOW);
    // The request must not be treated as a booking.
    expect(isBookable(bookingPlan)).toBe(true);

    const { created } = await createFromPlan(db, org, admin, bookingPlan);
    expect(created[0]!.status).toBe(SessionStatus.SCHEDULED);
  });

  it("refuses to approve into a slot that has since been taken", async () => {
    // The clash surfaces at approval, which is exactly when it should.
    const { created: requested } = await bookAs(parentPrincipal);
    await bookAs(admin);

    await expect(
      sessionOps.decideRequest(db, org, admin, requested[0]!, { approve: true }),
    ).rejects.toThrow("no longer free");

    // It stays pending.
    expect((await reload(requested[0]!.id)).status).toBe(SessionStatus.REQUESTED);
  });

  // --- Deciding ------------------------------------------------------------

  it("schedules and audits an approval", async () => {
    const { created } = await bookAs(parentPrincipal);

    const approved = await sessionOps.decideRequest(db, org, admin, created[0]!, {
      approve: true,
    });

    expect(approved.status).toBe(SessionStatus.SCHEDULED);
    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "session.request_approved" },
    });
    // The wire values the Python service records, not Prisma's member names:
    // the two trails have to be comparable.
    expect((event.changes as Record<string, unknown>).status).toEqual({
      from: "requested",
      to: "scheduled",
    });
  });

  it("records a rejection", async () => {
    const { created } = await bookAs(parentPrincipal);

    const rejected = await sessionOps.decideRequest(db, org, admin, created[0]!, {
      approve: false,
      reason: "instructor_unavailable",
    });

    expect(rejected.status).toBe(SessionStatus.REJECTED);
    expect(
      await db.auditEvent.findFirst({ where: { action: "session.request_rejected" } }),
    ).not.toBeNull();
  });

  it("lets the instructor on the session decide it", async () => {
    const { created } = await bookAs(parentPrincipal);

    const decided = await sessionOps.decideRequest(db, org, instructorPrincipal, created[0]!, {
      approve: true,
    });
    expect(decided.status).toBe(SessionStatus.SCHEDULED);
  });

  it("does not let another instructor decide it", async () => {
    // Being an instructor is not authority over somebody else's calendar.
    const { created } = await bookAs(parentPrincipal);
    const outsider = await makeUser(db, org.id, {
      first: "Dara",
      last: "Nwosu",
      email: "dara.nwosu@example.test",
      roles: [Role.INSTRUCTOR],
    });

    await expect(
      sessionOps.decideRequest(
        db,
        org,
        await loadPrincipal(db, outsider.id),
        created[0]!,
        { approve: true },
      ),
    ).rejects.toThrow("your own sessions");
  });

  it("does not let a parent approve their own request", async () => {
    const { created } = await bookAs(parentPrincipal);

    await expect(
      sessionOps.decideRequest(db, org, parentPrincipal, created[0]!, { approve: true }),
    ).rejects.toThrow("decide booking requests");
  });

  it("does not let an already decided request be decided again", async () => {
    const { created } = await bookAs(parentPrincipal);
    const approved = await sessionOps.decideRequest(db, org, admin, created[0]!, {
      approve: true,
    });

    await expect(
      sessionOps.decideRequest(db, org, admin, approved, { approve: false }),
    ).rejects.toBeInstanceOf(Forbidden);
    await expect(
      sessionOps.decideRequest(db, org, admin, approved, { approve: false }),
    ).rejects.toThrow("awaiting a decision");
  });

  // --- The rescheduled status ----------------------------------------------

  const moveTo = (occurrence: { scheduledStart: Date }, time: string) => ({
    startDate: civilDate(occurrence.scheduledStart, NY),
    startTime: time,
    durationMinutes: 60,
    timezone: NY,
  });

  it("marks a session as moved when it is rescheduled", async () => {
    const { created } = await bookAs(admin);
    expect(created[0]!.status).toBe(SessionStatus.SCHEDULED);

    const [moved] = await sessionOps.reschedule(
      db,
      org,
      admin,
      created[0]!,
      moveTo(created[0]!, "18:00"),
    );
    expect(moved!.status).toBe(SessionStatus.RESCHEDULED);
  });

  it("still holds the slot after a reschedule", async () => {
    // It moved, but it is still going to happen — nothing may be booked over it.
    const { created } = await bookAs(admin);
    const [moved] = await sessionOps.reschedule(
      db,
      org,
      admin,
      created[0]!,
      moveTo(created[0]!, "18:00"),
    );

    await expect(
      db.sessionOccurrence.create({
        data: {
          ref: newRef("ses"),
          organizationId: org.id,
          title: "Clash",
          deliveryType: DeliveryType.EXTERNAL_LINK,
          scheduledStart: moved!.scheduledStart,
          scheduledEnd: moved!.scheduledEnd,
          timezone: NY,
          instructorId: instructor.id,
          status: SessionStatus.SCHEDULED,
        },
      }),
    ).rejects.toThrow(/ex_session_instructor_overlap/);
  });

  it("agrees with the database constraint about which statuses hold a slot", async () => {
    // The preview and the constraint are two expressions of one rule. When they
    // drift, the preview promises a booking the insert then refuses with an
    // unexplained integrity error — so this asserts the service reports the
    // clash *before* the database has to, for every status that holds a slot.
    const { created } = await bookAs(admin);
    const occurrence = created[0]!;

    for (const status of OCCUPYING_STATUSES) {
      await db.sessionOccurrence.update({ where: { id: occurrence.id }, data: { status } });
      const report = await check(db, org, {
        start: occurrence.scheduledStart,
        end: occurrence.scheduledEnd,
        instructorId: instructor.id,
        checkAvailability: false,
      });
      expect(blocking(report).length, `${status} holds its slot but was not reported`)
        .toBeGreaterThan(0);
    }

    // And the converse: a status that does not occupy must not be reported.
    for (const status of [
      SessionStatus.CANCELLED,
      SessionStatus.REJECTED,
      SessionStatus.REQUESTED,
    ]) {
      await db.sessionOccurrence.update({ where: { id: occurrence.id }, data: { status } });
      const report = await check(db, org, {
        start: occurrence.scheduledStart,
        end: occurrence.scheduledEnd,
        instructorId: instructor.id,
        checkAvailability: false,
      });
      expect(blocking(report).length, `${status} does not hold a slot but was reported`).toBe(
        0,
      );
    }
  });

  it("can still cancel a rescheduled session", async () => {
    // The status is a label for coordinators, not a different set of rules.
    const { created } = await bookAs(admin);
    const [moved] = await sessionOps.reschedule(
      db,
      org,
      admin,
      created[0]!,
      moveTo(created[0]!, "18:00"),
    );

    const cancelled = await sessionOps.cancel(db, org, admin, moved!, {
      reason: "weather",
      scope: EditScope.THIS,
    });

    expect(cancelled.map((o) => o.id)).toEqual([moved!.id]);
    expect(cancelled[0]!.status).toBe(SessionStatus.CANCELLED);
  });

  it("refuses a conflict error rather than an integrity error at approval", async () => {
    const { created: requested } = await bookAs(parentPrincipal);
    await bookAs(admin);

    await expect(
      sessionOps.decideRequest(db, org, admin, requested[0]!, { approve: true }),
    ).rejects.toBeInstanceOf(ConflictError);
  });
});
