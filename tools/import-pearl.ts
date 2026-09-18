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
  UserStatus,
} from "@/generated/prisma/enums";
import { type CsvRow, parseTable } from "@/lib/csv";
import { clientFor } from "@/lib/db";
import {
  ACCOUNT,
  ATTENDANCE,
  STATUS,
  deliveryOf,
  emailOf,
  minutesOf,
  namesOf,
  rolesOf,
  splitName,
  startOf,
} from "@/lib/services/import/pearl";
import { REFUSALS, Tally, refusalFor } from "@/lib/services/import/refusals";

config();

/** Pearl exports `US/Central`; the rest of this codebase speaks IANA proper. */
const ZONE = "America/Chicago";

// --- reading ----------------------------------------------------------------

type Row = CsvRow;

/**
 * One file from disk.
 *
 * The parsing, the mappings and the refusal classifier all live in `src/lib`
 * now, shared with the import screen: the two must agree about what "Missed By
 * Instructor" means, and two tables that start identical do not stay that way.
 * What is left here is the half that is genuinely a command line — a directory,
 * a connection string, and somewhere to print to.
 */
function read(dir: string, file: string): Row[] {
  const table = parseTable(fs.readFileSync(path.join(dir, file), "utf8"));
  if (table.ragged.length > 0) {
    console.log(`${file}: ${table.ragged.length} rows had the wrong number of cells, skipped`);
  }
  return [...table.rows];
}

const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
function newRef(prefix: string): string {
  let body = "";
  for (let i = 0; i < 10; i += 1) {
    body += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  }
  return `${prefix}_${body}`;
}

// --- the tally --------------------------------------------------------------

/** `Tally` counts by reason code; this prints one. */
function report(tally: Tally, label: string): void {
  if (tally.total === 0) return;
  console.log(`
${label}: ${tally.total}`);
  for (const { message, count } of tally.entries()) {
    console.log(`  ${String(count).padStart(5)}  ${message}`);
  }
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
    const peopleSkipped = new Tally();
    let written = 0;

    for (const person of people) {
      const roles = rolesOf(person.Roles!);
      if (roles.length === 0) {
        peopleSkipped.add(REFUSALS.NO_ROLE);
        continue;
      }
      const [firstName, lastName] = splitName(person.Name!);
      try {
        const user = await db.user.create({
          data: {
            ref: newRef("usr"),
            organizationId: org.id,
            // A bare username is not an email, and the partial unique index is
            // over the rows that have one — so it is left null rather than
            // written as something that would fail a format check later.
            email: emailOf(person["Email / Username"]!),
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
        else peopleSkipped.add(REFUSALS.SHARED_NAME);
      } catch (error) {
        peopleSkipped.add(refusalFor(error));
      }
    }
    console.log(`people written: ${written} of ${people.length}`);
    report(peopleSkipped, "people not written, or ambiguous");

    // ---------------------------------------------------- relationships ---
    let guardianLinks = 0;
    let instructorLinks = 0;
    const linkSkipped = new Tally();
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
          linkSkipped.add(REFUSALS.UNKNOWN_PERSON);
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
          linkSkipped.add(REFUSALS.ALREADY_PRESENT);
        }
      }
    }
    console.log(`\ninstructor assignments: ${instructorLinks}`);
    console.log(`guardian links: ${guardianLinks}`);
    report(linkSkipped, "relationships not written");

    // ---------------------------------------------------------- sessions ---
    const sessions = read(dir, "sessions.csv");
    const sessionSkipped = new Tally();
    let sessionsWritten = 0;
    let participantsWritten = 0;
    let orphanStudents = 0;

    for (const row of sessions) {
      const start = startOf(row["Scheduled Start"]!, ZONE);
      if (start === null) {
        sessionSkipped.add(REFUSALS.UNREADABLE_START);
        continue;
      }
      const minutes = minutesOf(row["Scheduled Duration"]!);
      if (minutes <= 0) {
        sessionSkipped.add(REFUSALS.UNREADABLE_DURATION);
        continue;
      }
      const status = STATUS[row.Status!.trim()];
      if (status === undefined) {
        sessionSkipped.add(REFUSALS.UNKNOWN_STATUS);
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
        for (const name of namesOf(row.Students!)) {
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
        sessionSkipped.add(refusalFor(error));
      }
    }

    console.log(`\nsessions written: ${sessionsWritten} of ${sessions.length}`);
    console.log(`participants written: ${participantsWritten}`);
    console.log(`student names on a session that matched nobody: ${orphanStudents}`);
    report(sessionSkipped, "sessions the schema would not take");

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
