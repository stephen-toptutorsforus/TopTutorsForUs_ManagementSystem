/**
 * Copy undelivered session changes into the main app's database, then bring
 * attendance marks back.
 *
 * The caller has already checked both database names. This writes the session
 * columns the school app shows. It does not write a password hash or a host
 * start URL, and it does not change an attendance row that is already there.
 */

import { Pool, type PoolClient } from "pg";

import type { PrismaClient } from "@/generated/prisma/client";
import { applyInboundAttendance } from "@/lib/services/sharedSession";

const SESSION_KIND = "session.upsert";

export interface SessionPayload {
  school: { id: string; name: string; slug: string; timezone: string } | null;
  users: { id: string; email: string; name: string; role: string; schoolId: string | null }[];
  pod: { id: string; name: string; subject: string; tutorId: string; status: string };
  memberships: { id: string; podId: string; studentId: string; status: string }[];
  session: {
    id: string;
    podId: string;
    tutorId: string;
    title: string;
    subject: string;
    scheduledAt: string;
    duration: number;
    status: string;
    zoomJoinUrl: string | null;
  };
  attendance: {
    id: string;
    sessionId: string;
    studentId: string;
    status: string;
    joinedAt: string | null;
    leftAt: string | null;
  }[];
}

export class MissingLinkedPerson extends Error {
  constructor(userId: string) {
    super(`the main database has no person ${userId}; run npm run db:link-schools first`);
    this.name = "MissingLinkedPerson";
  }
}

/** Write one session payload. Existing attendance is left as it is. */
export async function applySessionPayload(
  client: PoolClient,
  payload: SessionPayload,
): Promise<void> {
  if (payload.school) {
    await client.query(
      `INSERT INTO "School" (id, name, slug, timezone, "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE
         SET name = EXCLUDED.name, slug = EXCLUDED.slug, timezone = EXCLUDED.timezone, "updatedAt" = NOW()`,
      [payload.school.id, payload.school.name, payload.school.slug, payload.school.timezone],
    );
  }

  for (const user of payload.users) {
    const found = await client.query<{ id: string }>(`SELECT id FROM "User" WHERE id = $1`, [
      user.id,
    ]);
    if (found.rowCount === 0) throw new MissingLinkedPerson(user.id);
    await client.query(
      `UPDATE "User"
         SET name = $2,
             role = $3::"Role",
             "schoolId" = COALESCE($4, "schoolId"),
             "updatedAt" = NOW()
       WHERE id = $1`,
      [user.id, user.name, user.role, user.schoolId],
    );
  }

  await client.query(
    `INSERT INTO "Pod" (id, name, subject, "tutorId", status, "createdAt")
     VALUES ($1, $2, $3, $4, $5, NOW())
     ON CONFLICT (id) DO UPDATE
       SET name = EXCLUDED.name, subject = EXCLUDED.subject, "tutorId" = EXCLUDED."tutorId", status = EXCLUDED.status`,
    [payload.pod.id, payload.pod.name, payload.pod.subject, payload.pod.tutorId, payload.pod.status],
  );

  for (const membership of payload.memberships) {
    await client.query(
      `INSERT INTO "PodMembership" (id, "podId", "studentId", "joinedAt", status)
       VALUES ($1, $2, $3, NOW(), $4)
       ON CONFLICT ("podId", "studentId") DO UPDATE SET status = EXCLUDED.status`,
      [membership.id, membership.podId, membership.studentId, membership.status],
    );
  }

  const sessionNumber = await client.query<{ next: number }>(
    `SELECT COALESCE(MAX("sessionNumber"), 0) + 1 AS next FROM "Session" WHERE "podId" = $1`,
    [payload.session.podId],
  );
  await client.query(
    `INSERT INTO "Session"
       (id, "podId", "tutorId", title, subject, "scheduledAt", duration, "sessionNumber",
        "zoomJoinUrl", status, "manualMeeting", "createdAt")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::"SessionStatus", true, NOW())
     ON CONFLICT (id) DO UPDATE SET
       "podId" = EXCLUDED."podId",
       "tutorId" = EXCLUDED."tutorId",
       title = EXCLUDED.title,
       subject = EXCLUDED.subject,
       "scheduledAt" = EXCLUDED."scheduledAt",
       duration = EXCLUDED.duration,
       "zoomJoinUrl" = EXCLUDED."zoomJoinUrl",
       status = EXCLUDED.status`,
    [
      payload.session.id,
      payload.session.podId,
      payload.session.tutorId,
      payload.session.title,
      payload.session.subject,
      new Date(payload.session.scheduledAt),
      payload.session.duration,
      sessionNumber.rows[0]?.next ?? 1,
      payload.session.zoomJoinUrl,
      payload.session.status,
    ],
  );

  for (const row of payload.attendance) {
    await client.query(
      `INSERT INTO "SessionAttendance" (id, "sessionId", "studentId", status, "joinedAt", "leftAt")
       VALUES ($1, $2, $3, $4::"AttendanceStatus", $5, $6)
       ON CONFLICT ("sessionId", "studentId") DO NOTHING`,
      [
        row.id,
        row.sessionId,
        row.studentId,
        row.status,
        row.joinedAt ? new Date(row.joinedAt) : null,
        row.leftAt ? new Date(row.leftAt) : null,
      ],
    );
  }
}

interface AttendanceOutboundRow {
  id: string;
  sourceId: string;
  sessionId: string;
  studentId: string;
  status: "UNMARKED" | "PRESENT" | "LATE" | "ABSENT";
  joinedAt: Date | null;
  leftAt: Date | null;
}

/** Deliver waiting session rows, then apply attendance marks that came back. */
export async function syncLocal(
  ops: PrismaClient,
  school: Pool,
): Promise<{ delivered: number; attendance: number }> {
  const waiting = await ops.outboundChange.findMany({
    where: { kind: SESSION_KIND, deliveredAt: null },
    orderBy: { id: "asc" },
  });

  let delivered = 0;
  for (const change of waiting) {
    const client = await school.connect();
    try {
      await client.query("BEGIN");
      await applySessionPayload(client, change.payload as unknown as SessionPayload);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    await ops.outboundChange.update({
      where: { id: change.id },
      data: { deliveredAt: new Date() },
    });
    delivered += 1;
  }

  const inbound = await school.query<AttendanceOutboundRow>(
    `SELECT id, "sourceId", "sessionId", "studentId", status::text AS status, "joinedAt", "leftAt"
     FROM "AttendanceOutbound"
     WHERE "appliedAt" IS NULL
     ORDER BY "createdAt" ASC`,
  );

  let attendance = 0;
  for (const row of inbound.rows) {
    await applyInboundAttendance(ops, {
      sourceId: row.sourceId,
      sessionId: row.sessionId,
      studentId: row.studentId,
      status: row.status,
      joinedAt: row.joinedAt,
      leftAt: row.leftAt,
    });
    await school.query(`UPDATE "AttendanceOutbound" SET "appliedAt" = NOW() WHERE id = $1`, [
      row.id,
    ]);
    attendance += 1;
  }

  return { delivered, attendance };
}
