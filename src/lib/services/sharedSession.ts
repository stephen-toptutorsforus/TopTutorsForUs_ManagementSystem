/**
 * The shared session slice.
 *
 * Ops keeps `session_occurrence` as the booking record. These functions also
 * write a copy shaped like the school app's School, User, Pod, Session, and
 * SessionAttendance rows, then append one outbound change. A received
 * attendance change is stored on that copy and on the ops participant, and
 * is not appended again.
 *
 * The host start URL is never copied. Password hashes are never copied.
 */

import {
  AttendanceSource,
  AttendanceStatus,
  ParticipantRole,
  SessionStatus,
  SharedAttendanceStatus,
  SharedRole,
  SharedSessionStatus,
} from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";

const SESSION_KIND = "session.upsert";

export interface InboundAttendance {
  /** Id of the change from the other database. A repeat is ignored. */
  sourceId: string;
  /** Shared session id, the same string on both sides. */
  sessionId: string;
  /** Shared user id of the student. */
  studentId: string;
  status: "UNMARKED" | "PRESENT" | "LATE" | "ABSENT";
  joinedAt?: Date | null;
  leftAt?: Date | null;
}

interface SharedUserRow {
  id: string;
  email: string;
  name: string;
  role: SharedRole;
  schoolId: string | null;
}

interface AttendanceRow {
  id: string;
  sessionId: string;
  studentId: string;
  status: SharedAttendanceStatus;
  joinedAt: Date | null;
  leftAt: Date | null;
}

/** Write or refresh the shared copy of one occurrence, and queue it. */
export async function publishOccurrence(
  db: Db,
  occurrenceId: bigint,
  options: { schoolId?: bigint | null } = {},
): Promise<void> {
  const occurrence = await db.sessionOccurrence.findUnique({ where: { id: occurrenceId } });
  if (occurrence === null) return;

  const organization = await db.organization.findUnique({
    where: { id: occurrence.organizationId },
  });
  if (organization === null) return;

  const subject = occurrence.subjectId
    ? await db.subject.findUnique({ where: { id: occurrence.subjectId } })
    : null;
  const subjectName = subject?.name ?? "General";

  const participants = await db.sessionParticipant.findMany({
    where: { sessionId: occurrence.id },
  });
  const studentIds = participants
    .filter((participant) => participant.role === ParticipantRole.STUDENT)
    .map((participant) => participant.userId);

  const schoolId = await resolveSchoolId(db, options.schoolId ?? null, occurrence.locationId, studentIds);
  const school = schoolId === null ? null : await ensureSchool(db, schoolId, organization.timezone);

  const studentSharedIds: string[] = [];
  for (const studentId of studentIds) {
    studentSharedIds.push(
      await ensurePerson(db, studentId, SharedRole.STUDENT, school?.id ?? null, true),
    );
  }
  const tutorSharedId =
    occurrence.instructorId !== null
      ? await ensurePerson(db, occurrence.instructorId, SharedRole.TUTOR, null, false)
      : await ensureUnassignedTutor(db, organization.id);

  const pod = await ensurePod(db, occurrence, subjectName, tutorSharedId);
  for (const studentSharedId of studentSharedIds) {
    await ensureMembership(db, pod.id, studentSharedId);
  }

  const duration = Math.max(
    1,
    Math.round((occurrence.scheduledEnd.getTime() - occurrence.scheduledStart.getTime()) / 60_000),
  );
  const session = await ensureSession(db, occurrence.id, {
    podId: pod.id,
    tutorId: tutorSharedId,
    title: occurrence.title,
    subject: subjectName,
    scheduledAt: occurrence.scheduledStart,
    duration,
    status: toSharedStatus(occurrence.status),
    zoomJoinUrl: occurrence.meetingUrl,
  });

  const attendance: AttendanceRow[] = [];
  for (const studentSharedId of studentSharedIds) {
    attendance.push(await ensureAttendance(db, session.id, studentSharedId));
  }

  const users = await db.sharedUser.findMany({
    where: { id: { in: [tutorSharedId, ...studentSharedIds] } },
  });
  const memberships = await db.sharedPodMembership.findMany({ where: { podId: pod.id } });

  await db.outboundChange.create({
    data: {
      kind: SESSION_KIND,
      sessionId: session.id,
      payload: {
        school: school
          ? { id: school.id, name: school.name, slug: school.slug, timezone: school.timezone }
          : null,
        users: users.map(userPayload),
        pod: {
          id: pod.id,
          name: pod.name,
          subject: pod.subject,
          tutorId: pod.tutorId,
          status: pod.status,
        },
        memberships: memberships.map((membership) => ({
          id: membership.id,
          podId: membership.podId,
          studentId: membership.studentId,
          status: membership.status,
        })),
        session: {
          id: session.id,
          podId: session.podId,
          tutorId: session.tutorId,
          title: session.title,
          subject: session.subject,
          scheduledAt: session.scheduledAt.toISOString(),
          duration: session.duration,
          status: session.status,
          zoomJoinUrl: session.zoomJoinUrl,
        },
        attendance: attendance.map(attendancePayload),
      },
    },
  });
}

/**
 * Store an attendance change that arrived from the other database.
 *
 * Returns false when this source id was already stored. Either way, nothing
 * is appended to the outbound queue.
 */
export async function applyInboundAttendance(
  db: Db,
  change: InboundAttendance,
): Promise<boolean> {
  const sourceId = change.sourceId.trim();
  if (!sourceId || sourceId.length > 64) {
    throw new ValidationError("an inbound attendance change needs a source id");
  }
  const sharedStatus = SHARED_ATTENDANCE[change.status];
  if (sharedStatus === undefined) {
    throw new ValidationError("that attendance status is not one this copy stores");
  }

  const seen = await db.appliedInbound.findUnique({ where: { sourceId } });
  if (seen !== null) return false;

  const session = await db.sharedSession.findUnique({ where: { id: change.sessionId } });
  if (session === null) throw new ValidationError("no such shared session");
  const student = await db.sharedUser.findUnique({ where: { id: change.studentId } });
  if (student === null) throw new ValidationError("no such shared student");

  const joinedAt = change.joinedAt ?? null;
  const leftAt = change.leftAt ?? null;
  if (joinedAt && leftAt && leftAt.getTime() < joinedAt.getTime()) {
    throw new ValidationError("a participant cannot leave before joining");
  }

  await db.sharedSessionAttendance.upsert({
    where: { sessionId_studentId: { sessionId: session.id, studentId: student.id } },
    create: {
      sessionId: session.id,
      studentId: student.id,
      status: sharedStatus,
      joinedAt,
      leftAt,
    },
    update: { status: sharedStatus, joinedAt, leftAt },
  });

  const sessionLink = await db.sharedLink.findFirst({
    where: { entityType: "session", sharedId: session.id },
  });
  const userLink = await db.sharedLink.findFirst({
    where: { entityType: "user", sharedId: student.id },
  });
  if (sessionLink !== null && userLink !== null) {
    await db.sessionParticipant.updateMany({
      where: {
        sessionId: sessionLink.opsId,
        userId: userLink.opsId,
        role: ParticipantRole.STUDENT,
      },
      data: {
        attendance: OPS_ATTENDANCE[change.status],
        joinedAt,
        leftAt,
        markedAt: new Date(),
        markedSource: AttendanceSource.SYSTEM,
      },
    });
  }

  await db.appliedInbound.create({ data: { sourceId } });
  return true;
}

const SHARED_ATTENDANCE: Record<InboundAttendance["status"], SharedAttendanceStatus> = {
  UNMARKED: SharedAttendanceStatus.UNMARKED,
  PRESENT: SharedAttendanceStatus.PRESENT,
  LATE: SharedAttendanceStatus.LATE,
  ABSENT: SharedAttendanceStatus.ABSENT,
};

const OPS_ATTENDANCE: Record<InboundAttendance["status"], AttendanceStatus> = {
  UNMARKED: AttendanceStatus.UNMARKED,
  PRESENT: AttendanceStatus.PRESENT,
  LATE: AttendanceStatus.LATE,
  ABSENT: AttendanceStatus.ABSENT,
};

function toSharedStatus(status: SessionStatus): SharedSessionStatus {
  switch (status) {
    case SessionStatus.IN_PROGRESS:
      return SharedSessionStatus.LIVE;
    case SessionStatus.COMPLETED:
      return SharedSessionStatus.COMPLETED;
    case SessionStatus.CANCELLED:
    case SessionStatus.REJECTED:
    case SessionStatus.MISSED:
      return SharedSessionStatus.CANCELLED;
    default:
      return SharedSessionStatus.SCHEDULED;
  }
}

function userPayload(user: SharedUserRow) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    schoolId: user.schoolId,
  };
}

function attendancePayload(row: AttendanceRow) {
  return {
    id: row.id,
    sessionId: row.sessionId,
    studentId: row.studentId,
    status: row.status,
    joinedAt: row.joinedAt ? row.joinedAt.toISOString() : null,
    leftAt: row.leftAt ? row.leftAt.toISOString() : null,
  };
}

async function resolveSchoolId(
  db: Db,
  requested: bigint | null,
  locationId: bigint | null,
  studentIds: readonly bigint[],
): Promise<bigint | null> {
  if (requested !== null) return requested;
  if (locationId !== null) {
    const location = await db.location.findUnique({ where: { id: locationId } });
    if (location?.schoolId) return location.schoolId;
  }
  if (studentIds.length === 0) return null;
  const placements = await db.userSchool.findMany({
    where: { userId: { in: [...studentIds] } },
  });
  const schoolIds = [...new Set(placements.map((placement) => placement.schoolId.toString()))];
  if (schoolIds.length !== 1) return null;
  return placements[0]!.schoolId;
}

async function ensureSchool(db: Db, schoolId: bigint, organizationTimezone: string) {
  const school = await db.school.findUnique({ where: { id: schoolId } });
  if (school === null) return null;
  const timezone = school.timezone || organizationTimezone || "America/Chicago";
  const existing = await db.sharedLink.findUnique({
    where: { entityType_opsId: { entityType: "school", opsId: school.id } },
  });
  if (existing !== null) {
    return db.sharedSchool.update({
      where: { id: existing.sharedId },
      data: { name: school.name, slug: school.ref, timezone },
    });
  }
  const created = await db.sharedSchool.create({
    data: { name: school.name, slug: school.ref, timezone },
  });
  await db.sharedLink.create({
    data: { entityType: "school", opsId: school.id, sharedId: created.id },
  });
  return created;
}

async function ensurePerson(
  db: Db,
  userId: bigint,
  role: SharedRole,
  schoolSharedId: string | null,
  assignSchool: boolean,
): Promise<string> {
  const user = await db.user.findUnique({ where: { id: userId } });
  if (user === null) throw new ValidationError("that person is not on the session");
  const email = user.email ?? `${user.ref}@users.toptutorsforus.invalid`;
  const name = `${user.firstName} ${user.lastName}`.trim();
  const existing = await db.sharedLink.findUnique({
    where: { entityType_opsId: { entityType: "user", opsId: user.id } },
  });
  if (existing !== null) {
    await db.sharedUser.update({
      where: { id: existing.sharedId },
      data: {
        name,
        role,
        ...(assignSchool ? { schoolId: schoolSharedId } : {}),
      },
    });
    return existing.sharedId;
  }
  const created = await db.sharedUser.create({
    data: { email, name, role, schoolId: schoolSharedId },
  });
  await db.sharedLink.create({
    data: { entityType: "user", opsId: user.id, sharedId: created.id },
  });
  return created.id;
}

async function ensureUnassignedTutor(db: Db, organizationId: bigint): Promise<string> {
  const existing = await db.sharedLink.findUnique({
    where: { entityType_opsId: { entityType: "unassigned_tutor", opsId: organizationId } },
  });
  if (existing !== null) return existing.sharedId;
  const created = await db.sharedUser.create({
    data: {
      email: `unassigned-${organizationId}@users.toptutorsforus.invalid`,
      name: "Unassigned tutor",
      role: SharedRole.TUTOR,
    },
  });
  await db.sharedLink.create({
    data: { entityType: "unassigned_tutor", opsId: organizationId, sharedId: created.id },
  });
  return created.id;
}

async function ensurePod(
  db: Db,
  occurrence: { id: bigint; seriesId: bigint | null; title: string },
  subject: string,
  tutorId: string,
) {
  const linkKey =
    occurrence.seriesId !== null
      ? { entityType: "series_pod", opsId: occurrence.seriesId }
      : { entityType: "occurrence_pod", opsId: occurrence.id };
  const existing = await db.sharedLink.findUnique({
    where: { entityType_opsId: linkKey },
  });
  if (existing !== null) {
    return db.sharedPod.update({
      where: { id: existing.sharedId },
      data: { name: occurrence.title, subject, tutorId },
    });
  }
  const created = await db.sharedPod.create({
    data: { name: occurrence.title, subject, tutorId, status: "ACTIVE" },
  });
  await db.sharedLink.create({
    data: { ...linkKey, sharedId: created.id },
  });
  return created;
}

async function ensureMembership(db: Db, podId: string, studentId: string): Promise<void> {
  await db.sharedPodMembership.upsert({
    where: { podId_studentId: { podId, studentId } },
    create: { podId, studentId, status: "ACTIVE" },
    update: { status: "ACTIVE" },
  });
}

async function ensureSession(
  db: Db,
  occurrenceId: bigint,
  data: {
    podId: string;
    tutorId: string;
    title: string;
    subject: string;
    scheduledAt: Date;
    duration: number;
    status: SharedSessionStatus;
    zoomJoinUrl: string | null;
  },
) {
  const existing = await db.sharedLink.findUnique({
    where: { entityType_opsId: { entityType: "session", opsId: occurrenceId } },
  });
  if (existing !== null) {
    return db.sharedSession.update({ where: { id: existing.sharedId }, data });
  }
  const created = await db.sharedSession.create({ data });
  await db.sharedLink.create({
    data: { entityType: "session", opsId: occurrenceId, sharedId: created.id },
  });
  return created;
}

/** Create the unmarked row once. A later edit does not wipe a mark. */
async function ensureAttendance(
  db: Db,
  sessionId: string,
  studentId: string,
): Promise<AttendanceRow> {
  const existing = await db.sharedSessionAttendance.findUnique({
    where: { sessionId_studentId: { sessionId, studentId } },
  });
  if (existing !== null) return existing;
  return db.sharedSessionAttendance.create({
    data: { sessionId, studentId, status: SharedAttendanceStatus.UNMARKED },
  });
}
