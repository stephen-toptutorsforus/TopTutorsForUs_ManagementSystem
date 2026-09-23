/**
 * The session copy written into the school database.
 *
 * Runs inside a transaction that is always rolled back, so the local school
 * database is left as it was.
 */

import { afterAll, describe, expect, it } from "vitest";

import { config } from "dotenv";
import { Pool } from "pg";

import { applySessionPayload, type SessionPayload } from "@/lib/services/schoolSync";
import { SCHOOL_DATABASE, databaseName } from "@/lib/services/localDatabases";

config({ path: ".env", quiet: true });

const schoolUrl = process.env.SCHOOL_DATABASE_URL ?? "";
const describeSchool = databaseName(schoolUrl) === SCHOOL_DATABASE ? describe : describe.skip;

describeSchool("session delivery into the school database", () => {
  const pool = new Pool({ connectionString: schoolUrl });

  afterAll(async () => {
    await pool.end();
  });

  it("writes the join link, leaves the host url empty, and does not change attendance", async () => {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const tutor = await client.query<{ id: string }>(
        `SELECT id FROM "User" WHERE email = 'north.tutor@toptutorsforus.test'`,
      );
      const student = await client.query<{ id: string }>(
        `SELECT id FROM "User" WHERE email = 'north.ada@toptutorsforus.test'`,
      );
      const school = await client.query<{ id: string }>(
        `SELECT id FROM "School" WHERE slug = 'north-high'`,
      );
      const tutorId = tutor.rows[0]?.id;
      const studentId = student.rows[0]?.id;
      const schoolId = school.rows[0]?.id;
      expect(tutorId).toBeTruthy();
      expect(studentId).toBeTruthy();
      expect(schoolId).toBeTruthy();

      const before = await client.query<{ passwordHash: string }>(
        `SELECT "passwordHash" FROM "User" WHERE id = $1`,
        [tutorId],
      );
      const payload = sample(schoolId!, tutorId!, studentId!);
      await applySessionPayload(client, payload);

      const session = await client.query<{
        zoomJoinUrl: string | null;
        zoomStartUrl: string | null;
        title: string;
      }>(`SELECT "zoomJoinUrl", "zoomStartUrl", title FROM "Session" WHERE id = $1`, [
        payload.session.id,
      ]);
      expect(session.rows[0]?.title).toBe("Algebra practice");
      expect(session.rows[0]?.zoomJoinUrl).toBe("https://meet.example.test/room/north");
      expect(session.rows[0]?.zoomStartUrl).toBeNull();

      const after = await client.query<{ passwordHash: string }>(
        `SELECT "passwordHash" FROM "User" WHERE id = $1`,
        [tutorId],
      );
      expect(after.rows[0]?.passwordHash).toBe(before.rows[0]?.passwordHash);

      await client.query(
        `UPDATE "SessionAttendance" SET status = 'PRESENT' WHERE "sessionId" = $1 AND "studentId" = $2`,
        [payload.session.id, studentId],
      );
      await applySessionPayload(client, {
        ...payload,
        session: { ...payload.session, title: "Moved practice" },
        attendance: payload.attendance.map((row) => ({ ...row, status: "UNMARKED" })),
      });
      const attendance = await client.query<{ status: string }>(
        `SELECT status::text AS status FROM "SessionAttendance" WHERE "sessionId" = $1`,
        [payload.session.id],
      );
      expect(attendance.rows[0]?.status).toBe("PRESENT");
      const renamed = await client.query<{ title: string }>(
        `SELECT title FROM "Session" WHERE id = $1`,
        [payload.session.id],
      );
      expect(renamed.rows[0]?.title).toBe("Moved practice");
    } finally {
      await client.query("ROLLBACK");
      client.release();
    }
  });
});

function sample(schoolId: string, tutorId: string, studentId: string): SessionPayload {
  return {
    school: { id: schoolId, name: "North High", slug: "north-high", timezone: "America/Chicago" },
    users: [
      { id: tutorId, email: "north.tutor@toptutorsforus.test", name: "Nico Tutor", role: "TUTOR", schoolId },
      { id: studentId, email: "north.ada@toptutorsforus.test", name: "Ada North", role: "STUDENT", schoolId },
    ],
    pod: { id: "pod-sync-test", name: "Algebra practice", subject: "General", tutorId, status: "ACTIVE" },
    memberships: [{ id: "mem-sync-test", podId: "pod-sync-test", studentId, status: "ACTIVE" }],
    session: {
      id: "ses-sync-test",
      podId: "pod-sync-test",
      tutorId,
      title: "Algebra practice",
      subject: "General",
      scheduledAt: "2026-04-06T20:00:00.000Z",
      duration: 60,
      status: "SCHEDULED",
      zoomJoinUrl: "https://meet.example.test/room/north",
    },
    attendance: [
      {
        id: "att-sync-test",
        sessionId: "ses-sync-test",
        studentId,
        status: "UNMARKED",
        joinedAt: null,
        leftAt: null,
      },
    ],
  };
}
