/**
 * Principal loading and tenant scoping, against a real database.
 *
 * The half of `tests/test_authorization.py` that needs one. A principal is
 * built from live rows on every request, so the properties worth pinning are
 * about *freshness* — a demotion, an archival, a configuration change taking
 * effect immediately rather than when a cookie expires.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { Role, UserStatus } from "@/generated/prisma/enums";
import { Forbidden, NotFound, Unauthenticated } from "@/lib/errors";
import { Permission as P, resolve } from "@/lib/policies/permissions";
import { Principal, loadPrincipal } from "@/lib/policies/principal";
import { fetchScoped, scoped } from "@/lib/policies/scoping";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";

function principalFor(organizationId: bigint, roles: Role[] = [Role.ADMIN]): Principal {
  const roleSet = new Set(roles);
  return new Principal({
    userId: 1n,
    userRef: "usr_test",
    organizationId,
    organizationRef: "org_test",
    displayName: "Test Person",
    roles: roleSet,
    permissions: resolve(roleSet),
    regionIds: new Set(),
    timezone: NY,
  });
}

describeDb("loading a principal", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let instructor: { id: bigint; ref: string };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });
    instructor = await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      roles: [Role.INSTRUCTOR],
    });
  });

  it("reflects live roles, not a stale token", async () => {
    const before = await loadPrincipal(db, instructor.id);
    expect(before.roles).toEqual(new Set([Role.INSTRUCTOR]));

    await db.userRole.create({
      data: { organizationId: org.id, userId: instructor.id, role: Role.ADMIN },
    });

    const after = await loadPrincipal(db, instructor.id);
    expect(after.roles).toEqual(new Set([Role.ADMIN, Role.INSTRUCTOR]));
    // The new role takes effect immediately.
    expect(after.has(P.SESSION_VIEW_ANY)).toBe(true);
  });

  it("refuses an archived user", async () => {
    await db.user.update({
      where: { id: instructor.id },
      data: { archivedAt: new Date() },
    });

    await expect(loadPrincipal(db, instructor.id)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it("refuses a disabled user", async () => {
    await db.user.update({
      where: { id: instructor.id },
      data: { status: UserStatus.DISABLED },
    });

    await expect(loadPrincipal(db, instructor.id)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it("stops a tenant's users the moment the tenant is archived", async () => {
    await db.organization.update({
      where: { id: org.id },
      data: { archivedAt: new Date() },
    });

    await expect(loadPrincipal(db, instructor.id)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it("refuses a user with no role", async () => {
    const stranger = await makeUser(db, org.id, {
      first: "Ines",
      last: "Quiroga",
      roles: [],
    });

    await expect(loadPrincipal(db, stranger.id)).rejects.toBeInstanceOf(Forbidden);
  });

  it("refuses a user who does not exist", async () => {
    await expect(loadPrincipal(db, 987_654_321n)).rejects.toBeInstanceOf(Unauthenticated);
  });

  it("reflects tenant configuration in the permission set", async () => {
    await db.organization.update({
      where: { id: org.id },
      data: { settings: { booking: { who_can_book: ["admin"] } } },
    });

    const principal = await loadPrincipal(db, instructor.id);
    expect(principal.has(P.SESSION_BOOK)).toBe(false);
    expect(() => principal.require(P.SESSION_BOOK)).toThrow("session.book");
  });

  it("loads the schools this person is placed at", async () => {
    const school = await db.school.create({
      data: { ref: "sch_north1", organizationId: org.id, name: "Northgate High" },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: instructor.id, schoolId: school.id },
    });

    const principal = await loadPrincipal(db, instructor.id);
    expect(principal.schoolIds).toEqual(new Set([school.id]));
  });

  it("falls back to the organization's timezone when the person has none", async () => {
    const principal = await loadPrincipal(db, instructor.id);
    expect(principal.timezone).toBe(NY);

    await db.user.update({
      where: { id: instructor.id },
      data: { timezone: "America/Los_Angeles" },
    });
    const moved = await loadPrincipal(db, instructor.id);
    expect(moved.timezone).toBe("America/Los_Angeles");
  });
});

describeDb("tenant scoping", () => {
  let db: PrismaClient;
  let org: { id: bigint };
  let otherOrg: { id: bigint };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY, name: "Northgate Learning Collective" });
    otherOrg = await makeOrganization(db, {
      timezone: "America/Los_Angeles",
      name: "Harbour Point Tutoring",
    });
  });

  it("never crosses a tenant", async () => {
    await makeUser(db, org.id, { first: "Ana", last: "Reyes", roles: [Role.ADMIN] });
    await makeUser(db, otherOrg.id, { first: "Bo", last: "Fischer", roles: [Role.ADMIN] });

    const here = principalFor(org.id);
    const found = await db.user.findMany({ where: scoped(here) });

    expect(found.length).toBe(1);
    expect(new Set(found.map((u) => u.organizationId))).toEqual(new Set([org.id]));
  });

  it("answers not-found for another tenant's record", async () => {
    const theirs = await makeUser(db, otherOrg.id, {
      first: "Cass",
      last: "Lindqvist",
      roles: [Role.ADMIN],
    });

    const here = principalFor(org.id);
    await expect(
      fetchScoped(db.user, here, { ref: theirs.ref, label: "user" }),
    ).rejects.toBeInstanceOf(NotFound);
  });

  it("finds the tenant's own record by ref", async () => {
    const ours = await makeUser(db, org.id, {
      first: "Dev",
      last: "Anand",
      roles: [Role.ADMIN],
    });

    const found = await fetchScoped(db.user, principalFor(org.id), {
      ref: ours.ref,
      label: "user",
    });
    expect(found.id).toBe(ours.id);
  });

  it("hides an archived record unless asked for", async () => {
    const gone = await makeUser(db, org.id, {
      first: "Eun",
      last: "Park",
      roles: [Role.ADMIN],
    });
    await db.user.update({ where: { id: gone.id }, data: { archivedAt: new Date() } });

    const here = principalFor(org.id);
    await expect(
      fetchScoped(db.user, here, { ref: gone.ref, label: "user" }),
    ).rejects.toBeInstanceOf(NotFound);

    const found = await fetchScoped(db.user, here, {
      ref: gone.ref,
      label: "user",
      includeArchived: true,
    });
    expect(found.id).toBe(gone.id);
  });

  it("refuses to be called without exactly one of ref or id", async () => {
    const here = principalFor(org.id);
    await expect(fetchScoped(db.user, here, { label: "user" })).rejects.toThrow(
      "exactly one",
    );
    await expect(
      fetchScoped(db.user, here, { ref: "usr_x", id: 1n, label: "user" }),
    ).rejects.toThrow("exactly one");
  });
});
