/**
 * Calendar window arithmetic, and the filter state that rides in the URL.
 *
 * Ported from the pure half of `tests/test_calendar.py`. No database: these are
 * date sums and string handling, and they gate every commit.
 *
 * The address-tidying cases went when the address stopped holding the state —
 * see `lib/web/filterState.ts`. What they were really protecting was that one
 * screen has one serialisation, and that is now the cookie's problem rather
 * than the URL's, so those cases moved rather than went.
 */

import { describe, expect, it } from "vitest";

import { SessionStatus } from "@/generated/prisma/enums";
import {
  type CalendarFilters,
  CalendarView,
  activeCalendarFilters,
  buildWindow,
  narrowsByStatus,
  parseAnchor,
  parseView,
  queryString,
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

/**
 * A calendar filter with only the part a case is about spelled out.
 *
 * The type gained `instructorRef` and `studentRef` when the calendar learned to
 * filter by who; almost none of these cases are about that, and restating two
 * nulls in every literal would bury what each one is actually checking.
 */
const only = (
  filters: Partial<CalendarFilters> & Pick<CalendarFilters, "search" | "statuses">,
): CalendarFilters => ({ instructorRef: null, studentRef: null, schoolRef: null, ...filters });

describe("links", () => {
  it("carries the whole filter state", () => {
    // Switching view must not silently drop the search or the statuses.
    const query = queryString(
      only({
        search: "algebra",
        statuses: [SessionStatus.SCHEDULED, SessionStatus.REQUESTED],
      }),
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
    const query = queryString(only({ search: "", statuses: [] }), { view: "gantt" });

    expect(query).toBe("");
    expect(query).not.toContain("gantt");
  });

  it("leaves out the parameters that only restate a default", () => {
    // Five parameters saying what their own absence says make the two that
    // mean something hard to find.
    expect(
      queryString(
        only({ search: "", statuses: Object.values(SessionStatus) }),
        { view: CalendarView.MONTH, anchor: ANCHOR },
      ),
    ).toBe("date=2026-08-14");
  });

  it("keeps a status list that actually excludes something", () => {
    const query = queryString(
      only({ search: "", statuses: [SessionStatus.CANCELLED] }),
      { view: CalendarView.MONTH },
    );

    expect(query).toBe("status=cancelled");
  });

  it("writes several statuses as one parameter", () => {
    expect(
      queryString(
        only({ search: "", statuses: [SessionStatus.SCHEDULED, SessionStatus.MISSED] }),
        { view: CalendarView.MONTH },
      ),
    ).toBe("status=scheduled,missed");
  });

  it("leaves the anchor out when it is the day an absent one would mean", () => {
    const filters = only({ search: "", statuses: [] });

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

  it("writes nothing for a full menu of ticks, so the state stays empty", () => {
    expect(
      queryString(
        only({ search: "", statuses: [...STATUS_FILTER_ORDER] }),
        { view: CalendarView.MONTH },
      ),
    ).toBe("");
  });

  it("writes nothing for the default screen, and only what differs otherwise", () => {
    expect(queryString(only({ search: "", statuses: [] }), { view: CalendarView.MONTH })).toBe(
      "",
    );
    expect(
      queryString(only({ search: "algebra", statuses: [] }), { view: CalendarView.WEEK }),
    ).toBe("view=week&q=algebra");
  });
});

describe("one spelling per state", () => {
  /**
   * The property the address-tidying used to protect, now protecting the
   * cookie.
   *
   * `queryString` is what gets stored, so two ways of arriving at the same
   * screen have to store the same string — otherwise the filter menu would
   * think it had changed every time it was opened, and the stored value would
   * grow a different spelling on each visit. `ANCHOR` stands in for today, so a
   * date equal to it is the default.
   */
  const stored = (query: string) => {
    const params = new URLSearchParams(query);
    return queryString(parseFilters(params), {
      view: parseView(params.get("view")),
      anchor: parseAnchor(params.get("date"), ANCHOR),
      today: ANCHOR,
    });
  };

  it("writes nothing at all for the default screen", () => {
    expect(stored("")).toBe("");
    expect(stored("view=month")).toBe("");
    expect(stored(`date=${ANCHOR}`)).toBe("");
    expect(stored("q=")).toBe("");
  });

  it("is a fixed point: storing what it stored changes nothing", () => {
    for (const query of [
      "view=week",
      "view=week&date=2026-09-02",
      "status=cancelled",
      "q=algebra&status=missed",
      "status=cancelled,missed",
      "instructor=usr_abc",
      "student=usr_xyz",
      "school=sch_abc",
      "view=week&q=algebra&instructor=usr_abc&student=usr_xyz&school=sch_abc",
    ]) {
      expect(stored(stored(query)), query).toBe(stored(query));
    }
  });

  it("keeps who the calendar was narrowed to", () => {
    // The whole defect: `parseFilters` has always read `instructor` on this
    // screen, and `queryString` never wrote it — so a value could reach the
    // cookie and be gone by the next render, and the drawer would show a
    // selection that narrowed nothing.
    expect(stored("instructor=usr_abc")).toBe("instructor=usr_abc");
    expect(stored("student=usr_xyz")).toBe("student=usr_xyz");
    expect(stored("school=sch_abc")).toBe("school=sch_abc");
  });

  it("counts each of them as one filter, and an unset one as none", () => {
    const none = only({ search: "", statuses: [] });
    expect(activeCalendarFilters(none)).toBe(0);
    expect(activeCalendarFilters({ ...none, instructorRef: "usr_abc" })).toBe(1);
    expect(
      activeCalendarFilters({ ...none, instructorRef: "usr_abc", studentRef: "usr_xyz" }),
    ).toBe(2);
    expect(activeCalendarFilters({ ...none, schoolRef: "sch_abc" })).toBe(1);
  });

  it("reads a status list written either way to the same one string", () => {
    // The forms submit a parameter per ticked box; the stored value joins them.
    expect(stored("status=cancelled&status=missed")).toBe(stored("status=cancelled,missed"));
  });

  it("does not invent a date for a state that did not carry one", () => {
    // Otherwise the calendar would pin itself to today on first sight and stop
    // meaning "now" the next morning.
    expect(stored("view=week")).not.toContain("date=");
    expect(stored("q=algebra")).not.toContain("date=");
  });
});
