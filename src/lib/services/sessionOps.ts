/**
 * Operations on sessions that already exist: edit, reschedule, cancel,
 * complete, and attendance.
 *
 * Ported from `app/services/session_ops.py`.
 *
 * Every function here takes a `Principal`, re-checks policy server-side, and
 * records an audit event through the same transaction client as the change, so
 * an audit failure rolls the change back with it.
 *
 * **Editing one occurrence detaches it.** Once someone has moved a single
 * session, a later series-wide edit must not silently move it back.
 * `detachedFromSeries` is set by the act of editing at `THIS` scope, not by a
 * separate opt-in the person has to remember.
 *
 * **Actual times are recorded, never inferred.** `complete()` takes the times
 * it is given, defaulting to the schedule only when nothing better is known,
 * and the difference between scheduled and actual is what the reports compare.
 */

import type { Prisma } from "@/generated/prisma/client";
import {
  AttendanceSource,
  AttendanceStatus,
  AuditCategory,
  ParticipantRole,
  SessionStatus,
} from "@/generated/prisma/enums";
import { SESSION_FIELDS, record, snapshot } from "@/lib/audit";
import { blocking, check } from "@/lib/conflicts";
import type { Db } from "@/lib/db";
import { ConflictError, Forbidden, ValidationError } from "@/lib/errors";
import {
  type ConfigurableOrganization,
  billingEnabled,
  settingStrings,
  settingsReader,
} from "@/lib/organization";
import { ACTIONS_BY_STATUS } from "@/lib/policies/sessions";
import {
  canCancel,
  canChangeStatus,
  canCorrectActualTimes,
  canDecideRequest,
  canEdit,
  canEditSeries,
  isInvolved,
  canMarkAttendance,
  canOverrideConflicts,
  canReschedule,
  requireDecision,
} from "@/lib/policies/sessions";
import type { Principal } from "@/lib/policies/principal";
import { EditScope, occurrencesInScope } from "@/lib/services/booking";
import { captureReschedule, retireReminders } from "@/lib/services/localNotices";
import { publishOccurrence } from "@/lib/services/sharedSession";
import type { BookingOrganization } from "@/lib/services/booking";
import type { RequestMeta } from "@/lib/services/people";
import {
  type CivilDate,
  type CivilTime,
  addDays,
  civilDate,
  daysBetween,
  ensureUtc,
  resolveCivil,
} from "@/lib/time";

export type Occurrence = Prisma.SessionOccurrenceGetPayload<object>;
export type Participant = Prisma.SessionParticipantGetPayload<object>;

/**
 * Attendance states that mean the person was there in some form. Used for the
 * attendance rate, which must not be depressed by an excused absence.
 */
export const PRESENT_STATES: AttendanceStatus[] = [
  AttendanceStatus.PRESENT,
  AttendanceStatus.LATE,
  AttendanceStatus.LEFT_EARLY,
  AttendanceStatus.INCOMPLETE,
];

/**
 * Statuses a cancellation can act on. Derived from the policy allowlist rather
 * than written out again, so a status added later cannot be silently skipped by
 * a series cancellation that policy said should reach it.
 */
export const CANCELLABLE_STATUSES: SessionStatus[] = (
  Object.keys(ACTIONS_BY_STATUS) as SessionStatus[]
).filter((status) => ACTIONS_BY_STATUS[status].has("cancel"));

/** Whether this person is on the session, or guards somebody who is. */
async function viewerInvolved(db: Db, principal: Principal, sessionId: bigint): Promise<boolean> {
  const participants = await db.sessionParticipant.findMany({
    where: { sessionId },
    select: { userId: true },
  });
  const ids = participants.map((row) => row.userId);
  if (ids.includes(principal.userId)) return true;
  if (ids.length === 0) return false;
  const links = await db.guardianStudent.findMany({
    where: {
      guardianId: principal.userId,
      organizationId: principal.organizationId,
      studentId: { in: ids },
    },
    select: { studentId: true },
  });
  return isInvolved(principal, ids, links.map((link) => link.studentId));
}

/** A new civil date and time, in a stated zone. */
export interface RescheduleRequest {
  startDate: CivilDate;
  startTime: CivilTime;
  durationMinutes: number;
  timezone?: string | null;
  reason?: string | null;
  overrideConflicts?: boolean;
}

/**
 * Move a session, or a series, to a new time.
 *
 * At `THIS` scope only this occurrence moves and it detaches. At the wider
 * scopes every reachable occurrence is moved to the same **wall-clock** time on
 * its own date, which is what "move the class to 5pm" means — not "add 60
 * minutes to each instant".
 */
export async function reschedule(
  db: Db,
  organization: BookingOrganization,
  principal: Principal,
  occurrence: Occurrence,
  request: RescheduleRequest,
  options: { scope?: EditScope; requestMeta?: RequestMeta } = {},
): Promise<Occurrence[]> {
  const scope = options.scope ?? EditScope.THIS;

  // Not `canEdit`. An in-progress session admits editing and refuses moving,
  // and checking the wrong one let a lesson be moved while it was happening.
  requireDecision(
    canReschedule(
      principal,
      occurrence,
      organization,
      undefined,
      await viewerInvolved(db, principal, occurrence.id),
    ),
  );
  if (scope !== EditScope.THIS) requireDecision(canEditSeries(principal, occurrence));

  const zone = request.timezone || occurrence.timezone;
  const targets = (await occurrencesInScope(db, occurrence, scope)) as Occurrence[];
  const durationMs = request.durationMinutes * 60_000;

  // Day offset from the occurrence being edited, so a series moved to a
  // different weekday keeps its spacing.
  const anchorDate = civilDate(occurrence.scheduledStart, zone);
  const dayShift = daysBetween(anchorDate, request.startDate);

  const changed: Occurrence[] = [];
  for (const target of targets) {
    const targetDate = addDays(civilDate(target.scheduledStart, zone), dayShift);
    const resolved = resolveCivil(targetDate, request.startTime, zone);
    const newStart = resolved.instant;
    const newEnd = new Date(newStart.getTime() + durationMs);

    if (
      newStart.getTime() === target.scheduledStart.getTime() &&
      newEnd.getTime() === target.scheduledEnd.getTime()
    ) {
      continue;
    }

    const report = await check(db, organization, {
      start: newStart,
      end: newEnd,
      instructorId: target.instructorId,
      studentIds: await studentIds(db, target),
      locationId: target.locationId,
      deliveryType: target.deliveryType,
      excludeSessionId: target.id,
      displayZone: zone,
    });
    const clashed = report.conflicts.length > 0;
    if (clashed) {
      if (blocking(report).length > 0 || !request.overrideConflicts) {
        throw new ConflictError(
          report.conflicts[0]!.message,
          report.conflicts.map((conflict) => conflict.message),
        );
      }
      if (!canOverrideConflicts(principal)) {
        throw new Forbidden("you may not reschedule over a conflict");
      }
    }

    const before = snapshot(target, SESSION_FIELDS);
    const updated = await db.sessionOccurrence.update({
      where: { id: target.id },
      data: {
        scheduledStart: newStart,
        scheduledEnd: newEnd,
        timezone: zone,
        rescheduleReason: request.reason ?? null,
        // A moved session is still going to happen, but coordinators need to
        // see which ones have already been shifted. Only a plain scheduled
        // session takes the label; an in-progress or restored one keeps its own.
        ...(target.status === SessionStatus.SCHEDULED
          ? { status: SessionStatus.RESCHEDULED }
          : {}),
        ...(clashed ? { conflictOverridden: true } : {}),
        // The act of moving one occurrence detaches it, so a later series-wide
        // edit cannot silently move it back.
        ...(scope === EditScope.THIS && target.seriesId !== null
          ? { detachedFromSeries: true }
          : {}),
      },
    });

    changed.push(updated);
    await publishOccurrence(db, updated.id);
    await record(db, principal, {
      category: AuditCategory.SESSION,
      action: "session.rescheduled",
      entityType: "session_occurrence",
      entityId: updated.id,
      entityRef: updated.ref,
      before,
      after: snapshot(updated, SESSION_FIELDS),
      note: `scope: ${scope}`,
      ...options.requestMeta,
    });
  }

  const movedAt = new Date();
  for (const session of changed) {
    await captureReschedule(db, session, movedAt);
  }

  return changed;
}

/** Change the non-scheduling fields of a session or series. */
export async function editDetails(
  db: Db,
  principal: Principal,
  occurrence: Occurrence,
  options: {
    scope?: EditScope;
    title?: string | null;
    description?: string | null;
    billable?: boolean | null;
    /**
     * The tenant, so that `billable` can be ignored where money is not part of
     * its vocabulary. The edit panel does not draw the box when
     * `booking.billable_enabled` is off; this is what makes that a rule rather
     * than a styling decision, because an unticked checkbox and a hidden one
     * send the same nothing and a crafted post sends `on`.
     *
     * Optional, and absent means "do not apply the rule" rather than "assume
     * off": the two callers that omit it never pass `billable` either.
     */
    organization?: ConfigurableOrganization | null;
    requestMeta?: RequestMeta;
  } = {},
): Promise<Occurrence[]> {
  const scope = options.scope ?? EditScope.THIS;
  requireDecision(canEdit(principal, occurrence));
  if (scope !== EditScope.THIS) requireDecision(canEditSeries(principal, occurrence));

  const { title, description } = options;
  const billable =
    options.organization !== undefined &&
    options.organization !== null &&
    !billingEnabled(options.organization)
      ? undefined
      : options.billable;
  if (title !== undefined && title !== null && !title.trim()) {
    throw new ValidationError("a session needs a title");
  }

  const targets = (await occurrencesInScope(db, occurrence, scope)) as Occurrence[];
  const changed: Occurrence[] = [];

  for (const target of targets) {
    const before = snapshot(target, SESSION_FIELDS);
    const data: Prisma.SessionOccurrenceUpdateInput = {};
    if (title !== undefined && title !== null) data.title = title.trim();
    if (description !== undefined) data.description = description;
    if (billable !== undefined && billable !== null) data.billable = billable;

    const wouldBe = {
      ...target,
      ...(data.title !== undefined ? { title: data.title as string } : {}),
      ...(data.description !== undefined
        ? { description: data.description as string | null }
        : {}),
      ...(data.billable !== undefined ? { billable: data.billable as boolean } : {}),
    };
    const after = snapshot(wouldBe, SESSION_FIELDS);
    if (JSON.stringify(before) === JSON.stringify(after)) continue;

    if (scope === EditScope.THIS && target.seriesId !== null) {
      data.detachedFromSeries = true;
    }
    const updated = await db.sessionOccurrence.update({ where: { id: target.id }, data });
    changed.push(updated);
    await publishOccurrence(db, updated.id);

    await record(db, principal, {
      category: AuditCategory.SESSION,
      action: "session.edited",
      entityType: "session_occurrence",
      entityId: updated.id,
      entityRef: updated.ref,
      before,
      after: snapshot(updated, SESSION_FIELDS),
      note: `scope: ${scope}`,
      ...options.requestMeta,
    });
  }

  if (scope !== EditScope.THIS && occurrence.seriesId !== null) {
    // Keep the series' own defaults in step, so occurrences generated later
    // inherit the new title rather than the superseded one.
    const data: Prisma.SessionSeriesUpdateInput = {};
    if (title !== undefined && title !== null) data.title = title.trim();
    if (description !== undefined) data.description = description;
    if (billable !== undefined && billable !== null) data.billable = billable;
    if (Object.keys(data).length > 0) {
      await db.sessionSeries.updateMany({ where: { id: occurrence.seriesId }, data });
    }
  }

  return changed;
}

/**
 * Cancel a session or the remainder of a series.
 *
 * Cancellation is a status change, never a delete: the record that a session
 * was booked and then cancelled is exactly what reporting and billing need.
 */
export async function cancel(
  db: Db,
  organization: ConfigurableOrganization,
  principal: Principal,
  occurrence: Occurrence,
  options: {
    reason: string;
    note?: string | null;
    scope?: EditScope;
    requestMeta?: RequestMeta;
  },
): Promise<Occurrence[]> {
  const scope = options.scope ?? EditScope.THIS;
  requireDecision(
    canCancel(
      principal,
      occurrence,
      organization,
      undefined,
      await viewerInvolved(db, principal, occurrence.id),
    ),
  );
  if (scope !== EditScope.THIS) requireDecision(canEditSeries(principal, occurrence));

  const valid = settingStrings(settingsReader(organization), ["reason_codes", "cancellation"]);
  if (valid !== null && valid.length > 0 && !valid.includes(options.reason)) {
    throw new ValidationError("that is not a configured cancellation reason");
  }

  const targets = (await occurrencesInScope(db, occurrence, scope)) as Occurrence[];
  const moment = new Date();
  const cancelled: Occurrence[] = [];

  for (const target of targets) {
    if (!CANCELLABLE_STATUSES.includes(target.status)) continue;

    const before = snapshot(target, SESSION_FIELDS);
    const updated = await db.sessionOccurrence.update({
      where: { id: target.id },
      data: {
        status: SessionStatus.CANCELLED,
        cancellationReason: options.reason,
        cancellationNote: options.note ?? null,
        cancelledAt: moment,
        cancelledById: principal.userId,
      },
    });
    cancelled.push(updated);
    await publishOccurrence(db, updated.id);
    await retireReminders(db, updated.id, moment);

    await record(db, principal, {
      category: AuditCategory.SESSION,
      action: "session.cancelled",
      entityType: "session_occurrence",
      entityId: updated.id,
      entityRef: updated.ref,
      before,
      // The free-text note is recorded as present, never reproduced.
      after: { ...snapshot(updated, SESSION_FIELDS), cancellation_note: options.note ?? null },
      note: `scope: ${scope}`,
      ...options.requestMeta,
    });
  }

  return cancelled;
}

/** Return a cancelled or missed session to scheduled. */
export async function restore(
  db: Db,
  principal: Principal,
  occurrence: Occurrence,
  options: { requestMeta?: RequestMeta } = {},
): Promise<Occurrence> {
  requireDecision(canChangeStatus(principal, occurrence, "restore"));

  const before = snapshot(occurrence, SESSION_FIELDS);
  const updated = await db.sessionOccurrence.update({
    where: { id: occurrence.id },
    data: {
      status: SessionStatus.SCHEDULED,
      cancellationReason: null,
      cancellationNote: null,
      cancelledAt: null,
      cancelledById: null,
      missedReason: null,
    },
  });

  await record(db, principal, {
    category: AuditCategory.SESSION,
    action: "session.restored",
    entityType: "session_occurrence",
    entityId: updated.id,
    entityRef: updated.ref,
    before,
    after: snapshot(updated, SESSION_FIELDS),
    ...options.requestMeta,
  });
  return updated;
}

/**
 * Approve or reject a booking request.
 *
 * Approval re-runs the conflict check. A request does not hold its slot while
 * it waits — otherwise anybody could block an instructor's calendar by asking —
 * so the time may well have gone by the time somebody looks at it, and finding
 * that out at approval is the whole point.
 */
export async function decideRequest(
  db: Db,
  organization: BookingOrganization,
  principal: Principal,
  occurrence: Occurrence,
  options: { approve: boolean; reason?: string | null; requestMeta?: RequestMeta },
): Promise<Occurrence> {
  const action = options.approve ? "approve" : "reject";
  requireDecision(canDecideRequest(principal, occurrence, action));

  const before = snapshot(occurrence, SESSION_FIELDS);
  let data: Prisma.SessionOccurrenceUpdateInput;

  if (options.approve) {
    const report = await check(db, organization, {
      start: occurrence.scheduledStart,
      end: occurrence.scheduledEnd,
      instructorId: occurrence.instructorId,
      studentIds: await studentIds(db, occurrence),
      locationId: occurrence.locationId,
      deliveryType: occurrence.deliveryType,
      excludeSessionId: occurrence.id,
      displayZone: occurrence.timezone,
    });
    const absolute = blocking(report);
    if (absolute.length > 0) {
      throw new ConflictError(
        `this time is no longer free — ${absolute[0]!.message}`,
        absolute.map((conflict) => conflict.message),
      );
    }
    data = { status: SessionStatus.SCHEDULED };
  } else {
    data = { status: SessionStatus.REJECTED, cancellationReason: options.reason || null };
  }

  const updated = await db.sessionOccurrence.update({ where: { id: occurrence.id }, data });

  await record(db, principal, {
    category: AuditCategory.SESSION,
    action: options.approve ? "session.request_approved" : "session.request_rejected",
    entityType: "session_occurrence",
    entityId: updated.id,
    entityRef: updated.ref,
    before,
    after: snapshot(updated, SESSION_FIELDS),
    ...options.requestMeta,
  });
  return updated;
}

/**
 * Mark a session held, recording when it actually ran.
 *
 * Actual times default to the schedule only because a session with no recorded
 * times is still better described as "ran as booked" than as an error — but the
 * two are stored separately so a report can tell them apart.
 */
export async function complete(
  db: Db,
  principal: Principal,
  occurrence: Occurrence,
  options: {
    actualStart?: Date | null;
    actualEnd?: Date | null;
    requestMeta?: RequestMeta;
  } = {},
): Promise<Occurrence> {
  requireDecision(canChangeStatus(principal, occurrence, "complete"));

  const start = options.actualStart
    ? ensureUtc(options.actualStart)
    : (occurrence.actualStart ?? occurrence.scheduledStart);
  const end = options.actualEnd
    ? ensureUtc(options.actualEnd)
    : (occurrence.actualEnd ?? occurrence.scheduledEnd);
  if (end.getTime() < start.getTime()) {
    throw new ValidationError("a session cannot end before it starts");
  }

  const before = snapshot(occurrence, SESSION_FIELDS);
  const updated = await db.sessionOccurrence.update({
    where: { id: occurrence.id },
    data: { status: SessionStatus.COMPLETED, actualStart: start, actualEnd: end },
  });

  await record(db, principal, {
    category: AuditCategory.SESSION,
    action: "session.completed",
    entityType: "session_occurrence",
    entityId: updated.id,
    entityRef: updated.ref,
    before,
    after: snapshot(updated, SESSION_FIELDS),
    ...options.requestMeta,
  });
  return updated;
}

export async function markMissed(
  db: Db,
  organization: ConfigurableOrganization,
  principal: Principal,
  occurrence: Occurrence,
  options: { reason: string; requestMeta?: RequestMeta },
): Promise<Occurrence> {
  requireDecision(canChangeStatus(principal, occurrence, "mark_missed"));

  const valid = settingStrings(settingsReader(organization), ["reason_codes", "missed"]);
  if (valid !== null && valid.length > 0 && !valid.includes(options.reason)) {
    throw new ValidationError("that is not a configured missed-session reason");
  }

  const before = snapshot(occurrence, SESSION_FIELDS);
  const updated = await db.sessionOccurrence.update({
    where: { id: occurrence.id },
    data: { status: SessionStatus.MISSED, missedReason: options.reason },
  });

  await record(db, principal, {
    category: AuditCategory.SESSION,
    action: "session.missed",
    entityType: "session_occurrence",
    entityId: updated.id,
    entityRef: updated.ref,
    before,
    after: snapshot(updated, SESSION_FIELDS),
    ...options.requestMeta,
  });
  return updated;
}

/** Fix what a completed session records. Always audited — it rewrites history. */
export async function correctActualTimes(
  db: Db,
  principal: Principal,
  occurrence: Occurrence,
  options: {
    actualStart: Date | null;
    actualEnd: Date | null;
    requestMeta?: RequestMeta;
  },
): Promise<Occurrence> {
  requireDecision(canCorrectActualTimes(principal, occurrence));

  const start = options.actualStart ? ensureUtc(options.actualStart) : null;
  const end = options.actualEnd ? ensureUtc(options.actualEnd) : null;
  if (start && end && end.getTime() < start.getTime()) {
    throw new ValidationError("a session cannot end before it starts");
  }

  const before = snapshot(occurrence, SESSION_FIELDS);
  const updated = await db.sessionOccurrence.update({
    where: { id: occurrence.id },
    data: { actualStart: start, actualEnd: end },
  });

  await record(db, principal, {
    category: AuditCategory.SESSION,
    action: "session.times_corrected",
    entityType: "session_occurrence",
    entityId: updated.id,
    entityRef: updated.ref,
    before,
    after: snapshot(updated, SESSION_FIELDS),
    ...options.requestMeta,
  });
  return updated;
}

// --- Attendance ------------------------------------------------------------

export const ATTENDANCE_FIELDS: readonly string[] = [
  "attendance",
  "joinedAt",
  "leftAt",
  "attendedMinutes",
];

/** Record one participant's attendance, with an audit entry. */
export async function markAttendance(
  db: Db,
  principal: Principal,
  occurrence: Occurrence,
  participant: Participant,
  options: {
    status: AttendanceStatus;
    joinedAt?: Date | null;
    leftAt?: Date | null;
    attendedMinutes?: number | null;
    source?: AttendanceSource;
    requestMeta?: RequestMeta;
  },
): Promise<Participant> {
  requireDecision(canMarkAttendance(principal, occurrence));
  if (participant.sessionId !== occurrence.id) {
    throw new ValidationError("that participant is not on this session");
  }

  const joined = options.joinedAt ? ensureUtc(options.joinedAt) : null;
  const left = options.leftAt ? ensureUtc(options.leftAt) : null;
  if (joined && left && left.getTime() < joined.getTime()) {
    throw new ValidationError("a participant cannot leave before joining");
  }

  const before = snapshot(participant, ATTENDANCE_FIELDS);
  const updated = await db.sessionParticipant.update({
    where: { id: participant.id },
    data: {
      attendance: options.status,
      joinedAt: joined,
      leftAt: left,
      attendedMinutes:
        options.attendedMinutes !== undefined && options.attendedMinutes !== null
          ? options.attendedMinutes
          : joined && left
            ? Math.floor((left.getTime() - joined.getTime()) / 60_000)
            : null,
      markedById: principal.userId,
      markedAt: new Date(),
      markedSource: options.source ?? AttendanceSource.MANUAL,
    },
  });

  await record(db, principal, {
    category: AuditCategory.ATTENDANCE,
    action: "attendance.marked",
    entityType: "session_participant",
    entityId: updated.id,
    entityRef: occurrence.ref,
    before,
    after: snapshot(updated, ATTENDANCE_FIELDS),
    ...options.requestMeta,
  });
  return updated;
}

/**
 * Bulk-mark, touching only participants nobody has judged yet.
 *
 * An explicit mark is somebody's considered decision. Bulk convenience must
 * never overwrite one, or the feature quietly destroys information.
 */
export async function markAllPresent(
  db: Db,
  principal: Principal,
  occurrence: Occurrence,
  options: { requestMeta?: RequestMeta } = {},
): Promise<Participant[]> {
  requireDecision(canMarkAttendance(principal, occurrence));

  const unmarked = await db.sessionParticipant.findMany({
    where: {
      sessionId: occurrence.id,
      role: ParticipantRole.STUDENT,
      attendance: AttendanceStatus.UNMARKED,
    },
  });

  const marked: Participant[] = [];
  for (const participant of unmarked) {
    marked.push(
      await markAttendance(db, principal, occurrence, participant, {
        status: AttendanceStatus.PRESENT,
        source: AttendanceSource.BULK,
        requestMeta: options.requestMeta,
      }),
    );
  }
  return marked;
}

/**
 * Share of expected students who attended.
 *
 * Excused absences leave the denominator, which is the whole reason the state
 * exists: an authorised absence should not read as a failure to attend.
 */
export function attendanceRate(participants: readonly Participant[]): number | null {
  const counted = participants.filter(
    (participant) =>
      participant.role === ParticipantRole.STUDENT &&
      participant.attendance !== AttendanceStatus.EXCUSED &&
      participant.attendance !== AttendanceStatus.UNMARKED,
  );
  if (counted.length === 0) return null;
  const present = counted.filter((participant) =>
    PRESENT_STATES.includes(participant.attendance),
  ).length;
  return present / counted.length;
}

async function studentIds(db: Db, occurrence: { id: bigint }): Promise<bigint[]> {
  const rows = await db.sessionParticipant.findMany({
    where: { sessionId: occurrence.id, role: ParticipantRole.STUDENT },
    select: { userId: true },
  });
  return rows.map((row) => row.userId);
}

// --- Derived facts about one session ----------------------------------------
//
// Properties on the SQLAlchemy model in the reference; functions here, because
// a Prisma row is a plain object. Kept beside the operations that set the
// values rather than in a helpers module, so the reason the second one may be
// null stays next to the code that decides it.

/** Scheduled length in whole minutes. */
export function scheduledDurationMinutes(occurrence: {
  scheduledStart: Date;
  scheduledEnd: Date;
}): number {
  return Math.floor(
    (occurrence.scheduledEnd.getTime() - occurrence.scheduledStart.getTime()) / 60_000,
  );
}

/**
 * Actual duration, or null when the session has not run.
 *
 * Deliberately not defaulted to the scheduled duration: "we do not know" and
 * "it ran exactly as booked" are different facts, and a report that conflates
 * them is wrong in the direction that flatters.
 */
export function actualDurationMinutes(occurrence: {
  actualStart: Date | null;
  actualEnd: Date | null;
}): number | null {
  if (occurrence.actualStart === null || occurrence.actualEnd === null) return null;
  return Math.floor(
    (occurrence.actualEnd.getTime() - occurrence.actualStart.getTime()) / 60_000,
  );
}
