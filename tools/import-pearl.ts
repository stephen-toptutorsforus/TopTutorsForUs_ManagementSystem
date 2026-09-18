/**
 * Load a Pearl CSV export into this schema.
 *
 *   npx tsx tools/import-pearl.ts <directory> [--tenant "Name"]
 *
 * The directory holds `people.csv`, `sessions.csv` and `series.csv` as the
 * reference service exports them. Nothing about a tenant is written here: the
 * files are the input, and the database is whatever `DATABASE_URL` names — so
 * point it at a scratch database, never at `tutorops_ops_dev`, which belongs to
 * the fixtures.
 *
 * **It prints no name, no address and no meeting link.** Counts, reasons and
 * shapes only. A real export is somebody's students, their contact details and
 * their classroom links, and the standing rule is that none of that reaches a
 * log, a screenshot or an error message. Every refusal below is reported as a
 * *tally by reason*, which is what makes the report worth reading anyway: one
 * rejected row is an anecdote, nine hundred is a finding.
 *
 * **Rows are written directly rather than through `plan()`/`createFromPlan()`.**
 * The fixture scripts deliberately go the long way round so that every row is
 * one the product could have produced; an import is the opposite errand. This
 * data was produced somewhere else, years of it is in the past, and putting it
 * through booking would reject most of it for lead time, declared availability
 * and eligibility — none of which is a statement about the data's fidelity.
 * A migration writes rows.
 *
 * What it cannot write is anything the *database* refuses, and that is
 * deliberate: the GiST exclusion constraints are guarantees rather than service
 * checks, so they apply to an import exactly as they apply to a booking. What
 * they reject is the most interesting output this tool produces.
 */

import fs from "node:fs";
import path from "node:path";

import { config } from "dotenv";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  AttendanceStatus,
  DeliveryType,
  ParticipantRole,
  Role,
  SessionStatus,
  UserStatus,
} from "@/generated/prisma/enums";
import { clientFor } from "@/lib/db";
import { resolveCivil } from "@/lib/time";

config();

/** Pearl exports `US/Central`; the rest of this codebase speaks IANA proper. */
const ZONE = "America/Chicago";

// --- reading ----------------------------------------------------------------

/** Quoted fields, doubled quotes, and commas inside them — all three occur. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((r) => r.some((v) => v !== ""));
}

type Row = Record<string, string>;

function read(dir: string, file: string): Row[] {
  const rows = parseCsv(fs.readFileSync(path.join(dir, file), "utf8"));
  const head = rows[0]!;
  return rows
    .slice(1)
    .map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ""])) as Row);
}

// --- mapping ----------------------------------------------------------------

const ROLES: Record<string, Role> = {
  Admin: Role.ADMIN,
  Instructor: Role.INSTRUCTOR,
  Student: Role.STUDENT,
  Parent: Role.PARENT,
};

const ACCOUNT: Record<string, UserStatus> = {
  Active: UserStatus.ACTIVE,
  Invited: UserStatus.INVITED,
  "Invite Bounced": UserStatus.BOUNCED,
  "Pending Invite": UserStatus.PENDING_INVITE,
};

/**
 * `Lobby` and `Lesson` are the live-classroom states, which this schema spells
 * as one: `IN_PROGRESS`. Nothing here sets it yet — the Phase 4 classroom will —
 * so an import is the only writer of it, which is worth knowing when four
 * sessions turn up in a state the product cannot currently produce.
 */
const STATUS: Record<string, SessionStatus> = {
  Scheduled: SessionStatus.SCHEDULED,
  Rescheduled: SessionStatus.RESCHEDULED,
  Completed: SessionStatus.COMPLETED,
  Cancelled: SessionStatus.CANCELLED,
  Missed: SessionStatus.MISSED,
  Lobby: SessionStatus.IN_PROGRESS,
  Lesson: SessionStatus.IN_PROGRESS,
};

/**
 * Pearl records attendance once for the session; this schema records it per
 * participant, which is strictly more information and cannot be recovered from
 * less. So a rollup is spread across everybody on the session, and the two that
 * genuinely differ are kept apart: a session the *instructor* missed leaves its
 * students excused rather than absent, because an authorised absence is not a
 * mark against them and `attendanceRate` counts it that way.
 *
 * "Incomplete" is not a mark at all. Every Pearl row carrying it is a scheduled
 * session whose time has passed, which is this codebase's derived `Incomplete`
 * state rather than anything stored — so it maps to `UNMARKED`, and the
 * calendar works the state out again for itself.
 */
const ATTENDANCE: Record<string, AttendanceStatus> = {
  "": AttendanceStatus.UNMARKED,
  Incomplete: AttendanceStatus.UNMARKED,
  Attended: AttendanceStatus.PRESENT,
  "Partially Attended": AttendanceStatus.LATE,
  Missed: AttendanceStatus.ABSENT,
  "Missed By Students": AttendanceStatus.ABSENT,
  "Missed By Instructor": AttendanceStatus.EXCUSED,
};

/** Pearl's own classroom, by the name it exports. */
const PEARL_CLASSROOM = "Pearl Advanced Class";

function deliveryOf(location: string): DeliveryType {
  if (location.startsWith("http")) return DeliveryType.EXTERNAL_LINK;
  if (location === PEARL_CLASSROOM) return DeliveryType.ADVANCED_CLASSROOM;
  return DeliveryType.IN_PERSON;
}

/** `1 hour 30 minutes`, `54 minutes`, `3 hours` — and `0:32` in the series file. */
function minutesOf(text: string): number {
  const clock = /^(\d+):(\d\d)$/.exec(text);
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = /(\d+)\s+hours?/.exec(text);
  const mins = /(\d+)\s+minutes?/.exec(text);
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

/** `09/10/2026 9:00:00 PM` in the tenant's zone, to an instant. */
function startOf(text: string): Date | null {
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d+):(\d\d):\d\d (AM|PM)$/.exec(text);
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === "PM") hour += 12;
  const civil = `${m[3]}-${m[1]}-${m[2]}`;
  const clock = `${String(hour).padStart(2, "0")}:${m[5]}`;
  return resolveCivil(civil as never, clock, ZONE).instant;
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newRef(prefix: string): string {
  let body = "";
  for (let i = 0; i < 10; i += 1) {
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${body}`;
}

/**
 * Split a display name into two fields.
 *
 * Everything before the last word is the given name, which is wrong for some of
 * these and right for most, and there is no more information in the export to
 * do better with. Suffixes are kept on the surname rather than becoming one.
 */
const SUFFIX = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);
function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ["Unknown", "Unknown"];
  if (parts.length === 1) return [parts[0]!, ""];
  let cut = parts.length - 1;
  if (SUFFIX.has(parts[cut]!.toLowerCase()) && cut > 1) cut -= 1;
  return [parts.slice(0, cut).join(" "), parts.slice(cut).join(" ")];
}

// --- the tally --------------------------------------------------------------

class Reasons {
  private readonly counts = new Map<string, number>();
  add(reason: string): void {
    this.counts.set(reason, (this.counts.get(reason) ?? 0) + 1);
  }
  get total(): number {
    return [...this.counts.values()].reduce((a, b) => a + b, 0);
  }
  report(label: string): void {
    if (this.counts.size === 0) return;
    console.log(`\n${label}: ${this.total}`);
    for (const [reason, n] of [...this.counts.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${String(n).padStart(5)}  ${reason}`);
    }
  }
}

/**
 * What a database refusal was about, without quoting the row it was about.
 *
 * The message carries a table name and a constraint name and nothing else; the
 * detail Postgres appends to an exclusion violation contains the conflicting
 * values, which here would be somebody's session.
 */
function why(error: unknown): string {
  const err = error as {
    code?: string;
    meta?: { driverAdapterError?: { cause?: { code?: string; originalMessage?: string } } };
  };

  // Prisma wraps a Postgres exclusion violation as P2039 and keeps the real
  // SQLSTATE underneath. Deliberately reading `originalMessage`, which names the
  // constraint, and never `detail`, which spells out the conflicting row.
  const cause = err.meta?.driverAdapterError?.cause;
  const named = cause?.originalMessage ?? "";
  if (cause?.code === "23P01" || named.includes("exclusion constraint")) {
    if (named.includes("ex_session_instructor_overlap")) {
      return "instructor is already teaching then — ex_session_instructor_overlap";
    }
    if (named.includes("ex_session_location_overlap")) {
      return "room is already in use then — ex_session_location_overlap";
    }
    return "an exclusion constraint refused it";
  }
  if (err.code === "P2002") return "duplicate of a row already written";
  if (err.code === "P2003") return "refers to something that was not imported";
  if (cause?.code) return `refused by Postgres ${cause.code}`;
  return `refused: ${String(err.code ?? "unclassified")}`;
}

// --- the import -------------------------------------------------------------

async function main(): Promise<void> {
  const dir = process.argv[2];
  if (!dir) throw new Error("usage: tsx tools/import-pearl.ts <directory> [--tenant Name]");
  const tenantFlag = process.argv.indexOf("--tenant");
  const tenantName = tenantFlag > 0 ? (process.argv[tenantFlag + 1] ?? "Imported") : "Imported";

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (/tutorops_ops_(dev|test)\b/.test(url)) {
    throw new Error(
      "refusing to import over the fixture databases — point DATABASE_URL at a scratch database",
    );
  }
  const db: PrismaClient = clientFor(url);

  try {
    const org = await db.organization.create({
      data: {
        ref: newRef("org"),
        name: tenantName,
        slug: newRef("slug"),
        country: "US",
        timezone: ZONE,
        currency: "USD",
        features: {},
        settings: {},
      },
    });
    console.log(`tenant created, zone ${ZONE}`);

    // ------------------------------------------------------------ people ---
    const people = read(dir, "people.csv");
    const byName = new Map<string, bigint>();
    const peopleSkipped = new Reasons();
    let written = 0;

    for (const person of people) {
      const roles = person.Roles!.split(",")
        .map((r) => ROLES[r.trim()])
        .filter((r): r is Role => r !== undefined);
      if (roles.length === 0) {
        peopleSkipped.add("no role this schema recognises");
        continue;
      }
      const handle = person["Email / Username"]!.trim();
      const [firstName, lastName] = splitName(person.Name!);
      try {
        const user = await db.user.create({
          data: {
            ref: newRef("usr"),
            organizationId: org.id,
            // A bare username is not an email, and the partial unique index is
            // over the rows that have one — so it is left null rather than
            // written as something that would fail a format check later.
            email: handle.includes("@") ? handle.toLowerCase() : null,
            firstName,
            lastName,
            status: ACCOUNT[person.Status!.trim()] ?? UserStatus.INVITED,
            timezone: ZONE,
            roles: { create: roles.map((role) => ({ organizationId: org.id, role })) },
          },
        });
        written += 1;
        // Sessions refer to people by display name and nothing else, so that is
        // the key an import has to join on. Where two people share one, the
        // first wins and the collision is counted rather than guessed at.
        if (!byName.has(person.Name!)) byName.set(person.Name!, user.id);
        else peopleSkipped.add("shares a display name with somebody already imported");
      } catch (error) {
        peopleSkipped.add(why(error));
      }
    }
    console.log(`people written: ${written} of ${people.length}`);
    peopleSkipped.report("people not written, or ambiguous");

    // ---------------------------------------------------- relationships ---
    let guardianLinks = 0;
    let instructorLinks = 0;
    const linkSkipped = new Reasons();
    for (const person of people) {
      const selfId = byName.get(person.Name!);
      if (selfId === undefined) continue;
      // `"Instructor:A,Parent:B,Student:C"` — and a name containing a comma
      // splits wrongly, which is why an unrecognised prefix is counted rather
      // than assumed.
      for (const raw of person.Relationships!.split(",")) {
        const [kind, ...rest] = raw.replace(/"/g, "").split(":");
        const other = rest.join(":").trim();
        if (!kind || !other) continue;
        const otherId = byName.get(other);
        if (otherId === undefined) {
          linkSkipped.add(`names somebody not in the export (${kind.trim()})`);
          continue;
        }
        try {
          if (kind.trim() === "Instructor") {
            await db.instructorStudent.create({
              data: { organizationId: org.id, instructorId: otherId, studentId: selfId },
            });
            instructorLinks += 1;
          } else if (kind.trim() === "Parent") {
            await db.guardianStudent.create({
              data: { organizationId: org.id, guardianId: otherId, studentId: selfId },
            });
            guardianLinks += 1;
          }
        } catch {
          linkSkipped.add("already linked, or links a person to themselves");
        }
      }
    }
    console.log(`\ninstructor assignments: ${instructorLinks}`);
    console.log(`guardian links: ${guardianLinks}`);
    linkSkipped.report("relationships not written");

    // ---------------------------------------------------------- sessions ---
    const sessions = read(dir, "sessions.csv");
    const sessionSkipped = new Reasons();
    let sessionsWritten = 0;
    let participantsWritten = 0;
    let orphanStudents = 0;

    for (const row of sessions) {
      const start = startOf(row["Scheduled Start"]!);
      if (start === null) {
        sessionSkipped.add("start time could not be read");
        continue;
      }
      const minutes = minutesOf(row["Scheduled Duration"]!);
      if (minutes <= 0) {
        sessionSkipped.add("duration could not be read");
        continue;
      }
      const status = STATUS[row.Status!.trim()];
      if (status === undefined) {
        sessionSkipped.add(`status has no equivalent here (${row.Status})`);
        continue;
      }
      const instructorId = byName.get(row.Instructor!.trim()) ?? null;
      const location = row.Location!.trim();
      const delivery = deliveryOf(location);

      try {
        const occurrence = await db.sessionOccurrence.create({
          data: {
            ref: newRef("ses"),
            organizationId: org.id,
            title: row.Title!.trim() || "Session",
            deliveryType: delivery,
            meetingUrl: delivery === DeliveryType.EXTERNAL_LINK ? location : null,
            // Free text, never a managed room: nothing in the export identifies
            // a room this tenant owns, so `locationId` stays null and the room
            // exclusion constraint never engages.
            locationDetail: delivery === DeliveryType.IN_PERSON ? location : null,
            scheduledStart: start,
            scheduledEnd: new Date(start.getTime() + minutes * 60_000),
            timezone: ZONE,
            status,
            instructorId,
            billable: row.Billable!.trim() === "Yes",
          },
        });
        sessionsWritten += 1;

        const mark = ATTENDANCE[row.Attendance!.trim()] ?? AttendanceStatus.UNMARKED;
        for (const name of row.Students!.split(",").map((s) => s.trim()).filter(Boolean)) {
          const studentId = byName.get(name);
          if (studentId === undefined) {
            orphanStudents += 1;
            continue;
          }
          try {
            await db.sessionParticipant.create({
              data: {
                organizationId: org.id,
                sessionId: occurrence.id,
                userId: studentId,
                role: ParticipantRole.STUDENT,
                attendance: mark,
              },
            });
            participantsWritten += 1;
          } catch {
            orphanStudents += 1;
          }
        }
      } catch (error) {
        sessionSkipped.add(why(error));
      }
    }

    console.log(`\nsessions written: ${sessionsWritten} of ${sessions.length}`);
    console.log(`participants written: ${participantsWritten}`);
    console.log(`student names on a session that matched nobody: ${orphanStudents}`);
    sessionSkipped.report("sessions the schema would not take");

    const counts = await db.sessionOccurrence.groupBy({
      by: ["status"],
      where: { organizationId: org.id },
      _count: { _all: true },
    });
    console.log("\nwhat landed, by status");
    for (const c of counts.sort((a, b) => b._count._all - a._count._all)) {
      console.log(`  ${String(c._count._all).padStart(5)}  ${c.status}`);
    }
    console.log(`\ntenant ref for the app: ${org.ref}`);
  } finally {
    await db.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(String((error as { message?: string })?.message ?? error));
  process.exitCode = 1;
});
