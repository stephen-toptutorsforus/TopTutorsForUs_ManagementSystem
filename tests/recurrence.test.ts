/**
 * Recurrence expansion — pure logic, no database.
 *
 * Ported from `tests/test_recurrence.py`, case for case and date for date. The
 * same function backs the preview and the generation, so these cover both at
 * once.
 */

import { describe, expect, it } from "vitest";

import {
  type BuildRuleInput,
  buildRule,
  dstAdjusted,
  expand,
  RecurrenceError,
} from "@/lib/recurrence";
import { DstEdge, toZone } from "@/lib/time";

const NY = "America/New_York";
const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;

interface WeeklyOptions {
  weekdays?: readonly string[] | null;
  start?: string;
  timeOfDay?: string;
  count?: number | null;
  until?: string | null;
  interval?: number;
  timezone?: string;
}

function weekly(options: WeeklyOptions = {}) {
  const count = options.count === undefined ? 4 : options.count;
  const input: BuildRuleInput = {
    frequency: "weekly",
    intervalN: options.interval ?? 1,
    weekdays: options.weekdays ?? null,
    startDate: options.start ?? "2026-04-06", // a Monday
    startTime: options.timeOfDay ?? "16:00",
    durationMinutes: 60,
    timezone: options.timezone ?? NY,
    endMode: count !== null ? "count" : "until",
    occurrenceCount: count,
    untilDate: options.until ?? null,
  };
  return buildRule(input);
}

const dates = (result: ReturnType<typeof expand>) =>
  result.occurrences.map((o) => o.localDate);

describe("which dates a rule produces", () => {
  it("produces the requested count", () => {
    const result = expand(weekly({ count: 4 }));

    expect(result.occurrences).toHaveLength(4);
    expect(dates(result)).toEqual(["2026-04-06", "2026-04-13", "2026-04-20", "2026-04-27"]);
    expect(result.occurrences.map((o) => o.index)).toEqual([1, 2, 3, 4]);
  });

  it("interleaves several weekdays in calendar order", () => {
    const result = expand(weekly({ weekdays: ["mon", "thu"], count: 6 }));

    expect(dates(result)).toEqual([
      "2026-04-06", // Mon
      "2026-04-09", // Thu
      "2026-04-13",
      "2026-04-16",
      "2026-04-20",
      "2026-04-23",
    ]);
  });

  it("orders weekdays by the week, not by the order they were passed", () => {
    const result = expand(weekly({ weekdays: ["fri", "tue"], count: 4 }));

    expect(dates(result)).toEqual([...dates(result)].sort());
    expect(dates(result)[0]).toBe("2026-04-07"); // Tuesday comes first in the week
  });

  it("waits for the next week when the weekday precedes the start date", () => {
    const result = expand(weekly({ weekdays: ["mon"], start: "2026-04-08", count: 2 }));

    expect(dates(result)).toEqual(["2026-04-13", "2026-04-20"]);
  });

  it("counts calendar weeks for every selected weekday", () => {
    // Every other week, Monday and Thursday: both fall in the same fortnight.
    // Counting 7-day blocks from the start date instead puts Thursday in the
    // alternate week and quietly produces one session a week for ever.
    const result = expand(weekly({ weekdays: ["mon", "thu"], interval: 2, count: 4 }));

    expect(dates(result)).toEqual([
      "2026-04-06", // week 0
      "2026-04-09", // week 0
      "2026-04-20", // week 2
      "2026-04-23", // week 2
    ]);
  });

  it("honours a daily interval", () => {
    const result = expand(
      buildRule({
        frequency: "daily",
        intervalN: 3,
        startDate: "2026-04-06",
        startTime: "09:00",
        durationMinutes: 45,
        timezone: NY,
        endMode: "count",
        occurrenceCount: 3,
      }),
    );

    expect(dates(result)).toEqual(["2026-04-06", "2026-04-09", "2026-04-12"]);
  });

  it("stops a date-ended rule on its last matching day", () => {
    const result = expand(weekly({ count: null, until: "2026-04-21" }));

    expect(dates(result)).toEqual(["2026-04-06", "2026-04-13", "2026-04-20"]);
    expect(result.truncated).toBe(false);
  });

  it("repeats the start date's weekday when none is selected", () => {
    const result = expand(weekly({ weekdays: null, start: "2026-04-08", count: 2 })); // a Wednesday

    expect(dates(result)).toEqual(["2026-04-08", "2026-04-15"]);
  });
});

describe("daylight saving", () => {
  const gaps = (result: ReturnType<typeof expand>) =>
    new Set(
      result.occurrences
        .slice(1)
        .map((o, i) => o.start.getTime() - result.occurrences[i]!.start.getTime()),
    );

  it("keeps the wall clock across spring forward", () => {
    const result = expand(weekly({ start: "2026-02-23", count: 4 }));

    expect(result.occurrences.map((o) => toZone(o.start, NY).toFormat("HH:mm"))).toEqual([
      "16:00",
      "16:00",
      "16:00",
      "16:00",
    ]);
    // And the underlying instants are genuinely not evenly spaced.
    expect(gaps(result)).toContain(167 * HOUR_MS);
    expect(gaps(result)).toContain(168 * HOUR_MS);
  });

  it("keeps the wall clock across fall back", () => {
    const result = expand(weekly({ start: "2026-10-19", count: 4 }));

    expect(result.occurrences.map((o) => toZone(o.start, NY).toFormat("HH:mm"))).toEqual([
      "16:00",
      "16:00",
      "16:00",
      "16:00",
    ]);
    expect(gaps(result)).toContain(169 * HOUR_MS);
  });

  it("reports an occurrence that landed in the spring-forward gap", () => {
    const result = expand(weekly({ start: "2026-03-01", timeOfDay: "02:30", count: 3 }));
    const adjusted = dstAdjusted(result);

    expect(adjusted).toHaveLength(1);
    expect(adjusted[0]!.localDate).toBe("2026-03-08");
    expect(adjusted[0]!.dstEdge).toBe(DstEdge.GAP_SHIFTED);
    expect(toZone(adjusted[0]!.start, NY).toFormat("HH:mm")).toBe("03:30");
  });

  it("keeps the session's duration across a boundary", () => {
    // Duration is elapsed time, not clock time: 60 minutes stays 60 minutes.
    const result = expand(weekly({ start: "2026-03-08", timeOfDay: "01:30", count: 1 }));
    const occurrence = result.occurrences[0]!;

    expect(occurrence.end.getTime() - occurrence.start.getTime()).toBe(60 * MINUTE_MS);
  });

  it("gives two zones different instants for the same civil rule", () => {
    const ny = expand(weekly({ count: 1 }));
    const lisbon = expand(weekly({ count: 1, timezone: "Europe/Lisbon" }));

    expect(ny.occurrences[0]!.start.getTime()).not.toBe(lisbon.occurrences[0]!.start.getTime());
    expect(toZone(ny.occurrences[0]!.start, NY).hour).toBe(16);
    expect(toZone(lisbon.occurrences[0]!.start, "Europe/Lisbon").hour).toBe(16);
  });
});

describe("closures and bounds", () => {
  it("skips a closure without shortening the run", () => {
    // A closure moves the run along; it does not cost the tenant a session.
    const result = expand(weekly({ count: 4 }), { skipDates: ["2026-04-13"] });

    expect(result.occurrences).toHaveLength(4);
    expect(dates(result)).not.toContain("2026-04-13");
    expect(result.skippedDates).toEqual(["2026-04-13"]);
    expect(result.occurrences[3]!.localDate).toBe("2026-05-04");
    expect(result.occurrences.map((o) => o.index)).toEqual([1, 2, 3, 4]);
  });

  it("stops at the occurrence ceiling and says so", () => {
    const result = expand(weekly({ count: 100 }), { maxOccurrences: 12 });

    expect(result.occurrences).toHaveLength(12);
    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain("12 sessions");
    expect(result.requestedCount).toBe(100);
  });

  it("stops at the booking horizon and says so", () => {
    const result = expand(weekly({ count: null, until: "2030-01-01" }), {
      maxHorizonDays: 30,
    });

    expect(result.truncated).toBe(true);
    expect(result.truncationReason).toContain("horizon");
    expect(result.occurrences.every((o) => o.localDate <= "2026-05-06")).toBe(true);
  });

  it("continues numbering from an existing position", () => {
    // A this-and-future edit keeps numbering where the original left off.
    const result = expand(weekly({ count: 3 }), { startIndex: 7 });

    expect(result.occurrences.map((o) => o.index)).toEqual([7, 8, 9]);
  });
});

describe("rules that are refused", () => {
  it.each([
    [{ count: null, until: null }, /needs an end date/],
    [{ count: 0 }, /at least 1/],
    [{ interval: 0 }, /interval must be at least 1/],
    [{ count: null, until: "2026-01-01" }, /before the start date/],
  ])("rejects %o before anything is generated", (options, message) => {
    expect(() => weekly(options as WeeklyOptions)).toThrow(RecurrenceError);
    expect(() => weekly(options as WeeklyOptions)).toThrow(message);
  });

  it("refuses a rule that ends on both a count and a date", () => {
    expect(() =>
      buildRule({
        frequency: "weekly",
        startDate: "2026-04-06",
        startTime: "16:00",
        durationMinutes: 60,
        timezone: NY,
        endMode: "count",
        occurrenceCount: 4,
        untilDate: "2026-06-01",
      }),
    ).toThrow(/never both/);
  });

  it("refuses an unknown weekday", () => {
    expect(() => weekly({ weekdays: ["mon", "funday"] })).toThrow(/unknown weekday/);
  });
});
