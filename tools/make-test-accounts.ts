/**
 * Put one account per role into the development database, so every screen has
 * somebody to be opened as.
 *
 *     npm run db:test-accounts
 *
 * After `tools/load-real-export.ts` the tenant holds the roster the office
 * actually has and **exactly one account that can sign in** — the administrator
 * that script creates. That is correct behaviour and a dead end for testing: an
 * import must not mint working accounts, so the 38 instructors, 391 students
 * and 218 parents it wrote all arrive `INVITED` with no password, and the
 * instructor's calendar, the student's session list and the parent's guardian
 * view cannot be opened by anybody.
 *
 * This adds the missing four, and nothing else.
 *
 * ## Fictional people, in the real tenant
 *
 * Every account here is invented and lives on the reserved `.test` domain,
 * which cannot be registered and cannot receive mail. That is the whole design:
 * a test account must be one whose password can be written down in a terminal,
 * a commit message or a test guide, and a real person's cannot. Giving a real
 * instructor a password is a thing to do from their own record in People — one
 * at a time, by somebody who knows who they are.
 *
 * They are created *inside* the imported tenant rather than in a fixture tenant
 * of their own, because the point is to read the real data through each role's
 * eyes. A separate organization would show an empty calendar under every one.
 *
 * ## And the smallest amount of structure that makes booking work
 *
 * The export carries people, sessions and series. It carries no availability,
 * no instructor assignments and no opening hours, and two of the product's
 * rules are asked against exactly those:
 *
 * * `booking.instructor_eligibility_mode` ships `assigned_only`, so with no
 *   assignment rows, choosing any student answers "nobody may teach them" and
 *   the booking screen stops there.
 * * With no availability rules, `resolveFrom` returns "no availability
 *   declared" for everybody, so the availability grid is empty on every date.
 *
 * So the instructor here gets declared hours and the student is assigned to
 * them, which makes the booking workflow walkable end to end. Only for these
 * four: nothing real is given hours it did not declare, or a relationship
 * nobody recorded. Fixing that for the real roster is a decision about the
 * tenant — turn the mode to `any_instructor`, or import the availability —
 * and not one a test-account script should take.
 *
 * ## Safe to run twice
 *
 * Additive and idempotent. An account that exists has its password reset rather
 * than being skipped, which is the same bargain `prisma/seed.ts` makes and for
 * the same reason: the printed password is the only copy, so a run that leaves
 * you unable to sign in has done nothing useful. It refuses any database but
 * `tutorops_ops_dev`, deletes nothing, and touches no imported row.
 */

import { config } from "dotenv";

import { Role, UserStatus } from "../src/generated/prisma/enums";
import type { PrismaClient } from "../src/generated/prisma/client";
import { clientFor } from "../src/lib/db";
import { loadPrincipal } from "../src/lib/policies/principal";
import { newRef } from "../src/lib/ref";
import { hashPassword } from "../src/lib/security";
import { createPerson } from "../src/lib/services/people";
import { setPassword } from "../src/lib/services/personAdmin";
import { timeToDb } from "../src/lib/time";

config({ path: ".env", quiet: true });

/** The only database this will touch. See `load-real-export.ts` for why. */
const ALLOWED = "tutorops_ops_dev";

const PASSWORD = "TestThisProject!2026";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;

/**
 * The cast, in the order somebody testing works through them.
 *
 * No second administrator: the one the loader creates is already the strongest
 * account in the tenant, and `setPassword` deliberately refuses to set an
 * administrator's password, so a second one could not be given one from here
 * anyway. The regional administrator is the interesting case instead — it holds
 * `USER_MANAGE` and is refused the password panel, which is the guard most
 * worth seeing work.
 */
const CAST = [
  {
    email: "regional@toptutorsforus.test",
    firstName: "Regional",
    lastName: "Tester",
    roles: [Role.REGIONAL_ADMIN],
    label: "Regional admin",
  },
  {
    email: "instructor@toptutorsforus.test",
    firstName: "Instructor",
    lastName: "Tester",
    roles: [Role.INSTRUCTOR],
    label: "Instructor",
  },
  {
    email: "student@toptutorsforus.test",
    firstName: "Student",
    lastName: "Tester",
    roles: [Role.STUDENT],
    label: "Student",
  },
  {
    email: "parent@toptutorsforus.test",
    firstName: "Parent",
    lastName: "Tester",
    roles: [Role.PARENT, Role.PAYER],
    label: "Parent",
  },
] as const;

/** The administrator the export loader leaves behind. */
const ADMIN_EMAIL = "admin@toptutorsforus.test";

function flag(name: string): string | undefined {
  const at = process.argv.indexOf(`--${name}`);
  return at === -1 ? undefined : process.argv[at + 1];
}

function databaseName(url: string): string {
  try {
    return new URL(url).pathname.replace(/^\//, "");
  } catch {
    return "";
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL ?? "";
  const name = databaseName(url);
  if (name !== ALLOWED) {
    throw new Error(
      `DATABASE_URL points at ${name || "nothing"}; this only runs against ${ALLOWED}.`,
    );
  }

  const password = flag("password") ?? PASSWORD;
  const slug = flag("organization");

  const db: PrismaClient = clientFor(url);

  const organizations = await db.organization.findMany({
    where: slug ? { slug } : {},
    select: { id: true, name: true, slug: true, timezone: true },
    orderBy: { id: "asc" },
  });
  if (organizations.length === 0) {
    throw new Error(slug ? `no organization with slug ${slug}` : "no organizations here");
  }
  if (organizations.length > 1) {
    throw new Error(
      `${organizations.length} organizations here; say which with --organization <slug>: ` +
        organizations.map((o) => o.slug).join(", "),
    );
  }
  const organization = organizations[0]!;

  // Somebody has to be the actor: `createPerson` and `setPassword` are the
  // product's own functions and both take a principal, which is what puts a
  // `user.created` and a `user.password_set` in the audit trail rather than
  // leaving four accounts nobody can account for.
  const adminRow =
    (await db.user.findFirst({
      where: { organizationId: organization.id, email: ADMIN_EMAIL, archivedAt: null },
      select: { id: true },
    })) ??
    (await db.user.findFirst({
      where: {
        organizationId: organization.id,
        roles: { some: { role: Role.ADMIN } },
        archivedAt: null,
      },
      orderBy: { id: "asc" },
      select: { id: true },
    }));

  // No administrator at all — an organization made by hand rather than by the
  // loader. Make the one the loader would have.
  const adminId =
    adminRow?.id ??
    (
      await db.user.create({
        data: {
          ref: newRef("usr"),
          organizationId: organization.id,
          email: ADMIN_EMAIL,
          firstName: "Operations",
          lastName: "Admin",
          status: UserStatus.ACTIVE,
          timezone: organization.timezone,
          passwordHash: await hashPassword(password),
          roles: {
            create: [{ organizationId: organization.id, role: Role.ADMIN }],
          },
        },
        select: { id: true },
      })
    ).id;

  const principal = await loadPrincipal(db, adminId);

  // The administrator's own password, reset directly. `setPassword` refuses an
  // administrator's on purpose — that is the guard that stops the weakest
  // administrator account being the effective strength of every one of them —
  // and this is a development tool writing a password it is about to print,
  // which is the one case that rule is not about. `prisma/seed.ts` resets its
  // own accounts the same way.
  const testAdmin = await db.user.findFirst({
    where: { organizationId: organization.id, email: ADMIN_EMAIL },
    select: { id: true },
  });
  if (testAdmin !== null) {
    await db.user.update({
      where: { id: testAdmin.id },
      data: { passwordHash: await hashPassword(password), status: UserStatus.ACTIVE },
    });
  }

  const made: { label: string; email: string; note: string }[] = [];

  for (const member of CAST) {
    const existing = await db.user.findFirst({
      where: { organizationId: organization.id, email: member.email },
      include: { roles: true },
    });

    const person =
      existing ??
      (await createPerson(db, organization, principal, {
        email: member.email,
        firstName: member.firstName,
        lastName: member.lastName,
        roles: [...member.roles],
        timezone: organization.timezone,
      }));

    // Through the service, so it is recorded and so an `INVITED` account
    // becomes `ACTIVE` rather than acquiring a password it would still refuse.
    await setPassword(db, principal, person, password);

    // Archived by a previous test run: put them back, or the next run signs in
    // as somebody the directory refuses to show.
    if (person.archivedAt !== null) {
      await db.user.update({ where: { id: person.id }, data: { archivedAt: null } });
    }

    made.push({
      label: member.label,
      email: member.email,
      note: existing === null ? "created" : "password reset",
    });
  }

  const instructor = await db.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: "instructor@toptutorsforus.test" },
    select: { id: true },
  });
  const student = await db.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: "student@toptutorsforus.test" },
    select: { id: true },
  });
  const parent = await db.user.findFirstOrThrow({
    where: { organizationId: organization.id, email: "parent@toptutorsforus.test" },
    select: { id: true },
  });

  // Declared hours, in the organization's own zone. Weekdays only and wide
  // enough that a session booked at almost any working hour falls inside them,
  // because the point of these is that the availability grid has something
  // green in it rather than that they model anybody's real week.
  let hours = 0;
  for (const weekday of WEEKDAYS) {
    const exists = await db.availabilityRule.findFirst({
      where: { instructorId: instructor.id, weekday },
      select: { id: true },
    });
    if (exists !== null) continue;
    await db.availabilityRule.create({
      data: {
        ref: newRef("avr"),
        organizationId: organization.id,
        instructorId: instructor.id,
        weekday,
        startTime: timeToDb("08:00"),
        endTime: timeToDb("20:00"),
        timezone: organization.timezone,
      },
    });
    hours += 1;
  }

  // The eligibility rule the shipped `assigned_only` mode asks. Without this
  // row, choosing the test student offers no instructor at all.
  const assigned = await db.instructorStudent.findFirst({
    where: { instructorId: instructor.id, studentId: student.id },
    select: { organizationId: true },
  });
  if (assigned === null) {
    await db.instructorStudent.create({
      data: {
        organizationId: organization.id,
        instructorId: instructor.id,
        studentId: student.id,
      },
    });
  }

  // So the parent has a child to see, and so "sees their own, and is not told
  // the name of the one beside them" is testable at all.
  const guarded = await db.guardianStudent.findFirst({
    where: { guardianId: parent.id, studentId: student.id },
    select: { organizationId: true },
  });
  if (guarded === null) {
    await db.guardianStudent.create({
      data: {
        organizationId: organization.id,
        guardianId: parent.id,
        studentId: student.id,
        isPrimary: true,
      },
    });
  }

  console.info(`\n  ${organization.name} — sign in at http://127.0.0.1:3000/sign-in`);
  console.info(`  Every account below has the password:  ${password}\n`);
  console.info(`  ${"Administrator".padEnd(16)} ${ADMIN_EMAIL}`);
  for (const person of made) {
    console.info(`  ${person.label.padEnd(16)} ${person.email.padEnd(36)} ${person.note}`);
  }
  console.info(
    `\n  The instructor works 08:00–20:00 on weekdays${hours === 0 ? " (already declared)" : ""}, ` +
      `teaches the test\n  student, and the parent is that student's guardian.\n`,
  );
  console.info(
    "  Everybody imported from the export is still INVITED and cannot sign in.\n" +
      "  Give one a password from their own record in People.\n",
  );

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
