/**
 * What the series list says, and who it says it to.
 *
 * `listSeries` had no test of any kind — no database test, no pure test, and no
 * browser test renders either series screen. That is the whole reason three
 * separate wrong answers sat in one function: a visibility rule that differs
 * from the one every other session surface uses, a count that reads archived
 * rows, and a schedule taken from the template rather than from the sessions
 * the template produced.
 *
 * The rule being pinned by the first half is that **there is one answer to
 * "may I see this series"**. `visibleSessions` is that answer everywhere else,
 * including on `/series/[ref]`, and a list that narrows differently from the
 * page it links to is a list that either hides a record somebody may read or
 * offers one they may not.
 *
 * The second half pins that **the grid reads the occurrences**. A series row is
 * a template: it holds one start time and one length however many weekdays the
 * run actually carries, and nothing updates it when an occurrence is moved. The
 * occurrences own their own schedule, so they are what the screen must ask.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  DeliveryType,
  ParticipantRole,
  RecurrenceEndMode,
  RecurrenceFrequency,
  Role,
} from "@/generated/prisma/enums";
import { loadPrincipal } from "@/lib/policies/principal";
import { listSeries, visibleSessions } from "@/lib/services/sessionQuery";
import { dateToDb, resolveCivil, timeToDb } from "@/lib/time";

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

/** A Monday, so "+2 days" is a Wednesday and the weekday names are readable. */
const MONDAY = "2026-06-01";
const WEDNESDAY = "2026-06-03";

describeDb("the series list", () => {
  let db: PrismaClient;
  let org: { id: bigint };
  let elsewhere: { id: bigint };
  let admin: { id: bigint };
  let owner: { id: bigint };
  let cover: { id: bigint };
  let stranger: { id: bigint };
  let ada: { id: bigint };
  let bruno: { id: bigint };
  let guardian: { id: bigint };

  const at = (day: string, time: string) => resolveCivil(day, time, NY).instant;

  /** A series row, with whatever the caller wants to say about the template. */
  async function makeSeries(
    organizationId: bigint,
    overrides: {
      title?: string;
      instructorId?: bigint | null;
      weekdays?: string[];
      startTime?: string;
      durationMinutes?: number;
    } = {},
  ) {
    return db.sessionSeries.create({
      data: {
        ref: newRef("ser"),
        organizationId,
        title: overrides.title ?? "Tuesday reading group",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        defaultDurationMinutes: overrides.durationMinutes ?? 60,
        timezone: NY,
        frequency: RecurrenceFrequency.WEEKLY,
        intervalN: 1,
        weekdays: overrides.weekdays ?? ["mon"],
        startDate: dateToDb(MONDAY),
        startTime: timeToDb(overrides.startTime ?? "16:00"),
        endMode: RecurrenceEndMode.COUNT,
        occurrenceCount: 4,
        defaultInstructorId: overrides.instructorId ?? null,
        classroomConfig: {},
      },
    });
  }

  /** One generated occurrence, which is what actually carries the schedule. */
  async function makeOccurrence(
    organizationId: bigint,
    series: { id: bigint },
    options: {
      day: string;
      time: string;
      minutes?: number;
      instructorId?: bigint | null;
      index?: number;
      archived?: boolean;
    },
  ) {
    const start = at(options.day, options.time);
    const minutes = options.minutes ?? 60;
    return db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId,
        seriesId: series.id,
        seriesIndex: options.index ?? 1,
        title: "Tuesday reading group",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: start,
        scheduledEnd: new Date(start.getTime() + minutes * 60_000),
        timezone: NY,
        status: "SCHEDULED",
        instructorId: options.instructorId ?? null,
        archivedAt: options.archived ? new Date() : null,
      },
    });
  }

  async function enrol(sessionId: bigint, userId: bigint, organizationId: bigint) {
    await db.sessionParticipant.create({
      data: { organizationId, sessionId, userId, role: ParticipantRole.STUDENT },
    });
  }

  /** The titles one person is offered, which is the whole of what the grid is. */
  async function titlesFor(viewer: { id: bigint }): Promise<string[]> {
    const principal = await loadPrincipal(db, viewer.id);
    const rows = await listSeries(db, principal);
    return rows.map((row) => row.series.title).sort();
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
    elsewhere = await makeOrganization(db, { timezone: NY, name: "Harbour Point" });

    admin = await makeUser(db, org.id, { first: "Rowan", last: "Mercer", roles: [Role.ADMIN] });
    owner = await makeUser(db, org.id, {
      first: "Marguerite",
      last: "Okonjo",
      roles: [Role.INSTRUCTOR],
    });
    cover = await makeUser(db, org.id, {
      first: "Tobias",
      last: "Lindqvist",
      roles: [Role.INSTRUCTOR],
    });
    stranger = await makeUser(db, org.id, {
      first: "Kofi",
      last: "Mensah",
      roles: [Role.INSTRUCTOR],
    });
    ada = await makeUser(db, org.id, { first: "Ada", last: "Fenwick", roles: [Role.STUDENT] });
    bruno = await makeUser(db, org.id, { first: "Bruno", last: "Salas", roles: [Role.STUDENT] });
    guardian = await makeUser(db, org.id, {
      first: "Delphine",
      last: "Arceneaux",
      roles: [Role.PARENT],
    });
    await db.guardianStudent.create({
      data: { organizationId: org.id, guardianId: guardian.id, studentId: ada.id },
    });
  });

  describe("who it is shown to", () => {
    beforeEach(async () => {
      // Ada's series, taught by its default instructor.
      const hers = await makeSeries(org.id, { title: "Ada's reading", instructorId: owner.id });
      const adaSession = await makeOccurrence(org.id, hers, {
        day: MONDAY,
        time: "16:00",
        instructorId: owner.id,
      });
      await enrol(adaSession.id, ada.id, org.id);

      // Bruno's, with nobody Ada is connected to on it.
      const his = await makeSeries(org.id, { title: "Bruno's algebra", instructorId: owner.id });
      const brunoSession = await makeOccurrence(org.id, his, {
        day: MONDAY,
        time: "18:00",
        instructorId: owner.id,
      });
      await enrol(brunoSession.id, bruno.id, org.id);

      // A run whose default instructor is one person and whose session is
      // covered by another. The cover teacher is on the session and is not the
      // template's instructor, which is precisely the case the old rule missed.
      const covered = await makeSeries(org.id, {
        title: "Covered geometry",
        instructorId: owner.id,
      });
      await makeOccurrence(org.id, covered, {
        day: WEDNESDAY,
        time: "16:00",
        instructorId: cover.id,
      });

      // Another tenant's, which nobody here may ever see.
      const theirs = await makeSeries(elsewhere.id, { title: "Harbour Point history" });
      await makeOccurrence(elsewhere.id, theirs, { day: MONDAY, time: "16:00" });
    });

    it("shows an administrator the whole tenant, and no other", async () => {
      expect(await titlesFor(admin)).toEqual([
        "Ada's reading",
        "Bruno's algebra",
        "Covered geometry",
      ]);
    });

    it("shows a student the series they are actually on", async () => {
      // Empty before this change: a student is never a `defaultInstructorId`,
      // so the screen the sidebar offered them could not have had a row in it.
      expect(await titlesFor(ada)).toEqual(["Ada's reading"]);
    });

    it("shows a guardian their ward's, and not the child beside them", async () => {
      expect(await titlesFor(guardian)).toEqual(["Ada's reading"]);
    });

    it("shows an instructor a series they cover but do not own", async () => {
      // The second half of the same bug. `defaultInstructorId` is the template's
      // instructor; who is teaching is a fact about the occurrence.
      expect(await titlesFor(cover)).toEqual(["Covered geometry"]);
    });

    it("shows the default instructor the runs they are actually teaching", async () => {
      // And not "Covered geometry", whose every session went to somebody else.
      //
      // This is a real narrowing, and it is the right one: `/series/[ref]` has
      // always refused that series to this person, because the page is built
      // from occurrences they may see and there are none. Listing a record
      // whose own page answers 404 is the disagreement this whole change
      // exists to remove, so the list follows the page rather than the page
      // being widened to follow the list. Anybody who needs the wider view of
      // a template holds `SESSION_VIEW_ANY`.
      expect(await titlesFor(owner)).toEqual(["Ada's reading", "Bruno's algebra"]);
    });

    it("shows an unconnected instructor nothing", async () => {
      expect(await titlesFor(stranger)).toEqual([]);
    });

    it("admits exactly what the detail page admits", async () => {
      // The two used to disagree, which is how a list could be empty on a
      // screen whose records were readable one link further in. Asserted as an
      // equality so neither can be widened alone.
      for (const viewer of [admin, owner, cover, ada, guardian, stranger]) {
        const principal = await loadPrincipal(db, viewer.id);
        const listed = (await listSeries(db, principal)).map((row) => row.series.id);

        const readable = await db.sessionSeries.findMany({
          where: {
            organizationId: principal.organizationId,
            archivedAt: null,
            occurrences: { some: { archivedAt: null } },
          },
          select: { id: true },
        });
        const openable: bigint[] = [];
        for (const series of readable) {
          const count = await db.sessionOccurrence.count({
            where: { ...visibleSessions(principal), seriesId: series.id },
          });
          if (count > 0) openable.push(series.id);
        }

        expect(listed.slice().sort(), String(viewer.id)).toEqual(openable.slice().sort());
      }
    });
  });

  describe("what it counts", () => {
    it("ignores an archived occurrence when counting late arrivals", async () => {
      // Every other tally in this function filters `archivedAt`; the late one
      // did not, so a deleted session went on inflating the column beside rows
      // that had stopped counting it.
      const series = await makeSeries(org.id, { instructorId: owner.id });
      const live = await makeOccurrence(org.id, series, {
        day: MONDAY,
        time: "16:00",
        instructorId: owner.id,
        index: 1,
      });
      const gone = await makeOccurrence(org.id, series, {
        day: WEDNESDAY,
        time: "16:00",
        instructorId: owner.id,
        index: 2,
        archived: true,
      });

      for (const session of [live, gone]) {
        await db.sessionParticipant.create({
          data: {
            organizationId: org.id,
            sessionId: session.id,
            userId: ada.id,
            role: ParticipantRole.STUDENT,
            attendance: "LATE",
          },
        });
      }

      const [row] = await listSeries(db, await loadPrincipal(db, admin.id));
      expect(row!.total).toBe(1);
      expect(row!.late).toBe(1);
    });
  });

  describe("what schedule it reports", () => {
    it("reads one weekday, time and length from the sessions themselves", async () => {
      const series = await makeSeries(org.id, { instructorId: owner.id });
      await makeOccurrence(org.id, series, {
        day: MONDAY,
        time: "16:00",
        instructorId: owner.id,
        index: 1,
      });
      await makeOccurrence(org.id, series, {
        day: "2026-06-08",
        time: "16:00",
        instructorId: owner.id,
        index: 2,
      });

      const [row] = await listSeries(db, await loadPrincipal(db, admin.id));
      expect(row!.schedule.weekdays).toEqual(["mon"]);
      expect(row!.schedule.startTimes).toEqual(["16:00"]);
      expect(row!.schedule.durations).toEqual([60]);
    });

    it("reports both halves of a run whose weekdays carry their own times", async () => {
      // "Mondays at four for an hour, Wednesdays at half five for thirty
      // minutes" is one series, and the template can only hold the first of
      // them — `perWeekday` is consumed when the occurrences are generated and
      // never stored. Before this change the grid said Mon, Wed at 16:00 for an
      // hour, which is wrong about every Wednesday of the run.
      const series = await makeSeries(org.id, {
        instructorId: owner.id,
        weekdays: ["mon", "wed"],
        startTime: "16:00",
        durationMinutes: 60,
      });
      await makeOccurrence(org.id, series, {
        day: MONDAY,
        time: "16:00",
        minutes: 60,
        instructorId: owner.id,
        index: 1,
      });
      await makeOccurrence(org.id, series, {
        day: WEDNESDAY,
        time: "17:30",
        minutes: 30,
        instructorId: owner.id,
        index: 2,
      });

      const [row] = await listSeries(db, await loadPrincipal(db, admin.id));
      expect(row!.schedule.weekdays).toEqual(["mon", "wed"]);
      expect(row!.schedule.startTimes).toEqual(["16:00", "17:30"]);
      expect(row!.schedule.durations).toEqual([30, 60]);
      expect(row!.schedule.byWeekday).toEqual([
        { weekday: "mon", startTimes: ["16:00"], durations: [60] },
        { weekday: "wed", startTimes: ["17:30"], durations: [30] },
      ]);
    });

    it("follows an occurrence that was moved on its own", async () => {
      // The template is not rewritten when one session is rescheduled, so a
      // screen reading the template goes on describing a time nothing happens
      // at any more.
      const series = await makeSeries(org.id, { instructorId: owner.id });
      await makeOccurrence(org.id, series, {
        day: MONDAY,
        time: "16:00",
        instructorId: owner.id,
        index: 1,
      });
      const moved = await makeOccurrence(org.id, series, {
        day: "2026-06-08",
        time: "16:00",
        instructorId: owner.id,
        index: 2,
      });
      const to = at(WEDNESDAY, "09:15");
      await db.sessionOccurrence.update({
        where: { id: moved.id },
        data: {
          scheduledStart: to,
          scheduledEnd: new Date(to.getTime() + 90 * 60_000),
          detachedFromSeries: true,
        },
      });

      const [row] = await listSeries(db, await loadPrincipal(db, admin.id));
      expect(row!.schedule.weekdays).toEqual(["mon", "wed"]);
      expect(row!.schedule.startTimes).toEqual(["09:15", "16:00"]);
      expect(row!.schedule.durations).toEqual([60, 90]);
    });

    it("shows staff a series that never had an occurrence, and nobody else", async () => {
      // An import writes these: a Pearl export carries no reference from a
      // session back to the series that produced it, so an imported series
      // arrives with nothing attached. Without this it would be written into a
      // place nobody could look at.
      //
      // Staff only, which keeps the rule the visibility clause exists for — a
      // student still cannot tell an empty series from one they are not on.
      await makeSeries(org.id, { title: "Imported, nothing attached", instructorId: owner.id });

      expect(await titlesFor(admin)).toContain("Imported, nothing attached");
      expect(await titlesFor(ada)).not.toContain("Imported, nothing attached");
      expect(await titlesFor(guardian)).not.toContain("Imported, nothing attached");
      expect(await titlesFor(owner)).not.toContain("Imported, nothing attached");
    });

    it("says nothing rather than guessing when every occurrence is archived", async () => {
      const series = await makeSeries(org.id, { instructorId: owner.id });
      await makeOccurrence(org.id, series, {
        day: MONDAY,
        time: "16:00",
        instructorId: owner.id,
        archived: true,
      });

      const rows = await listSeries(db, await loadPrincipal(db, admin.id));
      // Still not listed, and the distinction is deliberate: this series *has*
      // occurrence rows, they are archived. `{ occurrences: { none: {} } }`
      // admits only a series that never had one, so an archived-out run does
      // not come back through the door opened for imports.
      expect(rows).toEqual([]);
    });
  });
});
