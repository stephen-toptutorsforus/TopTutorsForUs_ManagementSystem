/**
 * The calendar screen: month, week, day, and list views.
 *
 * Ported from `app/web/calendar_view.py`.
 *
 * All four views are one route over one query. They differ only in the date
 * range they ask for and how the page lays the result out, which is why
 * switching view keeps the search text, the status filter, and the date you
 * were looking at — they are one stored state, and `queryString` is its one
 * spelling. It lived in the URL until the address of a page stopped changing
 * for anything done on it; see `lib/web/filterState.ts`.
 *
 * **Ranges are computed in civil dates, in the viewer's zone.** A month is "the
 * 1st to the last, where the viewer is", not a UTC instant range, and the grid
 * is padded out to whole weeks so the month view always shows complete rows.
 */

import { SessionStatus } from "@/generated/prisma/enums";
import type { SessionFilters } from "@/lib/services/sessionQuery";
import { type CivilDate, addDays, isoWeekday } from "@/lib/time";
import { STATUS_FILTER_ORDER } from "@/lib/presentation";
import { narrows } from "@/lib/selection";
import { readableQuery } from "@/lib/urlState";

export enum CalendarView {
  MONTH = "month",
  WEEK = "week",
  DAY = "day",
  LIST = "list",
}

/** How far a "next"/"previous" step moves, per view. */
const STEP: Record<CalendarView, string> = {
  [CalendarView.MONTH]: "month",
  [CalendarView.WEEK]: "week",
  [CalendarView.DAY]: "day",
  [CalendarView.LIST]: "month",
};

/**
 * How many events a month cell shows before collapsing into "+N more". Four is
 * what fits a cell at the smallest supported width without the row growing tall
 * enough to push the following week off screen.
 */
export const MONTH_CELL_LIMIT = 4;

/**
 * Statuses read back from one parameter or several.
 *
 * The forms submit a checkbox per status, so `status=a&status=b` arrives from
 * the browser; the stored state holds `status=a,b`. Both are accepted, and
 * serialising settles the first into the second.
 */
/** The one spelling of a status list: lower case, joined by commas. */
export function writeStatuses(statuses: readonly SessionStatus[]): string {
  return statuses.map((status) => status.toLowerCase()).join(",");
}

export function statusValues(params: URLSearchParams): string[] {
  return params.getAll("status").flatMap((chunk) => chunk.split(","));
}

/** Everything a page needs to render and navigate one view. */
export interface CalendarWindow {
  view: CalendarView;
  anchor: CivilDate;
  /** Inclusive, the first date to fetch. */
  first: CivilDate;
  /** Inclusive, the last date to fetch. */
  last: CivilDate;
  heading: string;
  previous: CivilDate;
  following: CivilDate;
  /** Month view only. */
  weeks: CivilDate[][];
  /** Week, day, and list views. */
  days: CivilDate[];
}

export function parseView(raw: string | null | undefined): CalendarView {
  const known = Object.values(CalendarView) as string[];
  return known.includes(raw ?? "") ? ((raw ?? "") as CalendarView) : CalendarView.MONTH;
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function parseAnchor(raw: string | null | undefined, today: CivilDate): CivilDate {
  if (!raw || !CIVIL_DATE.test(raw)) return today;
  const parsed = new Date(`${raw}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return today;
  return parsed.toISOString().slice(0, 10) === raw ? raw : today;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const WEEKDAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function parts(day: CivilDate): { year: number; month: number; day: number } {
  const [year, month, dayOfMonth] = day.split("-").map(Number);
  return { year: year!, month: month!, day: dayOfMonth! };
}

function compose(year: number, month: number, day: number): CivilDate {
  const yyyy = String(year).padStart(4, "0");
  const mm = String(month).padStart(2, "0");
  const dd = String(day).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function firstOfMonth(day: CivilDate): CivilDate {
  const { year, month } = parts(day);
  return compose(year, month, 1);
}

/** Resolve a view and an anchor date into a concrete range and its labels. */
export function buildWindow(view: CalendarView, anchor: CivilDate): CalendarWindow {
  if (view === CalendarView.DAY) {
    const { year, month, day } = parts(anchor);
    return {
      view,
      anchor,
      first: anchor,
      last: anchor,
      // "Friday 14 August 2026" — the weekday, then the date in full.
      heading: `${WEEKDAY_NAMES[isoWeekday(anchor) - 1]} ${String(day).padStart(2, "0")} ${
        MONTHS[month - 1]
      } ${year}`,
      previous: addDays(anchor, -1),
      following: addDays(anchor, 1),
      weeks: [],
      days: [anchor],
    };
  }

  if (view === CalendarView.WEEK) {
    // The week starts on Sunday: isoWeekday is 1..7 with Sunday as 7, so the
    // offset back to Sunday is `isoWeekday % 7`.
    const start = addDays(anchor, -(isoWeekday(anchor) % 7));
    const end = addDays(start, 6);
    return {
      view,
      anchor,
      first: start,
      last: end,
      heading: spanLabel(start, end),
      previous: addDays(start, -7),
      following: addDays(start, 7),
      weeks: [],
      days: Array.from({ length: 7 }, (_, index) => addDays(start, index)),
    };
  }

  // Month and list both span a calendar month.
  const { year, month } = parts(anchor);
  const monthStart = firstOfMonth(anchor);
  const monthEnd = compose(year, month, daysInMonth(year, month));
  const previous = firstOfMonth(addDays(monthStart, -1));
  const following = firstOfMonth(addDays(monthEnd, 1));

  if (view === CalendarView.LIST) {
    const length = daysInMonth(year, month);
    return {
      view,
      anchor,
      first: monthStart,
      last: monthEnd,
      heading: spanLabel(monthStart, monthEnd),
      previous,
      following,
      weeks: [],
      days: Array.from({ length }, (_, index) => addDays(monthStart, index)),
    };
  }

  // The month grid is padded to whole Sunday-to-Saturday weeks, so the shape of
  // the grid never changes with the month.
  const gridStart = addDays(monthStart, -(isoWeekday(monthStart) % 7));
  const weeks: CivilDate[][] = [];
  let cursor = gridStart;
  do {
    weeks.push(Array.from({ length: 7 }, (_, index) => addDays(cursor, index)));
    cursor = addDays(cursor, 7);
  } while (cursor <= monthEnd);

  return {
    view: CalendarView.MONTH,
    anchor,
    first: weeks[0]![0]!,
    last: weeks[weeks.length - 1]![6]!,
    heading: spanLabel(monthStart, monthEnd),
    previous,
    following,
    weeks,
    days: [],
  };
}

/**
 * "August 1 – 31, 2026", collapsing whatever the two dates share.
 *
 * Built by hand rather than with a locale formatter: the heading is part of the
 * product's own voice, and a zero-padded day number reads badly in one.
 */
function spanLabel(first: CivilDate, last: CivilDate): string {
  const a = parts(first);
  const b = parts(last);
  if (a.year !== b.year) {
    return `${monthDay(first)}, ${a.year} – ${monthDay(last)}, ${b.year}`;
  }
  if (a.month !== b.month) {
    return `${monthDay(first)} – ${monthDay(last)}, ${b.year}`;
  }
  return `${MONTHS[a.month - 1]} ${a.day} – ${b.day}, ${b.year}`;
}

function monthDay(day: CivilDate): string {
  const { month, day: dayOfMonth } = parts(day);
  return `${MONTHS[month - 1]} ${dayOfMonth}`;
}

export function step(view: CalendarView): string {
  return STEP[view];
}

// --- What the address bar carries -------------------------------------------
//
// The state stays in the URL; a parameter restating a default does not. That
// rule and its reasoning live in `lib/urlState.ts`. Here it means three things.
//
// `view=month` is what a bare `/calendar` already draws. A status list covering
// every status narrows nothing, because the query narrows only when the list is
// non-empty. And `date` is not written when it is today: today is what an
// absent anchor resolves to, so writing it says nothing — it was the parameter
// that turned "tick two statuses on this month" into an address with a date in
// it that nobody had chosen.
//
// The statuses are one comma-joined parameter rather than one parameter each.
// `status=scheduled,missed` and `status=scheduled&status=missed` mean the same
// thing and the parser takes both, so old links keep working; only one of them
// is written. The session grid's `columns` has always done this.

/**
 * Whether a status selection actually excludes anything.
 *
 * Complete means every status the menu **offers**, which is not every status in
 * the enum: `in_progress` is left out because nothing sets it yet. Every box
 * ticked is now the resting state of the control rather than a deliberate act,
 * so it has to mean what an untouched filter means — everything, including the
 * status the menu cannot show. Counting it as a filter instead would stamp a
 * parameter naming all seven statuses onto the address of a calendar nobody had
 * filtered. See `lib/selection.ts`.
 */
export function narrowsByStatus(statuses: readonly SessionStatus[]): boolean {
  return narrows(statuses, STATUS_FILTER_ORDER);
}

/**
 * The part of the grid's filter the calendar also has.
 *
 * Named rather than spelled inline at each use, because the two functions below
 * have to agree about it exactly: one decides whether the badge lights and the
 * other decides what is written down, and a key counted in one and not written
 * by the other is a filter that lights up and does nothing.
 *
 * Deliberately not the whole of `SessionFilters`. Paging and the column list
 * belong to a table, and the date bounds belong to a range the calendar already
 * decides with its view and anchor.
 */
export type CalendarFilters = Pick<
  SessionFilters,
  "search" | "statuses" | "instructorRef" | "studentRef" | "schoolRef"
>;

/**
 * How many filters are set.
 *
 * The view and the date are not among them. They decide which range is drawn,
 * not which sessions are shown — the same reason they live in the header's
 * secondary row rather than in its toolbar, and the reason resetting the filter
 * leaves you on the week you were reading.
 */
export function activeCalendarFilters(filters: CalendarFilters): number {
  return [
    filters.search !== "",
    narrowsByStatus(filters.statuses),
    filters.instructorRef !== null,
    filters.studentRef !== null,
    filters.schoolRef !== null,
  ].filter(Boolean).length;
}

/**
 * Serialise the calendar's whole state, so every link preserves it.
 *
 * Switching view, paging a month, or following a "+N more" link must not drop
 * the search text or the status filter the person just set. It must not spell
 * out the defaults either: what this omits is recoverable from the parsers, and
 * `canonicalLink` relies on that being the *only* spelling of a given state.
 *
 * `view` accepts a plain string because a component may pass one; an
 * unrecognised value falls back to the month rather than throwing in the middle
 * of a render.
 */
export function queryString(
  filters: CalendarFilters,
  options: {
    view: CalendarView | string;
    anchor?: CivilDate | null;
    /** What an absent anchor means. Given, the anchor equal to it is dropped. */
    today?: CivilDate | null;
  },
): string {
  const resolved = parseView(String(options.view));
  const params = new URLSearchParams();
  if (resolved !== CalendarView.MONTH) params.append("view", resolved);
  if (options.anchor && options.anchor !== options.today) {
    params.append("date", options.anchor);
  }
  if (filters.search) params.append("q", filters.search);
  if (narrowsByStatus(filters.statuses)) {
    params.append("status", writeStatuses(filters.statuses));
  }
  // Who, after what. Written only when set, like everything else here — an
  // empty value is what the address already means when it says nothing.
  if (filters.instructorRef) params.append("instructor", filters.instructorRef);
  if (filters.studentRef) params.append("student", filters.studentRef);
  if (filters.schoolRef) params.append("school", filters.schoolRef);
  return readableQuery(params);
}
