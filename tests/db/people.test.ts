/**
 * Creating and assigning people.
 *
 * Ported from the service half of `tests/test_people.py`, plus the filtering
 * half of `tests/test_people_filter.py` asked of `listPeople` rather than of
 * rendered HTML — the screens are not ported yet, and the question those tests
 * ask is a question about the query.
 *
 * The negative tests matter most here: a person-creation path that also grants
 * privileges, or leaks the directory into the audit trail, is worse than no
 * path.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { Role, UserStatus } from "@/generated/prisma/enums";
import { Forbidden, Unauthenticated } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import { assignStudent, createPerson, findOrInviteStudent } from "@/lib/services/people";
import { listPeople } from "@/lib/services/peopleQuery";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";

describeDb("creating people", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let otherOrg: { id: bigint; timezone: string };
  let adminPrincipal: Principal;
  let regionalPrincipal: Principal;
  let instructor: Awaited<ReturnType<typeof makeUser>>;
  let student: Awaited<ReturnType<typeof makeUser>>;

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });
    otherOrg = await makeOrganization(db, { timezone: "America/Los_Angeles" });

    const admin = await makeUser(db, org.id, {
      first: "Rowan",
      last: "Mercer",
      email: "rowan.mercer@example.test",
      roles: [Role.ADMIN],
    });
    const regional = await makeUser(db, org.id, {
      first: "Noor",
      last: "Haddad",
      email: "noor.haddad@example.test",
      roles: [Role.REGIONAL_ADMIN],
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

    adminPrincipal = await loadPrincipal(db, admin.id);
    regionalPrincipal = await loadPrincipal(db, regional.id);
  });

  const withRoles = (id: bigint) =>
    db.user.findUniqueOrThrow({ where: { id }, include: { roles: true } });

  it("creates an invited account with no password", async () => {
    const person = await createPerson(db, org, adminPrincipal, {
      email: "Kavi.Raman@Example.Test",
      firstName: "Kavi",
      lastName: "Raman",
      roles: ["student"],
    });

    expect(person.status).toBe(UserStatus.INVITED);
    // Nobody sets a password on another's behalf.
    expect(person.passwordHash).toBeNull();
    // Addresses are normalised.
    expect(person.email).toBe("kavi.raman@example.test");
    expect(person.ref.startsWith("usr_")).toBe(true);
  });

  it("lets a person hold several roles from the start", async () => {
    const person = await createPerson(db, org, adminPrincipal, {
      email: "sana.holm@example.test",
      firstName: "Sana",
      lastName: "Holm",
      roles: ["instructor", "parent"],
    });

    expect(new Set(person.roles.map((grant) => grant.role))).toEqual(
      new Set([Role.INSTRUCTOR, Role.PARENT]),
    );
  });

  it("does not let a regional administrator promote to administrator", async () => {
    // Holding user.manage must not become a route to granting oneself more.
    await expect(
      createPerson(db, org, regionalPrincipal, {
        email: "escalate@example.test",
        firstName: "Esca",
        lastName: "Late",
        roles: ["admin"],
      }),
    ).rejects.toThrow("only an administrator");

    await expect(
      createPerson(db, org, regionalPrincipal, {
        email: "escalate2@example.test",
        firstName: "Esca",
        lastName: "Late",
        roles: ["regional_admin"],
      }),
    ).rejects.toThrow("only an administrator");
  });

  it("still lets a regional administrator create ordinary people", async () => {
    const person = await createPerson(db, org, regionalPrincipal, {
      email: "ordinary@example.test",
      firstName: "Ola",
      lastName: "Berg",
      roles: ["student"],
    });

    expect(person.roles.map((grant) => grant.role)).toEqual([Role.STUDENT]);
  });

  it("does not let an instructor create people", async () => {
    const principal = await loadPrincipal(db, instructor.id);

    const attempt = createPerson(db, org, principal, {
      email: "nope@example.test",
      firstName: "No",
      lastName: "Pe",
      roles: ["student"],
    });
    await expect(attempt).rejects.toBeInstanceOf(Forbidden);
    await expect(attempt).rejects.toThrow("user.manage");
  });

  it.each([
    [{ email: "not-an-address" }, "email address"],
    [{ email: "missing@tld" }, "email address"],
    [{ firstName: "  " }, "first and last name"],
    [{ roles: [] }, "at least one role"],
    [{ roles: ["overlord"] }, "unknown role"],
    [{ phone: "no" }, "phone number"],
  ])("refuses invalid details (%o)", async (payload, message) => {
    const base = {
      email: "valid@example.test" as string | null,
      firstName: "Valid",
      lastName: "Person",
      roles: ["student"],
    };
    await expect(
      createPerson(db, org, adminPrincipal, { ...base, ...payload }),
    ).rejects.toThrow(message);
  });

  it("refuses a duplicate address within the tenant", async () => {
    await createPerson(db, org, adminPrincipal, {
      email: "taken@example.test",
      firstName: "First",
      lastName: "Claim",
      roles: ["student"],
    });

    await expect(
      createPerson(db, org, adminPrincipal, {
        email: "TAKEN@example.test",
        firstName: "Second",
        lastName: "Claim",
        roles: ["student"],
      }),
    ).rejects.toThrow("already exists here");
  });

  it("allows the same address in another tenant", async () => {
    // A person may work for two organizations without either seeing the other.
    await createPerson(db, org, adminPrincipal, {
      email: "shared@example.test",
      firstName: "Shared",
      lastName: "Person",
      roles: ["instructor"],
    });

    const outsiderAdmin = await makeUser(db, otherOrg.id, {
      first: "Bo",
      last: "Fischer",
      email: "bo.fischer@example.test",
      roles: [Role.ADMIN],
    });
    const person = await createPerson(
      db,
      otherOrg,
      await loadPrincipal(db, outsiderAdmin.id),
      {
        email: "shared@example.test",
        firstName: "Shared",
        lastName: "Person",
        roles: ["instructor"],
      },
    );

    expect(person.organizationId).toBe(otherOrg.id);
  });

  it("audits the roles but not the directory", async () => {
    const person = await createPerson(db, org, adminPrincipal, {
      email: "private.person@example.test",
      firstName: "Private",
      lastName: "Person",
      roles: ["student"],
    });

    const event = await db.auditEvent.findFirstOrThrow({
      where: { entityRef: person.ref },
    });
    const serialised = JSON.stringify(event.changes);

    expect(event.action).toBe("user.created");
    const changes = event.changes as Record<string, { to: string[] }>;
    expect(changes.role!.to).toEqual(["student"]);
    expect(serialised).not.toContain("private.person@example.test");
    // The trail is not a second copy of the directory.
    expect(serialised).not.toContain("Private");
  });

  it("cannot sign in to an invited account until it is activated", async () => {
    const person = await createPerson(db, org, adminPrincipal, {
      email: "pending@example.test",
      firstName: "Pending",
      lastName: "Person",
      roles: ["instructor"],
    });

    await expect(loadPrincipal(db, person.id)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it("puts the new person in the directory", async () => {
    await createPerson(db, org, adminPrincipal, {
      email: "listed@example.test",
      firstName: "Listed",
      lastName: "Person",
      roles: ["student"],
    });

    const found = await db.user.findMany({
      where: { organizationId: org.id, email: "listed@example.test" },
    });
    expect(found.length).toBe(1);
  });

  // --- Assignment ----------------------------------------------------------

  it("links an instructor and a student both ways, idempotently", async () => {
    const pair = {
      instructor: await withRoles(instructor.id),
      student: await withRoles(student.id),
    };
    const link = await assignStudent(db, org, adminPrincipal, pair);

    expect(link.instructorId).toBe(instructor.id);
    expect(link.studentId).toBe(student.id);

    const again = await assignStudent(db, org, adminPrincipal, pair);
    // Assigning twice is idempotent.
    expect(again.id).toBe(link.id);

    const count = await db.instructorStudent.count({
      where: { instructorId: instructor.id },
    });
    expect(count).toBe(1);
  });

  it("checks that the roles are what they claim", async () => {
    const asInstructor = await withRoles(instructor.id);
    const asStudent = await withRoles(student.id);

    await expect(
      assignStudent(db, org, adminPrincipal, {
        instructor: asStudent,
        student: asStudent,
      }),
    ).rejects.toThrow("not an instructor");

    await expect(
      assignStudent(db, org, adminPrincipal, {
        instructor: asInstructor,
        student: asInstructor,
      }),
    ).rejects.toThrow("not a student");
  });

  it("refuses to assign a person from another tenant", async () => {
    const outsider = await makeUser(db, otherOrg.id, {
      first: "Mira",
      last: "Dane",
      email: "mira.dane@example.test",
      roles: [Role.STUDENT],
    });

    await expect(
      assignStudent(db, org, adminPrincipal, {
        instructor: await withRoles(instructor.id),
        student: await withRoles(outsider.id),
      }),
    ).rejects.toThrow("must be in this organization");
  });

  // --- Add by email --------------------------------------------------------

  it("finds an existing student by address rather than inviting a second", async () => {
    const found = await findOrInviteStudent(db, org, adminPrincipal, {
      email: "TEO.VASQUEZ@example.test",
    });

    expect(found.id).toBe(student.id);
  });

  it("refuses an address belonging to somebody who is not a student", async () => {
    await expect(
      findOrInviteStudent(db, org, adminPrincipal, { email: "imani.okafor@example.test" }),
    ).rejects.toThrow("not a student here");
  });

  it("invites an unmatched address as a placeholder name", async () => {
    const invited = await findOrInviteStudent(db, org, adminPrincipal, {
      email: "amara.okonkwo@example.test",
    });

    expect(invited.firstName).toBe("Amara");
    expect(invited.lastName).toBe("Okonkwo");
    expect(invited.status).toBe(UserStatus.INVITED);
  });

  it("never reveals that an address exists in another tenant", async () => {
    await makeUser(db, otherOrg.id, {
      first: "Elsewhere",
      last: "Student",
      email: "elsewhere@example.test",
      roles: [Role.STUDENT],
    });

    // An administrator here may invite, so the address is created locally
    // rather than reported as taken.
    const invited = await findOrInviteStudent(db, org, adminPrincipal, {
      email: "elsewhere@example.test",
    });
    expect(invited.organizationId).toBe(org.id);
  });

  it("refuses rather than invents when the caller cannot manage people", async () => {
    const booker = await loadPrincipal(db, instructor.id);

    await expect(
      findOrInviteStudent(db, org, booker, { email: "nobody.here@example.test" }),
    ).rejects.toThrow("no student here has that email address");
  });
});

// --- The directory -----------------------------------------------------------

describeDb("the directory", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let otherOrg: { id: bigint; timezone: string };
  let principal: Principal;
  let refs: { region: string; district: string; school: string };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** Who the query lists, read off the surnames. */
  const surnames = (rows: { user: { lastName: string } }[]) =>
    new Set(rows.map((row) => row.user.lastName));

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });
    otherOrg = await makeOrganization(db, { timezone: "America/Los_Angeles" });

    const admin = await makeUser(db, org.id, {
      first: "Rowan",
      last: "Mercer",
      email: "rowan.mercer@example.test",
      roles: [Role.ADMIN],
    });
    await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      email: "imani.okafor@example.test",
      roles: [Role.INSTRUCTOR],
    });
    await makeUser(db, org.id, {
      first: "Teo",
      last: "Vasquez",
      email: "teo.vasquez@example.test",
      roles: [Role.STUDENT],
    });
    await makeUser(db, org.id, {
      first: "Delphine",
      last: "Arceneaux",
      email: "delphine.arceneaux@example.test",
      roles: [Role.PARENT],
    });
    await makeUser(db, org.id, {
      first: "Sana",
      last: "Holm",
      email: "sana.holm@example.test",
      roles: [Role.INSTRUCTOR, Role.PARENT],
    });
    await makeUser(db, org.id, {
      first: "Noor",
      last: "Haddad",
      email: "noor.haddad@example.test",
      roles: [Role.REGIONAL_ADMIN],
    });

    principal = await loadPrincipal(db, admin.id);
  });

  it("narrows to one role", async () => {
    const rows = await listPeople(db, principal, { roles: [Role.STUDENT] });
    expect(surnames(rows)).toEqual(new Set(["Vasquez"]));
  });

  it("shows the people who hold either of two roles", async () => {
    // Not both. A list of checkboxes reads as "any of these", and somebody who
    // holds two of them appears once rather than twice.
    const rows = await listPeople(db, principal, { roles: [Role.STUDENT, Role.PARENT] });

    expect(surnames(rows)).toEqual(new Set(["Vasquez", "Arceneaux", "Holm"]));
    expect(rows.filter((row) => row.user.lastName === "Holm").length).toBe(1);
  });

  it("shows everybody when nothing is ticked", async () => {
    const rows = await listPeople(db, principal);
    expect(surnames(rows)).toEqual(
      new Set(["Mercer", "Okafor", "Vasquez", "Arceneaux", "Holm", "Haddad"]),
    );
  });

  it("narrows by the filter and the search together", async () => {
    const rows = await listPeople(db, principal, {
      search: "Holm",
      roles: [Role.INSTRUCTOR],
    });
    expect(surnames(rows)).toEqual(new Set(["Holm"]));
  });

  it("searches by email address", async () => {
    const rows = await listPeople(db, principal, { search: "teo.vasquez@" });
    expect(surnames(rows)).toEqual(new Set(["Vasquez"]));
  });

  it("searches a full name across both columns", async () => {
    const rows = await listPeople(db, principal, { search: "Sana Holm" });
    expect(surnames(rows)).toEqual(new Set(["Holm"]));
  });

  it("filters by a role the menu does not offer", async () => {
    const rows = await listPeople(db, principal, { roles: [Role.REGIONAL_ADMIN] });
    expect(surnames(rows)).toEqual(new Set(["Haddad"]));
  });

  it("does not list another tenant's people", async () => {
    await makeUser(db, otherOrg.id, {
      first: "Bo",
      last: "Fischer",
      email: "bo.fischer@example.test",
      roles: [Role.ADMIN],
    });

    const rows = await listPeople(db, principal);
    expect(surnames(rows).has("Fischer")).toBe(false);
  });

  it("shows a zero credit balance as a balance", async () => {
    const rows = await listPeople(db, principal);
    for (const row of rows) expect(row.credits).toBe(0);
  });

  it("names both sides of a relationship", async () => {
    const teacher = await db.user.findFirstOrThrow({ where: { lastName: "Okafor" } });
    const learner = await db.user.findFirstOrThrow({ where: { lastName: "Vasquez" } });
    await db.instructorStudent.create({
      data: {
        organizationId: org.id,
        instructorId: teacher.id,
        studentId: learner.id,
      },
    });

    const rows = await listPeople(db, principal);
    const byName = new Map(rows.map((row) => [row.user.lastName, row]));

    expect(byName.get("Okafor")!.connections).toContainEqual({
      kind: "Teaches",
      name: "Teo Vasquez",
    });
    expect(byName.get("Vasquez")!.connections).toContainEqual({
      kind: "Instructor",
      name: "Imani Okafor",
    });
  });

  it("does not list an archived person", async () => {
    const gone = await db.user.findFirstOrThrow({ where: { lastName: "Haddad" } });
    await db.user.update({ where: { id: gone.id }, data: { archivedAt: new Date() } });

    expect(surnames(await listPeople(db, principal)).has("Haddad")).toBe(false);
  });

  describe("the filters the drawer adds", () => {
    /** A region, a district under it, a school under that, and who is where. */
    beforeEach(async () => {
      const region = await db.region.create({
        data: { ref: `reg_${Date.now().toString(36)}`, organizationId: org.id, name: "North" },
      });
      const district = await db.district.create({
        data: {
          ref: `dis_${Date.now().toString(36)}`,
          organizationId: org.id,
          regionId: region.id,
          name: "Riverside",
        },
      });
      const school = await db.school.create({
        data: {
          ref: `sch_${Date.now().toString(36)}`,
          organizationId: org.id,
          districtId: district.id,
          name: "Northgate High",
        },
      });

      const okafor = await db.user.findFirstOrThrow({ where: { lastName: "Okafor" } });
      const vasquez = await db.user.findFirstOrThrow({ where: { lastName: "Vasquez" } });

      await db.userRegion.create({
        data: { organizationId: org.id, userId: okafor.id, regionId: region.id },
      });
      await db.userDistrict.create({
        data: { organizationId: org.id, userId: okafor.id, districtId: district.id },
      });
      await db.userSchool.create({
        data: { organizationId: org.id, userId: vasquez.id, schoolId: school.id },
      });

      refs = { region: region.ref, district: district.ref, school: school.ref };
    });

    it("narrows to the people attached to a place", async () => {
      expect(surnames(await listPeople(db, principal, { regionRef: refs.region }))).toEqual(
        new Set(["Okafor"]),
      );
      expect(surnames(await listPeople(db, principal, { districtRef: refs.district }))).toEqual(
        new Set(["Okafor"]),
      );
      expect(surnames(await listPeople(db, principal, { schoolRef: refs.school }))).toEqual(
        new Set(["Vasquez"]),
      );
    });

    it("asks for all of the places at once, not the narrowest", async () => {
      // Nobody holds both this region and this school, so the answer is nobody
      // — not "the school wins". Dropping a filter somebody set would show them
      // people they had excluded.
      const rows = await listPeople(db, principal, {
        regionRef: refs.region,
        schoolRef: refs.school,
      });

      expect(rows).toEqual([]);
    });

    it("narrows by status", async () => {
      const holm = await db.user.findFirstOrThrow({ where: { lastName: "Holm" } });
      await db.user.update({ where: { id: holm.id }, data: { status: UserStatus.DISABLED } });

      expect(surnames(await listPeople(db, principal, { statuses: [UserStatus.DISABLED] }))).toEqual(
        new Set(["Holm"]),
      );
      expect(
        surnames(await listPeople(db, principal, { statuses: [UserStatus.ACTIVE] })).has("Holm"),
      ).toBe(false);
    });

    it("shows every status when none is ticked", async () => {
      const holm = await db.user.findFirstOrThrow({ where: { lastName: "Holm" } });
      await db.user.update({ where: { id: holm.id }, data: { status: UserStatus.DISABLED } });

      expect(surnames(await listPeople(db, principal, { statuses: [] })).has("Holm")).toBe(true);
    });

    it("combines a place, a role and a status", async () => {
      const rows = await listPeople(db, principal, {
        schoolRef: refs.school,
        roles: [Role.STUDENT],
        statuses: [UserStatus.ACTIVE],
      });

      expect(surnames(rows)).toEqual(new Set(["Vasquez"]));
    });

    it("cannot be pointed at another tenant's place", async () => {
      // A ref from elsewhere matches nothing rather than reaching across: the
      // outer `where` is tenant-scoped, so the join simply finds no row.
      const theirRegion = await db.region.create({
        data: { ref: `reg_other_${Date.now().toString(36)}`, organizationId: otherOrg.id, name: "South" },
      });
      const theirs = await makeUser(db, otherOrg.id, { last: "Fischer", roles: [Role.ADMIN] });
      await db.userRegion.create({
        data: { organizationId: otherOrg.id, userId: theirs.id, regionId: theirRegion.id },
      });

      expect(await listPeople(db, principal, { regionRef: theirRegion.ref })).toEqual([]);
    });
  });
});
