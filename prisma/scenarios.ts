/**
 * Awkward-case fixtures for the calendar and the booking screen.
 *
 * The equivalent of the reference's `seeds/scenarios.py`, which `CLAUDE.md` has
 * recorded as unported since the port began. It exists because the ordinary
 * seed cannot show most of what these two screens can draw: `bookExamples`
 * books two things and both are `SCHEDULED`, since `createFromPlan` is the only
 * thing that has ever written a session. Cancelled, Completed, Missed,
 * Requested, Rejected and Rescheduled had therefore never appeared on a screen,
 * and neither had a month cell that overflows, a session at midnight, or an
 * instructor with no declared hours.
 *
 *     npm run db:scenarios
 *     npm run db:scenarios -- --refresh
 *
 * **Additive.** It writes into Northgate alongside whatever is already there and
 * deletes nothing. `--refresh` removes only the sessions this script created and
 * builds them again; it finds them by their program, so anything booked by hand
 * is untouched by it.
 *
 * **Built through the services, not around them.** Every session is created by
 * `plan()` and `createFromPlan()` and then moved into its state by the same
 * functions the screens call — `cancel`, `complete`, `markMissed`,
 * `reschedule`, `decideRequest`, `markAttendance`. A fixture written straight
 * into the table can be in a state the product cannot produce, and then it
 * teaches the wrong thing: the grid shows it, the policy layer disagrees, and
 * an afternoon goes into working out which is right. The cost of doing it this
 * way is that each of these rows also has a real audit trail behind it, which
 * is the other half of what makes it worth looking at.
 *
 * Every address is on the reserved `.test` domain, every name is invented, and
 * no meeting URL here resolves to anything.
 */

import { config } from "dotenv";

import type { Prisma, PrismaClient } from "../src/generated/prisma/client";
import {
  AttendanceStatus,
  DeliveryType,
  ParticipantRole,
  Role,
  SessionStatus,
  UserStatus,
} from "../src/generated/prisma/enums";
import { clientFor } from "../src/lib/db";
import { loadPrincipal, type Principal } from "../src/lib/policies/principal";
import { newRef } from "../src/lib/ref";
import { hashPassword } from "../src/lib/security";
import {
  createFromPlan,
  EditScope,
  plan,
  type BookingOrganization,
  type BookingRequest,
  type CreatedOccurrence,
} from "../src/lib/services/booking";
import {
  cancel,
  complete,
  decideRequest,
  markAttendance,
  markMissed,
  reschedule,
} from "../src/lib/services/sessionOps";
import {
  addDays,
  civilDate,
  dateToDb,
  isoWeekday,
  resolveCivil,
  timeToDb,
  type CivilDate,
} from "../src/lib/time";

config();

/** Development only; the same one the ordinary seed prints. */
const DEMO_PASSWORD = "TopTutorsForUsDemo!2026";

/**
 * The marker.
 *
 * Every session here carries this program, which does three jobs at once: the
 * script can tell whether it has run, `--refresh` can find exactly its own rows
 * and nothing else, and the field is on the session's own page — so when one of
 * these turns up in a search months from now, the page says where it came from.
 */
const MARKER = "Coverage scenarios";

/**
 * The label on the closure this script writes. Named rather than typed twice,
 * because `clearOwnAvailability` finds it by exactly this string and a closure
 * it fails to find is one that accumulates.
 */
const SCENARIO_CLOSURE = "Mid-term break";

type Db = PrismaClient;

// --- Placing the cases -------------------------------------------------------
//
// Anchored on today, so they land in the month somebody is looking at. Weekday
// times, because the seeded instructors declare Monday to Friday 09:00–19:00 and
// a fixture that is *accidentally* outside declared hours is noise. The two
// cases that are deliberately outside it say so.

/**
 * The `count`-th weekday after today.
 *
 * Counting weekdays rather than adding days and then sliding off the weekend,
 * because sliding collapses: with a Wednesday today, +10 lands on Saturday and
 * +12 on Monday, and both then slide to the *same* Monday. Two cases meant for
 * different days landed on one, the second clashed with the first, and the
 * script refused itself. Counting cannot do that — distinct counts are distinct
 * days, which is the only property anything here needs from it.
 */
function weekdayFrom(today: CivilDate, count: number): CivilDate {
  let day = today;
  for (let left = count; left > 0; ) {
    day = addDays(day, 1);
    if (isoWeekday(day) <= 5) left -= 1;
  }
  return day;
}

/** The `count`-th weekday before today, counted the same way and for the same reason. */
function weekdayBefore(today: CivilDate, count: number): CivilDate {
  let day = today;
  for (let left = count; left > 0; ) {
    day = addDays(day, -1);
    if (isoWeekday(day) <= 5) left -= 1;
  }
  return day;
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (["production", "prod"].includes((process.env.APP_ENV ?? "").toLowerCase())) {
    throw new Error("refusing to write scenarios into a production database");
  }

  const db = clientFor(url);
  const org = await db.organization.findUnique({ where: { slug: "northgate" } });
  if (org === null) throw new Error("run `npm run db:seed` first — Northgate is not there");

  const program = await markerProgram(db, org.id);
  const refresh = process.argv.includes("--refresh");

  const already = await db.sessionOccurrence.count({
    where: { organizationId: org.id, programId: program.id },
  });
  if (already > 0 && !refresh) {
    console.info(`${already} scenario sessions already here — nothing to do.`);
    console.info("Pass --refresh to rebuild them. Only these are touched.");
    await db.$disconnect();
    return;
  }
  if (already > 0) await removeOwn(db, org.id, program.id);

  const admin = await db.user.findFirstOrThrow({
    where: { organizationId: org.id, email: "rowan.mercer@example.test" },
  });
  const principal = await loadPrincipal(db, admin.id);

  const people = await cast(db, org.id, org.timezone);
  if (already > 0) {
    await clearOwnAvailability(
      db,
      org.id,
      people.instructors.map((who) => who.id),
    );
  }
  const context: Context = {
    db,
    org: org as BookingOrganization & { id: bigint; timezone: string },
    principal,
    programId: program.id,
    today: civilDate(new Date(), org.timezone),
    ...people,
  };

  await theSevenStatuses(context);
  await theBusyDay(context);
  await theSameHourTwice(context);
  await theEdgesOfTheDay(context);
  await theDeliveryTypes(context);
  await aSeriesWithHistory(context);
  await theAwkwardAvailability(context);

  const total = await db.sessionOccurrence.count({
    where: { organizationId: org.id, programId: program.id },
  });
  await db.$disconnect();

  console.info(`\n${total} scenario sessions in Northgate, all under "${MARKER}".`);
  console.info("Sign in as rowan.mercer@example.test and open /calendar.\n");
}

interface Context {
  db: Db;
  org: BookingOrganization & { id: bigint; timezone: string };
  principal: Principal;
  programId: bigint;
  today: CivilDate;
  instructors: { id: bigint; firstName: string }[];
  students: { id: bigint }[];
  parent: { id: bigint };
  quiet: { id: bigint };
  unassigned: { id: bigint };
  group: { id: bigint };
  room: { id: bigint } | null;
}

// --- The marker, and taking it back ------------------------------------------

async function markerProgram(db: Db, organizationId: bigint) {
  const found = await db.program.findFirst({ where: { organizationId, name: MARKER } });
  if (found) return found;
  return db.program.create({
    data: { ref: newRef("prg"), organizationId, name: MARKER },
  });
}

/**
 * Remove this script's own sessions, and nothing else.
 *
 * Scoped by the marker program rather than by date or title, so a session
 * somebody booked by hand on the same afternoon is not swept up with them. The
 * series rows go too, but only the ones left with no occurrences — a series
 * created elsewhere that happens to have a scenario occurrence on it keeps its
 * own rows.
 */
/**
 * Remove the availability artefacts this script leaves behind, and nothing else.
 *
 * `removeOwn` above clears the *sessions*, which was only ever half the job.
 * The exceptions, the time off and the closure are placed at offsets counted
 * from **today**, so a run on Thursday puts time off where the following
 * Tuesday's run wants to book — and since nothing removed them, they piled up.
 * The failure that found this: a two-hour block refused as "outside declared
 * availability" on a day the instructor plainly works, because a run nine days
 * earlier had put its own conference on that afternoon. Two other cases had
 * already been quietly landing on stale rows.
 *
 * Safe to delete outright because the cast is this script's own — the file
 * books its own instructors and students precisely so that it owns everything
 * about them. The closure goes by its label for the same reason: it is the one
 * this file writes, and the seed's "Staff training day" is left alone.
 *
 * Only on `--refresh`. A first run has nothing to clear, and a second run
 * without the flag does not get this far.
 */
async function clearOwnAvailability(
  db: Db,
  organizationId: bigint,
  instructorIds: readonly bigint[],
): Promise<void> {
  const where = { organizationId, instructorId: { in: [...instructorIds] } };
  const exceptions = await db.availabilityException.deleteMany({ where });
  const timeOff = await db.timeOff.deleteMany({ where });
  const closures = await db.offDay.deleteMany({
    where: { organizationId, label: SCENARIO_CLOSURE },
  });
  console.info(
    `removed ${exceptions.count} exceptions, ${timeOff.count} time-off rows, ` +
      `${closures.count} closures`,
  );
}

async function removeOwn(db: Db, organizationId: bigint, programId: bigint): Promise<void> {
  const mine = await db.sessionOccurrence.findMany({
    where: { organizationId, programId },
    select: { id: true, seriesId: true },
  });
  const ids = mine.map((row) => row.id);
  const seriesIds = [...new Set(mine.map((row) => row.seriesId).filter((id) => id !== null))];

  await db.sessionParticipant.deleteMany({ where: { sessionId: { in: ids } } });
  await db.sessionOccurrence.deleteMany({ where: { id: { in: ids } } });

  for (const seriesId of seriesIds) {
    const left = await db.sessionOccurrence.count({ where: { seriesId } });
    if (left === 0) await db.sessionSeries.delete({ where: { id: seriesId! } });
  }
  console.info(`removed ${ids.length} scenario sessions`);
}

// --- The people these cases need ---------------------------------------------

/**
 * A cast of its own, and that is the point.
 *
 * The first version of this script booked its cases onto the seeded
 * instructors and students, and the first run failed: the instructor already
 * had a session somebody had booked by hand at that hour. The refusal was
 * correct — `instructor_busy` is a conflict no override clears — but it made
 * the fixture depend on what else happened to be in the database, which is the
 * one thing a fixture must not do.
 *
 * So the scenarios own their people. Nothing else books these instructors, so
 * nothing can collide with them; nothing else enrols these students, so no
 * `student_busy` appears either. Re-running the script is safe, and so is
 * booking anything you like alongside it.
 *
 * The same reasoning applies to their availability. The exceptions and time-off
 * rows below land on scenario instructors rather than seeded ones, so no
 * existing test's idea of who is free on which day changes.
 *
 * Two are deliberately incomplete. `quiet` declares no hours at all, which is
 * the only way to reach "no availability declared" — every seeded instructor
 * declares Monday to Friday. `unassigned` has no `instructor_student` row,
 * which under the shipped `assigned_users_only` setting is the only way to
 * reach "nobody may teach them". Those two sentences are fixed in different
 * places, which is why the product words them differently and why both have to
 * be reachable.
 */
async function cast(db: Db, organizationId: bigint, timezone: string) {
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  const person = async (
    email: string,
    firstName: string,
    lastName: string,
    roles: Role[],
  ) => {
    const found = await db.user.findFirst({ where: { organizationId, email } });
    if (found) return found;
    return db.user.create({
      data: {
        ref: newRef("usr"),
        organizationId,
        email,
        firstName,
        lastName,
        status: UserStatus.ACTIVE,
        passwordHash,
        timezone,
        roles: { create: roles.map((role) => ({ organizationId, role })) },
      },
    });
  };

  const instructors = [
    await person("marguerite.okonjo@example.test", "Marguerite", "Okonjo", [Role.INSTRUCTOR]),
    await person("tobias.lindqvist@example.test", "Tobias", "Lindqvist", [Role.INSTRUCTOR]),
  ];
  const quiet = await person("kofi.mensah@example.test", "Kofi", "Mensah", [Role.INSTRUCTOR]);

  const students = [
    await person("ada.fenwick@example.test", "Ada", "Fenwick", [Role.STUDENT]),
    await person("bruno.salas@example.test", "Bruno", "Salas", [Role.STUDENT]),
    await person("chiara.volpe@example.test", "Chiara", "Volpe", [Role.STUDENT]),
  ];
  const unassigned = await person("ilias.brandt@example.test", "Ilias", "Brandt", [
    Role.STUDENT,
  ]);
  const parent = await person("renata.silva@example.test", "Renata", "Silva", [Role.PARENT]);

  // The two working instructors keep the same hours the seed gives everybody
  // else, so a scenario row is only unusual where it is meant to be. `quiet`
  // gets nothing, which is the whole of that case.
  for (const instructor of instructors) {
    for (const weekday of ["mon", "tue", "wed", "thu", "fri"]) {
      const exists = await db.availabilityRule.findFirst({
        where: { organizationId, instructorId: instructor.id, weekday },
      });
      if (exists) continue;
      await db.availabilityRule.create({
        data: {
          ref: newRef("avr"),
          organizationId,
          instructorId: instructor.id,
          weekday,
          startTime: timeToDb("09:00"),
          endTime: timeToDb("19:00"),
          timezone,
        },
      });
    }
  }

  // Eligibility, which `plan()` asks before availability and again before the
  // write. Without these the scenario instructors may teach nobody and every
  // booking below is refused for a reason that has nothing to do with the case
  // it was demonstrating. `unassigned` is deliberately left out.
  for (const instructor of instructors) {
    for (const student of students) {
      const exists = await db.instructorStudent.findFirst({
        where: { instructorId: instructor.id, studentId: student.id },
      });
      if (exists) continue;
      await db.instructorStudent.create({
        data: { organizationId, instructorId: instructor.id, studentId: student.id },
      });
    }
  }

  // The parent guards them, so the two request cases can be booked by somebody
  // who is not allowed to approve their own booking.
  for (const student of students) {
    const exists = await db.guardianStudent.findFirst({
      where: { guardianId: parent.id, studentId: student.id },
    });
    if (exists) continue;
    await db.guardianStudent.create({
      data: {
        organizationId,
        guardianId: parent.id,
        studentId: student.id,
        isPrimary: false,
      },
    });
  }

  // A group of its own, for the same reason as everything else here: the
  // seeded pod's members are seeded students, and booking them risks a clash
  // with whatever else has been booked for them.
  let group = await db.group.findFirst({
    where: { organizationId, name: "Scenario reading circle" },
  });
  if (group === null) {
    group = await db.group.create({
      data: {
        ref: newRef("grp"),
        organizationId,
        name: "Scenario reading circle",
        capacity: 6,
      },
    });
    for (const student of students) {
      await db.groupMember.create({
        data: {
          organizationId,
          groupId: group.id,
          userId: student.id,
          memberRole: "student",
        },
      });
    }
  }

  // The one thing borrowed rather than made: a room is shared by definition, and
  // the location clash is worth being able to provoke against the seeded one.
  const room = await db.location.findFirst({
    where: { organizationId, name: "Study Room A" },
  });

  return { instructors, students, parent, quiet, unassigned, group, room };
}

// --- Booking, as the screen does it ------------------------------------------

/** One session, through `plan` and `createFromPlan`, carrying the marker. */
async function book(
  context: Context,
  request: Omit<BookingRequest, "timezone" | "programId">,
  as: Principal = context.principal,
): Promise<CreatedOccurrence[]> {
  const full: BookingRequest = {
    ...request,
    timezone: context.org.timezone,
    programId: context.programId,
  };
  const prepared = await plan(context.db, context.org, as, full);
  const { created } = await createFromPlan(context.db, context.org, as, prepared);
  return created;
}

/** The fields every case shares, so each one below says only what is its own. */
function base(context: Context, title: string, day: CivilDate, time: string) {
  return {
    title,
    deliveryType: DeliveryType.EXTERNAL_LINK,
    meetingUrl: "https://meet.example.test/northgate/scenario",
    startDate: day,
    startTime: time,
    durationMinutes: 60,
    instructorId: context.instructors[0]!.id,
    studentIds: [context.students[0]!.id],
  };
}

// --- Case: every status the calendar can draw --------------------------------

async function theSevenStatuses(context: Context): Promise<void> {
  const { db, org, principal, today } = context;

  // Scheduled — the one the ordinary seed already produces, here for comparison.
  await book(context, base(context, "Scheduled: algebra practice", weekdayFrom(today, 2), "10:00"));

  // And the same status in the past, deliberately left alone. Nothing moves a
  // session on when its hour passes — `complete` and `markMissed` are things a
  // person does — so this one goes on saying it is going to happen long after
  // it has not. The calendar draws it as *Incomplete* rather than Scheduled,
  // which is worked out at render time from the end instant: see
  // `sessionStateMeta`. The row itself still says SCHEDULED, and the action
  // panel still offers Complete and Missed, which is the whole point of not
  // writing it down.
  await book(
    context,
    base(context, "Incomplete: nobody said what happened", weekdayBefore(today, 3), "15:00"),
  );

  // And the same state with the attendance already taken, which is the case a
  // blanket "incomplete sessions have no attendance recorded" would have got
  // wrong. `SCHEDULED` admits the `attendance` action — see `ACTIONS_BY_STATUS`
  // — so an instructor can mark the room present and never press Mark
  // completed. This session is incomplete and has its attendance; what it is
  // missing is only the outcome, and a tooltip that told somebody to go and
  // record attendance would be sending them to redo work already done.
  const [taken] = await book(context, {
    ...base(context, "Incomplete: attendance taken, outcome not", weekdayBefore(today, 4), "13:00"),
    studentIds: context.students.slice(0, 2).map((who) => who.id),
  });
  for (const attendee of await db.sessionParticipant.findMany({
    where: { sessionId: taken!.id, role: ParticipantRole.STUDENT },
    orderBy: { id: "asc" },
  })) {
    await markAttendance(db, principal, taken!, attendee, {
      status: AttendanceStatus.PRESENT,
    });
  }

  // Rescheduled. Booked, then moved — the status is what `reschedule` leaves
  // behind, so it cannot be arrived at any other way.
  const [moving] = await book(
    context,
    base(context, "Rescheduled: moved from the morning", weekdayFrom(today, 4), "09:00"),
  );
  await reschedule(db, org, principal, moving!, {
    startDate: weekdayFrom(today, 4),
    startTime: "15:00",
    durationMinutes: 60,
    timezone: org.timezone,
    // The fixture's dates roam with the clock, and four weekdays out is
    // sometimes the seed's own closure — where every hour is refused for
    // everybody and this stopped dead. What it is here to produce is a row in
    // the RESCHEDULED state, not a test of closure policy; the booking on the
    // line above already lands on the same day without complaint, because
    // `createFromPlan` writes through an overridable conflict where
    // `reschedule` refuses unless asked. A closure is overridable —
    // `ABSOLUTE_KINDS` is instructor and room only — so this asks.
    overrideConflicts: true,
  });

  // Completed, with attendance recorded. In the past, which is where a
  // completed session belongs — booking there needs `session.book_historical`,
  // which the administrator has.
  const [done] = await book(
    context,
    { ...base(context, "Completed: fractions catch-up", weekdayBefore(today, 7), "10:00"),
      studentIds: context.students.slice(0, 2).map((who) => who.id) },
  );
  await complete(db, principal, done!);
  const attendees = await db.sessionParticipant.findMany({
    where: { sessionId: done!.id },
    orderBy: { id: "asc" },
  });
  // Two different answers, so the rate is a fraction rather than 0 or 100 —
  // which is the case that shows the calculation is doing anything.
  const marks = [AttendanceStatus.PRESENT, AttendanceStatus.LATE];
  for (const [index, attendee] of attendees.entries()) {
    await markAttendance(db, principal, done!, attendee, {
      status: marks[index] ?? AttendanceStatus.ABSENT,
    });
  }

  // Missed, with a reason from the tenant's own list.
  const [missed] = await book(
    context,
    base(context, "Missed: nobody arrived", weekdayBefore(today, 5), "11:00"),
  );
  await markMissed(db, org, principal, missed!, { reason: "no_show" });

  // Cancelled, likewise — and in the future, because a cancellation people can
  // still see coming is the one worth drawing.
  const [dropped] = await book(
    context,
    base(context, "Cancelled: family away", weekdayFrom(today, 3), "14:00"),
  );
  await cancel(db, org, principal, dropped!, { reason: "participant_request" });

  // Requested and Rejected. Both need `booking.require_approval` on and
  // somebody who cannot approve their own booking — a parent. The setting is
  // turned on for these two and put back afterwards: leaving it on would change
  // how the whole tenant books, which is not this fixture's business.
  {
    const parentPrincipal = await loadPrincipal(db, context.parent.id);
    // The setting has to be *read back* after it is written. `needsApproval`
    // is asked of the organization object in hand, not of the database, so
    // booking with the one captured at startup produced two scheduled sessions
    // and then a refusal to reject one of them — the service was right and the
    // fixture was asking the wrong question.
    const pending = { ...context, org: await setApproval(db, org.id, true) };
    try {
      await book(
        pending,
        base(context, "Requested: awaiting a decision", weekdayFrom(today, 6), "16:00"),
        parentPrincipal,
      );
      const [toRefuse] = await book(
        pending,
        base(context, "Rejected: no instructor free", weekdayFrom(today, 6), "17:00"),
        parentPrincipal,
      );
      await decideRequest(db, pending.org, principal, toRefuse!, {
        approve: false,
        reason: "No instructor available at that hour.",
      });
    } finally {
      await setApproval(db, org.id, false);
    }
  }

  // In progress. The one status no service sets — it is the seam the Phase 4
  // classroom will fill, so this is written directly and is the only row here
  // that is. It earns its place twice: the calendar draws it, and
  // `BLOCKING_STATUSES` counts it against conflicts, so a booking over it is
  // refused. Worth knowing both are true before anything sets it for real.
  //
  // It is also absent from `STATUS_FILTER_ORDER`, so it shows while the filter
  // is untouched and disappears the moment any status box is ticked. That
  // mismatch is deliberate and `tests/presentation.test.ts` guards it; this row
  // is what makes it visible.
  //
  // Noon today, unless the fixture is being run after about half past ten, in
  // which case tomorrow: `validateTiming` refuses a booking less than an hour
  // out, and a fixture that only works before eleven in the morning is a
  // fixture that fails for whoever runs it after lunch. Which it did.
  const running0 = resolveCivil(today, "12:00", org.timezone).instant;
  const runningDay =
    running0.getTime() - Date.now() > 90 * 60_000 ? today : weekdayFrom(today, 1);
  const [running] = await book(
    context,
    base(context, "In progress: happening now", runningDay, "12:00"),
  );
  await db.sessionOccurrence.update({
    where: { id: running!.id },
    data: { status: SessionStatus.IN_PROGRESS, actualStart: running!.scheduledStart },
  });
}

/**
 * Turn tenant approval on or off, leaving every other setting alone.
 *
 * Returns the updated row, because the caller needs it: `needsApproval` reads
 * the organization object it is given rather than the database, so a booking
 * made with a stale one ignores the setting that was just written.
 */
async function setApproval(db: Db, organizationId: bigint, required: boolean) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });
  const settings = (org.settings ?? {}) as Record<string, unknown>;
  const booking = { ...((settings.booking as Record<string, unknown>) ?? {}) };
  booking.require_approval = required;
  return db.organization.update({
    where: { id: organizationId },
    // Cast at the boundary: Prisma's `InputJsonValue` cannot describe an
    // object assembled from a column it has already widened to `JsonValue`,
    // and re-typing the whole settings tree to satisfy one write would be a
    // second description of a shape the application reads through `setting()`.
    data: { settings: { ...settings, booking } as Prisma.InputJsonValue },
  });
}

// --- Case: a day with more on it than a month cell can show -------------------

async function theBusyDay(context: Context): Promise<void> {
  const day = weekdayFrom(context.today, 9);

  // `MONTH_CELL_LIMIT` is 4, so six is what it takes to see "+2 more". Two of
  // them are back to back — 11:00 ends exactly as 12:00 begins — which is legal
  // and is the case the exclusion constraint is half-open for. If this script
  // ever starts failing here, that is the constraint having stopped being
  // half-open, and it is worth knowing.
  const times = ["09:00", "10:00", "11:00", "12:00", "14:00", "15:00"];
  for (const [index, time] of times.entries()) {
    await book(context, {
      ...base(context, `Busy day ${index + 1} of ${times.length}`, day, time),
      studentIds: [context.students[index % context.students.length]!.id],
    });
  }
}

// --- Case: more than one session in the same hour ----------------------------

/**
 * Sessions that overlap, so the week grid's lanes have something to draw.
 *
 * `assignLanes` has always split a cluster of overlapping sessions across the
 * column, and the stylesheet has always declared `.lane-N-of-M` — but nothing
 * in the seed or in the rest of this file ever overlapped, so it had never
 * appeared on a screen. A feature nobody has seen work is a feature nobody
 * knows is broken.
 *
 * It takes **two instructors**, and that is the interesting part: an instructor
 * cannot overlap themselves, because `instructor_busy` is a conflict no
 * override clears and a GiST exclusion constraint refuses it in the database.
 * Two people teaching at once in the same column is the only way this happens,
 * which is also why it is worth drawing rather than hiding.
 */
async function theSameHourTwice(context: Context): Promise<void> {
  const day = weekdayFrom(context.today, 10);
  const [first, second] = context.instructors;

  // Exactly together: two lanes, side by side, neither hiding the other.
  await book(context, {
    ...base(context, "Overlap: at the same time as another", day, "10:00"),
    instructorId: first!.id,
    studentIds: [context.students[0]!.id],
  });
  await book(context, {
    ...base(context, "Overlap: the other one", day, "10:00"),
    instructorId: second!.id,
    studentIds: [context.students[1]!.id],
  });

  // And a partial overlap, which is the case a naive implementation gets wrong:
  // these two clash with each other but the second also runs past the first, so
  // the cluster is decided by mutual overlap rather than by a shared start.
  await book(context, {
    ...base(context, "Overlap: starts on the half hour", day, "14:00"),
    instructorId: first!.id,
    studentIds: [context.students[0]!.id],
  });
  await book(context, {
    ...base(context, "Overlap: runs past the first", day, "14:30"),
    instructorId: second!.id,
    studentIds: context.students.slice(1, 3).map((who) => who.id),
  });
}

// --- Case: the two ends of the clock -----------------------------------------

async function theEdgesOfTheDay(context: Context): Promise<void> {
  const day = weekdayFrom(context.today, 11);

  // Both are outside the instructor's declared 09:00–19:00, which is exactly
  // the point: `outside_availability` is an *overridable* conflict, so an
  // administrator can book through it and the grid is right to keep offering
  // the whole day. `overrideConflicts` is how the screen does it too.
  await book(context, {
    ...base(context, "Edge: a quarter past midnight", day, "00:15"),
    durationMinutes: 30,
    instructorId: context.instructors[1]!.id,
    overrideConflicts: true,
  });
  await book(context, {
    ...base(context, "Edge: last thing at night", day, "22:45"),
    durationMinutes: 45,
    instructorId: context.instructors[1]!.id,
    overrideConflicts: true,
  });

  // A block tall enough to span rows in the week and day grids.
  //
  // Two hours, not three, and the reason is worth recording: the service
  // validates length against `booking.selectable_durations_minutes`, which
  // shipped as [15, 30, 45, 60, 90, 120] — while the hint under the Session
  // length field reports `booking.duration_bounds_minutes`, [15, 210], as the
  // minimum and maximum. So the form tells somebody a session may be three and
  // a half hours long and the service refuses anything over two. That is a
  // real disagreement between two settings, not something for a fixture to
  // work around, but this file is not the place to change a tenant's
  // configuration.
  await book(context, {
    ...base(context, "Long: two-hour revision block", weekdayFrom(context.today, 12), "13:00"),
    durationMinutes: 120,
    instructorId: context.instructors[1]!.id,
  });
}

// --- Case: each way a session can be delivered -------------------------------

async function theDeliveryTypes(context: Context): Promise<void> {
  const day = weekdayFrom(context.today, 13);

  // Two of the three, and the third is deliberately absent.
  // `ADVANCED_CLASSROOM` is a Phase 4 feature: `DEFAULT_FEATURES` ships it off,
  // `deliveryAvailable` therefore keeps it out of the form's Type list, and
  // `validateRequest` refuses it outright. A fixture that switched the feature
  // on to get a third badge on the calendar would be dressing an unbuilt phase
  // as a built one, which is the one thing the standing instructions single
  // out. So the calendar can draw three delivery types and only two are
  // reachable, on purpose, and this file leaves it that way.
  await book(context, {
    ...base(context, "Delivery: an external link", day, "09:00"),
    instructorId: context.instructors[1]!.id,
  });

  // In person, with both fields set: the managed room is what the location
  // exclusion constraint keys on, and the free text is how to find it. Before
  // today the booking screen could only send the second.
  await book(context, {
    ...base(context, "Delivery: in the building", day, "10:30"),
    deliveryType: DeliveryType.IN_PERSON,
    meetingUrl: null,
    locationId: context.room?.id ?? null,
    locationDetail: "Second floor, past the library",
    instructorId: context.instructors[1]!.id,
  });

  // The group case: a roster that arrives from a group rather than from named
  // students, which is a different path through `resolveStudents`.
  {
    await book(context, {
      ...base(context, "Group: the Wednesday pod", weekdayFrom(context.today, 16), "16:00"),
      studentIds: [],
      groupId: context.group.id,
      instructorId: context.instructors[1]!.id,
    });
  }
}

// --- Case: a series that has been lived in ------------------------------------

async function aSeriesWithHistory(context: Context): Promise<void> {
  const { db, org, principal } = context;

  const created = await book(context, {
    ...base(context, "Series: Tuesday reading group", weekdayFrom(context.today, 14), "17:00"),
    studentIds: context.students.slice(1, 3).map((who) => who.id),
    instructorId: context.instructors[1]!.id,
    repeat: true,
    frequency: "weekly",
    weekdays: ["tue", "thu"],
    endMode: "count",
    occurrenceCount: 8,
  });

  // One occurrence moved on its own. `EditScope.THIS` is what sets
  // `detachedFromSeries`, and that flag is the promise that a later series-wide
  // edit will skip this one — a rule with no visible effect until there is a
  // detached occurrence to look at.
  const third = created[2];
  if (third) {
    await reschedule(
      db,
      org,
      principal,
      third,
      {
        startDate: civilDate(third.scheduledStart, org.timezone),
        // 18:00, not 18:30: the declared window ends at 19:00, and a
        // sixty-minute session starting at half past would end outside it.
        startTime: "18:00",
        durationMinutes: 60,
        timezone: org.timezone,
      },
      { scope: EditScope.THIS },
    );
  }

  // And one cancelled, which releases its slot: the partial index behind the
  // instructor constraint excludes cancelled rows, so this hour is bookable
  // again. The series still says eight.
  const fifth = created[4];
  if (fifth) {
    await cancel(db, org, principal, fifth, { reason: "instructor_unavailable" });
  }
}

// --- Case: the awkward shapes of availability --------------------------------

async function theAwkwardAvailability(context: Context): Promise<void> {
  const { db, org, today } = context;
  const organizationId = org.id;

  // A dated exception that narrows one instructor to two hours. Two cases in
  // one row: the dated layer beating the weekly one, and a grid row that is
  // almost entirely closed.
  const narrow = weekdayFrom(today, 17);
  await ensureException(db, organizationId, context.instructors[0]!.id, narrow, {
    isAvailable: true,
    startTime: timeToDb("10:00"),
    endTime: timeToDb("12:00"),
    timezone: org.timezone,
  });

  // And one that removes a day outright — "unavailable on this date", which is
  // a different sentence from "no availability declared".
  const away = weekdayFrom(today, 18);
  await ensureException(db, organizationId, context.instructors[0]!.id, away, {
    isAvailable: false,
    timezone: org.timezone,
  });

  // Time off, which cuts an instant range out of whatever the layers above it
  // left — an afternoon here, so the morning survives and the row is visibly
  // half open.
  const afternoon = weekdayFrom(today, 19);
  const from = resolveCivil(afternoon, "13:00", org.timezone).instant;
  const to = resolveCivil(afternoon, "19:00", org.timezone).instant;
  const heldOff = await db.timeOff.findFirst({
    where: { organizationId, instructorId: context.instructors[1]!.id, startsAt: from },
  });
  if (!heldOff) {
    await db.timeOff.create({
      data: {
        ref: newRef("tof"),
        organizationId,
        instructorId: context.instructors[1]!.id,
        startsAt: from,
        endsAt: to,
        reason: "Conference",
      },
    });
  }

  // A second closure, a month out, so the recurrence preview has one to skip
  // that is not the seeded staff-training day.
  const closure = addDays(today, 35);
  const shut = await db.offDay.findFirst({
    where: { organizationId, day: dateToDb(closure) },
  });
  if (!shut) {
    await db.offDay.create({
      data: { organizationId, day: dateToDb(closure), label: SCENARIO_CLOSURE },
    });
  }
}

async function ensureException(
  db: Db,
  organizationId: bigint,
  instructorId: bigint,
  day: CivilDate,
  fields: {
    isAvailable: boolean;
    startTime?: Date;
    endTime?: Date;
    timezone: string;
  },
): Promise<void> {
  const found = await db.availabilityException.findFirst({
    where: { organizationId, instructorId, day: dateToDb(day) },
  });
  if (found) return;
  await db.availabilityException.create({
    data: {
      ref: newRef("ave"),
      organizationId,
      instructorId,
      day: dateToDb(day),
      ...fields,
    },
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
