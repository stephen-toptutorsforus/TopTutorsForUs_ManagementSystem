/**
 * A run whose days differ, and the clock that sets them.
 *
 * Two things are under test here and they meet on the booking form. The
 * recurrence engine now lets a weekday carry its own start time and length, so
 * "Mondays at four for an hour, Wednesdays at half five for thirty minutes" is
 * one series; and the start time is chosen from a list of civil times rather
 * than typed into the browser's own picker.
 *
 * Both are pure, so they are held here rather than against a database. The
 * DST case is the one that earns its place: a per-day time has to resolve
 * through the same civil-date walk the single-time rule does, or a Sunday in
 * March would silently move.
 */

import { describe, expect, it } from "vitest";

import {
  WEEKDAY_CHOICES,
  clockTime,
  clockTimes,
  nearestClockTime,
  weekdayOf,
} from "@/lib/presentation";
import { RecurrenceError, buildRule, expand, scheduleOn } from "@/lib/recurrence";
import { DstEdge } from "@/lib/time";

const NY = "America/New_York";
/** A Monday. Every date below is counted from it. */
const MONDAY = "2026-04-06";

function rule(overrides: Partial<Parameters<typeof buildRule>[0]> = {}) {
  return buildRule({
    frequency: "weekly",
    startDate: MONDAY,
    startTime: "16:00",
    durationMinutes: 60,
    timezone: NY,
    endMode: "count",
    occurrenceCount: 4,
    ...overrides,
  });
}

describe("a repeat whose days differ", () => {
  it("runs each weekday at its own time and length", () => {
    const expanded = expand(
      rule({
        weekdays: ["mon", "wed"],
        occurrenceCount: 4,
        perWeekday: {
          mon: { startTime: "16:00", durationMinutes: 60 },
          wed: { startTime: "17:30", durationMinutes: 30 },
        },
      }),
    );

    expect(expanded.occurrences.map((o) => o.localDate)).toEqual([
      "2026-04-06",
      "2026-04-08",
      "2026-04-13",
      "2026-04-15",
    ]);
    expect(expanded.occurrences.map((o) => o.startTime)).toEqual([
      "16:00",
      "17:30",
      "16:00",
      "17:30",
    ]);
    expect(expanded.occurrences.map((o) => o.durationMinutes)).toEqual([60, 30, 60, 30]);

    // And the instants agree with the minutes, rather than the fields being
    // decoration on an end computed from the rule's own duration.
    for (const occurrence of expanded.occurrences) {
      const minutes = (occurrence.end.getTime() - occurrence.start.getTime()) / 60_000;
      expect(minutes).toBe(occurrence.durationMinutes);
    }
  });

  it("falls back to the rule's own time for a weekday with no row", () => {
    // Every rule written before the panel existed is this one.
    const expanded = expand(rule({ weekdays: ["mon", "wed"], occurrenceCount: 2 }));
    expect(expanded.occurrences.map((o) => o.startTime)).toEqual(["16:00", "16:00"]);
    expect(expanded.occurrences.map((o) => o.durationMinutes)).toEqual([60, 60]);
  });

  it("drops a row for a weekday the rule does not run on", () => {
    // The form can leave one behind when somebody changes a day. Keeping it
    // would put a value in the rule that affects nothing and shows up in a
    // diff of two series that behave identically.
    const built = rule({
      weekdays: ["mon"],
      perWeekday: {
        mon: { startTime: "09:00", durationMinutes: 45 },
        fri: { startTime: "20:00", durationMinutes: 15 },
      },
    });
    expect(Object.keys(built.perWeekday)).toEqual(["mon"]);
  });

  it("refuses a row that names no real weekday, or an impossible length", () => {
    expect(() =>
      rule({ weekdays: ["mon"], perWeekday: { moonday: { startTime: "09:00", durationMinutes: 30 } } }),
    ).toThrow(RecurrenceError);
    expect(() =>
      rule({ weekdays: ["mon"], perWeekday: { mon: { startTime: "09:00", durationMinutes: 0 } } }),
    ).toThrow(/at least 1 minute/);
    expect(() =>
      rule({ weekdays: ["mon"], perWeekday: { mon: { startTime: "9am", durationMinutes: 30 } } }),
    ).toThrow(/start time/);
  });

  it("holds a per-day time by the wall clock across a DST change", () => {
    // The whole reason the engine walks civil dates. 8 March 2026 is the spring
    // forward in New York; a Sunday at 09:30 has to still be 09:30 the week
    // after, and a per-day time must not be the one place that adds elapsed
    // milliseconds instead.
    const expanded = expand(
      buildRule({
        frequency: "weekly",
        startDate: "2026-03-01",
        startTime: "16:00",
        durationMinutes: 60,
        timezone: NY,
        endMode: "count",
        occurrenceCount: 3,
        weekdays: ["sun"],
        perWeekday: { sun: { startTime: "09:30", durationMinutes: 90 } },
      }),
    );

    expect(expanded.occurrences.map((o) => o.localDate)).toEqual([
      "2026-03-01",
      "2026-03-08",
      "2026-03-15",
    ]);
    for (const occurrence of expanded.occurrences) {
      expect(occurrence.startTime).toBe("09:30");
      expect(occurrence.dstEdge).toBe(DstEdge.NONE);
      expect(occurrence.end.getTime() - occurrence.start.getTime()).toBe(90 * 60_000);
    }
    // Six days and 23 hours apart across the jump, not seven days — which is
    // exactly what "the clock stayed at 09:30" means in instants.
    const [first, second] = expanded.occurrences;
    expect(second!.start.getTime() - first!.start.getTime()).toBe(
      (7 * 24 - 1) * 3_600_000,
    );
  });

  it("counts sessions, not weeks, when several days are named", () => {
    // "Five sessions on Mondays, Wednesdays and Fridays" is five, ending
    // mid-week, rather than five of each.
    const expanded = expand(
      rule({ weekdays: ["mon", "wed", "fri"], occurrenceCount: 5 }),
    );
    expect(expanded.occurrences.map((o) => o.localDate)).toEqual([
      "2026-04-06",
      "2026-04-08",
      "2026-04-10",
      "2026-04-13",
      "2026-04-15",
    ]);
  });

  it("spills the remainder into a partial final week", () => {
    // The arithmetic the whole panel rests on. "Number of sessions" is the
    // total, not a figure per week: 100 across three weekdays is 33 full weeks
    // of three, and the hundredth lands on the Monday of the 34th — the run
    // ends mid-week rather than rounding up to 34 weeks of three.
    const expanded = expand(
      rule({ weekdays: ["mon", "wed", "fri"], occurrenceCount: 100 }),
      { maxOccurrences: 200, maxHorizonDays: 365 },
    );

    expect(expanded.occurrences).toHaveLength(100);
    expect(expanded.truncated).toBe(false);
    expect(expanded.occurrences[0]!.localDate).toBe(MONDAY);
    expect(expanded.occurrences.at(-1)!.localDate).toBe("2026-11-23");

    // 33 whole weeks between the first and the last, so the last is in the 34th.
    const week = (day: string) =>
      Math.floor(
        (Date.parse(`${day}T00:00:00Z`) - Date.parse(`${MONDAY}T00:00:00Z`)) /
          (7 * 86_400_000),
      );
    expect(week(expanded.occurrences.at(-1)!.localDate)).toBe(33);

    // Three in every week but the last, and one in the last.
    const perWeek = new Map<number, number>();
    for (const occurrence of expanded.occurrences) {
      const index = week(occurrence.localDate);
      perWeek.set(index, (perWeek.get(index) ?? 0) + 1);
    }
    expect(perWeek.size).toBe(34);
    expect([...perWeek.values()].filter((n) => n === 3)).toHaveLength(33);
    expect(perWeek.get(33)).toBe(1);
  });

  it("gives the leftover session to the earliest day, at that day's own time", () => {
    // The walk is chronological, so a remainder of one goes to the first
    // selected weekday — and runs at that weekday's time, not the first row's.
    const expanded = expand(
      rule({
        weekdays: ["mon", "wed", "fri"],
        occurrenceCount: 4,
        perWeekday: {
          mon: { startTime: "16:00", durationMinutes: 60 },
          wed: { startTime: "17:30", durationMinutes: 30 },
          fri: { startTime: "09:00", durationMinutes: 90 },
        },
      }),
    );

    const last = expanded.occurrences.at(-1)!;
    expect(last.localDate).toBe("2026-04-13");
    expect(last.startTime).toBe("16:00");
    expect(last.durationMinutes).toBe(60);
  });

  it("reports the horizon rather than silently shortening a two-year run", () => {
    // 100 weekly sessions is nearly two years, past the 365-day horizon. The
    // count is not refused — it is reachable at three days a week — so the run
    // stops and says why, and the preview shows that notice.
    const expanded = expand(rule({ weekdays: ["mon"], occurrenceCount: 100 }), {
      maxOccurrences: 200,
      maxHorizonDays: 365,
    });

    expect(expanded.occurrences.length).toBeLessThan(100);
    expect(expanded.truncated).toBe(true);
    expect(expanded.truncationReason).toContain("365-day booking horizon");
  });

  it("says what a date runs at without expanding the whole rule", () => {
    const built = rule({
      weekdays: ["mon", "wed"],
      perWeekday: { wed: { startTime: "17:30", durationMinutes: 30 } },
    });
    expect(scheduleOn(built, "2026-04-08")).toEqual({
      startTime: "17:30",
      durationMinutes: 30,
    });
    expect(scheduleOn(built, MONDAY)).toEqual({ startTime: "16:00", durationMinutes: 60 });
  });
});

describe("the clock the form offers", () => {
  it("covers the whole day at the step, once each", () => {
    const options = clockTimes(15);
    expect(options).toHaveLength(96);
    expect(options[0]).toEqual({ value: "00:00", label: "12:00 AM" });
    expect(options.at(-1)).toEqual({ value: "23:45", label: "11:45 PM" });
    expect(new Set(options.map((option) => option.value)).size).toBe(options.length);
  });

  it("names noon and midnight the way a person would", () => {
    // The two every 12-hour clock gets wrong.
    expect(clockTime("00:00")).toBe("12:00 AM");
    expect(clockTime("00:45")).toBe("12:45 AM");
    expect(clockTime("12:00")).toBe("12:00 PM");
    expect(clockTime("12:30")).toBe("12:30 PM");
    expect(clockTime("16:45")).toBe("4:45 PM");
  });

  it("snaps a time off the grid onto it rather than losing it", () => {
    // A value from the API, or from a tenant whose step used to differ. Left
    // unsnapped the select shows its first option and the session moves to
    // midnight without anybody choosing that.
    expect(nearestClockTime("16:07", 15)).toBe("16:00");
    expect(nearestClockTime("16:08", 15)).toBe("16:15");
    expect(nearestClockTime("16:00", 15)).toBe("16:00");
    expect(nearestClockTime("23:59", 15)).toBe("23:45");
    expect(nearestClockTime("nonsense", 15)).toBe("00:00");
  });

  it("every option it offers is one it can read back", () => {
    for (const option of clockTimes(15)) {
      expect(nearestClockTime(option.value, 15)).toBe(option.value);
    }
  });
});

describe("the week the panel offers", () => {
  it("starts on Monday, matching the weekday names the engine stores", () => {
    expect(WEEKDAY_CHOICES.map((choice) => choice.value)).toEqual([
      "mon",
      "tue",
      "wed",
      "thu",
      "fri",
      "sat",
      "sun",
    ]);
  });

  it("names the weekday of a date the same way the engine does", () => {
    // The panel seeds its first row from the chosen date, so a disagreement
    // here would show a Monday row for a Tuesday session.
    const cases: [string, string][] = [
      ["2026-04-06", "mon"],
      ["2026-04-08", "wed"],
      ["2026-04-11", "sat"],
      ["2026-04-12", "sun"],
    ];
    for (const [day, expected] of cases) {
      expect(weekdayOf(day)).toBe(expected);
      const built = buildRule({
        frequency: "weekly",
        startDate: day,
        startTime: "16:00",
        durationMinutes: 60,
        timezone: NY,
        endMode: "count",
        occurrenceCount: 1,
      });
      // With no selection, `buildRule` resolves to the start date's weekday.
      expect(built.weekdays).toEqual([expected]);
    }
  });
});
