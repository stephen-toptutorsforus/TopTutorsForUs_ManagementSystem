/**
 * Booking: previewing and creating sessions.
 *
 * Ported from `app/services/booking.py`.
 *
 * Everything here runs inside the caller's transaction and performs no network
 * I/O, so a command either fully happens or fully does not. A series is created
 * whole or not at all — a partially generated series is worse than a failed
 * one, because nobody can tell by looking that it is incomplete.
 *
 * **Preview and create share one code path.** `plan()` produces a `BookingPlan`
 * containing every occurrence with its conflicts; `createFromPlan()` writes
 * exactly that plan. What an administrator is shown before pressing the button
 * is by construction what gets written, rather than a second implementation
 * that agrees most of the time.
 *
 * **Edit scope is explicit.** `EditScope.THIS` reaches one occurrence;
 * `THIS_AND_FUTURE` and `ALL` skip occurrences already detached or already
 * settled. There is no inferred scope — the caller states it, because guessing
 * wrongly here silently rewrites work someone has already done.
 */

import { Prisma } from "@/generated/prisma/client";
import {
  AuditCategory,
  DeliveryType,
  ParticipantRole,
  Role,
  SessionStatus,
} from "@/generated/prisma/enums";
import { SESSION_FIELDS, record, snapshot } from "@/lib/audit";
import {
  type Conflict,
  type ConflictReport,
  blocking,
  check,
  selfOverlaps,
} from "@/lib/conflicts";
import type { Db } from "@/lib/db";
import { ConflictError, Forbidden, ValidationError } from "@/lib/errors";
import {
  type ConfigurableOrganization,
  settingNumber,
  settingStrings,
  settingsReader,
} from "@/lib/organization";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { canBookInPast, canOverrideConflicts } from "@/lib/policies/sessions";
import {
  type Expansion,
  type PlannedOccurrence,
  RecurrenceError,
  type RecurrenceEndMode,
  type RecurrenceFrequency,
  type RecurrenceRule,
  type Weekday,
  buildRule,
  expand,
} from "@/lib/recurrence";
import { newRef } from "@/lib/ref";
import { organizationOffDays } from "@/lib/availability";
import { assertEligible } from "@/lib/services/instructorEligibility";
import {
  type CivilDate,
  type CivilTime,
  addDays,
  civilDate,
  dateToDb,
  daysBetween,
  isValidZone,
  resolveCivil,
  timeToDb,
} from "@/lib/time";
import type { RequestMeta } from "@/lib/services/people";

/**
 * The widths of the columns these values are stored in. Named here so the
 * refusal and the schema cannot drift apart.
 */
export const TITLE_MAX = 200;
export const MEETING_URL_MAX = 1000;
export const LOCATION_DETAIL_MAX = 500;

/**
 * Statuses whose occurrences a series-wide edit must never touch: the record of
 * what already happened is not the series' to rewrite. A rejected request is
 * settled in the same sense — the decision stands until somebody reopens it.
 */
export const SETTLED_STATUSES: SessionStatus[] = [
  SessionStatus.COMPLETED,
  SessionStatus.MISSED,
  SessionStatus.CANCELLED,
  SessionStatus.REJECTED,
];

/** Roles whose bookings become requests when the tenant requires approval. */
const REQUESTING_ROLES: Role[] = [Role.STUDENT, Role.PARENT];

/** Which occurrences an edit reaches. Chosen explicitly, never inferred. */
export enum EditScope {
  THIS = "this",
  THIS_AND_FUTURE = "this_and_future",
  ALL = "all",
}

/**
 * Does this person's booking land as a request rather than a booking?
 *
 * Approval is skipped for anyone who could approve it anyway — asking an
 * administrator to approve their own booking is ceremony, not control.
 */
export function needsApproval(
  organization: ConfigurableOrganization,
  principal: Principal,
): boolean {
  const reader = settingsReader(organization);
  if (reader.setting(["booking", "require_approval"], false) !== true) return false;
  if (principal.has(P.SESSION_APPROVE_REQUEST) || principal.has(P.SESSION_VIEW_ANY)) {
    return false;
  }
  return REQUESTING_ROLES.some((role) => principal.roles.has(role));
}

/** A booking as it arrives, standalone or recurring. */
export interface BookingRequest {
  title: string;
  deliveryType: DeliveryType;
  startDate: CivilDate;
  startTime: CivilTime;
  durationMinutes: number;
  timezone: string;
  instructorId?: bigint | null;
  studentIds?: readonly bigint[];
  groupId?: bigint | null;
  programId?: bigint | null;
  subjectId?: bigint | null;
  gradeId?: bigint | null;
  locationId?: bigint | null;
  /**
   * Free text for "where", used when the tenant has no `location` row to point
   * at. It cannot feed the room exclusion constraint — only `locationId` can.
   */
  locationDetail?: string | null;
  meetingUrl?: string | null;
  description?: string | null;
  billable?: boolean;
  /** `repeat` false produces exactly one occurrence. */
  repeat?: boolean;
  frequency?: RecurrenceFrequency;
  intervalN?: number;
  weekdays?: readonly string[];
  endMode?: RecurrenceEndMode;
  occurrenceCount?: number | null;
  untilDate?: CivilDate | null;
  overrideConflicts?: boolean;
}

/** One occurrence in a plan, with whatever is wrong with it. */
export interface PlannedSession {
  readonly occurrence: PlannedOccurrence;
  readonly report: ConflictReport;
}

export function hasConflicts(planned: PlannedSession): boolean {
  return planned.report.conflicts.length > 0;
}

export function isBlocked(planned: PlannedSession): boolean {
  return blocking(planned.report).length > 0;
}

/** The complete preview: every occurrence, every conflict, every truncation. */
export interface BookingPlan {
  readonly request: BookingRequest;
  readonly expansion: Expansion;
  /**
   * The rule the preview was expanded from, kept so the write records the
   * weekdays that were actually used rather than the empty selection the form
   * sent. `buildRule` resolves "no selection" to the start date's weekday.
   */
  readonly rule: RecurrenceRule;
  readonly sessions: PlannedSession[];
  readonly selfOverlaps: [number, number][];
  readonly studentIds: bigint[];
}

export function planTotal(plan: BookingPlan): number {
  return plan.sessions.length;
}

export function conflictedSessions(plan: BookingPlan): PlannedSession[] {
  return plan.sessions.filter(hasConflicts);
}

export function blockedSessions(plan: BookingPlan): PlannedSession[] {
  return plan.sessions.filter(isBlocked);
}

/** True when nothing absolute stands in the way. */
export function isBookable(plan: BookingPlan): boolean {
  return (
    plan.sessions.length > 0 &&
    blockedSessions(plan).length === 0 &&
    plan.selfOverlaps.length === 0
  );
}

export function needsOverride(plan: BookingPlan): boolean {
  return conflictedSessions(plan).length > 0 && blockedSessions(plan).length === 0;
}

/** The organization row booking reads. */
export interface BookingOrganization extends ConfigurableOrganization {
  id: bigint;
  timezone: string;
}

/**
 * Expand and check a booking without writing anything.
 *
 * Every occurrence is checked individually, so the preview can show conflicts
 * per date rather than a single "there is a problem somewhere" that leaves the
 * person to find it.
 */
export async function plan(
  db: Db,
  organization: BookingOrganization,
  principal: Principal,
  request: BookingRequest,
  now?: Date,
): Promise<BookingPlan> {
  validateRequest(organization, principal, request, now);
  const studentIds = await resolveStudents(db, organization, request);

  // Who may teach whom, before anything is expanded or checked for clashes.
  // The roster is passed rather than the group, because the group has just been
  // expanded above and expanding it twice would let a membership change land
  // between the two — the session is booked for the roster resolved here.
  await assertEligible(db, {
    organization,
    principal,
    studentIds,
    instructorId: request.instructorId ?? null,
  });

  const repeat = request.repeat ?? false;
  const rule = buildRule({
    frequency: repeat ? (request.frequency ?? "weekly") : "weekly",
    intervalN: request.intervalN ?? 1,
    weekdays: request.weekdays && request.weekdays.length > 0 ? request.weekdays : null,
    startDate: request.startDate,
    startTime: request.startTime,
    durationMinutes: request.durationMinutes,
    timezone: request.timezone,
    endMode: repeat ? (request.endMode ?? "count") : "count",
    occurrenceCount: repeat ? (request.occurrenceCount ?? null) : 1,
    untilDate: repeat ? (request.untilDate ?? null) : null,
  });

  const reader = settingsReader(organization);
  const maxOccurrences = settingNumber(reader, ["booking", "max_occurrences_per_series"], 60);
  const maxHorizon = settingNumber(reader, ["booking", "max_series_horizon_days"], 365);
  const horizonEnd = addDays(request.startDate, maxHorizon);
  const offDays = await organizationOffDays(
    db,
    organization.id,
    request.startDate,
    horizonEnd,
  );

  const expansion = expand(rule, {
    maxOccurrences: repeat ? maxOccurrences : 1,
    maxHorizonDays: maxHorizon,
    skipDates: offDays,
  });
  if (expansion.occurrences.length === 0) {
    throw new ValidationError(
      "this rule produces no sessions — every matching date is a closure or " +
        "falls outside the booking horizon",
    );
  }

  const sessions: PlannedSession[] = [];
  for (const occurrence of expansion.occurrences) {
    const report = await check(db, organization, {
      start: occurrence.start,
      end: occurrence.end,
      instructorId: request.instructorId ?? null,
      studentIds,
      locationId: request.locationId ?? null,
      deliveryType: request.deliveryType,
      displayZone: request.timezone,
    });
    sessions.push({ occurrence, report });
  }

  return {
    request,
    expansion,
    rule,
    sessions,
    selfOverlaps: selfOverlaps(
      sessions.map((planned) => [planned.occurrence.start, planned.occurrence.end] as const),
    ),
    studentIds,
  };
}

export type CreatedSeries = Prisma.SessionSeriesGetPayload<object>;
export type CreatedOccurrence = Prisma.SessionOccurrenceGetPayload<object>;

/**
 * Write the plan. All occurrences, or none.
 *
 * The caller's transaction is not committed here — the route commits, so an
 * audit failure or a constraint violation rolls back the whole booking.
 */
export async function createFromPlan(
  db: Db,
  organization: BookingOrganization,
  principal: Principal,
  bookingPlan: BookingPlan,
  requestMeta: RequestMeta = {},
): Promise<{ series: CreatedSeries | null; created: CreatedOccurrence[] }> {
  const request = bookingPlan.request;

  if (bookingPlan.selfOverlaps.length > 0) {
    const [first, second] = bookingPlan.selfOverlaps[0]!;
    throw new ValidationError(
      `this rule produces sessions that overlap each other ` +
        `(sessions ${first + 1} and ${second + 1}) — shorten the duration ` +
        `or widen the interval`,
    );
  }

  const blocked = blockedSessions(bookingPlan);
  if (blocked.length > 0) {
    const all = blocked.flatMap((planned) => blocking(planned.report));
    throw new ConflictError(
      all[0]!.message,
      all.map((conflict: Conflict) => conflict.message),
    );
  }

  const conflicted = conflictedSessions(bookingPlan);
  if (needsOverride(bookingPlan) && !request.overrideConflicts) {
    throw new ConflictError(
      "this booking conflicts with existing sessions",
      conflicted.flatMap((planned) =>
        planned.report.conflicts.map((conflict) => conflict.message),
      ),
    );
  }
  if (request.overrideConflicts && !canOverrideConflicts(principal)) {
    throw new Forbidden("you may not book over a conflict");
  }

  // Asked again, against the roster the plan settled on. A preview can sit on
  // a screen for an hour, and an assignment withdrawn in that hour must not be
  // honoured by the confirm that follows it. There is no conflict-override
  // equivalent here: overriding a clash is a scheduling judgement somebody is
  // permitted to make, while teaching a student one may not teach is not.
  await assertEligible(db, {
    organization,
    principal,
    studentIds: bookingPlan.studentIds,
    instructorId: request.instructorId ?? null,
  });

  let series: CreatedSeries | null = null;
  if (request.repeat && bookingPlan.sessions.length > 1) {
    const endMode = request.endMode ?? "count";
    series = await db.sessionSeries.create({
      data: {
        ref: newRef("ser"),
        organizationId: organization.id,
        title: request.title,
        description: request.description ?? null,
        deliveryType: request.deliveryType,
        defaultDurationMinutes: request.durationMinutes,
        timezone: request.timezone,
        frequency: frequencyEnum(request.frequency ?? "weekly"),
        intervalN: request.intervalN ?? 1,
        weekdays: [...bookingPlan.rule.weekdays] as Prisma.InputJsonValue,
        startDate: dateToDb(request.startDate),
        startTime: timeToDb(request.startTime),
        endMode: endModeEnum(endMode),
        occurrenceCount: endMode === "count" ? (request.occurrenceCount ?? null) : null,
        untilDate:
          endMode === "until" && request.untilDate ? dateToDb(request.untilDate) : null,
        defaultInstructorId: request.instructorId ?? null,
        groupId: request.groupId ?? null,
        programId: request.programId ?? null,
        subjectId: request.subjectId ?? null,
        gradeId: request.gradeId ?? null,
        locationId: request.locationId ?? null,
        locationDetail: request.locationDetail ?? null,
        meetingUrl: request.meetingUrl ?? null,
        billable: request.billable ?? true,
        classroomConfig: {},
        createdById: principal.userId,
      },
    });
  }

  const overridden = Boolean(request.overrideConflicts && conflicted.length > 0);
  const initialStatus = needsApproval(organization, principal)
    ? SessionStatus.REQUESTED
    : SessionStatus.SCHEDULED;

  // Written one at a time rather than with createMany, because each row's ref
  // and conflict flag differ and the created rows are needed back for the
  // participants and the audit entries. The exclusion constraints are evaluated
  // on each insert, so a clash the service missed still fails the whole booking
  // — the caller's transaction is what makes that all-or-nothing.
  const created: CreatedOccurrence[] = [];
  for (const planned of bookingPlan.sessions) {
    created.push(
      await db.sessionOccurrence.create({
        data: {
          ref: newRef("ses"),
          organizationId: organization.id,
          seriesId: series ? series.id : null,
          seriesIndex: series ? planned.occurrence.index : null,
          title: request.title,
          description: request.description ?? null,
          deliveryType: request.deliveryType,
          meetingUrl: request.meetingUrl ?? null,
          locationId: request.locationId ?? null,
          locationDetail: request.locationDetail ?? null,
          scheduledStart: planned.occurrence.start,
          scheduledEnd: planned.occurrence.end,
          timezone: request.timezone,
          status: initialStatus,
          instructorId: request.instructorId ?? null,
          groupId: request.groupId ?? null,
          programId: request.programId ?? null,
          subjectId: request.subjectId ?? null,
          gradeId: request.gradeId ?? null,
          billable: request.billable ?? true,
          conflictOverridden: Boolean(
            hasConflicts(planned) && request.overrideConflicts,
          ),
          createdById: principal.userId,
        },
      }),
    );
  }

  for (const occurrence of created) {
    await attachParticipants(
      db,
      organization,
      occurrence,
      request.instructorId ?? null,
      bookingPlan.studentIds,
    );
  }

  if (series !== null) {
    await record(db, principal, {
      category: AuditCategory.SERIES,
      action: "series.created",
      entityType: "session_series",
      entityId: series.id,
      entityRef: series.ref,
      changes: {
        occurrence_count: { from: null, to: created.length },
        weekdays: { from: null, to: [...bookingPlan.rule.weekdays] },
        frequency: { from: null, to: request.frequency ?? "weekly" },
      },
      note: overridden ? "conflict override" : null,
      ...requestMeta,
    });
  }

  for (const occurrence of created) {
    await record(db, principal, {
      category: AuditCategory.SESSION,
      action: "session.created",
      entityType: "session_occurrence",
      entityId: occurrence.id,
      entityRef: occurrence.ref,
      before: {},
      after: snapshot(occurrence, SESSION_FIELDS),
      note: occurrence.conflictOverridden ? "conflict override" : null,
      ...requestMeta,
    });
  }

  return { series, created };
}

/**
 * Materialise the roster now, so the attendance denominator is fixed.
 *
 * A student added to the group next month must not retroactively appear on a
 * session held last month, nor change its attendance rate.
 */
async function attachParticipants(
  db: Db,
  organization: { id: bigint },
  occurrence: CreatedOccurrence,
  instructorId: bigint | null,
  studentIds: readonly bigint[],
): Promise<void> {
  if (instructorId !== null) {
    await db.sessionParticipant.create({
      data: {
        organizationId: organization.id,
        sessionId: occurrence.id,
        userId: instructorId,
        role: ParticipantRole.INSTRUCTOR,
      },
    });
  }
  for (const studentId of studentIds) {
    await db.sessionParticipant.create({
      data: {
        organizationId: organization.id,
        sessionId: occurrence.id,
        userId: studentId,
        role: ParticipantRole.STUDENT,
      },
    });
  }
}

/**
 * Server-side validation of everything the form could get wrong.
 *
 * All of it re-checked here regardless of what the UI allows, because a hidden
 * field is not a constraint.
 */
function validateRequest(
  organization: BookingOrganization,
  principal: Principal,
  request: BookingRequest,
  now?: Date,
): void {
  if (!request.title.trim()) throw new ValidationError("a session needs a title");

  // Checked against the columns these end up in. Without it the value reaches
  // Postgres, which refuses it with "value too long for type character
  // varying(200)" — a 500 produced by typing too much into a text box, and one
  // that appears only on confirm, because a preview writes nothing.
  const lengths: [string, string, number][] = [
    ["title", request.title, TITLE_MAX],
    ["meeting link", request.meetingUrl ?? "", MEETING_URL_MAX],
    ["location detail", request.locationDetail ?? "", LOCATION_DETAIL_MAX],
  ];
  for (const [label, value, limit] of lengths) {
    if (value.length > limit) {
      throw new ValidationError(`the ${label} is too long — ${limit} characters at most`);
    }
  }

  if (!isValidZone(request.timezone)) throw new ValidationError("unknown timezone");

  const reader = settingsReader(organization);

  const durations = reader.setting(["booking", "selectable_durations_minutes"], [60]);
  if (Array.isArray(durations) && durations.length > 0) {
    const allowed = durations.map(Number);
    if (!allowed.includes(request.durationMinutes)) {
      throw new ValidationError(
        `session length must be one of: ${allowed.map((d) => `${d} min`).join(", ")}`,
      );
    }
  }

  const enabled = settingStrings(reader, ["classroom", "enabled_delivery_types"]);
  if (enabled !== null && enabled.length > 0) {
    const wire = request.deliveryType.toLowerCase();
    if (!enabled.includes(wire)) {
      throw new ValidationError(`${wire} sessions are not enabled here`);
    }
  }

  // Neither the meeting link nor the room is required to book. The booking form
  // no longer asks for them, so demanding one here would make every booking
  // fail. A link that *is* supplied — by the API, or by a later edit — still
  // has to be a real one.
  if (request.meetingUrl) validateUrl(request.meetingUrl);

  if (request.instructorId === null || request.instructorId === undefined) {
    throw new ValidationError("a session needs an instructor");
  }
  if (
    (request.studentIds ?? []).length === 0 &&
    (request.groupId === null || request.groupId === undefined)
  ) {
    throw new ValidationError("a session needs at least one student, or a group");
  }

  if (request.repeat) {
    // Asked for more than the tenant allows, say so. `expand` would stop at the
    // ceiling and report the truncation, which is right for a run that grows
    // past it — a closure pushing the last session over the horizon — but wrong
    // for a number typed straight in: silently booking 60 when 500 was asked
    // for is not an answer to the question.
    const ceiling = settingNumber(reader, ["booking", "max_occurrences_per_series"], 60);
    const endMode = request.endMode ?? "count";
    if (
      endMode === "count" &&
      request.occurrenceCount !== null &&
      request.occurrenceCount !== undefined &&
      request.occurrenceCount > ceiling
    ) {
      throw new ValidationError(
        `book at most ${ceiling} sessions at once — you asked for ${request.occurrenceCount}`,
      );
    }

    // No weekday selection means "the weekday the series starts on", which is
    // what `buildRule` already resolves it to. The booking form relies on that:
    // it offers a count and nothing else.
    try {
      buildRule({
        frequency: request.frequency ?? "weekly",
        intervalN: request.intervalN ?? 1,
        weekdays: request.weekdays && request.weekdays.length > 0 ? request.weekdays : null,
        startDate: request.startDate,
        startTime: request.startTime,
        durationMinutes: request.durationMinutes,
        timezone: request.timezone,
        endMode,
        occurrenceCount: request.occurrenceCount ?? null,
        untilDate: request.untilDate ?? null,
      });
    } catch (error) {
      if (error instanceof RecurrenceError) throw new ValidationError(error.message);
      throw error;
    }
  }

  validateTiming(organization, principal, request, now);
}

/** Booking lead time and future horizon, both tenant-configured. */
function validateTiming(
  organization: BookingOrganization,
  principal: Principal,
  request: BookingRequest,
  now?: Date,
): void {
  const moment = now ?? new Date();
  const firstStart = resolveCivil(
    request.startDate,
    request.startTime,
    request.timezone,
  ).instant;
  const reader = settingsReader(organization);

  if (firstStart.getTime() < moment.getTime()) {
    if (!canBookInPast(principal)) throw new ValidationError("this session is in the past");
    return;
  }

  const lead = settingNumber(reader, ["booking", "lead_time_minutes"], 0);
  if (lead && firstStart.getTime() - moment.getTime() < lead * 60_000) {
    throw new ValidationError(`sessions must be booked at least ${lead} minutes ahead`);
  }

  const maxDays = settingNumber(reader, ["booking", "max_future_days"], 365);
  const ahead = daysBetween(
    civilDate(moment, request.timezone),
    civilDate(firstStart, request.timezone),
  );
  if (ahead > maxDays) {
    throw new ValidationError(`sessions cannot be booked more than ${maxDays} days ahead`);
  }
}

/**
 * Only http(s), and no credentials embedded in the authority.
 *
 * A `javascript:` link rendered as an anchor is stored XSS, and a URL carrying
 * `user:password@` leaks a credential into every page that shows the link.
 */
export function validateUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    throw new ValidationError("that meeting link is not a valid URL");
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new ValidationError("a meeting link must be an http or https URL");
  }
  if (!parsed.host) throw new ValidationError("that meeting link is not a valid URL");
  if (parsed.username || parsed.password) {
    throw new ValidationError("a meeting link must not contain credentials");
  }
}

/**
 * The final student list: explicit ids plus a group's current members.
 *
 * A group is expanded **once, at booking time**. The session then owns its
 * roster; later membership changes do not rewrite past sessions.
 */
async function resolveStudents(
  db: Db,
  organization: { id: bigint },
  request: BookingRequest,
): Promise<bigint[]> {
  const ids: bigint[] = [];

  if (request.groupId !== null && request.groupId !== undefined) {
    const group = await db.group.findUnique({ where: { id: request.groupId } });
    if (group === null || group.organizationId !== organization.id) {
      throw new ValidationError("no such group");
    }
    const members = await db.groupMember.findMany({
      where: { groupId: group.id, memberRole: "student" },
      select: { userId: true },
    });
    ids.push(...members.map((member) => member.userId));
    if (group.capacity !== null && members.length > group.capacity) {
      throw new ValidationError("this group is over its capacity");
    }
  }

  ids.push(...(request.studentIds ?? []));

  const unique = [...new Set(ids)];
  if (unique.length > 0) {
    const found = await db.user.findMany({
      where: { id: { in: unique }, organizationId: organization.id, archivedAt: null },
      select: { id: true },
    });
    if (found.length !== unique.length) {
      // Names deliberately absent: the caller passed an id that is not theirs
      // to see, so nothing about it is disclosed.
      throw new ValidationError("one or more selected students are not available");
    }
  }
  return unique;
}

/** Just enough of an occurrence to decide what an edit at a scope reaches. */
export interface ScopableOccurrence {
  id: bigint;
  organizationId: bigint;
  seriesId: bigint | null;
  scheduledStart: Date;
}

/**
 * Which occurrences an edit at this scope reaches.
 *
 * `ALL` and `THIS_AND_FUTURE` both skip occurrences that are detached or have
 * already settled — a completed session's record is not the series' to rewrite.
 */
export async function occurrencesInScope<T extends ScopableOccurrence>(
  db: Db,
  occurrence: T,
  scope: EditScope,
): Promise<(T | CreatedOccurrence)[]> {
  if (scope === EditScope.THIS || occurrence.seriesId === null) return [occurrence];

  const where: Prisma.SessionOccurrenceWhereInput = {
    seriesId: occurrence.seriesId,
    organizationId: occurrence.organizationId,
    archivedAt: null,
    detachedFromSeries: false,
    status: { notIn: SETTLED_STATUSES },
  };
  if (scope === EditScope.THIS_AND_FUTURE) {
    where.scheduledStart = { gte: occurrence.scheduledStart };
  }

  const found = await db.sessionOccurrence.findMany({
    where,
    orderBy: { scheduledStart: "asc" },
  });

  // The occurrence the edit started from is always included, even if it is
  // itself detached — the person is looking at it and asked to change it.
  if (!found.some((row) => row.id === occurrence.id)) {
    return [occurrence, ...found];
  }
  return found;
}

// --- Enum crossings ----------------------------------------------------------
//
// The recurrence module speaks the wire values ("weekly", "count"), because it
// was ported from a module that has no database in it. Prisma's generated enums
// use the member names. One conversion each, here, rather than a `as never`
// scattered through the writer.

function frequencyEnum(value: RecurrenceFrequency) {
  return value === "daily" ? "DAILY" : "WEEKLY";
}

function endModeEnum(value: RecurrenceEndMode) {
  return value === "until" ? "UNTIL" : "COUNT";
}

export type { Weekday };
