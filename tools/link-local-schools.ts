/**
 * Create North and South in both local databases and store the main app's
 * ids on the ops shared links.
 *
 *     npm run db:link-schools
 *
 * Passwords are written only in the main database. Ops receives the people
 * so a booking can select them. Sync refuses any database but the two local
 * names.
 */

import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";

import { config } from "dotenv";
import { Pool } from "pg";

import { Role, SharedRole, UserStatus } from "@/generated/prisma/enums";
import { clientFor } from "@/lib/db";
import { newRef } from "@/lib/ref";
import { assertLocalPair, databaseName } from "@/lib/services/localDatabases";
import { timeToDb } from "@/lib/time";

import { TEST_PASSWORD } from "./testAccounts";

config({ path: ".env", quiet: true });

const MAIN_APP = "C:/task/Mukund_TopTutorsforUsApp/package.json";
const ZONE = "America/Chicago";

interface CastMember {
  key: string;
  email: string;
  first: string;
  last: string;
  mainRole: "ADMIN" | "TUTOR" | "STUDENT";
  opsRole: Role;
  sharedRole: SharedRole;
}

interface SchoolCast {
  ref: string;
  name: string;
  people: CastMember[];
}

const SCHOOLS: SchoolCast[] = [
  {
    ref: "north-high",
    name: "North High",
    people: [
      person("admin", "north.admin@toptutorsforus.test", "Nora", "Admin", "ADMIN", Role.SCHOOL_ADMIN, SharedRole.ADMIN),
      person("tutor", "north.tutor@toptutorsforus.test", "Nico", "Tutor", "TUTOR", Role.INSTRUCTOR, SharedRole.TUTOR),
      person("a", "north.ada@toptutorsforus.test", "Ada", "North", "STUDENT", Role.STUDENT, SharedRole.STUDENT),
      person("b", "north.ben@toptutorsforus.test", "Ben", "North", "STUDENT", Role.STUDENT, SharedRole.STUDENT),
    ],
  },
  {
    ref: "south-high",
    name: "South High",
    people: [
      person("admin", "south.admin@toptutorsforus.test", "Sara", "Admin", "ADMIN", Role.SCHOOL_ADMIN, SharedRole.ADMIN),
      person("tutor", "south.tutor@toptutorsforus.test", "Sol", "Tutor", "TUTOR", Role.INSTRUCTOR, SharedRole.TUTOR),
      person("a", "south.cora@toptutorsforus.test", "Cora", "South", "STUDENT", Role.STUDENT, SharedRole.STUDENT),
      person("b", "south.dan@toptutorsforus.test", "Dan", "South", "STUDENT", Role.STUDENT, SharedRole.STUDENT),
    ],
  },
];

function person(
  key: string,
  email: string,
  first: string,
  last: string,
  mainRole: CastMember["mainRole"],
  opsRole: Role,
  sharedRole: SharedRole,
): CastMember {
  return { key, email, first, last, mainRole, opsRole, sharedRole };
}

async function mainPasswordHash(): Promise<string> {
  const require = createRequire(MAIN_APP);
  const { hash } = require("bcryptjs") as {
    hash: (value: string, rounds: number) => Promise<string>;
  };
  return hash(TEST_PASSWORD, 10);
}

async function main(): Promise<void> {
  const opsUrl = process.env.DATABASE_URL ?? "";
  const schoolUrl = process.env.SCHOOL_DATABASE_URL ?? "";
  assertLocalPair(opsUrl, schoolUrl);
  if (databaseName(opsUrl) === databaseName(schoolUrl)) {
    throw new Error("the two local databases must be different");
  }

  const passwordHash = await mainPasswordHash();
  const ops = clientFor(opsUrl);
  const school = new Pool({ connectionString: schoolUrl });

  const organizations = await ops.organization.findMany({
    select: { id: true, name: true, slug: true },
    orderBy: { id: "asc" },
  });
  const wanted = process.env.LINK_ORGANIZATION;
  const organization = wanted
    ? organizations.find((item) => item.slug === wanted)
    : organizations.length === 1
      ? organizations[0]
      : organizations.find((item) => item.slug === "northgate");
  if (!organization) {
    throw new Error(
      wanted
        ? `no organization with slug ${wanted}`
        : `say which organization with LINK_ORGANIZATION. Here: ` +
            organizations.map((item) => item.slug).join(", "),
    );
  }

  try {
    for (const cast of SCHOOLS) {
      const mainSchoolId = await ensureMainSchool(school, cast);
      const opsSchool = await ensureOpsSchool(ops, organization.id, cast);
      await ensureSharedSchool(ops, opsSchool.id, mainSchoolId, cast);

      const ids = new Map<string, { opsId: bigint; mainId: string }>();
      for (const member of cast.people) {
        const mainId = await ensureMainUser(school, mainSchoolId, member, passwordHash);
        const opsId = await ensureOpsUser(ops, organization.id, opsSchool.id, member);
        await ensureSharedUser(ops, opsId, mainId, mainSchoolId, member);
        ids.set(member.key, { opsId, mainId });
      }

      const tutor = ids.get("tutor");
      if (!tutor) throw new Error(`${cast.name} is missing its tutor`);
      for (const member of cast.people) {
        if (member.opsRole !== Role.STUDENT) continue;
        const student = ids.get(member.key);
        if (!student) continue;
        await ops.instructorStudent.upsert({
          where: {
            instructorId_studentId: { instructorId: tutor.opsId, studentId: student.opsId },
          },
          create: {
            organizationId: organization.id,
            instructorId: tutor.opsId,
            studentId: student.opsId,
          },
          update: {},
        });
      }
      await ensureAvailability(ops, organization.id, tutor.opsId);
    }
  } finally {
    await ops.$disconnect();
    await school.end();
  }

  console.log(`Linked North High and South High in ${organization.name} (${organization.slug}).`);
  console.log("Sign in to the main app with the local test password.");
  for (const cast of SCHOOLS) {
    for (const member of cast.people) console.log(`  ${member.email}`);
  }
}

async function ensureMainSchool(school: Pool, cast: SchoolCast): Promise<string> {
  const found = await school.query<{ id: string }>(`SELECT id FROM "School" WHERE slug = $1`, [
    cast.ref,
  ]);
  if (found.rows[0]) return found.rows[0].id;
  const id = randomUUID();
  await school.query(
    `INSERT INTO "School" (id, name, slug, timezone, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, NOW(), NOW())`,
    [id, cast.name, cast.ref, ZONE],
  );
  return id;
}

async function ensureMainUser(
  school: Pool,
  schoolId: string,
  member: CastMember,
  passwordHash: string,
): Promise<string> {
  const found = await school.query<{ id: string }>(`SELECT id FROM "User" WHERE email = $1`, [
    member.email,
  ]);
  let id = found.rows[0]?.id;
  if (!id) {
    id = randomUUID();
    await school.query(
      `INSERT INTO "User"
         (id, email, "passwordHash", name, role, "schoolId", "mustChangePassword", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, $4, $5::"Role", $6, false, NOW(), NOW())`,
      [id, member.email, passwordHash, `${member.first} ${member.last}`, member.mainRole, schoolId],
    );
  } else {
    await school.query(
      `UPDATE "User" SET name = $2, role = $3::"Role", "schoolId" = $4, "updatedAt" = NOW() WHERE id = $1`,
      [id, `${member.first} ${member.last}`, member.mainRole, schoolId],
    );
  }
  if (member.mainRole === "ADMIN") {
    await school.query(
      `INSERT INTO "AdminSchool" (id, "adminId", "schoolId", "createdAt")
       VALUES ($1, $2, $3, NOW())
       ON CONFLICT ("adminId", "schoolId") DO NOTHING`,
      [randomUUID(), id, schoolId],
    );
  }
  return id;
}

async function ensureOpsSchool(
  ops: ReturnType<typeof clientFor>,
  organizationId: bigint,
  cast: SchoolCast,
): Promise<{ id: bigint }> {
  const found = await ops.school.findUnique({ where: { ref: cast.ref } });
  if (found) return found;
  return ops.school.create({
    data: {
      ref: cast.ref,
      organizationId,
      name: cast.name,
      timezone: ZONE,
    },
  });
}

async function ensureOpsUser(
  ops: ReturnType<typeof clientFor>,
  organizationId: bigint,
  schoolId: bigint,
  member: CastMember,
): Promise<bigint> {
  const found = await ops.user.findFirst({
    where: { organizationId, email: member.email },
  });
  const user =
    found ??
    (await ops.user.create({
      data: {
        ref: newRef("usr"),
        organizationId,
        email: member.email,
        firstName: member.first,
        lastName: member.last,
        status: UserStatus.ACTIVE,
        timezone: ZONE,
      },
    }));
  const grant = await ops.userRole.findFirst({
    where: { userId: user.id, role: member.opsRole, regionId: null },
  });
  if (!grant) {
    await ops.userRole.create({
      data: { organizationId, userId: user.id, role: member.opsRole },
    });
  }
  await ops.userSchool.upsert({
    where: { userId_schoolId: { userId: user.id, schoolId } },
    create: { organizationId, userId: user.id, schoolId },
    update: {},
  });
  return user.id;
}

async function ensureSharedSchool(
  ops: ReturnType<typeof clientFor>,
  opsSchoolId: bigint,
  mainSchoolId: string,
  cast: SchoolCast,
): Promise<void> {
  const link = await ops.sharedLink.findUnique({
    where: { entityType_opsId: { entityType: "school", opsId: opsSchoolId } },
  });
  if (link && link.sharedId !== mainSchoolId) {
    throw new Error(`${cast.name} is already linked to ${link.sharedId}`);
  }
  await ops.sharedSchool.upsert({
    where: { id: mainSchoolId },
    create: { id: mainSchoolId, name: cast.name, slug: cast.ref, timezone: ZONE },
    update: { name: cast.name, slug: cast.ref, timezone: ZONE },
  });
  if (!link) {
    await ops.sharedLink.create({
      data: { entityType: "school", opsId: opsSchoolId, sharedId: mainSchoolId },
    });
  }
}

async function ensureSharedUser(
  ops: ReturnType<typeof clientFor>,
  opsUserId: bigint,
  mainUserId: string,
  mainSchoolId: string,
  member: CastMember,
): Promise<void> {
  const link = await ops.sharedLink.findUnique({
    where: { entityType_opsId: { entityType: "user", opsId: opsUserId } },
  });
  if (link && link.sharedId !== mainUserId) {
    throw new Error(`${member.email} is already linked to ${link.sharedId}`);
  }
  const taken = await ops.sharedUser.findUnique({ where: { email: member.email } });
  if (taken && taken.id !== mainUserId) {
    throw new Error(`${member.email} is already a shared person with a different id`);
  }
  await ops.sharedUser.upsert({
    where: { id: mainUserId },
    create: {
      id: mainUserId,
      email: member.email,
      name: `${member.first} ${member.last}`,
      role: member.sharedRole,
      schoolId: mainSchoolId,
    },
    update: {
      email: member.email,
      name: `${member.first} ${member.last}`,
      role: member.sharedRole,
      schoolId: mainSchoolId,
    },
  });
  if (!link) {
    await ops.sharedLink.create({
      data: { entityType: "user", opsId: opsUserId, sharedId: mainUserId },
    });
  }
}

async function ensureAvailability(
  ops: ReturnType<typeof clientFor>,
  organizationId: bigint,
  instructorId: bigint,
): Promise<void> {
  for (const weekday of ["mon", "tue", "wed", "thu", "fri"]) {
    const existing = await ops.availabilityRule.findFirst({
      where: { instructorId, weekday },
    });
    if (existing) continue;
    await ops.availabilityRule.create({
      data: {
        ref: newRef("avr"),
        organizationId,
        instructorId,
        weekday,
        startTime: timeToDb("08:00"),
        endTime: timeToDb("20:00"),
        timezone: ZONE,
      },
    });
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
