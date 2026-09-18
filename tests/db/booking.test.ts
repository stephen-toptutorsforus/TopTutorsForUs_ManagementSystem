/**
 * Booking, conflicts, edit scopes, and attendance — against the real database.
 *
 * Ported from `tests/test_booking.py`. These cover the Phase 1 definition of
 * done: preview a series, detect conflicts, edit one occurrence without
 * touching the series, edit the series with an explicit scope, and record
 * attendance with an audit trail.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import {
  AttendanceStatus,
  DeliveryType,
  ParticipantRole,
  Role,
  SessionStatus,
} from "@/generated/prisma/enums";
import { ConflictError, Forbidden, ValidationError } from "@/lib/errors";
import { ConflictKind } from "@/lib/conflicts";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import {
  type BookingOrganization,
  type BookingRequest,
  EditScope,
  conflictedSessions,
  createFromPlan,
  isBookable,
  needsOverride,
  plan,
  planTotal,
} from "@/lib/services/booking";
import { INELIGIBLE_INSTRUCTOR } from "@/lib/services/instructorEligibility";
import * as sessionOps from "@/lib/services/sessionOps";
import { newRef } from "@/lib/ref";
import { civilDate, civilTime, dateToDb, resolveCivil, timeToDb } from "@/lib/time";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-04-06";

describeDb("booking", () => {
  let db: PrismaClient;
  let org: BookingOrganization & { id: bigint };
  let otherOrg: { id: bigint };
  let admin: Principal;
  let instructor: { id: bigint; ref: string };
  let student: { id: bigint; ref: string };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** The instructor is bookable 08:00–20:00 every weekday. */
  async function wideAvailability(who: bigint) {
    // No organization_availability rows: with none declared there is no
    // organization-wide bound to intersect against, which is what the
    // reference's booking fixtures rely on too.
    for (const weekday of ["mon", "tue", "wed", "thu", "fri"]) {
      await db.availabilityRule.create({
        data: {
          ref: newRef("avr"),
          organizationId: org.id,
          instructorId: who,
          weekday,
          startTime: timeToDb("08:00"),
          endTime: timeToDb("20:00"),
          timezone: NY,
        },
      });
    }
  }

  beforeEach(async () => {
    await reset(db);
    org = (await makeOrganization(db, { timezone: NY })) as typeof org;
    otherOrg = await makeOrganization(db, { timezone: "America/Los_Angeles" });

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

    admin = await loadPrincipal(db, adminUser.id);
    await wideAvailability(instructor.id);
    // The shipped `booking.assigned_users_only` is true, which now means what
    // it always said: an instructor may only teach a student they are assigned
    // to. These tests are about scheduling rather than eligibility, so the
    // fixture makes the pairing a legitimate one instead of an exception —
    // `tests/db/instructorEligibility.test.ts` is where the rule itself is
    // held, and the cases below cover its effect on booking.
    await assign(instructor.id, student.id);
  });

  /** Make this instructor eligible to teach this student. */
  async function assign(instructorId: bigint, studentId: bigint) {
    await db.instructorStudent.create({
      data: { organizationId: org.id, instructorId, studentId },
    });
  }

  /** Reload the organization after a settings change, so the plan sees it. */
  async function configure(settings: Record<string, unknown>) {
    org = (await db.organization.update({
      where: { id: org.id },
      data: { settings: settings as Prisma.InputJsonValue },
    })) as typeof org;
  }

  function booking(
    who: { id: bigint },
    learner: { id: bigint },
    overrides: Partial<BookingRequest> = {},
  ): BookingRequest {
    return {
      title: "Algebra practice",
      deliveryType: DeliveryType.EXTERNAL_LINK,
      meetingUrl: "https://meet.example.test/room/abc",
      startDate: MONDAY,
      startTime: "16:00",
      durationMinutes: 60,
      timezone: NY,
      instructorId: who.id,
      studentIds: [learner.id],
      repeat: false,
      frequency: "weekly",
      weekdays: [],
      endMode: "count",
      occurrenceCount: null,
      ...overrides,
    };
  }

  /** A fixed "now" a week before the booking, so tests never drift with time. */
  function before(request: BookingRequest): Date {
    const startOfDay = new Date(`${request.startDate}T09:00:00.000Z`);
    return new Date(startOfDay.getTime() - 7 * 86_400_000);
  }

  function requestStart(request: BookingRequest): Date {
    return resolveCivil(request.startDate, request.startTime, request.timezone).instant;
  }

  async function book(request: BookingRequest, now?: Date) {
    const bookingPlan = await plan(db, org, admin, request, now ?? before(request));
    return createFromPlan(db, org, admin, bookingPlan);
  }

  const kindsIn = (bookingPlan: Awaited<ReturnType<typeof plan>>) =>
    new Set(
      bookingPlan.sessions.flatMap((planned) =>
        planned.report.conflicts.map((conflict) => conflict.kind),
      ),
    );

  async function anotherInstructor(email: string, last: string) {
    const person = await makeUser(db, org.id, {
      first: "Lior",
      last,
      email,
      roles: [Role.INSTRUCTOR],
    });
    await db.availabilityRule.create({
      data: {
        ref: newRef("avr"),
        organizationId: org.id,
        instructorId: person.id,
        weekday: "mon",
        startTime: timeToDb("08:00"),
        endTime: timeToDb("20:00"),
        timezone: NY,
      },
    });
    await assign(person.id, student.id);
    return person;
  }

  // --- Booking -------------------------------------------------------------

  it("creates a standalone session with its roster", async () => {
    const { series, created } = await book(booking(instructor, student));

    // A single session has no series.
    expect(series).toBeNull();
    expect(created.length).toBe(1);

    const occurrence = created[0]!;
    expect(occurrence.status).toBe(SessionStatus.SCHEDULED);
    expect(civilTime(occurrence.scheduledStart, NY)).toBe("16:00");
    expect(sessionOps.scheduledDurationMinutes(occurrence)).toBe(60);
    // It has not run yet.
    expect(sessionOps.actualDurationMinutes(occurrence)).toBeNull();

    const participants = await db.sessionParticipant.findMany({
      where: { sessionId: occurrence.id },
    });
    expect(new Map(participants.map((p) => [p.userId, p.role]))).toEqual(
      new Map([
        [instructor.id, ParticipantRole.INSTRUCTOR],
        [student.id, ParticipantRole.STUDENT],
      ]),
    );
  });

  it("generates every occurrence of a recurring series", async () => {
    const { series, created } = await book(
      booking(instructor, student, {
        repeat: true,
        weekdays: ["mon", "thu"],
        occurrenceCount: 6,
      }),
    );

    expect(series).not.toBeNull();
    expect(created.length).toBe(6);
    expect(created.map((o) => o.seriesIndex)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(created.map((o) => new Date(`${civilDate(o.scheduledStart, NY)}T00:00:00Z`).getUTCDay()))
      .toEqual([1, 4, 1, 4, 1, 4]);
    expect(created.every((o) => o.seriesId === series!.id)).toBe(true);
  });

  it("reports every occurrence in a preview before anything is written", async () => {
    const request = booking(instructor, student, {
      repeat: true,
      weekdays: ["mon"],
      occurrenceCount: 4,
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));

    expect(planTotal(bookingPlan)).toBe(4);
    expect(isBookable(bookingPlan)).toBe(true);
    expect(bookingPlan.sessions.map((p) => p.occurrence.localDate)).toEqual([
      "2026-04-06",
      "2026-04-13",
      "2026-04-20",
      "2026-04-27",
    ]);
    // A preview writes nothing.
    expect(await db.sessionOccurrence.count()).toBe(0);
  });

  it("skips a closure and still delivers the count asked for", async () => {
    await db.offDay.create({
      data: {
        organizationId: org.id,
        day: dateToDb("2026-04-13"),
        label: "Spring break",
      },
    });

    const { created } = await book(
      booking(instructor, student, {
        repeat: true,
        weekdays: ["mon"],
        occurrenceCount: 4,
      }),
    );

    const dates = created.map((o) => civilDate(o.scheduledStart, NY));
    expect(created.length).toBe(4);
    expect(dates).not.toContain("2026-04-13");
    expect(dates[dates.length - 1]).toBe("2026-05-04");
  });

  // --- Conflicts -----------------------------------------------------------

  it("detects a double-booked instructor before writing", async () => {
    await book(booking(instructor, student));

    const second = booking(instructor, student, { startTime: "16:30" });
    const bookingPlan = await plan(db, org, admin, second, before(second));

    expect(kindsIn(bookingPlan).has(ConflictKind.INSTRUCTOR_BUSY)).toBe(true);
    // An instructor clash cannot be overridden.
    expect(isBookable(bookingPlan)).toBe(false);
  });

  it("does not count back-to-back sessions as a conflict", async () => {
    await book(booking(instructor, student));

    const adjacent = booking(instructor, student, { startTime: "17:00" });
    const bookingPlan = await plan(db, org, admin, adjacent, before(adjacent));

    expect(isBookable(bookingPlan)).toBe(true);
    expect(conflictedSessions(bookingPlan)).toEqual([]);
  });

  it("detects a student already booked elsewhere", async () => {
    await book(booking(instructor, student));
    const other = await anotherInstructor("lior.tamm@example.test", "Tamm");

    const clash = booking(other, student, { startTime: "16:30" });
    const bookingPlan = await plan(db, org, admin, clash, before(clash));

    expect(kindsIn(bookingPlan).has(ConflictKind.STUDENT_BUSY)).toBe(true);
    // A student clash is a warning an admin may override.
    expect(needsOverride(bookingPlan)).toBe(true);
  });

  it("warns about booking outside declared availability but allows an override", async () => {
    const request = booking(instructor, student, { startTime: "06:00" });
    const bookingPlan = await plan(db, org, admin, request, before(request));

    expect(kindsIn(bookingPlan).has(ConflictKind.OUTSIDE_AVAILABILITY)).toBe(true);
    await expect(createFromPlan(db, org, admin, bookingPlan)).rejects.toBeInstanceOf(
      ConflictError,
    );

    const overriding = booking(instructor, student, {
      startTime: "06:00",
      overrideConflicts: true,
    });
    const overridden = await plan(db, org, admin, overriding, before(overriding));
    const { created } = await createFromPlan(db, org, admin, overridden);

    expect(created[0]!.conflictOverridden).toBe(true);
  });

  it("does not let an instructor override a conflict", async () => {
    const principal = await loadPrincipal(db, instructor.id);
    const request = booking(instructor, student, {
      startTime: "06:00",
      overrideConflicts: true,
    });
    const bookingPlan = await plan(db, org, principal, request, before(request));

    await expect(createFromPlan(db, org, principal, bookingPlan)).rejects.toThrow(
      "over a conflict",
    );
  });

  it("does not let a room hold two in-person sessions", async () => {
    const room = await db.location.create({
      data: { ref: newRef("loc"), organizationId: org.id, name: "Room 2" },
    });

    await book(
      booking(instructor, student, {
        deliveryType: DeliveryType.IN_PERSON,
        meetingUrl: null,
        locationId: room.id,
      }),
    );

    const other = await anotherInstructor("sana.holm@example.test", "Holm");
    const second = booking(other, student, {
      startTime: "16:30",
      deliveryType: DeliveryType.IN_PERSON,
      meetingUrl: null,
      locationId: room.id,
    });
    const bookingPlan = await plan(db, org, admin, second, before(second));

    expect(kindsIn(bookingPlan).has(ConflictKind.LOCATION_BUSY)).toBe(true);
  });

  it("refuses a series that clashes with itself", async () => {
    // A 26-hour session repeating daily overlaps its own next occurrence.
    await configure({
      booking: { selectable_durations_minutes: [1560] },
      classroom: { enabled_delivery_types: ["external_link"] },
    });

    const request = booking(instructor, student, {
      repeat: true,
      durationMinutes: 1560,
      occurrenceCount: 3,
      frequency: "daily",
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));

    expect(bookingPlan.selfOverlaps.length).toBeGreaterThan(0);
    await expect(createFromPlan(db, org, admin, bookingPlan)).rejects.toThrow(
      "overlap each other",
    );
  });

  it("leaves nothing behind when a series fails", async () => {
    // Occurrence 2 clashes; the whole booking must fail, not the first half.
    await book(booking(instructor, student, { startDate: "2026-04-13" }));
    const written = await db.sessionOccurrence.count();

    const request = booking(instructor, student, {
      repeat: true,
      weekdays: ["mon"],
      occurrenceCount: 4,
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));

    await expect(createFromPlan(db, org, admin, bookingPlan)).rejects.toBeInstanceOf(
      ConflictError,
    );
    // No partial series.
    expect(await db.sessionOccurrence.count()).toBe(written);
  });

  // --- Validation ----------------------------------------------------------

  it("refuses a session length outside the tenant list", async () => {
    await configure({ booking: { selectable_durations_minutes: [30, 60] } });

    const request = booking(instructor, student, { durationMinutes: 75 });
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      "session length",
    );
  });

  // --- Repeat days ---------------------------------------------------------
  //
  // A run whose Mondays and Wednesdays differ. The engine is held in
  // `tests/repeatDays.test.ts`; these are about what reaches the database,
  // because occurrences owning their own schedule is what makes it possible at
  // all — nothing below the recurrence module had to change.

  it("writes each repeat day at its own time and length", async () => {
    const { series, created } = await book(
      booking(instructor, student, {
        repeat: true,
        occurrenceCount: 4,
        weekdays: ["mon", "wed"],
        perWeekday: {
          mon: { startTime: "16:00", durationMinutes: 60 },
          wed: { startTime: "17:30", durationMinutes: 30 },
        },
      }),
    );

    expect(series).not.toBeNull();
    expect(created).toHaveLength(4);

    const minutes = created.map(
      (row) => (row.scheduledEnd.getTime() - row.scheduledStart.getTime()) / 60_000,
    );
    expect(minutes).toEqual([60, 30, 60, 30]);

    // And the dates, read back in the session's own zone rather than trusting
    // the instants to look right in UTC.
    expect(created.map((row) => civilDate(row.scheduledStart, NY))).toEqual([
      "2026-04-06",
      "2026-04-08",
      "2026-04-13",
      "2026-04-15",
    ]);
  });

  it("keeps the series' own default while its occurrences differ", async () => {
    // The series row is a template, not a second copy of the schedule. It
    // records the pattern's first day; the occurrences carry the rest, which
    // is the architecture's whole reason for materialising them.
    const { series, created } = await book(
      booking(instructor, student, {
        repeat: true,
        occurrenceCount: 2,
        weekdays: ["mon", "wed"],
        perWeekday: {
          mon: { startTime: "16:00", durationMinutes: 60 },
          wed: { startTime: "17:30", durationMinutes: 30 },
        },
      }),
    );

    expect(series!.defaultDurationMinutes).toBe(60);
    expect(series!.weekdays).toEqual(["mon", "wed"]);
    expect(
      (created[1]!.scheduledEnd.getTime() - created[1]!.scheduledStart.getTime()) / 60_000,
    ).toBe(30);
  });

  it("refuses a repeat day whose length the tenant does not offer", async () => {
    // The per-day field is repeated, which is not a reason to trust it. Without
    // this the top-level length is checked and the rest go straight through.
    const request = booking(instructor, student, {
      repeat: true,
      occurrenceCount: 2,
      weekdays: ["mon", "wed"],
      perWeekday: { wed: { startTime: "17:30", durationMinutes: 37 } },
    });
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      /length for wed/,
    );
  });

  it("ignores a repeat pattern on a booking that does not repeat", async () => {
    // The panel is hidden below two sessions but its fields still submit.
    const { series, created } = await book(
      booking(instructor, student, {
        repeat: false,
        occurrenceCount: 1,
        weekdays: ["mon", "wed"],
        perWeekday: { mon: { startTime: "09:00", durationMinutes: 15 } },
      }),
    );

    expect(series).toBeNull();
    expect(created).toHaveLength(1);
    expect(
      (created[0]!.scheduledEnd.getTime() - created[0]!.scheduledStart.getTime()) / 60_000,
    ).toBe(60);
  });

  it("refuses a delivery type whose feature the tenant does not have", async () => {
    // It was in the shipped `enabled_delivery_types` while `DEFAULT_FEATURES`
    // shipped the feature off — an option for a way of delivering a session
    // that nothing implements.
    await configure({
      classroom: { enabled_delivery_types: ["advanced_classroom", "external_link"] },
    });
    const request = booking(instructor, student, {
      deliveryType: DeliveryType.ADVANCED_CLASSROOM,
    });
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      "not enabled",
    );

    // With the feature on it is an ordinary delivery type again.
    org = (await db.organization.update({
      where: { id: org.id },
      data: { features: { advanced_classroom: true } },
    })) as typeof org;
    const allowed = await plan(db, org, admin, request, before(request));
    expect(planTotal(allowed)).toBe(1);
  });

  it("refuses a disabled delivery type", async () => {
    await configure({ classroom: { enabled_delivery_types: ["in_person"] } });

    const request = booking(instructor, student);
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      "not enabled",
    );
  });

  it.each([
    "javascript:alert(1)",
    "ftp://files.example.test/x",
    "https://user:pw@meet.test/x",
  ])("refuses the unsafe meeting link %s", async (url) => {
    const request = booking(instructor, student, { meetingUrl: url });
    await expect(plan(db, org, admin, request, before(request))).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it("enforces the booking lead time", async () => {
    await configure({ booking: { lead_time_minutes: 120 } });

    const request = booking(instructor, student);
    const justBefore = new Date(requestStart(request).getTime() - 30 * 60_000);

    await expect(plan(db, org, admin, request, justBefore)).rejects.toThrow(
      "at least 120 minutes ahead",
    );
  });

  it("enforces the future horizon", async () => {
    await configure({ booking: { max_future_days: 30 } });

    const request = booking(instructor, student, { startDate: "2026-12-07" });
    await expect(
      plan(db, org, admin, request, before(booking(instructor, student))),
    ).rejects.toThrow("more than 30 days ahead");
  });

  it("needs the historical permission to book in the past", async () => {
    const principal = await loadPrincipal(db, instructor.id);
    const request = booking(instructor, student);
    const afterTheFact = new Date(requestStart(request).getTime() + 86_400_000);

    await expect(plan(db, org, principal, request, afterTheFact)).rejects.toThrow(
      "in the past",
    );
  });

  it("lets an administrator book a historical session", async () => {
    const request = booking(instructor, student);
    const afterTheFact = new Date(requestStart(request).getTime() + 86_400_000);

    expect(planTotal(await plan(db, org, admin, request, afterTheFact))).toBe(1);
  });

  it("does not let a student from another tenant be added", async () => {
    const outsider = await makeUser(db, otherOrg.id, {
      first: "Mira",
      last: "Dane",
      email: "mira.dane@example.test",
      roles: [Role.STUDENT],
    });

    const request = booking(instructor, outsider);
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      "not available",
    );
  });

  // --- Eligibility ---------------------------------------------------------
  //
  // Hiding a name in a dropdown is a courtesy. These are the checks that make
  // it authorization: they run in `plan()` and again in `createFromPlan()`,
  // through the same service the booking screen draws its list from.

  it("refuses to preview a booking with an instructor the student is not assigned to", async () => {
    const stranger = await anotherInstructor("noa.brandt@example.test", "Brandt");
    await db.instructorStudent.deleteMany({ where: { instructorId: stranger.id } });

    const request = booking(stranger, student);
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      INELIGIBLE_INSTRUCTOR,
    );
  });

  it("refuses at creation an instructor who stopped being eligible after the preview", async () => {
    // The window this closes: a preview can sit on a screen for an hour, and
    // the confirm that follows must not honour an assignment withdrawn since.
    const request = booking(instructor, student);
    const previewed = await plan(db, org, admin, request, before(request));
    expect(isBookable(previewed)).toBe(true);

    await db.instructorStudent.updateMany({
      where: { instructorId: instructor.id, studentId: student.id },
      data: { archivedAt: new Date() },
    });

    await expect(createFromPlan(db, org, admin, previewed)).rejects.toThrow(
      INELIGIBLE_INSTRUCTOR,
    );
    expect(await db.sessionOccurrence.count({ where: { organizationId: org.id } })).toBe(0);
  });

  it("books normally when every student on the roster is assigned", async () => {
    const second = await makeUser(db, org.id, {
      first: "Nadia",
      last: "Ferrand",
      email: "nadia.ferrand@example.test",
      roles: [Role.STUDENT],
    });
    await assign(instructor.id, second.id);

    const { created } = await book(
      booking(instructor, student, { studentIds: [student.id, second.id] }),
    );
    expect(created).toHaveLength(1);
  });

  it("needs every student assigned, not the first one", async () => {
    const unassigned = await makeUser(db, org.id, {
      first: "Marek",
      last: "Sowinski",
      email: "marek.sowinski@example.test",
      roles: [Role.STUDENT],
    });

    const request = booking(instructor, student, {
      studentIds: [student.id, unassigned.id],
    });
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      INELIGIBLE_INSTRUCTOR,
    );
  });

  it("counts a group's members when deciding eligibility", async () => {
    const member = await makeUser(db, org.id, {
      first: "Sana",
      last: "Whitfield",
      email: "sana.whitfield@example.test",
      roles: [Role.STUDENT],
    });
    const group = await db.group.create({
      data: { ref: newRef("grp"), organizationId: org.id, name: "Monday Algebra" },
    });
    await db.groupMember.create({
      data: {
        organizationId: org.id,
        groupId: group.id,
        userId: member.id,
        memberRole: "student",
      },
    });

    const request = booking(instructor, student, {
      studentIds: [],
      groupId: group.id,
    });
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      INELIGIBLE_INSTRUCTOR,
    );

    await assign(instructor.id, member.id);
    const { created } = await book(request);
    expect(created).toHaveLength(1);
  });

  it("lets a tenant configured for any instructor book an unassigned one", async () => {
    await configure({ booking: { instructor_eligibility_mode: "any_instructor" } });
    const stranger = await anotherInstructor("perry.lund@example.test", "Lund");
    await db.instructorStudent.deleteMany({ where: { instructorId: stranger.id } });

    const { created } = await book(booking(stranger, student));
    expect(created).toHaveLength(1);
  });

  it("does not let another tenant's assignment make an instructor eligible", async () => {
    const stranger = await anotherInstructor("kai.oyelaran@example.test", "Oyelaran");
    await db.instructorStudent.deleteMany({ where: { instructorId: stranger.id } });
    // A row in the other organization linking our two people. It is not ours to
    // read, and it must not turn into permission to book.
    await db.instructorStudent.create({
      data: {
        organizationId: otherOrg.id,
        instructorId: stranger.id,
        studentId: student.id,
      },
    });

    const request = booking(stranger, student);
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      INELIGIBLE_INSTRUCTOR,
    );
  });

  it("refuses a booking with no instructor and one with no students", async () => {
    const noInstructor = booking(instructor, student, { instructorId: null });
    await expect(plan(db, org, admin, noInstructor, before(noInstructor))).rejects.toThrow(
      "needs an instructor",
    );

    const noStudents = booking(instructor, student, { studentIds: [], groupId: null });
    await expect(plan(db, org, admin, noStudents, before(noStudents))).rejects.toThrow(
      "at least one student",
    );
  });

  it("books a hundred sessions across three days, ending mid-week", async () => {
    // The example this ceiling was raised for. 33 whole weeks of three, and the
    // hundredth on the Monday of the 34th — through the real service, so the
    // count check, the expansion and the write all agree about it.
    const request = booking(instructor, student, {
      repeat: true,
      occurrenceCount: 100,
      weekdays: ["mon", "wed", "fri"],
      perWeekday: {
        mon: { startTime: "16:00", durationMinutes: 60 },
        wed: { startTime: "17:30", durationMinutes: 30 },
        fri: { startTime: "09:00", durationMinutes: 90 },
      },
    });

    const previewed = await plan(db, org, admin, request, before(request));
    expect(planTotal(previewed)).toBe(100);
    expect(previewed.expansion.truncated).toBe(false);
    expect(civilDate(previewed.sessions.at(-1)!.occurrence.start, NY)).toBe("2026-11-23");

    // Three distinct lengths in the run, and the leftover Monday keeps
    // Monday's hour rather than inheriting the previous day's.
    const minutes = previewed.sessions.map((s) => s.occurrence.durationMinutes);
    expect(new Set(minutes)).toEqual(new Set([60, 30, 90]));
    expect(minutes.at(-1)).toBe(60);
  });

  it("refuses a count past the tenant ceiling rather than silently truncating", async () => {
    // Configured rather than relying on the shipped number, so raising the
    // default does not quietly turn this into a test of nothing.
    await configure({ booking: { max_occurrences_per_series: 12 } });
    const request = booking(instructor, student, {
      repeat: true,
      weekdays: ["mon"],
      occurrenceCount: 500,
    });
    await expect(plan(db, org, admin, request, before(request))).rejects.toThrow(
      "book at most 12 sessions at once",
    );
  });

  // --- Edit scopes ---------------------------------------------------------

  async function aSeries(count = 4, startDate = MONDAY) {
    const { created } = await book(
      booking(instructor, student, {
        repeat: true,
        weekdays: ["mon"],
        occurrenceCount: count,
        startDate,
      }),
    );
    return created;
  }

  const moveTo = (occurrence: { scheduledStart: Date }, time: string) => ({
    startDate: civilDate(occurrence.scheduledStart, NY),
    startTime: time,
    durationMinutes: 60,
    timezone: NY,
  });

  const reload = (id: bigint) => db.sessionOccurrence.findUniqueOrThrow({ where: { id } });

  it("leaves the series alone when one occurrence is edited", async () => {
    const created = await aSeries();
    const target = created[1]!;
    const others = created.filter((o) => o.id !== target.id);

    const [moved] = await sessionOps.reschedule(db, org, admin, target, moveTo(target, "18:00"), {
      scope: EditScope.THIS,
    });

    expect(civilTime(moved!.scheduledStart, NY)).toBe("18:00");
    expect(moved!.detachedFromSeries).toBe(true);
    for (const other of others) {
      const now = await reload(other.id);
      // The rest of the series did not move.
      expect(now.scheduledStart).toEqual(other.scheduledStart);
      expect(now.detachedFromSeries).toBe(false);
    }
  });

  it("moves every remaining occurrence when the series is edited", async () => {
    const created = await aSeries();

    const changed = await sessionOps.reschedule(
      db,
      org,
      admin,
      created[0]!,
      moveTo(created[0]!, "17:00"),
      { scope: EditScope.ALL },
    );

    expect(changed.length).toBe(4);
    for (const occurrence of created) {
      expect(civilTime((await reload(occurrence.id)).scheduledStart, NY)).toBe("17:00");
    }
  });

  it("skips an occurrence already detached when the series is edited", async () => {
    // The whole point of detaching: a later series edit must not undo it.
    const created = await aSeries();
    const detached = created[2]!;
    await sessionOps.reschedule(db, org, admin, detached, moveTo(detached, "09:00"), {
      scope: EditScope.THIS,
    });

    await sessionOps.reschedule(db, org, admin, created[0]!, moveTo(created[0]!, "17:00"), {
      scope: EditScope.ALL,
    });

    // The detached occurrence kept its own time.
    expect(civilTime((await reload(detached.id)).scheduledStart, NY)).toBe("09:00");
  });

  it("leaves earlier occurrences untouched at this-and-future scope", async () => {
    const created = await aSeries();
    const pivot = created[2]!;

    const changed = await sessionOps.reschedule(db, org, admin, pivot, moveTo(pivot, "18:30"), {
      scope: EditScope.THIS_AND_FUTURE,
    });

    expect(new Set(changed.map((o) => o.id))).toEqual(
      new Set([created[2]!.id, created[3]!.id]),
    );
    for (const earlier of created.slice(0, 2)) {
      expect(civilTime((await reload(earlier.id)).scheduledStart, NY)).toBe("16:00");
    }
  });

  it("does not rewrite a completed occurrence in a series edit", async () => {
    const created = await aSeries();
    await sessionOps.complete(db, admin, created[0]!);
    const heldStart = created[0]!.scheduledStart;

    await sessionOps.reschedule(db, org, admin, created[1]!, moveTo(created[1]!, "19:00"), {
      scope: EditScope.ALL,
    });

    // What already happened is not rewritten.
    expect((await reload(created[0]!.id)).scheduledStart).toEqual(heldStart);
  });

  it("survives a DST boundary when a series moves by wall clock", async () => {
    // Moving a series to 17:00 puts every occurrence at 17:00 local, both sides
    // of the change — not at a fixed offset from the old instant.
    const created = await aSeries(4, "2026-02-23");

    await sessionOps.reschedule(db, org, admin, created[0]!, moveTo(created[0]!, "17:00"), {
      scope: EditScope.ALL,
    });

    for (const occurrence of created) {
      expect(civilTime((await reload(occurrence.id)).scheduledStart, NY)).toBe("17:00");
    }
  });

  // --- Status and attendance -----------------------------------------------

  it("leaves the held sessions alone when a series is cancelled", async () => {
    const created = await aSeries();
    await sessionOps.complete(db, admin, created[0]!);

    const cancelled = await sessionOps.cancel(db, org, admin, created[1]!, {
      reason: "instructor_unavailable",
      scope: EditScope.THIS_AND_FUTURE,
    });

    expect(new Set(cancelled.map((o) => o.id))).toEqual(
      new Set([created[1]!.id, created[2]!.id, created[3]!.id]),
    );
    expect((await reload(created[0]!.id)).status).toBe(SessionStatus.COMPLETED);
  });

  it("refuses an unconfigured cancellation reason", async () => {
    const { created } = await book(booking(instructor, student));

    await expect(
      sessionOps.cancel(db, org, admin, created[0]!, { reason: "felt like it" }),
    ).rejects.toThrow("configured cancellation reason");
  });

  it("records actual duration separately from scheduled", async () => {
    const { created } = await book(booking(instructor, student));
    const occurrence = created[0]!;

    const held = await sessionOps.complete(db, admin, occurrence, {
      actualStart: new Date(occurrence.scheduledStart.getTime() + 5 * 60_000),
      actualEnd: new Date(occurrence.scheduledEnd.getTime() - 10 * 60_000),
    });

    expect(sessionOps.scheduledDurationMinutes(held)).toBe(60);
    expect(sessionOps.actualDurationMinutes(held)).toBe(45);
  });

  it("records attendance per participant", async () => {
    const { created } = await book(booking(instructor, student));
    const occurrence = created[0]!;
    const participant = await db.sessionParticipant.findFirstOrThrow({
      where: { sessionId: occurrence.id, userId: student.id },
    });

    const marked = await sessionOps.markAttendance(db, admin, occurrence, participant, {
      status: AttendanceStatus.LATE,
      joinedAt: new Date(occurrence.scheduledStart.getTime() + 8 * 60_000),
      leftAt: occurrence.scheduledEnd,
    });

    expect(marked.attendance).toBe(AttendanceStatus.LATE);
    expect(marked.attendedMinutes).toBe(52);
    expect(marked.markedById).toBe(admin.userId);
  });

  it("never overwrites a considered mark when bulk-marking", async () => {
    const absent = await makeUser(db, org.id, {
      first: "Yusuf",
      last: "Adeyemi",
      email: "yusuf.adeyemi@example.test",
      roles: [Role.STUDENT],
    });
    const present = await makeUser(db, org.id, {
      first: "Wren",
      last: "Calloway",
      email: "wren.calloway@example.test",
      roles: [Role.STUDENT],
    });
    await assign(instructor.id, absent.id);
    await assign(instructor.id, present.id);

    const { created } = await book(
      booking(instructor, absent, { studentIds: [absent.id, present.id] }),
    );
    const occurrence = created[0]!;

    const judged = await db.sessionParticipant.findFirstOrThrow({
      where: { sessionId: occurrence.id, userId: absent.id },
    });
    await sessionOps.markAttendance(db, admin, occurrence, judged, {
      status: AttendanceStatus.ABSENT,
    });

    const touched = await sessionOps.markAllPresent(db, admin, occurrence);

    expect(new Set(touched.map((p) => p.userId))).toEqual(new Set([present.id]));
    const stillAbsent = await db.sessionParticipant.findUniqueOrThrow({
      where: { id: judged.id },
    });
    // The explicit mark survived.
    expect(stillAbsent.attendance).toBe(AttendanceStatus.ABSENT);
  });

  // --- Audit ---------------------------------------------------------------

  it("leaves an audit entry for every change", async () => {
    const { created } = await book(booking(instructor, student));
    const occurrence = created[0]!;

    await sessionOps.reschedule(db, org, admin, occurrence, moveTo(occurrence, "18:00"));
    await sessionOps.cancel(db, org, admin, await reload(occurrence.id), {
      reason: "weather",
      note: "ice storm",
    });

    const events = await db.auditEvent.findMany({
      where: { entityRef: occurrence.ref },
      orderBy: { id: "asc" },
    });

    expect(events.map((e) => e.action)).toEqual([
      "session.created",
      "session.rescheduled",
      "session.cancelled",
    ]);
    const moved = (events[1]!.changes as Record<string, { from: string; to: string }>)
      .scheduled_start!;
    expect(moved.from).not.toBe(moved.to);
    expect(events[0]!.actorLabel).toBe(admin.displayName);
  });

  it("records that a note was given, not what it said", async () => {
    const { created } = await book(booking(instructor, student));

    await sessionOps.cancel(db, org, admin, created[0]!, {
      reason: "other",
      note: "Parent said the family is moving to 14 Rowan Street",
    });

    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "session.cancelled" },
    });
    const serialised = JSON.stringify(event.changes);

    expect(serialised).not.toContain("Rowan Street");
    expect(serialised).not.toContain("moving");
    expect(
      (event.changes as Record<string, { to: string }>).cancellation_note!.to,
    ).toBe("«provided»");
  });

  it("records a conflict override", async () => {
    const request = booking(instructor, student, {
      startTime: "06:00",
      overrideConflicts: true,
    });
    const bookingPlan = await plan(db, org, admin, request, before(request));
    const { created } = await createFromPlan(db, org, admin, bookingPlan);

    const event = await db.auditEvent.findFirstOrThrow({
      where: { entityRef: created[0]!.ref },
    });
    expect(event.note).toBe("conflict override");
    expect(created[0]!.conflictOverridden).toBe(true);
  });

  it("writes no reschedule event for a session that never moved", async () => {
    // Recording a non-change would bury the changes that matter.
    const { created } = await book(booking(instructor, student));
    const occurrence = created[0]!;

    const changed = await sessionOps.reschedule(
      db,
      org,
      admin,
      occurrence,
      moveTo(occurrence, "16:00"),
    );

    expect(changed).toEqual([]);
    expect(await db.auditEvent.count({ where: { action: "session.rescheduled" } })).toBe(0);
  });

  it("cannot cancel a completed session", async () => {
    const { created } = await book(booking(instructor, student));
    const held = await sessionOps.complete(db, admin, created[0]!);

    await expect(
      sessionOps.cancel(db, org, admin, held, { reason: "participant_request" }),
    ).rejects.toThrow("cannot be cancelled");
  });

  it("does not let an instructor touch another instructor's session", async () => {
    const { created } = await book(booking(instructor, student));
    const outsider = await makeUser(db, org.id, {
      first: "Dara",
      last: "Nwosu",
      email: "dara.nwosu@example.test",
      roles: [Role.INSTRUCTOR],
    });
    const outsiderPrincipal = await loadPrincipal(db, outsider.id);

    await expect(
      sessionOps.editDetails(db, outsiderPrincipal, created[0]!, { title: "Renamed" }),
    ).rejects.toBeInstanceOf(Forbidden);
  });

  // --- Rescheduling is not editing -----------------------------------------

  it("cannot move a session that is in progress", async () => {
    // A lesson that has started cannot be moved to next week without leaving
    // the record describing something that did not happen.
    const { created } = await book(booking(instructor, student));
    const running = await db.sessionOccurrence.update({
      where: { id: created[0]!.id },
      data: { status: SessionStatus.IN_PROGRESS },
    });

    await expect(
      sessionOps.reschedule(db, org, admin, running, {
        startDate: "2026-04-13",
        startTime: "18:00",
        durationMinutes: 60,
        timezone: NY,
      }),
    ).rejects.toThrow("cannot be rescheduled");

    expect((await reload(running.id)).scheduledStart).toEqual(running.scheduledStart);
  });

  it("can still edit a session that is in progress", async () => {
    // The distinction being drawn. Correcting a title while a lesson runs is
    // fine; moving the lesson is not, and one gate cannot answer both.
    const { created } = await book(booking(instructor, student));
    const running = await db.sessionOccurrence.update({
      where: { id: created[0]!.id },
      data: { status: SessionStatus.IN_PROGRESS },
    });

    const [edited] = await sessionOps.editDetails(db, admin, running, {
      title: "Corrected title",
    });
    expect(edited!.title).toBe("Corrected title");
  });

  it("still moves a scheduled session", async () => {
    const { created } = await book(booking(instructor, student));
    const [moved] = await sessionOps.reschedule(
      db,
      org,
      admin,
      created[0]!,
      moveTo(created[0]!, "18:00"),
    );

    expect(civilTime(moved!.scheduledStart, NY)).toBe("18:00");
  });
  // --- Billable, on a product that charges for nothing ----------------------
  //
  // `booking.billable_enabled` ships off, so the booking form draws no Billable
  // box and the edit panel draws none either. A hidden control is a courtesy;
  // these are the checks that say so — every one of them sends `billable: true`
  // the way a crafted post or an older client would, and expects the write to
  // ignore it.

  it("books a free session however loudly the request asks to charge", async () => {
    const { created } = await book(booking(instructor, student, { billable: true }));
    expect(created[0]!.billable).toBe(false);
  });

  it("writes the series template free as well, not only the occurrences", async () => {
    // The series row is a template. One left billable would hand every
    // occurrence generated from it later the answer this rule just refused.
    const { series, created } = await book(
      booking(instructor, student, {
        billable: true,
        repeat: true,
        weekdays: ["mon"],
        occurrenceCount: 3,
      }),
    );
    expect(series!.billable).toBe(false);
    expect(created.map((row) => row.billable)).toEqual([false, false, false]);
  });

  it("honours the request once the tenant says it charges for something", async () => {
    // The setting is the whole rule, so this is the case that proves the rule
    // is the setting rather than a hard-coded `false` with a comment on it.
    await configure({ booking: { billable_enabled: true } });
    const { created } = await book(booking(instructor, student, { billable: true }));
    expect(created[0]!.billable).toBe(true);

    const free = await book(
      booking(instructor, student, { billable: false, startTime: "18:00" }),
    );
    expect(free.created[0]!.billable).toBe(false);
  });

  it("ignores an edit that tries to make a session billable", async () => {
    await configure({ booking: { billable_enabled: true } });
    const { created } = await book(booking(instructor, student, { billable: true }));
    await configure({ booking: { billable_enabled: false } });

    // Everything else in the same edit still lands: the field is dropped, not
    // the request.
    const [edited] = await sessionOps.editDetails(db, admin, created[0]!, {
      title: "Corrected title",
      billable: true,
      organization: org,
    });
    expect(edited!.title).toBe("Corrected title");
    expect(edited!.billable).toBe(true);

    const [stripped] = await sessionOps.editDetails(db, admin, edited!, {
      billable: false,
      organization: org,
    });
    // Nothing changed at all, so nothing was written — `editDetails` skips a
    // target whose snapshot is unmoved, which is what keeps the audit trail
    // free of entries recording no change.
    expect(stripped).toBeUndefined();
    expect((await reload(created[0]!.id)).billable).toBe(true);
  });
});
