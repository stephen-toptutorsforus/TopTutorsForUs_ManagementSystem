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
import { isAvailable, matrix, organizationOffDays, resolveDay } from "@/lib/availability";
import { dateToDb, resolveCivil, timeToDb, toZone } from "@/lib/time";

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
});
