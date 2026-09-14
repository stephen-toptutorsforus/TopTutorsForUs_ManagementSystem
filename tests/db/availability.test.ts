/**
 * Resolving an instructor's availability — the three layers and their bounds.
 *
 * Ported from the availability cases in the Python suite. The layers resolve
 * narrowest last: the weekly rule, then a dated exception that replaces or
 * removes it, then time off that blocks whatever it covers — with the
 * organization's opening hours and closures bounding all three.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType } from "@/generated/prisma/enums";
import {
  dayGrid,
  isAvailable,
  matrix,
  openings,
  organizationOffDays,
  resolveDay,
  resolveRange,
  weekdayGrid,
} from "@/lib/availability";
import { busyIntervals } from "@/lib/conflicts";
import { addDays, dateToDb, resolveCivil, timeToDb, toZone } from "@/lib/time";

import {
  makeOrganization,
  makeUser,
  newRef,
  reset,
  TEST_DATABASE_URL,
  testClient,
} from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri"] as const;

describeDb("availability", () => {
  let db: PrismaClient;
  let org: { id: bigint; timezone: string };
  let instructor: { id: bigint };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: NY });
    instructor = await makeUser(db, org.id);
  });

  async function openWeekdays(from = "08:00", to = "20:00") {
    for (const weekday of WEEKDAYS) {
      await db.organizationAvailability.create({
        data: {
          organizationId: org.id,
          weekday,
          startTime: timeToDb(from),
          endTime: timeToDb(to),
        },
      });
    }
  }

  async function declare(weekday: string, from: string, to: string, extra = {}) {
    return db.availabilityRule.create({
      data: {
        ref: newRef("avr"),
        organizationId: org.id,
        instructorId: instructor.id,
        weekday,
        startTime: timeToDb(from),
        endTime: timeToDb(to),
        timezone: NY,
        ...extra,
      },
    });
  }

  /** 2026-06-01 is a Monday, well away from either DST change. */
  const MONDAY = "2026-06-01";
  const at = (day: string, time: string) => resolveCivil(day, time, NY).instant;

  /** A booking that holds its slot, for the cases about what is already taken. */
  async function book(
    day: string,
    from: string,
    to: string,
    overrides: Record<string, unknown> = {},
  ) {
    return db.sessionOccurrence.create({
      data: {
        ref: newRef("ses"),
        organizationId: org.id,
        title: "Fractions review",
        deliveryType: DeliveryType.EXTERNAL_LINK,
        scheduledStart: at(day, from),
        scheduledEnd: at(day, to),
        timezone: NY,
        status: "SCHEDULED",
        instructorId: instructor.id,
        ...overrides,
      },
    });
  }

  /** Every booking the given span could contain, as the grids ask for it. */
  const bookedOver = (from: string, days: number) =>
    busyIntervals(db, org, [instructor.id], at(from, "00:00"), at(addDays(from, days), "00:00"));

  const candidate = () => ({
    id: instructor.id,
    ref: "usr_grid",
    firstName: "Imani",
    lastName: "Okafor",
  });

  describe("the weekly rule", () => {
    it("produces a window in the instructor's own zone", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(1);
      expect(toZone(day.windows[0]!.start, NY).toFormat("HH:mm")).toBe("09:00");
      expect(toZone(day.windows[0]!.end, NY).toFormat("HH:mm")).toBe("17:00");
    });

    it("says so when nothing has been declared", async () => {
      await openWeekdays();

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(0);
      expect(day.closedReason).toBe("no availability declared");
    });

    it("does not apply a rule that has not started yet", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00", { effectiveFrom: dateToDb("2026-09-01") });

      expect((await resolveDay(db, org, instructor.id, MONDAY)).windows).toHaveLength(0);
      expect(
        (await resolveDay(db, org, instructor.id, "2026-09-07")).windows,
      ).toHaveLength(1);
    });

    it("does not apply a rule that has expired", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00", { effectiveUntil: dateToDb("2026-05-01") });

      expect((await resolveDay(db, org, instructor.id, MONDAY)).windows).toHaveLength(0);
    });
  });

  describe("the organization's bounds", () => {
    it("clips a window to the opening hours", async () => {
      // An instructor narrows the organization's hours; they can never widen
      // them.
      await openWeekdays("09:00", "17:00");
      await declare("mon", "07:00", "23:00");

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(toZone(day.windows[0]!.start, NY).toFormat("HH:mm")).toBe("09:00");
      expect(toZone(day.windows[0]!.end, NY).toFormat("HH:mm")).toBe("17:00");
    });

    it("closes the day entirely when the two do not meet", async () => {
      await openWeekdays("09:00", "17:00");
      await declare("mon", "19:00", "23:00");

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(0);
      expect(day.closedReason).toBe("outside the organization's opening hours");
    });

    it("closes the day on a closure, and names it", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await db.offDay.create({
        data: { organizationId: org.id, day: dateToDb(MONDAY), label: "Staff training day" },
      });

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(0);
      expect(day.closedReason).toBe("Staff training day");
    });

    it("lists closures in a range for the recurrence preview", async () => {
      await db.offDay.create({
        data: { organizationId: org.id, day: dateToDb("2026-06-03"), label: "Closed" },
      });
      await db.offDay.create({
        data: { organizationId: org.id, day: dateToDb("2026-08-01"), label: "Out of range" },
      });

      const closures = await organizationOffDays(db, org.id, "2026-06-01", "2026-06-30");

      expect([...closures]).toEqual(["2026-06-03"]);
    });
  });

  describe("a dated exception", () => {
    it("removes the day when it says unavailable", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await db.availabilityException.create({
        data: {
          ref: newRef("avx"),
          organizationId: org.id,
          instructorId: instructor.id,
          day: dateToDb(MONDAY),
          isAvailable: false,
          note: "Conference",
        },
      });

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(0);
      expect(day.closedReason).toBe("unavailable on this date");
    });

    it("replaces the day's hours when it carries times", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await db.availabilityException.create({
        data: {
          ref: newRef("avx"),
          organizationId: org.id,
          instructorId: instructor.id,
          day: dateToDb(MONDAY),
          isAvailable: true,
          startTime: timeToDb("13:00"),
          endTime: timeToDb("15:00"),
          timezone: NY,
          note: "Half day",
        },
      });

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(1);
      expect(toZone(day.windows[0]!.start, NY).toFormat("HH:mm")).toBe("13:00");
      expect(toZone(day.windows[0]!.end, NY).toFormat("HH:mm")).toBe("15:00");
    });

    it("beats the weekly rule in both directions", async () => {
      // The next day is untouched, so the exception really is dated rather than
      // a change to the pattern.
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await declare("tue", "09:00", "17:00");
      await db.availabilityException.create({
        data: {
          ref: newRef("avx"),
          organizationId: org.id,
          instructorId: instructor.id,
          day: dateToDb(MONDAY),
          isAvailable: false,
        },
      });

      expect((await resolveDay(db, org, instructor.id, MONDAY)).windows).toHaveLength(0);
      expect(
        (await resolveDay(db, org, instructor.id, "2026-06-02")).windows,
      ).toHaveLength(1);
    });
  });

  describe("time off", () => {
    async function away(from: Date, to: Date) {
      await db.timeOff.create({
        data: {
          ref: newRef("off"),
          organizationId: org.id,
          instructorId: instructor.id,
          startsAt: from,
          endsAt: to,
          reason: "Annual leave",
        },
      });
    }

    it("removes the whole day when it covers it", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await away(at(MONDAY, "00:00"), at("2026-06-02", "00:00"));

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(0);
      expect(day.closedReason).toBe("time off");
    });

    it("splits a window it bisects", async () => {
      // An afternoon appointment leaves a morning and a late afternoon, not one
      // window with a hole in it that a booking could fall through.
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await away(at(MONDAY, "12:00"), at(MONDAY, "14:00"));

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(2);
      expect(toZone(day.windows[0]!.end, NY).toFormat("HH:mm")).toBe("12:00");
      expect(toZone(day.windows[1]!.start, NY).toFormat("HH:mm")).toBe("14:00");
    });

    it("trims a window it overlaps at one end", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await away(at(MONDAY, "08:00"), at(MONDAY, "11:00"));

      const day = await resolveDay(db, org, instructor.id, MONDAY);

      expect(day.windows).toHaveLength(1);
      expect(toZone(day.windows[0]!.start, NY).toFormat("HH:mm")).toBe("11:00");
    });
  });

  describe("answering a proposed booking", () => {
    beforeEach(async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
    });

    it("accepts a booking inside the window", async () => {
      const answer = await isAvailable(
        db,
        org,
        instructor.id,
        at(MONDAY, "10:00"),
        at(MONDAY, "11:00"),
      );

      expect(answer.available).toBe(true);
    });

    it("refuses one that starts before the window", async () => {
      const answer = await isAvailable(
        db,
        org,
        instructor.id,
        at(MONDAY, "08:00"),
        at(MONDAY, "10:00"),
      );

      expect(answer.available).toBe(false);
      expect(answer.reason).toBe("outside declared availability");
    });

    it("refuses one that runs past the end of it", async () => {
      const answer = await isAvailable(
        db,
        org,
        instructor.id,
        at(MONDAY, "16:30"),
        at(MONDAY, "17:30"),
      );

      expect(answer.available).toBe(false);
    });

    it("accepts one that sits exactly on the boundaries", async () => {
      const answer = await isAvailable(
        db,
        org,
        instructor.id,
        at(MONDAY, "09:00"),
        at(MONDAY, "17:00"),
      );

      expect(answer.available).toBe(true);
    });

    it("takes the date in the display zone, not in UTC", async () => {
      // 16:00 in New York is 20:00 UTC; bucketing by the UTC date would check
      // Monday evening against Tuesday's rule.
      const answer = await isAvailable(
        db,
        org,
        instructor.id,
        at(MONDAY, "16:00"),
        at(MONDAY, "17:00"),
        { displayZone: NY },
      );

      expect(answer.available).toBe(true);
    });

    it("gives the day's own reason when the day is shut", async () => {
      await db.offDay.create({
        data: { organizationId: org.id, day: dateToDb(MONDAY), label: "Winter break" },
      });

      const answer = await isAvailable(
        db,
        org,
        instructor.id,
        at(MONDAY, "10:00"),
        at(MONDAY, "11:00"),
      );

      expect(answer.available).toBe(false);
      expect(answer.reason).toBe("Winter break");
    });
  });

  describe("the grid", () => {
    it("returns one entry per day, open or not", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");

      const week = await matrix(db, org, instructor.id, MONDAY, 7);

      expect(week).toHaveLength(7);
      expect(week[0]!.windows).toHaveLength(1); // Monday
      expect(week[1]!.windows).toHaveLength(0); // Tuesday, nothing declared
      expect(week.map((d) => d.day)).toEqual([
        "2026-06-01",
        "2026-06-02",
        "2026-06-03",
        "2026-06-04",
        "2026-06-05",
        "2026-06-06",
        "2026-06-07",
      ]);
    });

    it("keeps the wall clock across a DST change", async () => {
      // The window is declared as wall-clock time plus a zone. Stored as
      // instants it would drift by an hour and start refusing bookings that
      // were fine the week before.
      await db.organizationAvailability.create({
        data: {
          organizationId: org.id,
          weekday: "sun",
          startTime: timeToDb("00:00"),
          endTime: timeToDb("23:59"),
        },
      });
      await declare("sun", "09:00", "17:00");

      const before = await resolveDay(db, org, instructor.id, "2026-03-01");
      const after = await resolveDay(db, org, instructor.id, "2026-03-15");

      expect(toZone(before.windows[0]!.start, NY).toFormat("HH:mm")).toBe("09:00");
      expect(toZone(after.windows[0]!.start, NY).toFormat("HH:mm")).toBe("09:00");
      // And the two instants are genuinely an hour apart in UTC terms.
      expect(before.windows[0]!.start.getUTCHours()).not.toBe(
        after.windows[0]!.start.getUTCHours(),
      );
    });
  });
  // --- The repeat grid ------------------------------------------------------
  //
  // One instructor, one row per weekday a repeating run falls on. It is the
  // table the booking form draws once a run has several days and a chosen
  // tutor, and the thing worth pinning is that each row is asked about its own
  // weekday's length on its own date — not all of them about the first row's.

  describe("weekdayGrid", () => {
    /** A Monday, so the weekdays below resolve predictably. */
    const MONDAY = "2026-04-06";

    beforeEach(async () => {
      await openWeekdays();
    });

    it("returns a row per weekday asked for, in date order", async () => {
      await declare("mon", "09:00", "17:00");
      await declare("wed", "09:00", "17:00");
      await declare("fri", "09:00", "17:00");

      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [
          { weekday: "fri", durationMinutes: 60 },
          { weekday: "mon", durationMinutes: 60 },
          { weekday: "wed", durationMinutes: 60 },
        ],
        { from: MONDAY, fromTime: "09:00", timezone: NY, columns: 4, stepMinutes: 60 },
      );

      // Asked out of order, answered in the order the run will happen.
      expect(grid.rows.map((row) => row.weekday)).toEqual(["mon", "wed", "fri"]);
      expect(grid.rows.map((row) => row.day)).toEqual([
        "2026-04-06",
        "2026-04-08",
        "2026-04-10",
      ]);
      expect(grid.columns.map((column) => column.value)).toEqual([
        "09:00",
        "10:00",
        "11:00",
        "12:00",
      ]);
    });

    it("sends a weekday earlier than the start date into the following week", async () => {
      // Never a date in the past: a Monday row on a run that starts on
      // Wednesday is next Monday, which is when it will first be taught.
      await declare("mon", "09:00", "17:00");
      await declare("wed", "09:00", "17:00");

      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [
          { weekday: "mon", durationMinutes: 60 },
          { weekday: "wed", durationMinutes: 60 },
        ],
        { from: "2026-04-08", fromTime: "09:00", timezone: NY, columns: 2, stepMinutes: 60 },
      );

      expect(grid.rows.map((row) => [row.weekday, row.day])).toEqual([
        ["wed", "2026-04-08"],
        ["mon", "2026-04-13"],
      ]);
    });

    it("tests each row against its own length, not the first row's", async () => {
      // The whole reason a per-day length exists. A window of exactly one hour
      // holds the 30-minute day twice over and the 90-minute day not at all.
      await declare("mon", "09:00", "10:00");
      await declare("wed", "09:00", "10:00");

      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [
          { weekday: "mon", durationMinutes: 90 },
          { weekday: "wed", durationMinutes: 30 },
        ],
        { from: MONDAY, fromTime: "09:00", timezone: NY, columns: 2, stepMinutes: 30 },
      );

      const [monday, wednesday] = grid.rows;
      expect(monday!.durationMinutes).toBe(90);
      expect(monday!.free).toEqual([false, false]);
      expect(wednesday!.durationMinutes).toBe(30);
      expect(wednesday!.free).toEqual([true, true]);
    });

    it("gives a shut day its own reason rather than an empty row", async () => {
      await declare("mon", "09:00", "17:00");
      // Wednesday has no rule at all, so it is closed for a stated reason.
      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [
          { weekday: "mon", durationMinutes: 60 },
          { weekday: "wed", durationMinutes: 60 },
        ],
        { from: MONDAY, fromTime: "09:00", timezone: NY, columns: 2, stepMinutes: 60 },
      );

      expect(grid.rows[0]!.free).toEqual([true, true]);
      expect(grid.rows[1]!.free).toEqual([false, false]);
      expect(grid.rows[1]!.closedReason).not.toBeNull();
    });

    it("keeps the whole day's axis on the date the clocks go forward", async () => {
      // The axis the booking form asks for: midnight, an hour a column, all
      // day. Built by adding an hour to an instant it would come back one
      // heading short on 8 March, so which headings the table had would depend
      // on which weekday happened to sort first.
      await declare("sun", "09:00", "17:00");

      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [{ weekday: "sun", durationMinutes: 60 }],
        { from: "2026-03-08", fromTime: "00:00", timezone: NY, columns: 24, stepMinutes: 60 },
      );

      expect(grid.columns).toHaveLength(24);
      expect(grid.columns[0]!.value).toBe("00:00");
      expect(grid.columns[2]!.label).toBe("2 AM");
      expect(grid.columns[23]!.value).toBe("23:00");
      // And it is still the declared window that decides, not the axis.
      expect(grid.rows[0]!.free.filter(Boolean)).toHaveLength(8);
    });

    it("asks every row about the same clock time, not the same instant", async () => {
      // Across a daylight-saving change the two are different questions, and
      // the header can only mean one of them. 8 March 2026 is the spring
      // forward in New York, so this run's Sunday and its Wednesday straddle it.
      await declare("sun", "09:00", "17:00");
      await declare("wed", "09:00", "17:00");

      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [
          { weekday: "sun", durationMinutes: 60 },
          { weekday: "wed", durationMinutes: 60 },
        ],
        { from: "2026-03-08", fromTime: "10:00", timezone: NY, columns: 2, stepMinutes: 60 },
      );

      expect(grid.columns.map((column) => column.value)).toEqual(["10:00", "11:00"]);
      // Both days are open at the clock times the header names, which is what
      // an instant-based comparison would have got wrong for one of them.
      for (const row of grid.rows) expect(row.free).toEqual([true, true]);
    });
  });
  // --- One rule, fed two ways ------------------------------------------------
  //
  // `resolveDay` and `resolveRange` exist so that a grid drawn for many people
  // over many days costs five statements instead of five per person per day.
  // They must not become two answers. These are the tripwire for that: the same
  // question, asked both ways, across every layer this module has.

  describe("the bulk resolver", () => {
    it("agrees with the single-day resolver across every layer", async () => {
      await openWeekdays("08:00", "20:00");
      await declare("mon", "09:00", "17:00");
      await declare("tue", "10:00", "12:00");
      await declare("wed", "09:00", "17:00");
      await declare("thu", "09:00", "17:00");
      // A dated exception on the Tuesday, time off across the Wednesday
      // afternoon, and a closure on the Thursday: one of each, so a
      // disagreement anywhere in the chain shows up here.
      await db.availabilityException.create({
        data: {
          ref: newRef("ave"),
          organizationId: org.id,
          instructorId: instructor.id,
          day: dateToDb("2026-06-02"),
          isAvailable: true,
          startTime: timeToDb("13:00"),
          endTime: timeToDb("15:00"),
          timezone: NY,
        },
      });
      await db.timeOff.create({
        data: {
          ref: newRef("tof"),
          organizationId: org.id,
          instructorId: instructor.id,
          startsAt: at("2026-06-03", "13:00"),
          endsAt: at("2026-06-03", "23:00"),
          reason: "away",
        },
      });
      await db.offDay.create({
        data: { organizationId: org.id, day: dateToDb("2026-06-04"), label: "Founders Day" },
      });

      const bulk = await resolveRange(db, org, [instructor.id], MONDAY, 7);

      for (let offset = 0; offset < 7; offset += 1) {
        const day = addDays(MONDAY, offset);
        const one = await resolveDay(db, org, instructor.id, day);
        const many = bulk.get(`${instructor.id}|${day}`)!;

        expect(many.closedReason, day).toBe(one.closedReason);
        expect(
          many.windows.map((window) => [window.start.toISOString(), window.end.toISOString()]),
          day,
        ).toEqual(
          one.windows.map((window) => [window.start.toISOString(), window.end.toISOString()]),
        );
      }
    });

    it("costs no more statements for many people than for one", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");

      const people = [instructor.id];
      for (let extra = 0; extra < 4; extra += 1) {
        people.push((await makeUser(db, org.id)).id);
      }

      // Five people over twenty-eight days against one person over one day.
      // The old shape resolved once per pair; this asserts the cost no longer
      // moves with either dimension.
      const wide = await resolveRange(db, org, people, MONDAY, 28);
      const narrow = await resolveRange(db, org, [instructor.id], MONDAY, 1);

      expect(wide.size).toBe(people.length * 28);
      expect(narrow.size).toBe(1);
    });
  });

  // --- What is already booked ------------------------------------------------

  describe("times already taken", () => {
    it("does not offer a start time the instructor is already teaching at", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await book(MONDAY, "10:00", "11:00");

      const grid = await dayGrid(db, org, [candidate()], {
        day: MONDAY,
        fromTime: "09:00",
        durationMinutes: 60,
        timezone: NY,
        columns: 4,
        stepMinutes: 60,
      });
      const withBusy = await dayGrid(db, org, [candidate()], {
        day: MONDAY,
        fromTime: "09:00",
        durationMinutes: 60,
        timezone: NY,
        columns: 4,
        stepMinutes: 60,
        busy: await bookedOver(MONDAY, 1),
      });

      // Declared hours alone say all four are free. They are not: 10 AM is
      // taken, and `instructor_busy` is a conflict no override clears.
      expect(grid.rows[0]!.free).toEqual([true, true, true, true]);
      expect(withBusy.rows[0]!.free).toEqual([true, false, true, true]);
      // And the table can say *why*, which is a different fix from "he does
      // not work then".
      expect(withBusy.rows[0]!.taken).toEqual([false, true, false, false]);
    });

    it("releases the slot when the session is cancelled", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await book(MONDAY, "10:00", "11:00", { status: "CANCELLED" });

      const grid = await dayGrid(db, org, [candidate()], {
        day: MONDAY,
        fromTime: "09:00",
        durationMinutes: 60,
        timezone: NY,
        columns: 4,
        stepMinutes: 60,
        busy: await bookedOver(MONDAY, 1),
      });

      // The same status list the exclusion constraint's predicate uses. A
      // cancelled session holds nothing — in the grid, the preview and the
      // database alike.
      expect(grid.rows[0]!.free).toEqual([true, true, true, true]);
    });

    it("does not count another tenant's booking", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      const other = await makeOrganization(db, { timezone: NY });
      const elsewhere = await makeUser(db, other.id);
      await book(MONDAY, "10:00", "11:00", {
        organizationId: other.id,
        instructorId: elsewhere.id,
      });

      const grid = await dayGrid(db, org, [candidate()], {
        day: MONDAY,
        fromTime: "09:00",
        durationMinutes: 60,
        timezone: NY,
        columns: 4,
        stepMinutes: 60,
        busy: await bookedOver(MONDAY, 1),
      });

      expect(grid.rows[0]!.free).toEqual([true, true, true, true]);
    });

    it("drops a day from the list when its only long-enough window is taken", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "11:00");
      // Two hours declared, half an hour taken out of the middle: nothing 90
      // minutes long survives, so this is not a day to look at.
      await book(MONDAY, "09:45", "10:15");

      const before = await openings(db, org, [candidate()], {
        start: MONDAY,
        days: 1,
        durationMinutes: 90,
      });
      const after = await openings(db, org, [candidate()], {
        start: MONDAY,
        days: 1,
        durationMinutes: 90,
        busy: await bookedOver(MONDAY, 1),
      });

      expect(before[0]!.total).toBe(1);
      expect(after[0]!.total).toBe(0);
    });

    it("marks a booked quarter on the repeat table without withdrawing it", async () => {
      await openWeekdays();
      await declare("mon", "09:00", "17:00");
      await book(MONDAY, "10:00", "11:00");

      const grid = await weekdayGrid(
        db,
        org,
        instructor.id,
        [{ weekday: "mon", durationMinutes: 60 }],
        {
          from: MONDAY,
          fromTime: "09:00",
          timezone: NY,
          columns: 3,
          stepMinutes: 60,
          busy: await bookedOver(MONDAY, 7),
        },
      );

      // The row stands for every Monday of the run, so a clash on this one
      // costs that occurrence rather than the time. Marked, and still offered.
      expect(grid.rows[0]!.taken).toEqual([false, true, false]);
      expect(grid.rows[0]!.free).toEqual([true, true, true]);
    });
  });
});
