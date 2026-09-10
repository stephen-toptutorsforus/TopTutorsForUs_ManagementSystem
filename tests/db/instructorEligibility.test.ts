/**
 * Who may teach whom, against the real database.
 *
 * Every case here is about the *relationship* question, never the calendar one:
 * nobody in this file has any declared availability, and that is deliberate.
 * An instructor who is eligible and completely unbookable must still come back
 * from this service, because the booking screen shows the two separately and
 * the messages a person reads depend on the difference.
 *
 * The cross-tenant cases are the ones worth reading twice. A relationship row
 * belonging to another organization must not merely fail to help — it must be
 * invisible, so that neither a wider nor a narrower list is a signal that it
 * exists.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { Role, UserStatus } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import {
  EligibilityMode,
  INELIGIBLE_INSTRUCTOR,
  assertEligible,
  eligibleInstructors,
  resolveRosterFromRefs,
} from "@/lib/services/instructorEligibility";
import { newRef } from "@/lib/ref";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

type Person = { id: bigint; ref: string };

describeDb("instructor eligibility", () => {
  let db: PrismaClient;
  let org: { id: bigint; settings: Record<string, unknown> };
  let otherOrg: { id: bigint };
  let admin: Principal;

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  /** The organization, with whichever mode this case is about. */
  async function mode(named: EligibilityMode | null): Promise<void> {
    const settings =
      named === null ? {} : { booking: { instructor_eligibility_mode: named } };
    await db.organization.update({ where: { id: org.id }, data: { settings } });
    org = { ...org, settings };
  }

  async function ask(options: {
    studentIds?: bigint[];
    groupId?: bigint | null;
  }): Promise<string[]> {
    const result = await eligibleInstructors(db, {
      organization: org,
      principal: admin,
      ...options,
    });
    return result.instructors.map((person) => person.ref).sort();
  }

  beforeEach(async () => {
    await reset(db);
    const created = await makeOrganization(db);
    org = { id: created.id, settings: {} };
    otherOrg = await makeOrganization(db, { slug: newRef("slug") });
    const who = await makeUser(db, created.id, { roles: [Role.ADMIN] });
    admin = await loadPrincipal(db, who.id);
  });

  const instructor = (overrides: Parameters<typeof makeUser>[2] = {}) =>
    makeUser(db, org.id, { roles: [Role.INSTRUCTOR], ...overrides });
  const student = (overrides: Parameters<typeof makeUser>[2] = {}) =>
    makeUser(db, org.id, { roles: [Role.STUDENT], ...overrides });

  async function assign(who: Person, whom: Person, archived = false) {
    await db.instructorStudent.create({
      data: {
        organizationId: org.id,
        instructorId: who.id,
        studentId: whom.id,
        archivedAt: archived ? new Date() : null,
      },
    });
  }

  // --- assigned_only --------------------------------------------------------

  describe("assigned_only", () => {
    beforeEach(async () => {
      await mode(EligibilityMode.ASSIGNED_ONLY);
    });

    it("offers the assigned instructor and not the unassigned one", async () => {
      const assigned = await instructor();
      const stranger = await instructor();
      const learner = await student();
      await assign(assigned, learner);

      expect(await ask({ studentIds: [learner.id] })).toEqual([assigned.ref]);
      expect(await ask({ studentIds: [learner.id] })).not.toContain(stranger.ref);
    });

    it("does not count an archived assignment", async () => {
      const former = await instructor();
      const learner = await student();
      await assign(former, learner, true);

      expect(await ask({ studentIds: [learner.id] })).toEqual([]);
    });

    it("leaves out an instructor whose account is not active", async () => {
      // Assigned, and still not bookable: an account that cannot sign in
      // cannot teach, and offering it books a session with nobody to run it.
      const disabled = await instructor({ status: UserStatus.DISABLED });
      const invited = await instructor({ status: UserStatus.INVITED });
      const active = await instructor();
      const learner = await student();
      for (const who of [disabled, invited, active]) await assign(who, learner);

      expect(await ask({ studentIds: [learner.id] })).toEqual([active.ref]);
    });

    it("leaves out an archived instructor", async () => {
      const gone = await instructor();
      const learner = await student();
      await assign(gone, learner);
      await db.user.update({ where: { id: gone.id }, data: { archivedAt: new Date() } });

      expect(await ask({ studentIds: [learner.id] })).toEqual([]);
    });

    it("needs an assignment to every student, not to one of them", async () => {
      // The intersection. Teaching three of four is not a partial pass: the
      // fourth would be taught by somebody the tenant said may not.
      const both = await instructor();
      const half = await instructor();
      const one = await student();
      const two = await student();
      await assign(both, one);
      await assign(both, two);
      await assign(half, one);

      expect(await ask({ studentIds: [one.id] }).then((r) => r.sort())).toEqual(
        [both.ref, half.ref].sort(),
      );
      expect(await ask({ studentIds: [one.id, two.id] })).toEqual([both.ref]);
    });

    it("counts a group's members as students", async () => {
      const teaches = await instructor();
      const stranger = await instructor();
      const member = await student();
      await assign(teaches, member);
      const group = await db.group.create({
        data: { ref: newRef("grp"), organizationId: org.id, name: "Tuesday Reading" },
      });
      await db.groupMember.create({
        data: {
          organizationId: org.id,
          groupId: group.id,
          userId: member.id,
          memberRole: "student",
        },
      });

      expect(await ask({ groupId: group.id })).toEqual([teaches.ref]);
      expect(await ask({ groupId: group.id })).not.toContain(stranger.ref);
    });

    it("counts somebody in the group and chosen individually only once", async () => {
      // Otherwise the intersection would demand two matching assignments for
      // one person and drop a perfectly eligible instructor.
      const teaches = await instructor();
      const member = await student();
      await assign(teaches, member);
      const group = await db.group.create({
        data: { ref: newRef("grp"), organizationId: org.id, name: "Overlap" },
      });
      await db.groupMember.create({
        data: {
          organizationId: org.id,
          groupId: group.id,
          userId: member.id,
          memberRole: "student",
        },
      });

      expect(await ask({ studentIds: [member.id], groupId: group.id })).toEqual([
        teaches.ref,
      ]);
    });

    it("offers every active instructor while no student is chosen", async () => {
      const one = await instructor();
      const two = await instructor();
      await student();

      const result = await eligibleInstructors(db, { organization: org, principal: admin });
      expect(result.instructors.map((p) => p.ref).sort()).toEqual([one.ref, two.ref].sort());
      expect(result.narrowed).toBe(false);
    });

    it("never counts an assignment made in another tenant", async () => {
      const ours = await instructor();
      const learner = await student();
      const theirInstructor = await makeUser(db, otherOrg.id, { roles: [Role.INSTRUCTOR] });
      // A row that links their instructor to our student. It must not widen the
      // list, and it must not narrow it either.
      await db.instructorStudent.create({
        data: {
          organizationId: otherOrg.id,
          instructorId: theirInstructor.id,
          studentId: learner.id,
        },
      });

      expect(await ask({ studentIds: [learner.id] })).toEqual([]);
      await assign(ours, learner);
      expect(await ask({ studentIds: [learner.id] })).toEqual([ours.ref]);
    });

    it("ignores a group belonging to another tenant", async () => {
      const ours = await instructor();
      const theirGroup = await db.group.create({
        data: { ref: newRef("grp"), organizationId: otherOrg.id, name: "Theirs" },
      });
      const theirStudent = await makeUser(db, otherOrg.id, { roles: [Role.STUDENT] });
      await db.groupMember.create({
        data: {
          organizationId: otherOrg.id,
          groupId: theirGroup.id,
          userId: theirStudent.id,
          memberRole: "student",
        },
      });

      // Their group resolves to nothing, so the roster is empty and the answer
      // is the ordinary unfiltered one — not a hint that the group exists.
      const result = await eligibleInstructors(db, {
        organization: org,
        principal: admin,
        groupId: theirGroup.id,
      });
      expect(result.instructors.map((p) => p.ref)).toEqual([ours.ref]);
      expect(result.narrowed).toBe(false);
    });
  });

  // --- shared_structure -----------------------------------------------------

  describe("shared_structure", () => {
    let region: { id: bigint };
    let district: { id: bigint };
    let school: { id: bigint };

    beforeEach(async () => {
      await mode(EligibilityMode.SHARED_STRUCTURE);
      region = await db.region.create({
        data: { ref: newRef("reg"), organizationId: org.id, name: "North Region" },
      });
      district = await db.district.create({
        data: {
          ref: newRef("dis"),
          organizationId: org.id,
          name: "Riverbend District",
          regionId: region.id,
        },
      });
      school = await db.school.create({
        data: {
          ref: newRef("sch"),
          organizationId: org.id,
          name: "Northgate High",
          districtId: district.id,
        },
      });
    });

    const place = {
      school: (who: Person) =>
        db.userSchool.create({
          data: { organizationId: org.id, userId: who.id, schoolId: school.id },
        }),
      district: (who: Person) =>
        db.userDistrict.create({
          data: { organizationId: org.id, userId: who.id, districtId: district.id },
        }),
      region: (who: Person) =>
        db.userRegion.create({
          data: { organizationId: org.id, userId: who.id, regionId: region.id },
        }),
    };

    it.each(["school", "district", "region"] as const)(
      "matches on a shared %s",
      async (level) => {
        const together = await instructor();
        const apart = await instructor();
        const learner = await student();
        await place[level](together);
        await place[level](learner);

        expect(await ask({ studentIds: [learner.id] })).toEqual([together.ref]);
        expect(await ask({ studentIds: [learner.id] })).not.toContain(apart.ref);
      },
    );

    it("does not match two people placed at different levels of the same tree", async () => {
      // A school is inside the district which is inside the region, but the
      // rule compares the placement tables rather than walking the hierarchy.
      // The seed writes all three rows for this reason; see prisma/seed.ts.
      const regional = await instructor();
      const schooled = await student();
      await place.region(regional);
      await place.school(schooled);

      expect(await ask({ studentIds: [schooled.id] })).toEqual([]);
    });

    it("refuses rather than widening when a student has no placement", async () => {
      // The tenant has a hierarchy; this student is simply not in it. Falling
      // back to everybody here would hide a gap in their data behind a list
      // that looks fine.
      const placed = await instructor();
      const unplaced = await student();
      await place.school(placed);

      const result = await eligibleInstructors(db, {
        organization: org,
        principal: admin,
        studentIds: [unplaced.id],
      });
      expect(result.instructors).toEqual([]);
      expect(result.narrowed).toBe(true);
    });

    it("falls back to every active instructor when the tenant has no hierarchy", async () => {
      await db.userSchool.deleteMany({});
      await db.school.deleteMany({});
      await db.district.deleteMany({});
      await db.region.deleteMany({});
      const one = await instructor();
      const learner = await student();

      const result = await eligibleInstructors(db, {
        organization: org,
        principal: admin,
        studentIds: [learner.id],
      });
      expect(result.instructors.map((p) => p.ref)).toEqual([one.ref]);
      // Not narrowed: nothing filtered, so nothing should be blamed for the
      // list, and the screen must not say a roster limited it.
      expect(result.narrowed).toBe(false);
    });

    it("needs a shared placement with every student", async () => {
      const schoolOnly = await instructor();
      const both = await instructor();
      await place.school(schoolOnly);
      await place.school(both);
      await place.region(both);

      const atSchool = await student();
      const inRegion = await student();
      await place.school(atSchool);
      await place.region(inRegion);

      expect(await ask({ studentIds: [atSchool.id, inRegion.id] })).toEqual([both.ref]);
    });

    it("never counts a placement row from another tenant", async () => {
      const ours = await instructor();
      const learner = await student();
      const theirRegion = await db.region.create({
        data: { ref: newRef("reg"), organizationId: otherOrg.id, name: "Elsewhere" },
      });
      // Both rows belong to the other tenant, which is the shape a leak would
      // take: two of our people made to look co-located by somebody else's data.
      for (const who of [ours, learner]) {
        await db.userRegion.create({
          data: { organizationId: otherOrg.id, userId: who.id, regionId: theirRegion.id },
        });
      }

      expect(await ask({ studentIds: [learner.id] })).toEqual([]);
    });
  });

  // --- any_instructor and the older boolean ---------------------------------

  describe("any_instructor", () => {
    it("returns every active instructor whatever the roster is", async () => {
      await mode(EligibilityMode.ANY_INSTRUCTOR);
      const one = await instructor();
      const two = await instructor();
      await instructor({ status: UserStatus.DISABLED });
      const learner = await student();

      const result = await eligibleInstructors(db, {
        organization: org,
        principal: admin,
        studentIds: [learner.id],
      });
      expect(result.instructors.map((p) => p.ref).sort()).toEqual([one.ref, two.ref].sort());
      expect(result.narrowed).toBe(false);
    });
  });

  describe("backward compatibility", () => {
    it("honours assigned_users_only when no mode is configured", async () => {
      await db.organization.update({
        where: { id: org.id },
        data: { settings: { booking: { assigned_users_only: true } } },
      });
      org = { ...org, settings: { booking: { assigned_users_only: true } } };

      const assigned = await instructor();
      const stranger = await instructor();
      const learner = await student();
      await assign(assigned, learner);

      expect(await ask({ studentIds: [learner.id] })).toEqual([assigned.ref]);

      const relaxed = { booking: { assigned_users_only: false } };
      await db.organization.update({ where: { id: org.id }, data: { settings: relaxed } });
      org = { ...org, settings: relaxed };
      expect(await ask({ studentIds: [learner.id] })).toEqual(
        [assigned.ref, stranger.ref].sort(),
      );
    });
  });

  // --- refusal --------------------------------------------------------------

  describe("assertEligible", () => {
    beforeEach(async () => {
      await mode(EligibilityMode.ASSIGNED_ONLY);
    });

    it("passes an assigned instructor and refuses an unassigned one", async () => {
      const assigned = await instructor();
      const stranger = await instructor();
      const learner = await student();
      await assign(assigned, learner);

      const ask = (who: Person) =>
        assertEligible(db, {
          organization: org,
          principal: admin,
          studentIds: [learner.id],
          instructorId: who.id,
        });

      await expect(ask(assigned)).resolves.toBeUndefined();
      await expect(ask(stranger)).rejects.toThrow(INELIGIBLE_INSTRUCTOR);
      await expect(ask(stranger)).rejects.toBeInstanceOf(ValidationError);
    });

    it("names neither the student nor the assignment in the refusal", async () => {
      // The chooser may not be entitled to know which assignments exist, and a
      // message that lists them is a disclosure dressed as help.
      const stranger = await instructor();
      const learner = await student({ first: "Amara", last: "Okonkwo" });

      await expect(
        assertEligible(db, {
          organization: org,
          principal: admin,
          studentIds: [learner.id],
          instructorId: stranger.id,
        }),
      ).rejects.toThrow(/^The selected instructor is not eligible/);
      expect(INELIGIBLE_INSTRUCTOR).not.toMatch(/Amara|Okonkwo/);
    });

    it("tells a disabled account apart from an ineligible one", async () => {
      const disabled = await instructor({ status: UserStatus.DISABLED });
      const learner = await student();
      await assign(disabled, learner);

      await expect(
        assertEligible(db, {
          organization: org,
          principal: admin,
          studentIds: [learner.id],
          instructorId: disabled.id,
        }),
      ).rejects.toThrow(/account is not active/);
    });

    it("has nothing to refuse when no instructor is chosen", async () => {
      const learner = await student();
      await expect(
        assertEligible(db, {
          organization: org,
          principal: admin,
          studentIds: [learner.id],
          instructorId: null,
        }),
      ).resolves.toBeUndefined();
    });
  });

  // --- the screen's own resolver --------------------------------------------

  describe("resolveRosterFromRefs", () => {
    it("drops a ref it cannot resolve rather than raising", async () => {
      // This path draws a picker. A stale or foreign ref in a form field must
      // narrow nothing and disclose nothing; the write path refuses instead.
      const ours = await student();
      const theirs = await makeUser(db, otherOrg.id, { roles: [Role.STUDENT] });

      const roster = await resolveRosterFromRefs(db, admin, {
        studentRefs: [ours.ref, theirs.ref, "usr_nothing"],
      });
      expect(roster).toEqual([ours.id]);
    });

    it("expands a group and deduplicates against the individual choices", async () => {
      const member = await student();
      const alone = await student();
      const group = await db.group.create({
        data: { ref: newRef("grp"), organizationId: org.id, name: "Wednesday" },
      });
      await db.groupMember.create({
        data: {
          organizationId: org.id,
          groupId: group.id,
          userId: member.id,
          memberRole: "student",
        },
      });

      const roster = await resolveRosterFromRefs(db, admin, {
        studentRefs: [member.ref, alone.ref],
        groupRef: group.ref,
      });
      expect(roster.sort()).toEqual([member.id, alone.id].sort());
    });
  });
});
