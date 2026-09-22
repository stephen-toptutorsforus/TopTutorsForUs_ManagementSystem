/**
 * School-scoped authority: who a school admin and a principal may see.
 *
 * Organization is still the tenant. Another school's session or person is
 * 404, never 403. Super admin is unscoped. These hold the write and the
 * list against the same helper, because a list that hides a row the write
 * still finds is half a rule.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, ParticipantRole, Role } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import { createStaff, createStudent, setPlacements } from "@/lib/services/enrolment";
import { findPerson } from "@/lib/services/personAdmin";
import { listPeople } from "@/lib/services/peopleQuery";
import { EMPTY_FILTERS, listSessions, visibleSessions } from "@/lib/services/sessionQuery";
import { resolveCivil } from "@/lib/time";
import { bookingContext } from "@/lib/web/booking";
import { newRef } from "@/lib/ref";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-06-01";

describeDb("school-scoped authority", () => {
  let db: PrismaClient;
  let org: Awaited<ReturnType<typeof makeOrganization>>;
  let north: { id: bigint; ref: string; organizationId: bigint };
  let south: { id: bigint; ref: string; organizationId: bigint };
  let adminId: bigint;
  let schoolAdminId: bigint;
  let ada: { id: bigint; ref: string };
  let bruno: { id: bigint; ref: string };
  let northSession: { id: bigint; ref: string };
  let southSession: { id: bigint; ref: string };

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
      roles: [Role.ADMIN],
    });
    adminId = admin.id;

    const schoolAdmin = await makeUser(db, org.id, {
      first: "Keiko",
      last: "Nash",
      roles: [Role.SCHOOL_ADMIN],
    });
    schoolAdminId = schoolAdmin.id;

    const instructor = await makeUser(db, org.id, {
      first: "Imani",
      last: "Okafor",
      roles: [Role.INSTRUCTOR],
    });
    ada = await makeUser(db, org.id, {
      first: "Ada",
      last: "Fenwick",
      roles: [Role.STUDENT],
    });
    bruno = await makeUser(db, org.id, {
      first: "Bruno",
      last: "Salas",
      roles: [Role.STUDENT],
    });

    north = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Northgate High" },
    });
    south = await db.school.create({
      data: { ref: newRef("sch"), organizationId: org.id, name: "Riverbend Middle" },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: schoolAdmin.id, schoolId: north.id },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: ada.id, schoolId: north.id },
    });
    await db.userSchool.create({
      data: { organizationId: org.id, userId: bruno.id, schoolId: south.id },
    });

    const at = (time: string) => resolveCivil(MONDAY, time, NY).instant;
    northSession = await db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title: "North maths",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: at("14:00"),
        scheduledEnd: at("15:00"),
        timezone: NY,
        status: "SCHEDULED",
        instructorId: instructor.id,
      },
    });
    southSession = await db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title: "South maths",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: at("16:00"),
        scheduledEnd: at("17:00"),
        timezone: NY,
        status: "SCHEDULED",
        instructorId: instructor.id,
      },
    });
    await db.sessionParticipant.create({
      data: {
        organizationId: org.id,
        sessionId: northSession.id,
        userId: ada.id,
        role: ParticipantRole.STUDENT,
      },
    });
    await db.sessionParticipant.create({
      data: {
        organizationId: org.id,
        sessionId: southSession.id,
        userId: bruno.id,
        role: ParticipantRole.STUDENT,
      },
    });
  });

  it("lists only the sessions whose students are at the viewer's school", async () => {
    const principal = await loadPrincipal(db, schoolAdminId);
    const page = await listSessions(db, principal, EMPTY_FILTERS, { zone: NY });
    expect(page.rows.map((row) => row.session.ref).sort()).toEqual([northSession.ref]);

    const hidden = await db.sessionOccurrence.findFirst({
      where: { ...visibleSessions(principal), ref: southSession.ref },
    });
    expect(hidden).toBeNull();
  });

  it("still lists every session to a super admin", async () => {
    const principal = await loadPrincipal(db, adminId);
    const page = await listSessions(db, principal, EMPTY_FILTERS, { zone: NY });
    expect(page.rows.map((row) => row.session.ref).sort()).toEqual(
      [northSession.ref, southSession.ref].sort(),
    );
  });

  it("lists only the people placed at the viewer's school", async () => {
    const principal = await loadPrincipal(db, schoolAdminId);
    const surnames = (await listPeople(db, principal)).map((row) => row.user.lastName);
    expect(new Set(surnames)).toEqual(new Set(["Nash", "Fenwick"]));
  });

  it("404s another school's person rather than confirming they exist", async () => {
    const principal = await loadPrincipal(db, schoolAdminId);
    expect(await findPerson(db, principal, bruno.ref)).toBeNull();
    expect(await findPerson(db, principal, ada.ref)).not.toBeNull();
  });

  it("forces the booking form onto the school admin's school", async () => {
    const principal = await loadPrincipal(db, schoolAdminId);
    const drawn = await bookingContext(db, principal, org, {
      day: null,
      fromTime: "16:00",
      instructorRef: "",
      matrixDays: 7,
    });
    expect(drawn.schools.map((school) => school.ref)).toEqual([north.ref]);
    expect(drawn.chosenSchoolRef).toBe(north.ref);
    expect(drawn.students.map((person) => person.ref)).toEqual([ada.ref]);
  });

  it("requires exactly one school when granting school admin", async () => {
    const principal = await loadPrincipal(db, adminId);
    await expect(
      createStaff(db, org, principal, {
        role: Role.SCHOOL_ADMIN,
        firstName: "Ines",
        lastName: "Marek",
        email: "ines.marek@example.test",
      }),
    ).rejects.toThrow("exactly one school");

    const created = await createStaff(db, org, principal, {
      role: Role.SCHOOL_ADMIN,
      firstName: "Ines",
      lastName: "Marek",
      email: "ines.marek@example.test",
      schools: [north],
    });
    expect(created.roles.map((grant) => grant.role)).toEqual([Role.SCHOOL_ADMIN]);
  });

  it("refuses a school admin granting school admin or principal", async () => {
    const principal = await loadPrincipal(db, schoolAdminId);
    await expect(
      createStaff(db, org, principal, {
        role: Role.SCHOOL_ADMIN,
        firstName: "Ines",
        lastName: "Marek",
        email: "ines.marek@example.test",
        schools: [north],
      }),
    ).rejects.toThrow("only an administrator may grant");
    await expect(
      createStaff(db, org, principal, {
        role: Role.PRINCIPAL,
        firstName: "Otto",
        lastName: "Vale",
        email: "otto.vale@example.test",
        schools: [north],
      }),
    ).rejects.toThrow("only an administrator may grant");
  });

  it("refuses a school admin placing a student at another school", async () => {
    const principal = await loadPrincipal(db, schoolAdminId);
    await expect(
      createStudent(db, org, principal, {
        firstName: "Chiara",
        lastName: "Volpe",
        email: "chiara.volpe@example.test",
        schools: [south],
      }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(
      createStudent(db, org, principal, {
        firstName: "Chiara",
        lastName: "Volpe",
        email: "chiara.volpe@example.test",
      }),
    ).rejects.toThrow("place this person at your school");
  });

  it("refuses moving a school admin off their one school", async () => {
    const principal = await loadPrincipal(db, adminId);
    const person = await db.user.findUniqueOrThrow({
      where: { id: schoolAdminId },
      include: { roles: true },
    });
    await expect(
      setPlacements(db, org, principal, { person, schools: [] }),
    ).rejects.toThrow("exactly one school");
    await expect(
      setPlacements(db, org, principal, { person, schools: [north, south] }),
    ).rejects.toThrow("exactly one school");
  });
});
