/**
 * Reminders and credit warnings that stay on this machine.
 *
 * Nothing here talks to an email provider or an SMS provider. A row in
 * `captured_message` is the message. Addresses are the person's own, which
 * on this product are `.test` or a phone stored beside them, and the text
 * names a session ref and a time — never a meeting link.
 *
 * Credits are a number on the person. A student request needs one per
 * session. Staff booking does not. A request that is still short 48 hours
 * out is warned, and one that is still short 24 hours out is cancelled.
 */

import { ParticipantRole, Role, SessionStatus } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import {
  type ConfigurableOrganization,
  settingBoolean,
  settingsReader,
} from "@/lib/organization";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { civilDate, civilTime } from "@/lib/time";

type Audience = "student" | "parent" | "instructor";
type Kind = "reminder" | "confirmation" | "reschedule" | "credit_warning" | "credit_cancel";
type Channel = "in_app" | "email" | "sms";

const MATRIX: Record<Audience, Record<"reminder" | "confirmation" | "reschedule", readonly Channel[]>> = {
  student: {
    reminder: ["in_app", "email", "sms"],
    confirmation: ["in_app", "email"],
    reschedule: ["in_app", "email"],
  },
  parent: {
    reminder: ["in_app", "email", "sms"],
    confirmation: ["in_app", "email"],
    reschedule: ["in_app", "email"],
  },
  instructor: {
    reminder: ["in_app", "email"],
    confirmation: ["in_app"],
    reschedule: ["in_app"],
  },
};

const REMINDER_OFFSETS = [24 * 60, 60];
const WARN_MS = 48 * 3_600_000;
const CANCEL_MS = 24 * 3_600_000;

interface NoticeSession {
  id: bigint;
  ref: string;
  organizationId: bigint;
  status: SessionStatus;
  scheduledStart: Date;
  timezone: string;
  instructorId: bigint | null;
}

/** A student asking, rather than staff booking. Parents are not students. */
function bookedByStudent(roles: readonly Role[]): boolean {
  const held = new Set(roles);
  if (!held.has(Role.STUDENT)) return false;
  if (held.has(Role.INSTRUCTOR) || held.has(Role.ADMIN) || held.has(Role.REGIONAL_ADMIN)) {
    return false;
  }
  return true;
}

/** A student asking, rather than staff booking. Parents are not students. */
export function isStudentRequest(principal: Principal): boolean {
  if (!principal.roles.has(Role.STUDENT)) return false;
  if (principal.roles.has(Role.INSTRUCTOR)) return false;
  if (principal.has(P.SESSION_VIEW_ANY) || principal.has(P.SESSION_APPROVE_REQUEST)) return false;
  return true;
}

export async function assertStudentCredits(
  db: Db,
  organization: ConfigurableOrganization,
  principal: Principal,
  count: number,
): Promise<void> {
  if (!isStudentRequest(principal)) return;
  if (!settingBoolean(settingsReader(organization), ["booking", "require_credits"], true)) return;
  const user = await db.user.findFirst({
    where: { id: principal.userId, organizationId: principal.organizationId },
    select: { creditBalance: true },
  });
  const balance = user?.creditBalance ?? 0;
  if (balance < count) {
    throw new ValidationError(
      count === 1
        ? "a student request needs a credit"
        : `a student request needs ${count} credits`,
    );
  }
}

/** Confirmation and the two reminders, for a session that was just booked. */
export async function captureBooking(
  db: Db,
  sessions: readonly NoticeSession[],
  now: Date,
): Promise<void> {
  for (const session of sessions) {
    if (session.status === SessionStatus.CANCELLED) continue;
    await captureKind(db, session, "confirmation", now);
    await captureKind(db, session, "reminder", now);
  }
}

/** The old reminder is finished. The new time gets its own. */
export async function captureReschedule(db: Db, session: NoticeSession, now: Date): Promise<void> {
  await retireReminders(db, session.id, now);
  if (session.status === SessionStatus.CANCELLED) return;
  await captureKind(db, session, "reschedule", now);
  await captureKind(db, session, "reminder", now);
}

export async function retireReminders(db: Db, sessionId: bigint, now: Date): Promise<void> {
  await db.capturedMessage.updateMany({
    where: { sessionId, kind: "reminder", retiredAt: null },
    data: { retiredAt: now },
  });
}

/**
 * Warn, then cancel, student requests that are still short of a credit.
 *
 * Staff-booked sessions are not requests, so they are not in this sweep.
 */
export async function sweepCredits(
  db: Db,
  organizationId: bigint,
  now: Date,
): Promise<void> {
  const organization = await db.organization.findFirst({
    where: { id: organizationId },
    select: { settings: true },
  });
  if (
    organization === null ||
    !settingBoolean(settingsReader(organization), ["booking", "require_credits"], true)
  ) {
    return;
  }

  const horizon = new Date(now.getTime() + WARN_MS);
  const sessions = await db.sessionOccurrence.findMany({
    where: {
      organizationId,
      status: SessionStatus.REQUESTED,
      archivedAt: null,
      scheduledStart: { lte: horizon },
    },
    select: {
      id: true,
      ref: true,
      organizationId: true,
      status: true,
      scheduledStart: true,
      timezone: true,
      instructorId: true,
      createdById: true,
      participants: {
        where: { role: ParticipantRole.STUDENT },
        select: { userId: true },
      },
    },
  });

  const creatorIds = [
    ...new Set(
      sessions.flatMap((session) => (session.createdById === null ? [] : [session.createdById])),
    ),
  ];
  const creators =
    creatorIds.length === 0
      ? []
      : await db.user.findMany({
          where: { id: { in: creatorIds } },
          select: { id: true, roles: { select: { role: true } } },
        });
  const studentCreators = new Set(
    creators
      .filter((person) => bookedByStudent(person.roles.map((row) => row.role)))
      .map((person) => person.id),
  );

  for (const session of sessions) {
    // A parent request is still a request. Credits apply only when a student asked.
    if (session.createdById === null || !studentCreators.has(session.createdById)) continue;
    const studentIds = session.participants.map((row) => row.userId);
    if (studentIds.length === 0) continue;
    const students = await db.user.findMany({
      where: { id: { in: studentIds } },
      select: { id: true, creditBalance: true },
    });
    const short = students.some((student) => student.creditBalance < 1);
    if (!short) continue;

    const until = session.scheduledStart.getTime() - now.getTime();
    if (until <= CANCEL_MS) {
      await db.sessionOccurrence.update({
        where: { id: session.id },
        data: {
          status: SessionStatus.CANCELLED,
          cancellationReason: "other",
          cancellationNote: "credit balance still short",
          cancelledAt: now,
        },
      });
      await retireReminders(db, session.id, now);
      await captureKind(
        db,
        { ...session, status: SessionStatus.CANCELLED },
        "credit_cancel",
        now,
      );
      continue;
    }

    await captureKind(db, session, "credit_warning", now);
  }
}

async function captureKind(db: Db, session: NoticeSession, kind: Kind, now: Date): Promise<void> {
  if (kind === "reminder" && session.status === SessionStatus.CANCELLED) return;
  const recipients = await recipientsOf(db, session);
  const offsets = kind === "reminder" ? REMINDER_OFFSETS : [0];
  for (const recipient of recipients) {
    const channels =
      kind === "credit_warning" || kind === "credit_cancel"
        ? (["in_app", "email"] as const)
        : MATRIX[recipient.audience][kind];
    for (const channel of channels) {
      const address = channel === "sms" ? recipient.phone : recipient.email;
      if (!address) continue;
      for (const offset of offsets) {
        const dueAt =
          kind === "reminder"
            ? new Date(session.scheduledStart.getTime() - offset * 60_000)
            : now;
        const open = await db.capturedMessage.findFirst({
          where: {
            sessionId: session.id,
            userId: recipient.userId,
            channel,
            kind,
            offsetMinutes: offset,
            retiredAt: null,
          },
          select: { id: true },
        });
        if (open) continue;
        await db.capturedMessage.create({
          data: {
            organizationId: session.organizationId,
            sessionId: session.id,
            userId: recipient.userId,
            channel,
            kind,
            offsetMinutes: offset,
            address,
            body: noticeBody(session, kind),
            dueAt,
          },
        });
      }
    }
  }
}

function noticeBody(session: NoticeSession, kind: Kind): string {
  const when = `${civilDate(session.scheduledStart, session.timezone)} ${civilTime(session.scheduledStart, session.timezone)}`;
  if (kind === "credit_warning") {
    return `Credit balance still short for ${session.ref} at ${when}. It will be cancelled if it is still short a day before.`;
  }
  if (kind === "credit_cancel") {
    return `Request ${session.ref} at ${when} was cancelled because the credit balance was still short.`;
  }
  if (kind === "confirmation") return `Booked ${session.ref} at ${when}.`;
  if (kind === "reschedule") return `Moved ${session.ref} to ${when}.`;
  return `Reminder for ${session.ref} at ${when}.`;
}

interface Recipient {
  userId: bigint;
  audience: Audience;
  email: string | null;
  phone: string | null;
}

async function recipientsOf(db: Db, session: NoticeSession): Promise<Recipient[]> {
  const participants = await db.sessionParticipant.findMany({
    where: { sessionId: session.id, role: ParticipantRole.STUDENT },
    select: { userId: true },
  });
  const studentIds = participants.map((row) => row.userId);
  const guardians = studentIds.length
    ? await db.guardianStudent.findMany({
        where: { organizationId: session.organizationId, studentId: { in: studentIds } },
        select: { guardianId: true },
      })
    : [];
  const ids = [
    ...new Set([
      ...(session.instructorId === null ? [] : [session.instructorId]),
      ...studentIds,
      ...guardians.map((row) => row.guardianId),
    ]),
  ];
  if (ids.length === 0) return [];
  const people = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, email: true, phone: true, roles: { select: { role: true } } },
  });
  const out: Recipient[] = [];
  for (const person of people) {
    const roles = new Set(person.roles.map((row) => row.role));
    let audience: Audience | null = null;
    if (person.id === session.instructorId || roles.has(Role.INSTRUCTOR)) audience = "instructor";
    else if (studentIds.includes(person.id) || roles.has(Role.STUDENT)) audience = "student";
    else if (roles.has(Role.PARENT)) audience = "parent";
    if (audience === null) continue;
    // A person who is both the instructor and a parent is written once, as the instructor.
    if (person.id === session.instructorId) audience = "instructor";
    out.push({
      userId: person.id,
      audience,
      email: person.email,
      phone: person.phone,
    });
  }
  return out;
}
