/**
 * The five accounts a person testing this by hand signs in as.
 *
 * Shared by two commands rather than written twice: `load-real-export.ts` calls
 * it as the last step of a reload, and `make-test-accounts.ts` is the same thing
 * on its own for a database that already holds the export. Two copies of this
 * would drift, and the one that drifted would be whichever was edited last —
 * which is exactly the failure that matters here, because what drifts is a
 * password somebody has written down.
 *
 * ## Fictional people, in the real tenant
 *
 * Every account is invented and on the reserved `.test` domain, which cannot be
 * registered and cannot receive mail. That is the whole design: a test password
 * is written into a terminal, a commit message and a test guide, and a real
 * person's may never be. Giving a real instructor a password is a thing to do
 * from their own record in People — one at a time, by somebody who knows who
 * they are.
 *
 * They live *inside* the imported tenant rather than in a fixture tenant of
 * their own, because the point is to read the real data through each role's
 * eyes. A separate organization would show an empty calendar under every one.
 *
 * ## And the smallest structure that makes booking work
 *
 * An export of people, sessions and series carries no availability, no
 * instructor assignments and no opening hours — and two shipped rules are asked
 * against exactly those. `booking.instructor_eligibility_mode` ships
 * `assigned_only`, so with no assignment rows every student answers "nobody may
 * teach them"; and with no availability rules `resolveFrom` answers "no
 * availability declared" for everybody.
 *
 * So the instructor here declares hours and the student is assigned to them,
 * which makes the booking workflow walkable end to end. **Only for these
 * four.** Nothing real is given hours it did not declare or a relationship
 * nobody recorded — fixing that for the real roster is a decision about the
 * tenant, not one a test-account helper should take.
 *
 * Additive and idempotent. An account that exists has its password reset rather
 * than being skipped, which is the bargain `prisma/seed.ts` already makes and
 * for the same reason: the printed password is the only copy, so a run that
 * leaves you unable to sign in has done nothing useful.
 */

import { Role, UserStatus } from "../src/generated/prisma/enums";
import type { PrismaClient } from "../src/generated/prisma/client";
import { loadPrincipal } from "../src/lib/policies/principal";
import { newRef } from "../src/lib/ref";
import { hashPassword } from "../src/lib/security";
import { createPerson } from "../src/lib/services/people";
import { setPassword } from "../src/lib/services/personAdmin";
import { timeToDb } from "../src/lib/time";

/** One password for every account below, and it is meant to be quoted. */
export const TEST_PASSWORD = "TestThisProject!2026";

/** The administrator a reload leaves behind, and the actor for everything here. */
export const ADMIN_EMAIL = "admin@toptutorsforus.test";

export const INSTRUCTOR_EMAIL = "instructor@toptutorsforus.test";
export const STUDENT_EMAIL = "student@toptutorsforus.test";
export const PARENT_EMAIL = "parent@toptutorsforus.test";
export const REGIONAL_EMAIL = "regional@toptutorsforus.test";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;

/** Declared hours for the one instructor who has any. Weekdays, wide. */
const WORKS_FROM = "08:00";
const WORKS_UNTIL = "20:00";

/**
 * The cast, in the order somebody testing works through them.
 *
 * No second administrator. The one the reload creates is already the strongest
 * account in the tenant, and `setPassword` deliberately refuses to set an
 * administrator's password, so a second could not be given one from here
 * anyway. The regional administrator is the interesting case instead: it holds
 * `USER_MANAGE` and is still refused the password panel, which is the guard
 * most worth watching work.
 */
const CAST = [
  {
    email: REGIONAL_EMAIL,
    firstName: "Regional",
    lastName: "Tester",
    roles: [Role.REGIONAL_ADMIN],
    label: "Regional admin",
  },
  {
    email: INSTRUCTOR_EMAIL,
    firstName: "Instructor",
    lastName: "Tester",
    roles: [Role.INSTRUCTOR],
    label: "Instructor",
  },
  {
    email: STUDENT_EMAIL,
    firstName: "Student",
    lastName: "Tester",
    roles: [Role.STUDENT],
    label: "Student",
  },
  {
    email: PARENT_EMAIL,
    firstName: "Parent",
    lastName: "Tester",
    roles: [Role.PARENT, Role.PAYER],
    label: "Parent",
  },
] as const;

export interface TestAccount {
  label: string;
  email: string;
  /** `created` or `password reset` — said so a second run reads as a second run. */
  note: string;
}

export interface TestAccountsResult {
  accounts: TestAccount[];
  /** How many weekday availability rules this run had to write. */
  hoursAdded: number;
}

/**
 * Make sure all five exist, are active, and have this password.
 *
 * The organization must already exist. The administrator does not: an
 * organization made by hand rather than by a reload has nobody to act as, so one
 * is created to be the actor — `createPerson` and `setPassword` both take a
 * principal, which is what puts a `user.created` and a `user.password_set` in
 * the audit trail rather than leaving five accounts nobody can account for.
 */
export async function ensureTestAccounts(
  db: PrismaClient,
  organization: { id: bigint; timezone: string },
  password: string = TEST_PASSWORD,
): Promise<TestAccountsResult> {
  const adminId = await administratorFor(db, organization, password);
  const principal = await loadPrincipal(db, adminId);

  // The administrator's own password, written directly. `setPassword` refuses
  // an administrator's on purpose — that is the guard stopping the weakest
  // administrator account being the effective strength of every one of them —
  // and this is a development helper writing a password it is about to print,
  // which is the one case that rule is not about. `prisma/seed.ts` resets its
  // own accounts the same way.
  const testAdmin = await db.user.findFirst({
    where: { organizationId: organization.id, email: ADMIN_EMAIL },
    select: { id: true },
  });
  if (testAdmin !== null) {
    await db.user.update({
      where: { id: testAdmin.id },
      data: {
        passwordHash: await hashPassword(password),
        status: UserStatus.ACTIVE,
        archivedAt: null,
      },
    });
  }

  const accounts: TestAccount[] = [
    { label: "Administrator", email: ADMIN_EMAIL, note: testAdmin === null ? "created" : "password reset" },
  ];

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

    // Through the service, so it is recorded and so an `INVITED` account becomes
    // `ACTIVE` rather than acquiring a password it would still refuse.
    await setPassword(db, principal, person, password);

    // Archived by an earlier test: put them back, or the next run signs in as
    // somebody the directory refuses to show.
    if (person.archivedAt !== null) {
      await db.user.update({ where: { id: person.id }, data: { archivedAt: null } });
    }

    accounts.push({
      label: member.label,
      email: member.email,
      note: existing === null ? "created" : "password reset",
    });
  }

  const hoursAdded = await linkThemUp(db, organization);
  return { accounts, hoursAdded };
}

/** The `.test` administrator if there is one, any administrator if not, a new one otherwise. */
async function administratorFor(
  db: PrismaClient,
  organization: { id: bigint; timezone: string },
  password: string,
): Promise<bigint> {
  const named = await db.user.findFirst({
    where: { organizationId: organization.id, email: ADMIN_EMAIL, archivedAt: null },
    select: { id: true },
  });
  if (named !== null) return named.id;

  const any = await db.user.findFirst({
    where: {
      organizationId: organization.id,
      roles: { some: { role: Role.ADMIN } },
      archivedAt: null,
    },
    orderBy: { id: "asc" },
    select: { id: true },
  });
  if (any !== null) return any.id;

  const made = await db.user.create({
    data: {
      ref: newRef("usr"),
      organizationId: organization.id,
      email: ADMIN_EMAIL,
      firstName: "Operations",
      lastName: "Admin",
      status: UserStatus.ACTIVE,
      timezone: organization.timezone,
      passwordHash: await hashPassword(password),
      roles: { create: [{ organizationId: organization.id, role: Role.ADMIN }] },
    },
    select: { id: true },
  });
  return made.id;
}

/** Hours for the instructor, an assignment, and a guardian link. Returns rules written. */
async function linkThemUp(
  db: PrismaClient,
  organization: { id: bigint; timezone: string },
): Promise<number> {
  const find = async (email: string) =>
    db.user.findFirstOrThrow({
      where: { organizationId: organization.id, email },
      select: { id: true },
    });

  const instructor = await find(INSTRUCTOR_EMAIL);
  const student = await find(STUDENT_EMAIL);
  const parent = await find(PARENT_EMAIL);

  // Wide enough that a session booked at almost any working hour falls inside
  // them. The point is that the availability grid has something green in it,
  // not that this models anybody's real week.
  let hoursAdded = 0;
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
        startTime: timeToDb(WORKS_FROM),
        endTime: timeToDb(WORKS_UNTIL),
        timezone: organization.timezone,
      },
    });
    hoursAdded += 1;
  }

  // The eligibility rule the shipped `assigned_only` mode asks. Without this
  // row, choosing the test student offers no instructor at all.
  const assigned = await db.instructorStudent.findFirst({
    where: { instructorId: instructor.id, studentId: student.id },
    select: { organizationId: true },
  });
  if (assigned === null) {
    await db.instructorStudent.create({
      data: { organizationId: organization.id, instructorId: instructor.id, studentId: student.id },
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

  return hoursAdded;
}

/** The block both commands end with. One password, said once, above the list. */
export function printAccounts(
  organizationName: string,
  password: string,
  result: TestAccountsResult,
): void {
  console.info(`\n  ${organizationName} — sign in at http://127.0.0.1:3000/sign-in`);
  console.info(`  Every account below has the password:  ${password}\n`);
  for (const account of result.accounts) {
    console.info(`  ${account.label.padEnd(16)} ${account.email.padEnd(34)} ${account.note}`);
  }
  console.info(
    `\n  The instructor works ${WORKS_FROM}–${WORKS_UNTIL} on weekdays` +
      `${result.hoursAdded === 0 ? " (already declared)" : ""}, teaches the test\n` +
      `  student, and the parent is that student's guardian.\n`,
  );
  console.info(
    "  Everybody imported from the export is INVITED and cannot sign in.\n" +
      "  Give one a password from their own record in People.\n",
  );
}
