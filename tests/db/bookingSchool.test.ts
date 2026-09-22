/**
 * Booking narrowed by school: the student list, the rooms, and the write.
 *
 * The school is a narrowing control, not a column on the session. These hold
 * the four answers the form has to get right: the list shrinks, a student
 * from another school cannot be posted, no school chosen keeps the full list,
 * and eligibility still refuses independently.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { Role } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import { assertStudentsAtSchool } from "@/lib/services/enrolment";
import { INELIGIBLE_INSTRUCTOR, assertEligible } from "@/lib/services/instructorEligibility";
import { newRef } from "@/lib/ref";
import { bookingContext } from "@/lib/web/booking";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";

describeDb("booking narrowed by school", () => {
  let db: PrismaClient;
  let org: Awaited<ReturnType<typeof makeOrganization>>;
  let adminId: bigint;
  let north: { id: bigint; ref: string; organizationId: bigint };
  let south: { id: bigint; ref: string; organizationId: bigint };
  let ada: { id: bigint; ref: string };
  let bruno: { id: bigint; ref: string };
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
    const admin = await makeUser(db, org.id, {
      first: "Rowan",
      last: "Mercer",
      email: "rowan.mercer@example.test",
      roles: [Role.ADMIN],
    });
    adminId = admin.id;
    instructor = await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      email: "imani.okafor@example.test",
      roles: [Role.INSTRUCTOR],
    });
    ada = await makeUser(db, org.id, {
      first: "Ada",
      last: "Fenwick",
      email: "ada.fenwick@example.test",
      roles: [Role.STUDENT],
    });
    bruno = await makeUser(db, org.id, {
      first: "Bruno",
      last: "Salas",
      email: "bruno.salas@example.test",
      roles: [Role.STUDENT],
    });

    north = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Northgate High" },
    });
    south = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Riverbend Middle" },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: ada.id, schoolId: north.id },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: bruno.id, schoolId: south.id },
    });

    await db.location.create({
      data: {
        ref: newRef("loc"),
        organizationId: org.id,
        name: "North Room",
        schoolId: north.id,
      },
    });
    await db.location.create({
      data: {
        ref: newRef("loc"),
        organizationId: org.id,
        name: "South Room",
        schoolId: south.id,
      },
    });
    await db.location.create({
      data: { ref: newRef("loc"), organizationId: org.id, name: "Shared Hall" },
    });
  });

  async function context(schoolRef?: string) {
    const principal = await loadPrincipal(db, adminId);
    return bookingContext(db, principal, org, {
      day: null,
      fromTime: "16:00",
      instructorRef: "",
      matrixDays: 7,
      schoolRef,
    });
  }

  it("keeps the full student list when no school is chosen", async () => {
    const drawn = await context();
    expect(drawn.students.map((person) => person.ref).sort()).toEqual(
      [ada.ref, bruno.ref].sort(),
    );
    expect(drawn.locations.map((room) => room.label).sort()).toEqual(
      ["North Room", "Shared Hall", "South Room"].sort(),
    );
    expect(drawn.chosenSchoolRef).toBe("");
  });

  it("narrows students and rooms to the chosen school", async () => {
    const drawn = await context(north.ref);
    expect(drawn.students.map((person) => person.ref)).toEqual([ada.ref]);
    expect(drawn.locations.map((room) => room.label).sort()).toEqual(
      ["North Room", "Shared Hall"].sort(),
    );
    expect(drawn.chosenSchoolRef).toBe(north.ref);
  });

  it("narrows the roster to nothing for an unknown school", async () => {
    const drawn = await context("sch_nobody");
    expect(drawn.students).toEqual([]);
    expect(drawn.locations).toEqual([]);
    expect(drawn.chosenSchoolRef).toBe("");
  });

  it("refuses a student who is not at the chosen school", async () => {
    await expect(
      assertStudentsAtSchool(db, org, north, [bruno.id]),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(assertStudentsAtSchool(db, org, north, [bruno.id])).rejects.toThrow(
      "not at this school",
    );
    await expect(assertStudentsAtSchool(db, org, north, [ada.id])).resolves.toBeUndefined();
  });

  it("still refuses an ineligible instructor after a school is chosen", async () => {
    const principal = await loadPrincipal(db, adminId);
    await expect(
      assertEligible(db, {
        organization: org,
        principal,
        instructorId: instructor.id,
        studentIds: [ada.id],
      }),
    ).rejects.toThrow(INELIGIBLE_INSTRUCTOR);
  });
});
