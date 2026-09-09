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
  calendarLink,
  canonicalLink,
  narrowsByStatus,
  parseAnchor,
  parseView,
  queryString,
  readStatuses,
  restoredLink,
  writeStatuses,
} from "@/lib/calendar";
import { STATUS_FILTER_ORDER } from "@/lib/presentation";
import { parseFilters } from "@/lib/services/sessionQuery";
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
    expect(query).toContain("status=scheduled,requested");
  });

  it("falls back to the month for a view it does not recognise", () => {
    // The month is the default, and the default is spelled as nothing at all —
    // so the test worth writing is that the unknown name is not echoed back.
    const query = queryString({ search: "", statuses: [] }, { view: "gantt" });

    expect(query).toBe("");
    expect(query).not.toContain("gantt");
  });

  it("leaves out the parameters that only restate a default", () => {
    // Five parameters saying what their own absence says make the two that
    // mean something hard to find.
    expect(
      queryString(
        { search: "", statuses: Object.values(SessionStatus) },
        { view: CalendarView.MONTH, anchor: ANCHOR },
      ),
    ).toBe("date=2026-08-14");
  });

  it("keeps a status list that actually excludes something", () => {
    const query = queryString(
      { search: "", statuses: [SessionStatus.CANCELLED] },
      { view: CalendarView.MONTH },
    );

    expect(query).toBe("status=cancelled");
  });

  it("writes several statuses as one parameter", () => {
    expect(
      queryString(
        { search: "", statuses: [SessionStatus.SCHEDULED, SessionStatus.MISSED] },
        { view: CalendarView.MONTH },
      ),
    ).toBe("status=scheduled,missed");
  });

  it("leaves the anchor out when it is the day an absent one would mean", () => {
    const filters = { search: "", statuses: [] };

    expect(queryString(filters, { view: CalendarView.WEEK, anchor: ANCHOR, today: ANCHOR })).toBe(
      "view=week",
    );
    expect(
      queryString(filters, { view: CalendarView.WEEK, anchor: "2026-09-02", today: ANCHOR }),
    ).toBe("view=week&date=2026-09-02");
    // With no `today` given there is no default to compare against, so the
    // anchor is written — which is what `restoredLink` and the tests rely on.
    expect(queryString(filters, { view: CalendarView.WEEK, anchor: ANCHOR })).toBe(
      "view=week&date=2026-08-14",
    );
  });

  it("counts a full menu of ticks as no filter, because that is the resting state", () => {
    // Every box starts ticked, so a complete selection is what an untouched
    // filter looks like rather than something somebody chose. Counting it
    // would stamp all seven statuses onto the address of a calendar nobody had
    // filtered. Complete is measured against what the menu offers, which is
    // seven of the eight — `in_progress` is not on it.
    expect(narrowsByStatus([...STATUS_FILTER_ORDER])).toBe(false);
    expect(narrowsByStatus(Object.values(SessionStatus))).toBe(false);
    expect(narrowsByStatus([])).toBe(false);

    // One box unticked is a filter, and so is one box ticked.
    expect(narrowsByStatus(STATUS_FILTER_ORDER.slice(1))).toBe(true);
    expect(narrowsByStatus([SessionStatus.SCHEDULED])).toBe(true);
  });

  it("writes nothing for a full menu of ticks, so the address stays bare", () => {
    expect(
      calendarLink(
        { search: "", statuses: [...STATUS_FILTER_ORDER] },
        { view: CalendarView.MONTH },
      ),
    ).toBe("/calendar");
  });

  it("gives a path without a bare question mark for the default screen", () => {
    expect(calendarLink({ search: "", statuses: [] }, { view: CalendarView.MONTH })).toBe(
      "/calendar",
    );
    expect(
      calendarLink({ search: "algebra", statuses: [] }, { view: CalendarView.WEEK }),
    ).toBe("/calendar?view=week&q=algebra");
  });
});

describe("tidying the address bar", () => {
  /** `ANCHOR` stands in for today, so a date equal to it is the default. */
  const tidy = (query: string) => {
    const params = new URLSearchParams(query);
    return canonicalLink(params, {
      filters: parseFilters(params),
      view: parseView(params.get("view")),
      anchor: parseAnchor(params.get("date"), ANCHOR),
      today: ANCHOR,
    });
  };

  it("leaves an address that is already the tidiest one alone", () => {
    // The redirect fires on anything but `null`, so a fixed point here is what
    // keeps the page from bouncing a request between two spellings for ever.
    expect(tidy("")).toBeNull();
    expect(tidy("view=week")).toBeNull();
    expect(tidy("view=week&date=2026-09-02")).toBeNull();
    expect(tidy("status=cancelled")).toBeNull();
    expect(tidy("q=algebra&status=missed")).toBeNull();
    expect(tidy("status=cancelled,missed")).toBeNull();
  });

  it("strips the defaults, and is then a fixed point", () => {
    const statuses = Object.values(SessionStatus)
      .map((status) => `status=${status.toLowerCase()}`)
      .join("&");

    expect(tidy(`view=month&${statuses}`)).toBe("/calendar");
    expect(tidy("view=month")).toBe("/calendar");
    // Today is what an absent date means, so writing it says nothing. This was
    // the commonest piece of noise in a filtered address: the filter form
    // submitted it whether or not anybody had paged anywhere.
    expect(tidy(`date=${ANCHOR}`)).toBe("/calendar");
    expect(tidy(`view=week&date=${ANCHOR}&status=missed`)).toBe(
      "/calendar?view=week&status=missed",
    );
    // Another month is a real choice, and stays.
    expect(tidy("view=month&date=2026-09-02")).toBe("/calendar?date=2026-09-02");
  });

  it("writes one status parameter, however many statuses are ticked", () => {
    // The checkbox form submits one per status. The address holds them joined,
    // which is the whole of the difference between 78 characters and 43.
    expect(tidy("status=scheduled&status=completed&status=missed")).toBe(
      "/calendar?status=scheduled,completed,missed",
    );
    // And the joined spelling is what it settles on, so it does not bounce.
    expect(tidy("status=scheduled,completed,missed")).toBeNull();
  });

  it("reads a filter written either way, so an old link still works", () => {
    const separate = new URLSearchParams("status=scheduled&status=missed");
    const joined = new URLSearchParams("status=scheduled,missed");

    expect(parseFilters(separate).statuses).toEqual(parseFilters(joined).statuses);
  });

  it("drops what the page never read in the first place", () => {
    // `calendarRange` narrows by search text and status and nothing else, so
    // these were being ignored before they were removed from the address.
    expect(tidy("instructor=abc&page=4")).toBe("/calendar");
    expect(tidy("status=wizard")).toBe("/calendar");
    expect(tidy("view=gantt")).toBe("/calendar");
  });

  it("settles an impossible date and untidy search text", () => {
    // An impossible date resolves to today, which is then not written at all.
    expect(tidy("date=2026-02-30")).toBe("/calendar");
    expect(tidy("q=%20algebra%20")).toBe("/calendar?q=algebra");
  });

  it("does not invent a date for an address that did not carry one", () => {
    // Otherwise a bare `/calendar` would pin itself to today on first sight,
    // and stop meaning "now" the moment it was bookmarked.
    expect(tidy("view=week")).toBeNull();
    expect(tidy("q=algebra")).toBeNull();
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

    expect(link).toBe("/calendar?status=cancelled");
    expect(link).not.toContain("date=");
  });
});
