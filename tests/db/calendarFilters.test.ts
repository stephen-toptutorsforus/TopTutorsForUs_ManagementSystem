/**
 * Filtering the calendar by who, against a real database.
 *
 * The calendar has always called the *full* `parseFilters`, so `instructor` was
 * read on this screen from the day it was written — and `queryString` never
 * wrote it back and `calendarRange` never looked at it. A value could reach the
 * cookie and be gone by the next render. A drawer that offers a filter which
 * narrows nothing is worse than one that does not offer it, so the query side
 * is pinned here and the serialisation side in `tests/calendar.test.ts`.
 *
 * The case that matters most is the unknown ref. "Narrow to nothing" and
 * "ignore it" are the same code path right up until somebody mistypes a link,
 * and then one of them quietly shows the whole tenant.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, ParticipantRole, Role } from "@/generated/prisma/enums";
import { loadPrincipal } from "@/lib/policies/principal";
import { EMPTY_FILTERS, calendarRange } from "@/lib/services/sessionQuery";
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

describeDb("narrowing the calendar by who", () => {
  let db: PrismaClient;
  let org: { id: bigint };
  let admin: { id: bigint };
  let marguerite: { ref: string; id: bigint };
  let tobias: { ref: string; id: bigint };
  let ada: { ref: string; id: bigint };
  let bruno: { ref: string; id: bigint };

  const at = (time: string) => resolveCivil(MONDAY, time, NY).instant;

  /** Every session the calendar draws for this filter, by title. */
  async function titles(filters: Partial<typeof EMPTY_FILTERS>) {
    const principal = await loadPrincipal(db, admin.id);
    const buckets = await calendarRange(db, principal, {
      first: MONDAY,
      last: MONDAY,
      zone: NY,
      filters: { ...EMPTY_FILTERS, ...filters },
    });
    return [...buckets.values()]
      .flat()
      .map((row) => row.session.title)
      .sort();
  }

  async function book(title: string, instructorId: bigint, studentId: bigint, hour: string) {
    const session = await db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title,
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: at(hour),
        scheduledEnd: at(hour === "09:00" ? "10:00" : "15:00"),
        timezone: NY,
        status: "SCHEDULED",
        instructorId,
      },
    });
    await db.sessionParticipant.create({
      data: {
        organizationId: org.id,
        sessionId: session.id,
        userId: studentId,
        role: ParticipantRole.STUDENT,
      },
    });
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
    marguerite = await makeUser(db, org.id, {
      first: "Marguerite",
      last: "Okonjo",
      roles: [Role.INSTRUCTOR],
    });
    tobias = await makeUser(db, org.id, {
      first: "Tobias",
      last: "Lindqvist",
      roles: [Role.INSTRUCTOR],
    });
    ada = await makeUser(db, org.id, { first: "Ada", last: "Fenwick", roles: [Role.STUDENT] });
    bruno = await makeUser(db, org.id, { first: "Bruno", last: "Salas", roles: [Role.STUDENT] });

    await book("Marguerite and Ada", marguerite.id, ada.id, "09:00");
    await book("Tobias and Bruno", tobias.id, bruno.id, "14:00");
  });

  it("draws everything when nothing is asked of it", async () => {
    expect(await titles({})).toEqual(["Marguerite and Ada", "Tobias and Bruno"]);
  });

  it("narrows to one instructor", async () => {
    expect(await titles({ instructorRef: marguerite.ref })).toEqual(["Marguerite and Ada"]);
  });

  it("narrows to one student", async () => {
    // A relation rather than a column: the student is on the participant table,
    // which is why this could not simply copy the instructor's ref lookup.
    expect(await titles({ studentRef: bruno.ref })).toEqual(["Tobias and Bruno"]);
  });

  it("asks both at once, and means and", async () => {
    expect(await titles({ instructorRef: marguerite.ref, studentRef: bruno.ref })).toEqual([]);
    expect(await titles({ instructorRef: marguerite.ref, studentRef: ada.ref })).toEqual([
      "Marguerite and Ada",
    ]);
  });

  it("narrows to nothing for a ref that names nobody", async () => {
    // Not "ignores it". A mistyped or stale link must not quietly widen the
    // calendar back out to the whole tenant.
    expect(await titles({ instructorRef: "usr_nobody" })).toEqual([]);
    expect(await titles({ studentRef: "usr_nobody" })).toEqual([]);
  });

  it("will not reach another tenant's person", async () => {
    const elsewhere = await makeOrganization(db, { name: "Harbour Point", timezone: NY });
    const theirs = await makeUser(db, elsewhere.id, {
      first: "Bo",
      last: "Fischer",
      roles: [Role.STUDENT],
    });
    expect(await titles({ studentRef: theirs.ref })).toEqual([]);
    expect(await titles({ instructorRef: theirs.ref })).toEqual([]);
  });
});
