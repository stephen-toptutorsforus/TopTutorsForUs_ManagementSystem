/**
 * Loading another system's records into this tenant.
 *
 * The property this suite exists for is the one the export itself cannot
 * support: **importing the same file twice must write nothing the second
 * time.** A Pearl export carries no identifier for a person, a session or a
 * series, and 1,198 of one real file's 2,229 session rows are indistinguishable
 * from another row by every column they have — so "is this already here" is
 * answered from `import_record`, and if that answer is ever wrong the second
 * run silently doubles somebody's history.
 *
 * The rest is the standing rules applied to a new writer: admin only, scoped to
 * one tenant, additive, and never able to say more in a report than counts and
 * reasons.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { Prisma, PrismaClient } from "@/generated/prisma/client";
import { Role, SessionStatus, UserStatus } from "@/generated/prisma/enums";
import { Forbidden, NotFound } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import { commitImport, previewImport } from "@/lib/services/import";

import {
  TEST_DATABASE_URL,
  makeOrganization,
  makeUser,
  reset,
  testClient,
} from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NEWLINE = "\n";
const CHICAGO = "America/Chicago";

/** Two people, one of whom teaches the other. */
const PEOPLE = [
  "Name,Email / Username,Roles,Status",
  "Marguerite Okonjo,marguerite@example.test,Instructor,Active",
  "Ada Fenwick,ada@example.test,Student,Invited",
].join("\n");

/** Two sessions an hour apart, so neither clashes with the other. */
const SESSIONS = [
  "Title,Instructor,Students,Location,Billable,Status,Attendance,Scheduled Start,Scheduled Duration",
  "Fractions,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 9:00:00 AM,1 hour",
  "Decimals,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Completed,Attended,09/10/2026 11:00:00 AM,30 minutes",
].join("\n");

/** Two rows that collide on every column a session has, bar nothing. */
const STACKED = [
  "Title,Instructor,Students,Location,Billable,Status,Attendance,Scheduled Start,Scheduled Duration",
  "Study hall,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/11/2026 9:00:00 AM,1 hour",
  "Study hall,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/11/2026 9:00:00 AM,1 hour",
].join("\n");

const SERIES = [
  "Title,Start Date,End Date,Instructor,Students,Weekdays,StartTime,Timezone,Duration,Total",
  "Weekly clinic,09/07/2026,12/07/2026,Marguerite Okonjo,Ada Fenwick,\"Monday, Wednesday\",4:00 PM,US/Central,1 hour,12",
].join("\n");

describeDb("importing another system's records", () => {
  let db: PrismaClient;
  // `settings` as well as the two the importer reads: the session writer asks
  // `booking.billable_enabled` before it believes the file's Billable column.
  let org: { id: bigint; timezone: string; settings: Prisma.JsonValue };
  let elsewhere: { id: bigint; timezone: string; settings: Prisma.JsonValue };
  let admin: { id: bigint };
  let regional: { id: bigint };
  let student: { id: bigint };

  const asAdmin = () => loadPrincipal(db, admin.id);

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: CHICAGO });
    elsewhere = await makeOrganization(db, { timezone: CHICAGO, name: "Harbour Point" });
    admin = await makeUser(db, org.id, { first: "Rowan", last: "Mercer", roles: [Role.ADMIN] });
    regional = await makeUser(db, org.id, {
      first: "Noor",
      last: "Haddad",
      roles: [Role.REGIONAL_ADMIN],
    });
    student = await makeUser(db, org.id, { first: "Teo", last: "Vasquez", roles: [Role.STUDENT] });
  });

  describe("who may run one", () => {
    it("refuses a student", async () => {
      const principal = await loadPrincipal(db, student.id);
      await expect(
        previewImport(db, org, principal, { people: PEOPLE }),
      ).rejects.toBeInstanceOf(Forbidden);
    });

    it("refuses a regional administrator", async () => {
      // The permission is granted by `ADMIN` holding every permission, and
      // every other role's grants are listed one by one — so this is the
      // assertion that "administrators only" was not quietly widened.
      const principal = await loadPrincipal(db, regional.id);
      await expect(
        previewImport(db, org, principal, { people: PEOPLE }),
      ).rejects.toBeInstanceOf(Forbidden);
    });
  });

  describe("a preview", () => {
    it("reports what it would do and writes none of it", async () => {
      const before = await db.user.count({ where: { organizationId: org.id } });
      const report = await previewImport(db, org, await asAdmin(), { people: PEOPLE });

      expect(report.committed).toBe(false);
      expect(report.files[0]!.counts).toMatchObject({ seen: 2, written: 2, alreadyHere: 0 });
      expect(await db.user.count({ where: { organizationId: org.id } })).toBe(before);
    });

    it("names the columns a file is missing rather than guessing", async () => {
      const report = await previewImport(db, org, await asAdmin(), {
        people: "Name,Roles\nAda Fenwick,Student",
      });
      expect(report.files[0]!.missing).toContain("Email / Username");
      expect(report.files[0]!.counts.written).toBe(0);
    });

    it("refuses an upload with no files at all", async () => {
      await expect(previewImport(db, org, await asAdmin(), {})).rejects.toThrow(
        /at least one file/,
      );
    });
  });

  describe("what the file says about money", () => {
    it("writes every session free, whatever the Billable column claims", async () => {
      // Both fixture rows say Yes. `booking.billable_enabled` ships off, so an
      // import must not be the one writer on the product that marks a thousand
      // sessions chargeable — and the column defaults to `true`, so this is a
      // value that has to be written rather than one that can be left out.
      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: SESSIONS,
        series: SERIES,
      });
      await commitImport(db, org, await asAdmin(), preview.batchRef);

      const sessions = await db.sessionOccurrence.findMany({
        where: { organizationId: org.id },
        select: { billable: true },
      });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((row) => row.billable === false)).toBe(true);

      // The series file has no Billable column at all, which is the quieter
      // half: a template left at the schema's default hands `true` to every
      // occurrence generated from it afterwards.
      const series = await db.sessionSeries.findMany({
        where: { organizationId: org.id },
        select: { billable: true },
      });
      expect(series.length).toBeGreaterThan(0);
      expect(series.every((row) => row.billable === false)).toBe(true);
    });

    it("believes the file once the tenant says it charges for something", async () => {
      org = await db.organization.update({
        where: { id: org.id },
        data: { settings: { booking: { billable_enabled: true } } },
      });
      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: SESSIONS,
      });
      await commitImport(db, org, await asAdmin(), preview.batchRef);

      const sessions = await db.sessionOccurrence.findMany({
        where: { organizationId: org.id },
        select: { billable: true },
      });
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.every((row) => row.billable === true)).toBe(true);
    });
  });

  describe("a commit", () => {
    it("writes the people, and leaves them unable to sign in", async () => {
      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      const report = await commitImport(db, org, await asAdmin(), preview.batchRef);

      expect(report.committed).toBe(true);
      expect(report.files[0]!.counts.written).toBe(2);

      const people = await db.user.findMany({
        where: { organizationId: org.id, email: { in: ["ada@example.test", "marguerite@example.test"] } },
      });
      expect(people).toHaveLength(2);
      // No password, whatever the file said about their account state.
      expect(people.every((person) => person.passwordHash === null)).toBe(true);
      const ada = people.find((person) => person.email === "ada@example.test")!;
      expect(ada.status).toBe(UserStatus.INVITED);
    });

    it("carries the exported account state across", async () => {
      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      await commitImport(db, org, await asAdmin(), preview.batchRef);
      const marguerite = await db.user.findFirstOrThrow({
        where: { organizationId: org.id, email: "marguerite@example.test" },
      });
      expect(marguerite.status).toBe(UserStatus.ACTIVE);
    });

    it("writes sessions with their students and attendance", async () => {
      const first = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: SESSIONS,
      });
      const report = await commitImport(db, org, await asAdmin(), first.batchRef);

      const sessions = report.files.find((file) => file.kind === "sessions")!;
      expect(sessions.counts.written).toBe(2);

      const written = await db.sessionOccurrence.findMany({
        where: { organizationId: org.id },
        orderBy: { scheduledStart: "asc" },
        include: { participants: true },
      });
      expect(written).toHaveLength(2);
      expect(written[0]!.status).toBe(SessionStatus.SCHEDULED);
      expect(written[1]!.status).toBe(SessionStatus.COMPLETED);
      expect(written[0]!.participants).toHaveLength(1);
      expect(written[1]!.participants[0]!.attendance).toBe("PRESENT");
    });

    it("clears the uploaded text once the rows are written", async () => {
      // A second copy of somebody's children in a staging column has nothing
      // left to justify it.
      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      await commitImport(db, org, await asAdmin(), preview.batchRef);
      const batch = await db.importBatch.findFirstOrThrow({ where: { ref: preview.batchRef } });
      expect(batch.sourcePeople).toBeNull();
      expect(batch.sourceSessions).toBeNull();
      expect(batch.sourceSeries).toBeNull();
      expect(batch.committedAt).not.toBeNull();
    });

    it("records an audit event carrying counts and nothing else", async () => {
      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      await commitImport(db, org, await asAdmin(), preview.batchRef);

      const event = await db.auditEvent.findFirstOrThrow({
        where: { organizationId: org.id, action: "import.committed" },
      });
      expect(event.entityType).toBe("import_batch");
      expect(JSON.stringify(event.changes)).toContain("people_written");
      // The rule the whole feature is written around.
      expect(JSON.stringify(event.changes)).not.toContain("Ada");
      expect(JSON.stringify(event.changes)).not.toContain("example.test");
    });

    it("refuses to run the same batch twice", async () => {
      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      await commitImport(db, org, await asAdmin(), preview.batchRef);
      await expect(
        commitImport(db, org, await asAdmin(), preview.batchRef),
      ).rejects.toThrow(/already been run/);
    });

    it("is 404, not 403, for a batch belonging to another tenant", async () => {
      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      await expect(
        commitImport(db, elsewhere, await asAdmin(), preview.batchRef),
      ).rejects.toBeInstanceOf(NotFound);
    });
  });

  describe("importing the same file twice", () => {
    it("writes nothing the second time", async () => {
      const files = { people: PEOPLE, sessions: SESSIONS, series: SERIES };

      const firstPreview = await previewImport(db, org, await asAdmin(), files);
      await commitImport(db, org, await asAdmin(), firstPreview.batchRef);

      const people = await db.user.count({ where: { organizationId: org.id } });
      const sessions = await db.sessionOccurrence.count({ where: { organizationId: org.id } });
      const series = await db.sessionSeries.count({ where: { organizationId: org.id } });

      const second = await previewImport(db, org, await asAdmin(), files);
      // Said out loud before anything is written, because somebody uploading
      // the same file twice usually did not mean to.
      expect(second.seenBefore).toBe(true);
      for (const file of second.files) expect(file.counts.written).toBe(0);

      const report = await commitImport(db, org, await asAdmin(), second.batchRef);
      for (const file of report.files) {
        expect(file.counts.written, file.kind).toBe(0);
        expect(file.counts.alreadyHere, file.kind).toBeGreaterThan(0);
      }

      expect(await db.user.count({ where: { organizationId: org.id } })).toBe(people);
      expect(await db.sessionOccurrence.count({ where: { organizationId: org.id } })).toBe(sessions);
      expect(await db.sessionSeries.count({ where: { organizationId: org.id } })).toBe(series);
    });

    it("keeps two indistinguishable rows apart, and matches both on a re-run", async () => {
      // Nothing in these two rows differs, so only their position in the file
      // separates them — which is the whole reason a key carries an ordinal.
      const files = { people: PEOPLE, sessions: STACKED };
      const first = await previewImport(db, org, await asAdmin(), files);
      const firstReport = await commitImport(db, org, await asAdmin(), first.batchRef);

      const sessions = firstReport.files.find((file) => file.kind === "sessions")!;
      // One lands; the second is refused by the instructor exclusion constraint,
      // which is a guarantee and applies to an import exactly as to a booking.
      expect(sessions.counts.written).toBe(1);
      expect(sessions.reasons[0]!.code).toBe("instructor_busy");

      const second = await previewImport(db, org, await asAdmin(), files);
      const secondReport = await commitImport(db, org, await asAdmin(), second.batchRef);
      const again = secondReport.files.find((file) => file.kind === "sessions")!;
      expect(again.counts.written).toBe(0);
      expect(again.counts.alreadyHere).toBe(1);
      expect(await db.sessionOccurrence.count({ where: { organizationId: org.id } })).toBe(1);
    });

    it("leaves somebody this product already created alone", async () => {
      // Matched by address against the tenant, not only against earlier
      // imports — otherwise an import duplicates the people already here.
      await db.user.create({
        data: {
          ref: "usr_alreadyhere",
          organizationId: org.id,
          email: "ada@example.test",
          firstName: "Ada",
          lastName: "Fenwick",
          status: UserStatus.ACTIVE,
        },
      });
      const before = await db.user.count({ where: { organizationId: org.id } });

      const preview = await previewImport(db, org, await asAdmin(), { people: PEOPLE });
      const report = await commitImport(db, org, await asAdmin(), preview.batchRef);

      expect(report.files[0]!.counts.alreadyHere).toBe(1);
      expect(report.files[0]!.counts.written).toBe(1);
      expect(await db.user.count({ where: { organizationId: org.id } })).toBe(before + 1);
    });
  });

  describe("a preview and a commit agree", () => {
    it("counts a clash between two rows the same import creates", async () => {
      // The case that makes this hard, and the one the browser found. During a
      // preview nobody has been written, so a session naming its instructor
      // cannot look them up — and a preview that resolves them to nobody skips
      // the clash check and promises rows the commit then refuses.
      const clashing = [
        "Title,Instructor,Students,Location,Billable,Status,Attendance,Scheduled Start,Scheduled Duration",
        "One,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 9:00:00 AM,1 hour",
        "Two,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 9:30:00 AM,1 hour",
      ].join(NEWLINE);

      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: clashing,
      });
      const forecast = preview.files.find((file) => file.kind === "sessions")!;
      expect(forecast.counts.written).toBe(1);
      expect(forecast.counts.refused).toBe(1);

      const report = await commitImport(db, org, await asAdmin(), preview.batchRef);
      const actual = report.files.find((file) => file.kind === "sessions")!;

      // Stated as an equality rather than as two numbers that happen to match:
      // this is the property the whole two-step shape rests on.
      expect(actual.counts).toEqual(forecast.counts);
      expect(actual.reasons).toEqual(forecast.reasons);
    });
  });

  describe("what it refuses", () => {
    it("counts a clash by reason and goes on with the rest", async () => {
      const clashing = [
        "Title,Instructor,Students,Location,Billable,Status,Attendance,Scheduled Start,Scheduled Duration",
        "One,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 9:00:00 AM,1 hour",
        "Two,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 9:30:00 AM,1 hour",
        "Three,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 2:00:00 PM,1 hour",
      ].join("\n");

      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: clashing,
      });
      const report = await commitImport(db, org, await asAdmin(), preview.batchRef);
      const sessions = report.files.find((file) => file.kind === "sessions")!;

      expect(sessions.counts.written).toBe(2);
      expect(sessions.counts.refused).toBe(1);
      expect(sessions.reasons).toEqual([
        { code: "instructor_busy", message: "the instructor is already teaching then", count: 1 },
      ]);
    });

    it("says why a row could not be read, without quoting it", async () => {
      const bad = [
        "Title,Instructor,Students,Location,Billable,Status,Attendance,Scheduled Start,Scheduled Duration",
        "Bad date,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,not a date,1 hour",
        "Bad length,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Scheduled,Incomplete,09/10/2026 9:00:00 AM,a while",
        "Bad status,Marguerite Okonjo,Ada Fenwick,Room 2B,Yes,Teleported,Incomplete,09/10/2026 1:00:00 PM,1 hour",
      ].join("\n");

      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: bad,
      });
      const codes = preview.files
        .find((file) => file.kind === "sessions")!
        .reasons.map((reason) => reason.code)
        .sort();
      expect(codes).toEqual(["unknown_status", "unreadable_duration", "unreadable_start"]);
      expect(JSON.stringify(preview)).not.toContain("Marguerite");
    });
  });

  describe("series", () => {
    it("writes the recurrence rule the file describes", async () => {
      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        series: SERIES,
      });
      await commitImport(db, org, await asAdmin(), preview.batchRef);

      const series = await db.sessionSeries.findFirstOrThrow({
        where: { organizationId: org.id },
      });
      expect(series.title).toBe("Weekly clinic");
      expect(series.weekdays).toEqual(["mon", "wed"]);
      expect(series.defaultDurationMinutes).toBe(60);
      expect(series.defaultInstructorId).not.toBeNull();
      // Nothing is attached: the session export carries no reference to the
      // series that produced a row, and guessing would be guessing on somebody
      // else's records.
      expect(await db.sessionOccurrence.count({ where: { seriesId: series.id } })).toBe(0);
    });
  });

  describe("tenant isolation", () => {
    it("writes into the tenant it was given and no other", async () => {
      const preview = await previewImport(db, org, await asAdmin(), {
        people: PEOPLE,
        sessions: SESSIONS,
      });
      await commitImport(db, org, await asAdmin(), preview.batchRef);

      expect(await db.user.count({ where: { organizationId: elsewhere.id } })).toBe(0);
      expect(await db.sessionOccurrence.count({ where: { organizationId: elsewhere.id } })).toBe(0);
      expect(await db.importRecord.count({ where: { organizationId: elsewhere.id } })).toBe(0);
    });
  });
});
