/**
 * Development seed data.
 *
 * Ported from `seeds/seed.py`. Everything here is invented. The organizations,
 * people, programs, and subjects are fictional; every email address is on the
 * reserved `.test` top-level domain, which cannot be registered and cannot
 * receive mail. No real person, school, price, or link appears anywhere in this
 * file.
 *
 * Two tenants are created deliberately. A single-tenant development database
 * hides exactly the bugs tenant isolation exists to prevent, because every
 * query looks correct when there is only one organization's data to return.
 *
 *     npm run db:seed
 *     npm run db:seed -- --reset
 *
 * `--reset` empties every table first. Without it the seed is idempotent:
 * running it twice does not duplicate anything, but it also cannot remove a row
 * left behind by a hand-test.
 */

import { config } from "dotenv";

import { DeliveryType, Role, UserStatus } from "../src/generated/prisma/enums";
import type { PrismaClient } from "../src/generated/prisma/client";
import { clientFor } from "../src/lib/db";
import { loadPrincipal } from "../src/lib/policies/principal";
import { newRef } from "../src/lib/ref";
import { hashPassword } from "../src/lib/security";
import { createFromPlan, plan } from "../src/lib/services/booking";
import type { BookingOrganization, BookingRequest } from "../src/lib/services/booking";
import { addDays, civilDate, dateToDb, isoWeekday, timeToDb } from "../src/lib/time";

config();

/** Development only; never used in production. */
const DEMO_PASSWORD = "TopTutorsForUsDemo!2026";

const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;

/** Invented people. Names chosen to be varied and clearly fictional. */
const NORTHGATE_PEOPLE: [string, string, string, Role[]][] = [
  ["rowan.mercer@example.test", "Rowan", "Mercer", [Role.ADMIN]],
  ["noor.haddad@example.test", "Noor", "Haddad", [Role.REGIONAL_ADMIN]],
  ["imani.okafor@example.test", "Imani", "Okafor", [Role.INSTRUCTOR]],
  ["dara.nwosu@example.test", "Dara", "Nwosu", [Role.INSTRUCTOR]],
  ["sana.holm@example.test", "Sana", "Holm", [Role.INSTRUCTOR, Role.PARENT]],
  ["teo.vasquez@example.test", "Teo", "Vasquez", [Role.STUDENT]],
  ["wren.calloway@example.test", "Wren", "Calloway", [Role.STUDENT]],
  ["yusuf.adeyemi@example.test", "Yusuf", "Adeyemi", [Role.STUDENT]],
  ["pilar.esteban@example.test", "Pilar", "Esteban", [Role.STUDENT]],
  ["delphine.arceneaux@example.test", "Delphine", "Arceneaux", [Role.PARENT, Role.PAYER]],
];

const HARBOUR_PEOPLE: [string, string, string, Role[]][] = [
  ["bo.fischer@example.test", "Bo", "Fischer", [Role.ADMIN]],
  ["lior.tamm@example.test", "Lior", "Tamm", [Role.INSTRUCTOR]],
  ["mira.dane@example.test", "Mira", "Dane", [Role.STUDENT]],
];

const PROGRAMS: Record<string, string[]> = {
  northgate: ["Foundations", "Exam Preparation", "Enrichment"],
  harbour: ["Coastal Reading Programme"],
};

const SUBJECTS: Record<string, string[]> = {
  northgate: ["Mathematics", "Literacy", "Science"],
  harbour: ["Portuguese", "English"],
};

const GRADES = ["Year 5", "Year 6", "Year 7", "Year 8"];

type Variant = "northgate" | "harbour";

async function organization(
  db: PrismaClient,
  input: { name: string; slug: string; timezone: string },
) {
  const existing = await db.organization.findUnique({ where: { slug: input.slug } });
  if (existing) return existing;

  const american = input.timezone.startsWith("America");
  return db.organization.create({
    data: {
      ref: newRef("org"),
      name: input.name,
      slug: input.slug,
      country: american ? "US" : "PT",
      timezone: input.timezone,
      currency: american ? "USD" : "EUR",
      supportEmail: `support@${input.slug}.example.test`,
      features: {},
      settings: {},
    },
  });
}

/**
 * The place hierarchy each tenant gets. Invented names, like everything else in
 * this file — no real school appears anywhere in it.
 */
const PLACES: Record<Variant, { region: string; district: string; schools: string[] }> = {
  northgate: {
    region: "North Region",
    district: "Riverbend District",
    schools: ["Northgate High", "Riverbend Middle"],
  },
  harbour: {
    region: "Harbour Region",
    district: "Eastport District",
    schools: ["Eastport Academy"],
  },
};

async function populate(
  db: PrismaClient,
  org: { id: bigint; timezone: string },
  variant: Variant,
): Promise<void> {
  const people = variant === "northgate" ? NORTHGATE_PEOPLE : HARBOUR_PEOPLE;
  const passwordHash = await hashPassword(DEMO_PASSWORD);

  for (const [email, firstName, lastName, roles] of people) {
    const existing = await db.user.findFirst({
      where: { organizationId: org.id, email },
    });
    if (existing) {
      // Reset the password rather than skipping the row outright. These
      // accounts exist to be signed into, and the printed password is the only
      // way anyone knows what to type — so when the two disagree it is the
      // database that is wrong, not the constant. Only ever true of these fixed
      // demo accounts.
      await db.user.update({ where: { id: existing.id }, data: { passwordHash } });
      continue;
    }
    await db.user.create({
      data: {
        ref: newRef("usr"),
        organizationId: org.id,
        email,
        firstName,
        lastName,
        status: UserStatus.ACTIVE,
        passwordHash,
        timezone: org.timezone,
        roles: { create: roles.map((role) => ({ organizationId: org.id, role })) },
      },
    });
  }

  for (const name of PROGRAMS[variant]!) {
    await ensureNamed(db.program, org.id, name, "prg");
  }
  for (const name of SUBJECTS[variant]!) {
    await ensureNamed(db.subject, org.id, name, "sub");
  }
  // Only grades carry a sort order — they are the one list with an inherent
  // sequence, and the reference's helper skips the column on the models that
  // do not have it rather than inventing one.
  for (const [index, name] of GRADES.entries()) {
    await ensureNamed(db.grade, org.id, name, "grd", { sortOrder: index });
  }
  await ensureNamed(db.location, org.id, "Study Room A", "loc");
  await ensureNamed(db.location, org.id, "Study Room B", "loc");

  // Where people are placed: a region, a district inside it, and two schools
  // inside that. Small on purpose — the point is that the hierarchy exists and
  // the directory's location filters have something to offer, not that the
  // fixture is a plausible district. Every name is invented.
  const region = await ensureNamed(db.region, org.id, PLACES[variant]!.region, "reg");
  const district = await ensureNamed(db.district, org.id, PLACES[variant]!.district, "dis", {
    regionId: region.id,
  });
  const schools: { id: bigint }[] = [];
  for (const name of PLACES[variant]!.schools) {
    schools.push(
      await ensureNamed(db.school, org.id, name, "sch", {
        districtId: district.id,
        timezone: org.timezone,
      }),
    );
  }

  // Attach the students to the first school and the instructors to the region,
  // so both ends of the filter return somebody. `skipDuplicates` rather than a
  // read-then-write: the unique index on the pair is what makes it idempotent,
  // and re-running the seed must not double them up.
  const [placedStudents, placedInstructors] = await Promise.all([
    byRole(db, org.id, Role.STUDENT),
    byRole(db, org.id, Role.INSTRUCTOR),
  ]);
  await db.userSchool.createMany({
    data: placedStudents.map((person) => ({
      organizationId: org.id,
      userId: person.id,
      schoolId: schools[0]!.id,
    })),
    skipDuplicates: true,
  });
  // The district and the region the school sits in, written alongside it. The
  // schema says these rows exist so that attaching a school really does attach
  // the district and region above it rather than only appearing to, and the
  // seed was not keeping that promise — which left every seeded student
  // holding a school and every seeded instructor holding a region, sharing
  // nothing. `booking.instructor_eligibility_mode: shared_structure` compares
  // these three tables directly, so it read the gap as "nobody may teach
  // anybody".
  await db.userDistrict.createMany({
    data: placedStudents.map((person) => ({
      organizationId: org.id,
      userId: person.id,
      districtId: district.id,
    })),
    skipDuplicates: true,
  });
  await db.userRegion.createMany({
    data: [...placedStudents, ...placedInstructors].map((person) => ({
      organizationId: org.id,
      userId: person.id,
      regionId: region.id,
    })),
    skipDuplicates: true,
  });

  // Organization hours: open on weekdays, 08:00 to 20:00.
  for (const weekday of WEEKDAYS) {
    const exists = await db.organizationAvailability.findFirst({
      where: { organizationId: org.id, weekday },
    });
    if (!exists) {
      await db.organizationAvailability.create({
        data: {
          organizationId: org.id,
          weekday,
          startTime: timeToDb("08:00"),
          endTime: timeToDb("20:00"),
        },
      });
    }
  }

  const instructors = await byRole(db, org.id, Role.INSTRUCTOR);
  const students = await byRole(db, org.id, Role.STUDENT);
  const parents = await byRole(db, org.id, Role.PARENT);

  for (const instructor of instructors) {
    for (const weekday of WEEKDAYS) {
      const exists = await db.availabilityRule.findFirst({
        where: { instructorId: instructor.id, weekday },
      });
      if (!exists) {
        await db.availabilityRule.create({
          data: {
            ref: newRef("avr"),
            organizationId: org.id,
            instructorId: instructor.id,
            weekday,
            startTime: timeToDb("09:00"),
            endTime: timeToDb("19:00"),
            timezone: org.timezone,
          },
        });
      }
    }
  }

  // Assignments and guardian links, so relationship-based policies have data.
  for (const [offset, student] of students.entries()) {
    const instructor = instructors[offset % Math.max(instructors.length, 1)];
    if (!instructor) continue;
    const exists = await db.instructorStudent.findFirst({
      where: { instructorId: instructor.id, studentId: student.id },
    });
    if (!exists) {
      await db.instructorStudent.create({
        data: {
          organizationId: org.id,
          instructorId: instructor.id,
          studentId: student.id,
        },
      });
    }
  }

  // Two students each, in order, rather than both to whichever parent sorted
  // first. That used to give every link to Sana Holm, who is also an
  // instructor — so a test signing in as her could not tell guardian visibility
  // from instructor visibility — and left Delphine Arceneaux, the only person
  // here who is nothing but a parent, guarding nobody. Her calendar and her
  // session list were empty, which is why the parent journey had never been
  // walked end to end.
  //
  // The split is worth more than a tidier fixture. The recurring series below
  // is a group of two, and this gives Delphine one of its students and not the
  // other — so "a guardian sees their own child and not the child beside them"
  // is a case the base seed can demonstrate, with no scenario fixture needed.
  for (const [index, parent] of parents.entries()) {
    for (const student of students.slice(index * 2, index * 2 + 2)) {
      const exists = await db.guardianStudent.findFirst({
        where: { guardianId: parent.id, studentId: student.id },
      });
      if (!exists) {
        await db.guardianStudent.create({
          data: {
            organizationId: org.id,
            guardianId: parent.id,
            studentId: student.id,
            isPrimary: true,
          },
        });
      }
    }
  }

  if (variant === "northgate") {
    let group = await db.group.findFirst({
      where: { organizationId: org.id, name: "Wednesday Maths Pod" },
    });
    if (group === null) {
      group = await db.group.create({
        data: {
          ref: newRef("grp"),
          organizationId: org.id,
          name: "Wednesday Maths Pod",
          capacity: 6,
        },
      });
      for (const student of students.slice(0, 3)) {
        await db.groupMember.create({
          data: {
            organizationId: org.id,
            groupId: group.id,
            userId: student.id,
            memberRole: "student",
          },
        });
      }
    }

    // One closure, so the recurrence preview has a skip to demonstrate.
    const closure = addDays(civilDate(new Date(), org.timezone), 14);
    const exists = await db.offDay.findFirst({
      where: { organizationId: org.id, day: dateToDb(closure) },
    });
    if (!exists) {
      await db.offDay.create({
        data: {
          organizationId: org.id,
          day: dateToDb(closure),
          label: "Staff training day",
        },
      });
    }
  }
}

/** Any delegate whose model carries `ref`, `name`, and an optional sort order. */
type NamedDelegate = {
  findFirst(args: {
    where: { organizationId: bigint; name: string };
  }): Promise<{ id: bigint } | null>;
  create(args: { data: Record<string, unknown> }): Promise<{ id: bigint }>;
};

async function ensureNamed(
  delegate: NamedDelegate,
  organizationId: bigint,
  name: string,
  prefix: string,
  extra: Record<string, unknown> = {},
) {
  const existing = await delegate.findFirst({ where: { organizationId, name } });
  if (existing) return existing;
  return delegate.create({
    data: { ref: newRef(prefix), organizationId, name, ...extra },
  });
}

async function byRole(db: PrismaClient, organizationId: bigint, role: Role) {
  return db.user.findMany({
    where: { organizationId, roles: { some: { role } } },
    orderBy: { id: "asc" },
  });
}

/** A standalone session and a recurring series, so the app opens with data. */
async function bookExamples(db: PrismaClient, org: BookingOrganization): Promise<void> {
  const already = await db.sessionOccurrence.findFirst({
    where: { organizationId: org.id },
  });
  if (already) {
    console.info("sessions already seeded — skipping");
    return;
  }

  const admin = await db.user.findFirstOrThrow({
    where: { organizationId: org.id, email: "rowan.mercer@example.test" },
  });
  const principal = await loadPrincipal(db, admin.id);
  const instructors = await byRole(db, org.id, Role.INSTRUCTOR);
  const students = await byRole(db, org.id, Role.STUDENT);
  if (instructors.length < 2 || students.length < 3) return;

  // Anchor on next Monday so the demo data always sits in the future.
  const today = civilDate(new Date(), org.timezone);
  const ahead = (8 - isoWeekday(today)) % 7 || 7;
  const monday = addDays(today, ahead);

  const standalone: BookingRequest = {
    title: "Fractions review",
    description: "One-to-one catch-up before the end-of-unit check.",
    deliveryType: DeliveryType.EXTERNAL_LINK,
    meetingUrl: "https://meet.example.test/northgate/fractions",
    startDate: monday,
    startTime: "16:00",
    durationMinutes: 60,
    timezone: org.timezone,
    instructorId: instructors[0]!.id,
    studentIds: [students[0]!.id],
  };
  await bookable(db, org, standalone);
  await createFromPlan(db, org, principal, await plan(db, org, principal, standalone));

  const series: BookingRequest = {
    title: "Weekly maths clinic",
    description: "Recurring small-group session.",
    deliveryType: DeliveryType.EXTERNAL_LINK,
    meetingUrl: "https://meet.example.test/northgate/maths-clinic",
    startDate: addDays(monday, 1),
    startTime: "17:00",
    durationMinutes: 60,
    timezone: org.timezone,
    instructorId: instructors[1]!.id,
    studentIds: students.slice(1, 3).map((student) => student.id),
    repeat: true,
    frequency: "weekly",
    weekdays: ["tue", "thu"],
    endMode: "count",
    occurrenceCount: 8,
  };
  await bookable(db, org, series);
  await createFromPlan(db, org, principal, await plan(db, org, principal, series));
  console.info("seeded example sessions");
}

/**
 * Make sure the tenant can actually book what this seed is about to book.
 *
 * Whether an instructor *may* teach a student is a relationship question, and
 * under `assigned_only` — which is the shipped default — `plan()` refuses a
 * pairing with no assignment row behind it. The assignments above are a
 * round-robin, one instructor per student, which is a reasonable shape for a
 * tenant and the wrong shape for a small group: the weekly clinic puts two
 * students with one instructor, and the second of them had been assigned to
 * somebody else. So the seed failed, on the second of its two example bookings,
 * on any database it had not already seeded.
 *
 * It failed *every time* and had not been noticed once, because a seeded
 * database is seeded and this branch returns early on the second run. It took a
 * genuinely empty one to see it — which is what CI runs against every time.
 *
 * Derived from the request rather than written out beside it, so the next
 * person to change an example booking does not have to know this rule exists.
 */
async function bookable(
  db: PrismaClient,
  org: { id: bigint },
  request: BookingRequest,
): Promise<void> {
  if (request.instructorId === null || request.instructorId === undefined) return;
  for (const studentId of request.studentIds ?? []) {
    const exists = await db.instructorStudent.findFirst({
      where: { instructorId: request.instructorId, studentId },
    });
    if (exists) continue;
    await db.instructorStudent.create({
      data: { organizationId: org.id, instructorId: request.instructorId, studentId },
    });
  }
}

/**
 * Empty every tenant table, so the next seed starts from nothing.
 *
 * Development only, and behind an explicit flag. A seed that is merely
 * idempotent accumulates: rows left over from a hand-test stay for ever, and
 * "why is there a session on that date" costs more to answer than a re-seed
 * costs to run.
 */
async function reset(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`,
  );
  const names = rows.map((row) => `"${row.tablename}"`).join(", ");
  if (names) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }
  console.info(`reset ${rows.length} tables`);
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set");
  if (["production", "prod"].includes((process.env.APP_ENV ?? "").toLowerCase())) {
    throw new Error("refusing to seed a production database");
  }

  const db = clientFor(url);
  const wipe = process.argv.includes("--reset");
  if (wipe) {
    console.info("Emptying every table in the development database first.");
    await reset(db);
  }

  const northgate = await organization(db, {
    name: "Northgate Learning Collective",
    slug: "northgate",
    timezone: "America/New_York",
  });
  const harbour = await organization(db, {
    name: "Harbour Point Tutoring",
    slug: "harbour-point",
    timezone: "Europe/Lisbon",
  });

  await populate(db, northgate, "northgate");
  await populate(db, harbour, "harbour");
  await bookExamples(db, northgate);

  await db.$disconnect();

  console.info("\nSeeded two organizations. Sign in at http://127.0.0.1:3000/sign-in\n");
  console.info(`  Administrator   rowan.mercer@example.test        ${DEMO_PASSWORD}`);
  console.info(`  Instructor      imani.okafor@example.test        ${DEMO_PASSWORD}`);
  console.info(`  Parent          delphine.arceneaux@example.test  ${DEMO_PASSWORD}`);
  console.info(`  Student         teo.vasquez@example.test         ${DEMO_PASSWORD}`);
  console.info("\n  Other tenant    bo.fischer@example.test          (Harbour Point)\n");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
