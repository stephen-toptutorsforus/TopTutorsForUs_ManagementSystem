/**
 * Enrolling a student, a guardian, and staff.
 *
 * Ported from the enrolment half of `tests/test_people.py`. The two rules the
 * interface states and this layer enforces — schools *or* regions, and a school
 * carrying its district and region — are the ones worth holding, because a rule
 * stated only on the screen is not a rule.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { GuardianRelationship, Role, UserStatus } from "@/generated/prisma/enums";
import type { Principal } from "@/lib/policies/principal";
import { loadPrincipal } from "@/lib/policies/principal";
import {
  attachSchool,
  createGuardian,
  createStaff,
  createStudent,
  detachSchool,
  setPlacements,
} from "@/lib/services/enrolment";
import { newRef } from "@/lib/ref";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";

describeDb("enrolment", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let principal: Principal;
  let instructor: Awaited<ReturnType<typeof makeUser>>;
  let student: Awaited<ReturnType<typeof makeUser>>;
  let parent: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });

    const admin = await makeUser(db, org.id, {
      first: "Rowan",
      last: "Mercer",
      email: "rowan.mercer@example.test",
      roles: [Role.ADMIN],
    });
    instructor = await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      email: "imani.okafor@example.test",
      roles: [Role.INSTRUCTOR],
    });
    student = await makeUser(db, org.id, {
      first: "Teo",
      last: "Vasquez",
      email: "teo.vasquez@example.test",
      roles: [Role.STUDENT],
    });
    parent = await makeUser(db, org.id, {
      first: "Rhea",
      last: "Lindqvist",
      email: "rhea.lindqvist@example.test",
      roles: [Role.PARENT],
    });

    principal = await loadPrincipal(db, admin.id);
  });

  const withRoles = (id: bigint) =>
    db.user.findUniqueOrThrow({ where: { id }, include: { roles: true } });

  async function aRegion(name: string) {
    return db.region.create({
      data: { ref: newRef("reg"), organizationId: org.id, name },
    });
  }

  async function aSchoolUnderARegion() {
    const region = await aRegion("Northern");
    const district = await db.district.create({
      data: {
        ref: newRef("dis"),
        organizationId: org.id,
        name: "Ridge",
        regionId: region.id,
      },
    });
    const school = await db.school.create({
      data: {
        ref: newRef("sch"),
        organizationId: org.id,
        name: "Ridge High",
        districtId: district.id,
      },
    });
    return { region, district, school };
  }

  // --- Students ------------------------------------------------------------

  it("creates a student with a parent and no address", async () => {
    // The parent sets the address and the password, so asking for one here
    // would be asking for one nobody is going to use.
    const created = await createStudent(db, org, principal, {
      firstName: "Nils",
      lastName: "Berg",
      requiresGuardian: true,
      guardian: await withRoles(parent.id),
      instructors: [await withRoles(instructor.id)],
    });

    expect(created.email).toBeNull();
    expect(created.status).toBe(UserStatus.INVITED);

    const link = await db.guardianStudent.findFirst({ where: { studentId: created.id } });
    expect(link?.guardianId).toBe(parent.id);

    const taught = await db.instructorStudent.findFirst({
      where: { studentId: created.id },
    });
    expect(taught?.instructorId).toBe(instructor.id);
  });

  it("requires an address for a student with no parent", async () => {
    await expect(
      createStudent(db, org, principal, { firstName: "Ada", lastName: "Reyes" }),
    ).rejects.toThrow("needs an email address");
  });

  it("requires a parent when one is said to be required", async () => {
    await expect(
      createStudent(db, org, principal, {
        firstName: "Ada",
        lastName: "Reyes",
        requiresGuardian: true,
      }),
    ).rejects.toThrow("choose the parent");
  });

  it("refuses a guardian who is not a parent", async () => {
    await expect(
      createStudent(db, org, principal, {
        firstName: "Ada",
        lastName: "Reyes",
        requiresGuardian: true,
        guardian: await withRoles(instructor.id),
      }),
    ).rejects.toThrow("not a parent");
  });

  it("refuses schools and regions together", async () => {
    const region = await aRegion("Northern");
    const school = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Elm Street Primary" },
    });

    await expect(
      createStudent(db, org, principal, {
        firstName: "Ada",
        lastName: "Reyes",
        email: "ada.reyes@example.test",
        schools: [school],
        regions: [region],
      }),
    ).rejects.toThrow("not both");
  });

  it("carries a school's district and region", async () => {
    // The interface promises this, so it is written as rows rather than left to
    // be inferred by whoever queries next.
    const { school } = await aSchoolUnderARegion();

    const created = await createStudent(db, org, principal, {
      firstName: "Ada",
      lastName: "Reyes",
      email: "ada.reyes@example.test",
      schools: [school],
    });

    expect(await db.userSchool.findFirst({ where: { userId: created.id } })).not.toBeNull();
    expect(
      await db.userDistrict.findFirst({ where: { userId: created.id } }),
    ).not.toBeNull();
    expect(await db.userRegion.findFirst({ where: { userId: created.id } })).not.toBeNull();
  });

  it("lets two students both wait for an address", async () => {
    // Uniqueness is a partial index over rows that have an address, so any
    // number of accounts may be waiting for one.
    const guardian = await withRoles(parent.id);
    const first = await createStudent(db, org, principal, {
      firstName: "Nils",
      lastName: "Berg",
      requiresGuardian: true,
      guardian,
    });
    const second = await createStudent(db, org, principal, {
      firstName: "Sofia",
      lastName: "Berg",
      requiresGuardian: true,
      guardian,
    });

    expect(first.email).toBeNull();
    expect(second.email).toBeNull();
    expect(first.id).not.toBe(second.id);
  });

  it("keeps a name and an address out of the enrolment audit entry", async () => {
    const created = await createStudent(db, org, principal, {
      firstName: "Ada",
      lastName: "Reyes",
      email: "ada.reyes@example.test",
      instructors: [await withRoles(instructor.id)],
    });

    const event = await db.auditEvent.findFirstOrThrow({
      where: { entityRef: created.ref, action: "user.student_enrolled" },
    });
    const serialised = JSON.stringify(event.changes);

    expect(serialised).not.toContain("ada.reyes@example.test");
    expect(serialised).not.toContain("Reyes");
    expect(serialised).toContain(instructor.ref);
  });

  // --- Guardians -----------------------------------------------------------

  it("creates a parent with its students and relationship", async () => {
    const created = await createGuardian(db, org, principal, {
      firstName: "Rhea",
      lastName: "Lindqvist",
      email: "rhea.lindqvist2@example.test",
      phone: "555 0134",
      relationship: "coach",
      students: [await withRoles(student.id)],
    });

    const link = await db.guardianStudent.findFirstOrThrow({
      where: { guardianId: created.id },
    });
    expect(link.studentId).toBe(student.id);
    expect(link.relationshipKind).toBe(GuardianRelationship.COACH);
    // The first student named should be the primary link.
    expect(link.isPrimary).toBe(true);
  });

  it("refuses an unknown relationship", async () => {
    await expect(
      createGuardian(db, org, principal, {
        firstName: "Rhea",
        lastName: "Lindqvist",
        email: "rhea.lindqvist3@example.test",
        relationship: "landlord",
      }),
    ).rejects.toThrow("unknown relationship");
  });

  it("requires an address for a parent", async () => {
    await expect(
      createGuardian(db, org, principal, {
        firstName: "Rhea",
        lastName: "Lindqvist",
        email: "  ",
      }),
    ).rejects.toThrow("needs an email address");
  });

  // --- Staff ---------------------------------------------------------------

  it("gives an instructor the district and region behind a school", async () => {
    const { school } = await aSchoolUnderARegion();

    const person = await createStaff(db, org, principal, {
      role: Role.INSTRUCTOR,
      firstName: "Sana",
      lastName: "Holm",
      email: "sana.holm2@example.test",
      schools: [school],
    });

    expect(await db.userDistrict.findFirst({ where: { userId: person.id } })).not.toBeNull();
    expect(await db.userRegion.findFirst({ where: { userId: person.id } })).not.toBeNull();
  });

  it("bounds a regional administrator by the regions chosen", async () => {
    // The regions are not decoration: `Principal.regionIds` is read from the
    // role rows, so this is what limits everything they will be allowed to see.
    const north = await aRegion("Northern");
    const south = await aRegion("Southern");

    const person = await createStaff(db, org, principal, {
      role: Role.REGIONAL_ADMIN,
      firstName: "Ines",
      lastName: "Marek",
      email: "ines.marek@example.test",
      regions: [north, south],
    });

    // Read the role rows directly: loadPrincipal refuses an account that cannot
    // sign in, and an invited account has no password yet. These rows are what
    // `Principal.regionIds` is built from.
    const rows = await db.userRole.findMany({ where: { userId: person.id } });
    expect(new Set(rows.map((row) => row.role))).toEqual(new Set([Role.REGIONAL_ADMIN]));
    expect(new Set(rows.map((row) => row.regionId))).toEqual(new Set([north.id, south.id]));
  });

  it("requires a region for a regional administrator", async () => {
    await expect(
      createStaff(db, org, principal, {
        role: Role.REGIONAL_ADMIN,
        firstName: "Ines",
        lastName: "Marek",
        email: "ines.marek@example.test",
      }),
    ).rejects.toThrow("needs at least one region");
  });

  it("refuses schools and regions together for staff", async () => {
    const region = await aRegion("Northern");
    const school = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Ridge High" },
    });

    await expect(
      createStaff(db, org, principal, {
        role: Role.INSTRUCTOR,
        firstName: "Sana",
        lastName: "Holm",
        email: "sana.holm2@example.test",
        schools: [school],
        regions: [region],
      }),
    ).rejects.toThrow("not both");
  });

  it("requires an address for staff", async () => {
    await expect(
      createStaff(db, org, principal, {
        role: Role.INSTRUCTOR,
        firstName: "Sana",
        lastName: "Holm",
        email: "",
      }),
    ).rejects.toThrow("needs an email address");
  });

  // --- Placements after create --------------------------------------------

  it("replaces a person's schools and expands the new one", async () => {
    const first = await aSchoolUnderARegion();
    const secondRegion = await aRegion("Southern");
    const secondDistrict = await db.district.create({
      data: {
        ref: newRef("dis"),
        organizationId: org.id,
        name: "Vale",
        regionId: secondRegion.id,
      },
    });
    const second = await db.school.create({
      data: {
        ref: newRef("sch"),
        organizationId: org.id,
        name: "Vale High",
        districtId: secondDistrict.id,
      },
    });

    const person = await withRoles(student.id);
    await setPlacements(db, org, principal, { person, schools: [first.school] });
    await setPlacements(db, org, principal, { person, schools: [second] });

    expect(await db.userSchool.findMany({ where: { userId: person.id } })).toHaveLength(1);
    expect(
      (await db.userSchool.findFirstOrThrow({ where: { userId: person.id } })).schoolId,
    ).toBe(second.id);
    expect(
      (await db.userDistrict.findFirstOrThrow({ where: { userId: person.id } })).districtId,
    ).toBe(secondDistrict.id);
    expect(
      (await db.userRegion.findFirstOrThrow({ where: { userId: person.id } })).regionId,
    ).toBe(secondRegion.id);
  });

  it("refuses schools and regions together when replacing placements", async () => {
    const { school } = await aSchoolUnderARegion();
    const region = await aRegion("Coastal");

    await expect(
      setPlacements(db, org, principal, {
        person: await withRoles(student.id),
        schools: [school],
        regions: [region],
      }),
    ).rejects.toThrow("not both");
  });

  it("refuses another tenant's school", async () => {
    const other = await makeOrganization(db, { timezone: "America/Los_Angeles" });
    const theirSchool = await db.school.create({
      data: { ref: newRef("sch"), organizationId: other.id, name: "Elsewhere High" },
    });

    await expect(
      setPlacements(db, org, principal, {
        person: await withRoles(student.id),
        schools: [theirSchool],
      }),
    ).rejects.toThrow("not in this organization");
  });

  it("leaves role grants alone when placements change", async () => {
    const { school } = await aSchoolUnderARegion();
    const person = await withRoles(instructor.id);
    const before = await db.userRole.findMany({ where: { userId: person.id } });

    await setPlacements(db, org, principal, { person, schools: [school] });

    const after = await db.userRole.findMany({ where: { userId: person.id } });
    expect(after.map((row) => row.role)).toEqual(before.map((row) => row.role));
  });

  it("attaches a school without dropping one already held", async () => {
    const first = await aSchoolUnderARegion();
    const extra = await db.school.create({
      data: {
        ref: newRef("sch"),
        organizationId: org.id,
        name: "Riverbend Middle",
        districtId: first.district.id,
      },
    });
    const person = await withRoles(student.id);
    await setPlacements(db, org, principal, { person, schools: [first.school] });
    await attachSchool(db, org, principal, { person, school: extra });

    const held = await db.userSchool.findMany({ where: { userId: person.id } });
    expect(new Set(held.map((row) => row.schoolId))).toEqual(
      new Set([first.school.id, extra.id]),
    );
  });

  it("refuses to attach a school to somebody placed only at a region", async () => {
    const { school, region } = await aSchoolUnderARegion();
    const person = await withRoles(student.id);
    await setPlacements(db, org, principal, { person, regions: [region] });

    await expect(
      attachSchool(db, org, principal, { person, school }),
    ).rejects.toThrow("attached to regions");
  });

  it("detaches one school and rebuilds the rest", async () => {
    const { school, district, region } = await aSchoolUnderARegion();
    const person = await withRoles(student.id);
    await setPlacements(db, org, principal, { person, schools: [school] });
    await detachSchool(db, org, principal, { person, school });

    expect(await db.userSchool.findMany({ where: { userId: person.id } })).toHaveLength(0);
    expect(await db.userDistrict.findMany({ where: { userId: person.id } })).toHaveLength(0);
    expect(await db.userRegion.findMany({ where: { userId: person.id } })).toHaveLength(0);
    expect(district.id).toBeTruthy();
    expect(region.id).toBeTruthy();
  });
});
