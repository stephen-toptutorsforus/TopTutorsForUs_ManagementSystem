/**
 * Calendar window arithmetic, and the filter state that rides in the URL.
 *
 * Ported from the pure half of `tests/test_calendar.py` plus the cookie cases
 * at its end. No database: these are date sums and string handling, and they
 * gate every commit.
 */

import { describe, expect, it } from "vitest";

import { SessionStatus } from "@/generated/prisma/enums";
import {
  CalendarView,
  buildWindow,
  parseAnchor,
  parseView,
  queryString,
  readStatuses,
  restoredLink,
  writeStatuses,
} from "@/lib/calendar";
import { isoWeekday } from "@/lib/time";

const ANCHOR = "2026-08-14"; // a Friday

describe("window arithmetic", () => {
  it("covers whole weeks in the month window", () => {
    // The grid must always be complete rows, so its shape never jumps.
    const window = buildWindow(CalendarView.MONTH, ANCHOR);

    expect(window.heading).toBe("August 1 – 31, 2026");
    expect(window.weeks[0]!.length).toBe(7);
    expect(window.first).toBe(window.weeks[0]![0]);
    expect(window.last).toBe(window.weeks[window.weeks.length - 1]![6]);
    expect(window.first <= "2026-08-01").toBe(true);
    expect(window.last >= "2026-08-31").toBe(true);
  });

  it("steps a month at a time", () => {
    const window = buildWindow(CalendarView.MONTH, ANCHOR);

    expect(window.previous).toBe("2026-07-01");
    expect(window.following).toBe("2026-09-01");
  });

  it("lands in the previous year stepping back from January", () => {
    const window = buildWindow(CalendarView.MONTH, "2026-01-10");

    expect(window.previous).toBe("2025-12-01");
    expect(window.following).toBe("2026-02-01");
  });

  it("runs the week window Sunday to Saturday", () => {
    const window = buildWindow(CalendarView.WEEK, ANCHOR); // a Friday

    expect(window.first).toBe("2026-08-09");
    expect(isoWeekday(window.first)).toBe(7); // Sunday
    expect(window.last).toBe("2026-08-15");
    expect(isoWeekday(window.last)).toBe(6); // Saturday
    expect(window.days.length).toBe(7);
    expect(window.previous).toBe("2026-08-02");
    expect(window.following).toBe("2026-08-16");
  });

  it("starts a Sunday anchor on its own week", () => {
    expect(buildWindow(CalendarView.WEEK, "2026-08-09").first).toBe("2026-08-09");
  });

  it("makes the day window a single day", () => {
    const window = buildWindow(CalendarView.DAY, ANCHOR);

    expect([window.first, window.last]).toEqual([ANCHOR, ANCHOR]);
    expect(window.heading).toBe("Friday 14 August 2026");
    expect(window.previous).toBe("2026-08-13");
    expect(window.following).toBe("2026-08-15");
  });

  it("makes the list window exactly the month", () => {
    // Unlike the grid it is not padded — a list of neighbouring months is noise.
    const window = buildWindow(CalendarView.LIST, ANCHOR);

    expect(window.first).toBe("2026-08-01");
    expect(window.last).toBe("2026-08-31");
    expect(window.days.length).toBe(31);
  });

  it("measures a February in a leap year correctly", () => {
    const window = buildWindow(CalendarView.LIST, "2028-02-10");

    expect(window.last).toBe("2028-02-29");
    expect(window.days.length).toBe(29);
  });

  it("names both months in a span across two", () => {
    expect(buildWindow(CalendarView.WEEK, "2026-08-31").heading).toBe(
      "August 30 – September 5, 2026",
    );
  });

  it("names both years in a span across two", () => {
    expect(buildWindow(CalendarView.WEEK, "2026-12-31").heading).toBe(
      "December 27, 2026 – January 2, 2027",
    );
  });

  it("falls back to the month for an unknown view", () => {
    expect(parseView("gantt")).toBe(CalendarView.MONTH);
    expect(parseView(null)).toBe(CalendarView.MONTH);
  });

  it("falls back to today for an unparseable date", () => {
    expect(parseAnchor("not-a-date", ANCHOR)).toBe(ANCHOR);
    expect(parseAnchor("2026-02-30", ANCHOR)).toBe(ANCHOR);
    expect(parseAnchor(null, ANCHOR)).toBe(ANCHOR);
    expect(parseAnchor("2026-09-01", ANCHOR)).toBe("2026-09-01");
  });
});

describe("links", () => {
  it("carries the whole filter state", () => {
    // Switching view must not silently drop the search or the statuses.
    const query = queryString(
      {
        search: "algebra",
        statuses: [SessionStatus.SCHEDULED, SessionStatus.REQUESTED],
      },
      { view: CalendarView.WEEK, anchor: ANCHOR },
    );

    expect(query).toContain("view=week");
    expect(query).toContain("date=2026-08-14");
    expect(query).toContain("q=algebra");
    expect(query).toContain("status=scheduled");
    expect(query).toContain("status=requested");
  });

  it("falls back to the month for a view it does not recognise", () => {
    expect(queryString({ search: "", statuses: [] }, { view: "gantt" })).toContain(
      "view=month",
    );
  });
});

describe("the remembered status filter", () => {
  it("counts a repeated status once", () => {
    expect(readStatuses("scheduled,scheduled,missed")).toEqual([
      SessionStatus.SCHEDULED,
      SessionStatus.MISSED,
    ]);
  });

  it("cannot name more statuses than exist", () => {
    const flood = Array.from({ length: 500 }, () => "scheduled").join(",");
    expect(readStatuses(flood)).toEqual([SessionStatus.SCHEDULED]);
  });

  it("treats an empty cookie as no preference", () => {
    expect(readStatuses("")).toEqual([]);
    expect(readStatuses(null)).toEqual([]);
  });

  it("ignores a cookie of pure nonsense rather than raising", () => {
    // A cookie is user-supplied input like any other.
    expect(readStatuses("../../etc/passwd,<script>,scheduled")).toEqual([
      SessionStatus.SCHEDULED,
    ]);
  });

  it("round-trips what it wrote", () => {
    const statuses = [SessionStatus.CANCELLED, SessionStatus.MISSED];
    expect(readStatuses(writeStatuses(statuses))).toEqual(statuses);
  });

  it("restores the statuses but not the date", () => {
    // Coming back to the calendar should show now, not the month somebody was
    // reading on Friday.
    const link = restoredLink([SessionStatus.CANCELLED]);

    expect(link).toContain("view=month");
    expect(link).toContain("status=cancelled");
    expect(link).not.toContain("date=");
  });
});
