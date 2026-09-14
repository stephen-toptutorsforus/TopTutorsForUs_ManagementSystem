/**
 * Conflict detection for a proposed booking.
 *
 * Ported from `app/services/conflicts.py`. Four kinds are checked, all
 * server-side, all before anything is written:
 *
 * 1. **Instructor double-booking** — the same instructor in two overlapping
 *    sessions.
 * 2. **Student double-booking** — a student in two overlapping sessions. This
 *    one cannot be expressed as a constraint on the session alone, because it
 *    lives in the participant table, so it is checked here and the database
 *    backstops only the instructor and room cases.
 * 3. **Room double-booking** — two in-person sessions in one location.
 * 4. **Outside declared availability** — the instructor has not offered that
 *    time.
 *
 * **Conflicts are warnings with an explicit override, not hard blocks.** Real
 * operations need somebody senior to be able to say "do it anyway". The
 * override is permission-gated, recorded on the session, and written to the
 * audit trail — so "anyone can override" and "nobody can tell who did" are both
 * false.
 *
 * The exception is the database's own exclusion constraints, which are
 * absolute. An override that would violate one is refused with a clear message
 * rather than producing an unexplained integrity error, because those are the
 * cases where two sessions genuinely cannot both exist.
 */

import { DeliveryType, SessionStatus } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { type BusyByInstructor, isAvailable, type OrganizationRef } from "@/lib/availability";

/**
 * Which statuses hold their slot. One decision, made once, because the
 * database's exclusion constraints encode the same list in their predicates. If
 * the two ever disagree, the preview promises a booking the insert then
 * refuses, or reports a clash the database would have allowed. The
 * database-backed suite pins them together.
 */
export const BLOCKING_STATUSES: SessionStatus[] = [
  SessionStatus.SCHEDULED,
  SessionStatus.RESCHEDULED,
  SessionStatus.IN_PROGRESS,
];

export enum ConflictKind {
  INSTRUCTOR_BUSY = "instructor_busy",
  STUDENT_BUSY = "student_busy",
  LOCATION_BUSY = "location_busy",
  OUTSIDE_AVAILABILITY = "outside_availability",
  ORGANIZATION_CLOSED = "organization_closed",
}

/** Kinds the database will refuse outright. An override cannot get past these. */
export const ABSOLUTE_KINDS: ReadonlySet<ConflictKind> = new Set([
  ConflictKind.INSTRUCTOR_BUSY,
  ConflictKind.LOCATION_BUSY,
]);

/** One detected clash, described in terms a person can act on. */
export interface Conflict {
  readonly kind: ConflictKind;
  readonly message: string;
  /**
   * The public ref of the clashing session, when there is one. Never a database
   * id, and never the other party's contact details.
   */
  readonly sessionRef: string | null;
  readonly subjectLabel: string | null;
}

export function overridable(conflict: Conflict): boolean {
  return !ABSOLUTE_KINDS.has(conflict.kind);
}

/** All conflicts found for one proposed occurrence. */
export interface ConflictReport {
  readonly conflicts: Conflict[];
}

/** Conflicts no override can clear. */
export function blocking(report: ConflictReport): Conflict[] {
  return report.conflicts.filter((conflict) => !overridable(conflict));
}

export function overridableConflicts(report: ConflictReport): Conflict[] {
  return report.conflicts.filter(overridable);
}

export function summary(report: ConflictReport): string {
  return report.conflicts.map((conflict) => conflict.message).join("; ");
}

/**
 * When each instructor is already booked, over a range — one statement.
 *
 * The booking screen's grids need this alongside declared hours: a time that
 * reads free and is already taken is a promise the write cannot keep, because
 * `INSTRUCTOR_BUSY` is one of the kinds no override clears and the exclusion
 * constraint refuses it outright.
 *
 * It lives here rather than in `lib/availability.ts` because the filter is
 * `BLOCKING_STATUSES` and that list belongs beside the check whose predicate
 * the database mirrors. Availability takes the answer as an argument, which
 * also keeps the two modules pointing one way.
 */
export async function busyIntervals(
  db: Db,
  organization: OrganizationRef,
  instructorIds: readonly bigint[],
  from: Date,
  to: Date,
): Promise<BusyByInstructor> {
  const ids = [...new Set(instructorIds)];
  const out: BusyByInstructor = new Map();
  if (ids.length === 0) return out;

  const rows = await db.sessionOccurrence.findMany({
    where: {
      organizationId: organization.id,
      archivedAt: null,
      instructorId: { in: ids },
      status: { in: BLOCKING_STATUSES },
      scheduledStart: { lt: to },
      scheduledEnd: { gt: from },
    },
    select: { instructorId: true, scheduledStart: true, scheduledEnd: true },
  });

  for (const row of rows) {
    if (row.instructorId === null) continue;
    const key = String(row.instructorId);
    const list = out.get(key) ?? [];
    list.push({ start: row.scheduledStart, end: row.scheduledEnd });
    out.set(key, list);
  }
  return out;
}

export interface CheckInput {
  start: Date;
  end: Date;
  instructorId: bigint | null;
  studentIds?: readonly bigint[];
  locationId?: bigint | null;
  deliveryType?: DeliveryType;
  /** Skips the session being edited, so rescheduling does not clash with itself. */
  excludeSessionId?: bigint | null;
  checkAvailability?: boolean;
  displayZone?: string | null;
}

/** Check one proposed interval. */
export async function check(
  db: Db,
  organization: OrganizationRef,
  input: CheckInput,
): Promise<ConflictReport> {
  const conflicts: Conflict[] = [];
  const {
    start,
    end,
    instructorId,
    studentIds = [],
    locationId = null,
    deliveryType = DeliveryType.EXTERNAL_LINK,
    excludeSessionId = null,
    checkAvailability = true,
    displayZone = null,
  } = input;

  // Same tenant, live status, half-open overlap, not itself.
  const live = {
    organizationId: organization.id,
    archivedAt: null,
    status: { in: BLOCKING_STATUSES },
    scheduledStart: { lt: end },
    scheduledEnd: { gt: start },
    ...(excludeSessionId === null ? {} : { id: { not: excludeSessionId } }),
  };

  if (instructorId !== null) {
    const clashes = await db.sessionOccurrence.findMany({
      where: { ...live, instructorId },
      select: { ref: true, title: true },
    });
    for (const clash of clashes) {
      conflicts.push({
        kind: ConflictKind.INSTRUCTOR_BUSY,
        message: `the instructor already has ${JSON.stringify(clash.title)} at this time`,
        sessionRef: clash.ref,
        subjectLabel: null,
      });
    }
  }

  if (studentIds.length > 0) {
    // Students clash through the participant table, which the database's
    // exclusion constraints cannot reach — so this check is the only guard.
    const clashes = await db.sessionOccurrence.findMany({
      where: { ...live, participants: { some: { userId: { in: [...studentIds] } } } },
      select: {
        ref: true,
        title: true,
        participants: {
          where: { userId: { in: [...studentIds] } },
          select: { user: { select: { firstName: true, lastName: true } } },
        },
      },
    });
    for (const clash of clashes) {
      for (const participant of clash.participants) {
        const label = `${participant.user.firstName} ${participant.user.lastName}`.trim();
        conflicts.push({
          kind: ConflictKind.STUDENT_BUSY,
          message: `${label} already has ${JSON.stringify(clash.title)} at this time`,
          sessionRef: clash.ref,
          subjectLabel: label,
        });
      }
    }
  }

  if (locationId !== null && deliveryType === DeliveryType.IN_PERSON) {
    const clashes = await db.sessionOccurrence.findMany({
      where: { ...live, locationId, deliveryType: DeliveryType.IN_PERSON },
      select: { ref: true, title: true },
    });
    for (const clash of clashes) {
      conflicts.push({
        kind: ConflictKind.LOCATION_BUSY,
        message: `this location is booked for ${JSON.stringify(clash.title)} at this time`,
        sessionRef: clash.ref,
        subjectLabel: null,
      });
    }
  }

  if (checkAvailability && instructorId !== null) {
    const answer = await isAvailable(db, organization, instructorId, start, end, { displayZone });
    if (!answer.available) {
      const kind = answer.reason?.includes("opening hours")
        ? ConflictKind.ORGANIZATION_CLOSED
        : ConflictKind.OUTSIDE_AVAILABILITY;
      conflicts.push({
        kind,
        message: `the instructor is ${answer.reason ?? "unavailable"}`,
        sessionRef: null,
        subjectLabel: null,
      });
    }
  }

  return { conflicts };
}

/**
 * Pairs of *proposed* occurrences that overlap each other.
 *
 * A rule can generate a series that clashes with itself — a three-hour session
 * repeating daily at 23:00, for instance. Nothing in the database catches that
 * until the second insert fails, so the preview checks the batch against itself
 * first and reports the positions involved.
 *
 * Indices are into the input array, in ascending order. A series is capped at a
 * few dozen occurrences, so a plain pairwise scan is both fast enough and
 * obviously correct.
 */
export function selfOverlaps(
  occurrences: readonly (readonly [Date, Date])[],
): [number, number][] {
  const clashes: [number, number][] = [];
  for (let i = 0; i < occurrences.length; i += 1) {
    const [aStart, aEnd] = occurrences[i]!;
    for (let j = i + 1; j < occurrences.length; j += 1) {
      const [bStart, bEnd] = occurrences[j]!;
      // Half-open overlap, the same rule as the database constraint.
      if (aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime()) {
        clashes.push([i, j]);
      }
    }
  }
  return clashes;
}
