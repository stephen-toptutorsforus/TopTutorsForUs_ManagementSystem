/**
 * Policy decisions about individual sessions.
 *
 * Ported from `app/policies/sessions.py`.
 *
 * A permission says "this person may cancel sessions in general". A policy says
 * "this person may cancel *this* session" — which additionally depends on who
 * is on it, what state it is in, and what the tenant's cancellation window
 * says. Keeping the two separate is what stops the rules turning into one
 * unreadable condition per route handler.
 *
 * **Status gates action.** A completed session does not offer cancellation, and
 * no amount of permission makes it do so; the record of what happened is not
 * editable into a record of what did not. Deliberately expressed as an
 * allowlist per status, so a new status added later fails closed rather than
 * inheriting every action by default.
 */

import { ParticipantRole, Role, SessionStatus } from "@/generated/prisma/enums";
import { Forbidden } from "@/lib/errors";
import { sessionInSchoolScope } from "@/lib/policies/schoolScope";
import { type ConfigurableOrganization, settingNumber, settingsReader } from "@/lib/organization";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";

/**
 * Just enough of a session row for a policy to decide about it.
 *
 * Structural rather than the Prisma model, so a policy can be asked about a
 * proposed occurrence that has not been written yet — which is exactly what the
 * booking preview does.
 */
export interface SessionLike {
  readonly organizationId: bigint;
  readonly instructorId: bigint | null;
  readonly status: SessionStatus;
  readonly scheduledStart: Date;
  readonly seriesId: bigint | null;
}

/** Which actions each status admits at all, before permissions are considered. */
export const ACTIONS_BY_STATUS: Readonly<Record<SessionStatus, ReadonlySet<string>>> = {
  // A request is not yet a commitment: it can be approved, rejected, tidied up,
  // or withdrawn, but it cannot be completed or marked missed, because nothing
  // has been agreed to happen yet.
  [SessionStatus.REQUESTED]: new Set(["approve", "reject", "edit", "cancel", "delete"]),
  // A rejection is a decision, not a dead end — an administrator may reopen it.
  [SessionStatus.REJECTED]: new Set(["restore", "delete"]),
  [SessionStatus.SCHEDULED]: new Set([
    "edit",
    "reschedule",
    "cancel",
    "complete",
    "mark_missed",
    "attendance",
    "delete",
  ]),
  // Once moved, a session behaves exactly like a scheduled one. The status is a
  // label for coordinators, not a different set of rules.
  [SessionStatus.RESCHEDULED]: new Set([
    "edit",
    "reschedule",
    "cancel",
    "complete",
    "mark_missed",
    "attendance",
    "delete",
  ]),
  [SessionStatus.IN_PROGRESS]: new Set(["edit", "complete", "attendance"]),
  // A held session's record stays correctable — an administrator may fix the
  // actual times and attendance — but it can no longer be cancelled.
  [SessionStatus.COMPLETED]: new Set(["attendance", "correct_actuals"]),
  [SessionStatus.CANCELLED]: new Set(["restore", "delete"]),
  [SessionStatus.MISSED]: new Set(["attendance", "restore"]),
};

/** An allow/deny with a reason fit to show a person. */
export interface Decision {
  readonly allowed: boolean;
  readonly reason: string | null;
}

export const ALLOW: Decision = { allowed: true, reason: null };

export function deny(reason: string): Decision {
  return { allowed: false, reason };
}

export function requireDecision(decision: Decision): void {
  if (!decision.allowed) throw new Forbidden(decision.reason ?? "not permitted");
}

/** "in_progress" reads as "in progress" in a sentence shown to a person. */
function statusWords(status: SessionStatus): string {
  return status.toLowerCase().replace(/_/g, " ");
}

export function statusAllows(session: SessionLike, action: string): boolean {
  return ACTIONS_BY_STATUS[session.status]?.has(action) ?? false;
}

export function isParticipant(
  principal: Principal,
  participantUserIds: Iterable<bigint>,
): boolean {
  for (const id of participantUserIds) {
    if (id === principal.userId) return true;
  }
  return false;
}

/** The instructor of a session owns it for `*_own` permission purposes. */
export function owns(principal: Principal, session: SessionLike): boolean {
  return session.instructorId !== null && session.instructorId === principal.userId;
}

/**
 * Who may follow the host start URL.
 *
 * Students and parents may join; they must not start. The instructor of
 * *this* session may, and so may anybody who can see every session — that
 * is the same people who already see the join link on the booking they
 * made. Another tenant is 404, never 403.
 */
export function canStartMeeting(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (owns(principal, session)) return ALLOW;
  if (principal.has(P.SESSION_VIEW_ANY)) return ALLOW;
  return deny("you may not start this meeting");
}

/** The one refusal that must never say more than this. */
function elsewhere(principal: Principal, session: SessionLike): boolean {
  return session.organizationId !== principal.organizationId;
}

/**
 * Tenant first, then relationship. The tenant check is not optional.
 *
 * A caller from another organization is refused here and turned into a 404 by
 * the route, because a 403 would confirm the session exists.
 */
export function canView(
  principal: Principal,
  session: SessionLike,
  options: {
    participantUserIds?: Iterable<bigint>;
    guardianOfIds?: Iterable<bigint>;
    /** Schools of the students on this session. Used when the viewer is school-scoped. */
    studentSchoolIds?: Iterable<bigint>;
  } = {},
): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (principal.has(P.SESSION_VIEW_ANY)) {
    if (
      options.studentSchoolIds !== undefined &&
      !sessionInSchoolScope(principal, options.studentSchoolIds)
    ) {
      return deny("no such session");
    }
    return ALLOW;
  }

  const participants = new Set(options.participantUserIds ?? []);
  if (participants.has(principal.userId)) return ALLOW;
  for (const childId of options.guardianOfIds ?? []) {
    if (participants.has(childId)) return ALLOW;
  }
  return deny("you are not on this session");
}

export function canEdit(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!statusAllows(session, "edit")) {
    return deny(`a ${statusWords(session.status)} session cannot be edited`);
  }
  if (principal.has(P.SESSION_EDIT_ANY)) return ALLOW;
  if (principal.has(P.SESSION_EDIT_OWN) && owns(principal, session)) return ALLOW;
  return deny("you may not edit this session");
}

/**
 * Moving a session is not the same permission as editing its details.
 *
 * `ACTIONS_BY_STATUS` has always said so — an in-progress session admits `edit`
 * and deliberately not `reschedule`, because a lesson that has started cannot
 * be moved to next Tuesday without leaving the record describing something that
 * did not happen. Nothing called it: the service checked `canEdit`, and the
 * word "reschedule" appeared in the table and nowhere else. So the rule was
 * written down and never enforced.
 *
 * Who may do it is the same question as for editing. When it may be done is
 * not, and that is the part this adds.
 */
export function canReschedule(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!statusAllows(session, "reschedule")) {
    return deny(`a ${statusWords(session.status)} session cannot be rescheduled`);
  }
  if (principal.has(P.SESSION_EDIT_ANY)) return ALLOW;
  if (principal.has(P.SESSION_EDIT_OWN) && owns(principal, session)) return ALLOW;
  return deny("you may not reschedule this session");
}

/**
 * Editing a whole series is a separate, deliberately narrower capability.
 *
 * Being allowed to move one session is not the same as being allowed to move
 * the next thirty, so it is a distinct permission rather than a wider blast
 * radius on the same one.
 */
export function canEditSeries(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (session.seriesId === null) return deny("this session is not part of a series");
  if (!principal.has(P.SESSION_EDIT_SERIES)) return deny("you may not edit a whole series");
  return ALLOW;
}

/**
 * Cancellation, including the tenant's notice window.
 *
 * Administrators are exempt from the window — it exists to protect an
 * instructor's time from late changes by participants, not to stop staff fixing
 * a mistake.
 */
export function canCancel(
  principal: Principal,
  session: SessionLike,
  organization: ConfigurableOrganization | null,
  now?: Date,
): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!statusAllows(session, "cancel")) {
    return deny(`a ${statusWords(session.status)} session cannot be cancelled`);
  }

  if (principal.has(P.SESSION_CANCEL_ANY)) return ALLOW;
  if (!(principal.has(P.SESSION_CANCEL_OWN) && owns(principal, session))) {
    return deny("you may not cancel this session");
  }

  const window = settingNumber(
    settingsReader(organization),
    ["booking", "cancellation_window_hours"],
    24,
  );
  if (window <= 0) return ALLOW;

  const moment = now ?? new Date();
  const noticeMs = session.scheduledStart.getTime() - moment.getTime();
  if (noticeMs < window * 3_600_000) {
    return deny(`cancellations close ${window} hours before the session starts`);
  }
  return ALLOW;
}

export function canDelete(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!principal.has(P.SESSION_DELETE)) return deny("you may not delete sessions");
  if (!statusAllows(session, "delete")) {
    return deny("a session that has run cannot be deleted, only archived");
  }
  return ALLOW;
}

export function canChangeStatus(
  principal: Principal,
  session: SessionLike,
  action: string,
): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!statusAllows(session, action)) {
    return deny(`a ${statusWords(session.status)} session cannot be marked ${action}`);
  }
  if (principal.has(P.SESSION_EDIT_ANY)) return ALLOW;
  if (principal.has(P.SESSION_EDIT_OWN) && owns(principal, session)) return ALLOW;
  return deny("you may not change this session's status");
}

export function canMarkAttendance(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!statusAllows(session, "attendance")) {
    return deny("attendance cannot be recorded for this session");
  }
  if (principal.has(P.ATTENDANCE_MARK_ANY)) return ALLOW;
  if (principal.has(P.ATTENDANCE_MARK_OWN) && owns(principal, session)) return ALLOW;
  return deny("you may not record attendance for this session");
}

/**
 * Correcting what a completed session records is an administrator action.
 *
 * It rewrites history, so it is gated separately and always audited.
 */
export function canCorrectActualTimes(principal: Principal, session: SessionLike): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!principal.has(P.ATTENDANCE_CORRECT_ACTUALS)) {
    return deny("you may not correct recorded times");
  }
  return ALLOW;
}

/**
 * Approve or reject a booking request.
 *
 * An instructor may decide requests for their **own** time and nobody else's;
 * an administrator may decide any in the tenant. Being asked to teach is not
 * grounds for deciding somebody else's calendar.
 */
export function canDecideRequest(
  principal: Principal,
  session: SessionLike,
  action: string,
): Decision {
  if (elsewhere(principal, session)) return deny("no such session");
  if (!statusAllows(session, action)) return deny("this session is not awaiting a decision");
  if (!principal.has(P.SESSION_APPROVE_REQUEST)) {
    return deny("you may not decide booking requests");
  }
  if (principal.has(P.SESSION_VIEW_ANY) || owns(principal, session)) return ALLOW;
  return deny("you may only decide requests for your own sessions");
}

export function canOverrideConflicts(principal: Principal): boolean {
  return principal.has(P.SESSION_OVERRIDE_CONFLICT);
}

export function canBookInPast(principal: Principal): boolean {
  return principal.has(P.SESSION_BOOK_HISTORICAL);
}

/**
 * The actions to offer for this session, in this state, to this person.
 *
 * The detail page renders exactly this list. A completed session therefore
 * never shows a cancel control, which is both correct and one less way for a
 * person to be told "no" after clicking.
 */
export function availableActions(
  principal: Principal,
  session: SessionLike,
  organization: ConfigurableOrganization | null,
): string[] {
  const actions: string[] = [];
  for (const action of ["approve", "reject"]) {
    if (canDecideRequest(principal, session, action).allowed) actions.push(action);
  }
  if (canEdit(principal, session).allowed) actions.push("edit");
  if (canReschedule(principal, session).allowed) actions.push("reschedule");
  if (canEditSeries(principal, session).allowed) actions.push("edit_series");
  if (canCancel(principal, session, organization).allowed) actions.push("cancel");
  if (canChangeStatus(principal, session, "complete").allowed) actions.push("complete");
  if (canChangeStatus(principal, session, "mark_missed").allowed) actions.push("mark_missed");
  if (canChangeStatus(principal, session, "restore").allowed) actions.push("restore");
  if (canMarkAttendance(principal, session).allowed) actions.push("attendance");
  if (
    canCorrectActualTimes(principal, session).allowed &&
    statusAllows(session, "correct_actuals")
  ) {
    actions.push("correct_actuals");
  }
  if (canDelete(principal, session).allowed) actions.push("delete");
  return actions;
}

/** How this person joins a session they book for themselves. */
export function participantRoleFor(principal: Principal): ParticipantRole {
  if (principal.roles.has(Role.INSTRUCTOR)) return ParticipantRole.INSTRUCTOR;
  if (principal.roles.has(Role.STUDENT)) return ParticipantRole.STUDENT;
  return ParticipantRole.OBSERVER;
}
