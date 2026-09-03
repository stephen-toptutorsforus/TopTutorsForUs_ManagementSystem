/**
 * Groups and locations.
 *
 * Ported from the service half of `tests/test_structure.py`. One case is held
 * back until booking lands: that removing somebody from a group leaves the
 * sessions already booked with it alone. It needs a booking to remove them
 * from, and it belongs with the booking suite.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { Forbidden } from "@/lib/errors";
import type { Principal } from "@/lib/policies/principal";
import { loadPrincipal } from "@/lib/policies/principal";
import type { PersonRecord } from "@/lib/services/people";
import {
  addMember,
  archiveGroup,
  archiveLocation,
  countMembers,
  createGroup,
  createLocation,
  removeMember,
} from "@/lib/services/structure";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";

describeDb("structure", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let otherOrg: { id: bigint; timezone: string };
  let principal: Principal;
  let instructorPrincipal: Principal;
  let instructor: PersonRecord;
  let student: PersonRecord;

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  const withRoles = (id: bigint) =>
    db.user.findUniqueOrThrow({ where: { id }, include: { roles: true } });

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
    const teacher = await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      email: "imani.okafor@example.test",
      roles: [Role.INSTRUCTOR],
    });
    const learner = await makeUser(db, org.id, {
      first: "Teo",
      last: "Vasquez",
      email: "teo.vasquez@example.test",
      roles: [Role.STUDENT],
    });

    principal = await loadPrincipal(db, admin.id);
    instructorPrincipal = await loadPrincipal(db, teacher.id);
    instructor = await withRoles(teacher.id);
    student = await withRoles(learner.id);
  });

  const aGroup = (capacity: number | null = 2) =>
    createGroup(db, org, principal, { name: "Wednesday Maths", capacity });

  // --- Groups --------------------------------------------------------------

  it("creates a group with an audit entry", async () => {
    const group = await aGroup();

    expect(group.name).toBe("Wednesday Maths");
    expect(group.ref.startsWith("grp_")).toBe(true);

    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "group.created", entityRef: group.ref },
    });
    expect((event.changes as Record<string, { to: string }>).title!.to).toBe(
      "Wednesday Maths",
    );
  });

  it("refuses a duplicate group name within the tenant", async () => {
    await aGroup();
    await expect(
      createGroup(db, org, principal, { name: "wednesday maths" }),
    ).rejects.toThrow("already exists here");
  });

  it("leaves the same group name free in another tenant", async () => {
    await aGroup();
    const outsiderAdmin = await makeUser(db, otherOrg.id, {
      first: "Bo",
      last: "Fischer",
      email: "bo.fischer@example.test",
      roles: [Role.ADMIN],
    });

    const group = await createGroup(
      db,
      otherOrg,
      await loadPrincipal(db, outsiderAdmin.id),
      { name: "Wednesday Maths" },
    );
    expect(group.organizationId).toBe(otherOrg.id);
  });

  it.each([
    [{ name: "   " }, "needs a name"],
    [{ name: "Ok", capacity: 0 }, "at least 1"],
  ])("refuses an invalid group (%o)", async (input, message) => {
    await expect(createGroup(db, org, principal, input)).rejects.toThrow(message);
  });

  it("does not let an instructor create a group", async () => {
    const attempt = createGroup(db, org, instructorPrincipal, { name: "Theirs" });
    await expect(attempt).rejects.toBeInstanceOf(Forbidden);
    await expect(attempt).rejects.toThrow("structure.manage");
  });

  it("adds members idempotently", async () => {
    const group = await aGroup();
    const first = await addMember(db, org, principal, { group, user: student });
    const again = await addMember(db, org, principal, { group, user: student });

    expect(again.id).toBe(first.id);
    expect(await countMembers(db, group.id, "student")).toBe(1);
  });

  it("enforces capacity when the group fills", async () => {
    // The honest moment to refuse is when the group fills, not weeks later at
    // booking time.
    const group = await aGroup(2);
    const others: PersonRecord[] = [];
    for (const index of [0, 1]) {
      const person = await makeUser(db, org.id, {
        first: `Student${index}`,
        last: "Example",
        email: `student${index}@example.test`,
        roles: [Role.STUDENT],
      });
      others.push(await withRoles(person.id));
    }

    await addMember(db, org, principal, { group, user: student });
    await addMember(db, org, principal, { group, user: others[0]! });

    await expect(
      addMember(db, org, principal, { group, user: others[1]! }),
    ).rejects.toThrow("full");
  });

  it("does not count instructors against capacity", async () => {
    // A capacity of two means two students, not two people in the room.
    const group = await aGroup(2);
    await addMember(db, org, principal, { group, user: student });
    await addMember(db, org, principal, {
      group,
      user: instructor,
      memberRole: "instructor",
    });

    expect(await countMembers(db, group.id, "student")).toBe(1);
    expect(await countMembers(db, group.id, "instructor")).toBe(1);
  });

  it("requires a person to hold the role they are added as", async () => {
    const group = await aGroup();

    await expect(
      addMember(db, org, principal, {
        group,
        user: student,
        memberRole: "instructor",
      }),
    ).rejects.toThrow("not an instructor");

    await expect(
      addMember(db, org, principal, { group, user: instructor }),
    ).rejects.toThrow("not a student");
  });

  it("does not let a person from another tenant join", async () => {
    const group = await aGroup();
    const outsider = await makeUser(db, otherOrg.id, {
      first: "Mira",
      last: "Dane",
      email: "mira.dane@example.test",
      roles: [Role.STUDENT],
    });

    await expect(
      addMember(db, org, principal, { group, user: await withRoles(outsider.id) }),
    ).rejects.toThrow("must be in this organization");
  });

  it("names a member by ref, not by name", async () => {
    const group = await aGroup();
    await addMember(db, org, principal, { group, user: student });

    const event = await db.auditEvent.findFirstOrThrow({
      where: { action: "group.member_added" },
    });
    const serialised = JSON.stringify(event.changes);

    expect(serialised).toContain(student.ref);
    expect(serialised).not.toContain(student.firstName);
    expect(serialised).not.toContain(student.email);
  });

  it("removes a member outright", async () => {
    const group = await aGroup();
    const member = await addMember(db, org, principal, { group, user: student });

    await removeMember(db, principal, { group, member });

    expect(await countMembers(db, group.id, "student")).toBe(0);
    expect(
      await db.auditEvent.findFirst({ where: { action: "group.member_removed" } }),
    ).not.toBeNull();
  });

  it("hides an archived group without deleting it", async () => {
    const group = await aGroup();
    const archived = await archiveGroup(db, principal, { group });

    expect(archived.archivedAt).not.toBeNull();
    expect(await db.group.findUnique({ where: { id: group.id } })).not.toBeNull();
  });

  it("keeps an archived group's name reserved", async () => {
    // `uq_group_org_name` is unconditional in both services — it does not
    // exclude archived rows — so the name stays taken. The service's own clash
    // check ignores archived groups and would allow the reuse; the database is
    // what actually decides, and it refuses. Recorded here because the two
    // disagreeing is surprising enough to be worth a test rather than a
    // comment, and because the reference behaves identically.
    const group = await aGroup();
    await archiveGroup(db, principal, { group });

    await expect(
      createGroup(db, org, principal, { name: "Wednesday Maths" }),
    ).rejects.toThrow();
  });

  // --- Locations -----------------------------------------------------------

  it("creates a location and trims its name", async () => {
    const location = await createLocation(db, org, principal, {
      name: "  Study Room A  ",
      address: " 12 Fictional Way ",
    });

    expect(location.name).toBe("Study Room A");
    expect(location.address).toBe("12 Fictional Way");
  });

  it("refuses a duplicate location name", async () => {
    await createLocation(db, org, principal, { name: "Study Room A" });
    await expect(
      createLocation(db, org, principal, { name: "study room a" }),
    ).rejects.toThrow("already exists here");
  });

  it("stores an empty address as nothing rather than a blank", async () => {
    const location = await createLocation(db, org, principal, {
      name: "Study Room B",
      address: "   ",
    });
    expect(location.address).toBeNull();
  });

  it("keeps an archived location for the sessions held there", async () => {
    const location = await createLocation(db, org, principal, { name: "Study Room C" });
    const archived = await archiveLocation(db, principal, { location });

    expect(archived.archivedAt).not.toBeNull();
    expect(await db.location.findUnique({ where: { id: location.id } })).not.toBeNull();
  });

  it("does not let an instructor create a location", async () => {
    await expect(
      createLocation(db, org, instructorPrincipal, { name: "Theirs" }),
    ).rejects.toThrow("structure.manage");
  });

  it("refuses a school from another tenant", async () => {
    const theirSchool = await db.school.create({
      data: { ref: "sch_elsewhere1", organizationId: otherOrg.id, name: "Elsewhere High" },
    });

    await expect(
      createLocation(db, org, principal, {
        name: "Borrowed Room",
        schoolId: theirSchool.id,
      }),
    ).rejects.toThrow("no such school");
  });
});
