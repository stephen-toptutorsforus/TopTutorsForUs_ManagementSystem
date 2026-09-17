/**
 * What a session's row *contains*, as opposed to whether it can be read at all.
 *
 * `visibleSessions` decides which sessions a person may open and has been
 * tested since it was written. Nothing decided what was inside one, so
 * `decorate` handed back every student's name to whoever asked — and a student
 * holding nothing but `session.view_own` was served their classmates' names on
 * the calendar, the dashboard, the grid, both record screens and the JSON API.
 *
 * There was no database test over `sessionQuery` at all, which is the reason
 * that went unseen: the narrowing it does happens in SQL against real rows, so
 * a pure test cannot reach it. This file is that suite.
 *
 * The shape being pinned is "name self, count others". The count is deliberate
 * and is not a leak — somebody in a group of three already knows there are
 * three of them — and it is what keeps a group lesson from being drawn as a
 * one-to-one beside an attendance rate that plainly came from more than one
 * person.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, ParticipantRole, Role } from "@/generated/prisma/enums";
import { loadPrincipal } from "@/lib/policies/principal";
import { calendarRange, decorate } from "@/lib/services/sessionQuery";
import { resolveCivil } from "@/lib/time";

import {
  TEST_DATABASE_URL,
  makeOrganization,
  makeUser,
  newRef,
  reset,
  testClient,
} from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const MONDAY = "2026-06-01";

describeDb("who a session says is on it", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let admin: { id: bigint };
  let instructor: { id: bigint };
  let other: { id: bigint };
  let ada: { id: bigint };
  let bruno: { id: bigint };
  let chiara: { id: bigint };
  let guardian: { id: bigint };
  let session: { id: bigint };

  const at = (time: string) => resolveCivil(MONDAY, time, NY).instant;

  /** The decorated row for one person, which is what every screen renders. */
  async function rowFor(viewer: { id: bigint }) {
    const principal = await loadPrincipal(db, viewer.id);
    const occurrence = await db.sessionOccurrence.findUniqueOrThrow({
      where: { id: session.id },
    });
    const [row] = await decorate(db, principal, [occurrence]);
    return row!;
  }

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });

    admin = await makeUser(db, org.id, { first: "Rowan", last: "Mercer", roles: [Role.ADMIN] });
    instructor = await makeUser(db, org.id, {
      first: "Marguerite",
      last: "Okonjo",
      roles: [Role.INSTRUCTOR],
    });
    other = await makeUser(db, org.id, {
      first: "Tobias",
      last: "Lindqvist",
      roles: [Role.INSTRUCTOR],
    });
    ada = await makeUser(db, org.id, { first: "Ada", last: "Fenwick", roles: [Role.STUDENT] });
    bruno = await makeUser(db, org.id, { first: "Bruno", last: "Salas", roles: [Role.STUDENT] });
    chiara = await makeUser(db, org.id, {
      first: "Chiara",
      last: "Volpe",
      roles: [Role.STUDENT],
    });
    guardian = await makeUser(db, org.id, {
      first: "Renata",
      last: "Silva",
      roles: [Role.PARENT],
    });

    // A guardian of one member of the group and not the others. One ward out of
    // three is the case that matters: guarding everybody and guarding nobody
    // both pass a rule that does nothing.
    await db.guardianStudent.create({
      data: { organizationId: org.id, guardianId: guardian.id, studentId: ada.id },
    });

    session = await db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title: "The Wednesday pod",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: at("14:00"),
        scheduledEnd: at("15:00"),
        timezone: NY,
        status: "SCHEDULED",
        instructorId: instructor.id,
      },
    });

    for (const student of [ada, bruno, chiara]) {
      await db.sessionParticipant.create({
        data: {
          organizationId: org.id,
          sessionId: session.id,
          userId: student.id,
          role: ParticipantRole.STUDENT,
        },
      });
    }
  });

  it("names the whole group to an administrator", async () => {
    const row = await rowFor(admin);
    expect(row.studentNames.slice().sort()).toEqual([
      "Ada Fenwick",
      "Bruno Salas",
      "Chiara Volpe",
    ]);
    expect(row.studentCount).toBe(3);
  });

  it("names the whole group to the instructor teaching it", async () => {
    // They are in the room. `owns` is the same test every `*_own` permission is
    // decided by, so this cannot drift away from who may mark the attendance.
    const row = await rowFor(instructor);
    expect(row.studentNames).toHaveLength(3);
    expect(row.studentCount).toBe(3);
  });

  it("names a student only themselves, and counts the rest", async () => {
    const row = await rowFor(ada);
    expect(row.studentNames).toEqual(["Ada Fenwick"]);
    expect(row.studentCount).toBe(3);
  });

  it("never lets a classmate's name through to a student", async () => {
    // The assertion the whole file exists for, stated as an absence rather than
    // as an equality: an equality can pass for the wrong reason the day the
    // shape of the row changes.
    const row = await rowFor(ada);
    expect(row.studentNames.join(" ")).not.toContain("Bruno");
    expect(row.studentNames.join(" ")).not.toContain("Chiara");
  });

  it("names a guardian their own child and nobody else's", async () => {
    const row = await rowFor(guardian);
    expect(row.studentNames).toEqual(["Ada Fenwick"]);
    expect(row.studentCount).toBe(3);
    expect(row.studentNames.join(" ")).not.toContain("Salas");
  });

  it("tells an instructor who is not on it nothing, if they reach it at all", async () => {
    // `visibleSessions` already keeps this session off their calendar. Asserted
    // anyway, because `decorate` is exported and the next caller may not have
    // filtered first — a rule that only holds when it is approached from the
    // right direction is not a rule.
    const row = await rowFor(other);
    expect(row.studentNames).toEqual([]);
    expect(row.studentCount).toBe(3);
  });

  it("keeps the attendance rate over everybody, not over the visible few", async () => {
    // Two of three present. Narrowing the rows before counting would show the
    // student 100% — a different number wearing this session's label, and one
    // that contradicts the "and 2 others" printed beside it.
    const rows = await db.sessionParticipant.findMany({
      where: { sessionId: session.id },
      orderBy: { id: "asc" },
    });
    await db.sessionParticipant.update({
      where: { id: rows[0]!.id },
      data: { attendance: "PRESENT" },
    });
    await db.sessionParticipant.update({
      where: { id: rows[1]!.id },
      data: { attendance: "PRESENT" },
    });
    await db.sessionParticipant.update({
      where: { id: rows[2]!.id },
      data: { attendance: "ABSENT" },
    });

    const staff = await rowFor(admin);
    const student = await rowFor(ada);
    expect(student.attendanceRate).toBeCloseTo(2 / 3);
    expect(student.attendanceRate).toBe(staff.attendanceRate);
  });

  it("narrows on the calendar too, which is where most people read it", async () => {
    const principal = await loadPrincipal(db, ada.id);
    const buckets = await calendarRange(db, principal, {
      first: MONDAY,
      last: MONDAY,
      zone: NY,
    });
    const rows = [...buckets.values()].flat();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.studentNames).toEqual(["Ada Fenwick"]);
    expect(rows[0]!.studentCount).toBe(3);
  });

  it("leaves a one-to-one alone", async () => {
    // The common session. Nothing is withheld and nothing is counted, so the
    // student's row is the administrator's row.
    const solo = await db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title: "Fractions catch-up",
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
        sessionId: solo.id,
        userId: bruno.id,
        role: ParticipantRole.STUDENT,
      },
    });

    const asStudent = await decorate(db, await loadPrincipal(db, bruno.id), [solo]);
    const asAdmin = await decorate(db, await loadPrincipal(db, admin.id), [solo]);
    expect(asStudent[0]!.studentNames).toEqual(["Bruno Salas"]);
    expect(asStudent[0]!.studentNames).toEqual(asAdmin[0]!.studentNames);
    expect(asStudent[0]!.studentCount).toBe(1);
  });
});
