/**
 * The calendar screen: month, week, day, and list views.
 *
 * Ported from `app/web/calendar_view.py`.
 *
 * All four views are one route over one query. They differ only in the date
 * range they ask for and how the page lays the result out, which is why
 * switching view keeps the search text, the status filter, and the date you
 * were looking at — they all live in the URL.
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
import { canonicalUrl, readableQuery } from "@/lib/urlState";

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

// --- Remembering the status filter ------------------------------------------
//
// The screen's state lives in the URL, which is what makes it shareable — but
// the sidebar link is a bare `/calendar` and carries no state at all, so
// leaving a filter set and coming back later lost it. The status filter is the
// one part of that state a person means to keep: it is how they say "I only
// care about the cancelled ones" and it is not tied to a date or a search they
// have since moved on from.
//
// So it is remembered in a cookie, and a bare `/calendar` redirects to the URL
// that spells it out rather than quietly filtering. That distinction matters:
// had the filter been applied without changing the address, copying `/calendar`
// and sending it to a colleague would show them *their* last filter rather than
// what the sender was looking at.

export const STATUS_COOKIE = "toptutorsforus_calendar_status";

/**
 * Long enough to still be there after a weekend and a holiday, short enough
 * that a filter set once and forgotten does not follow somebody for ever.
 */
export const STATUS_COOKIE_MAX_AGE = 60 * 60 * 24 * 90;

/**
 * The parameters that make a URL authoritative about the whole screen. If any
 * one of them is present the URL is taken at its word, including the *absence*
 * of `status` — otherwise "Clear all", which navigates with a view and a date
 * and no statuses, would be undone by the remembered value on arrival.
 */
export const STATE_PARAMS = ["view", "date", "q", "status"] as const;

/** Whether this URL says anything about which calendar to draw. */
export function carriesState(params: URLSearchParams): boolean {
  return STATE_PARAMS.some((name) => params.has(name));
}

/**
 * Statuses read back from the cookie, dropping anything unrecognised.
 *
 * A cookie is user-supplied input like any other. A status this build does not
 * have — an older name, or something typed by hand — is ignored rather than
 * raising, exactly as an unknown `status=` in the query string is.
 */
export function readStatuses(raw: string | null | undefined): SessionStatus[] {
  if (!raw) return [];
  const known = Object.values(SessionStatus) as string[];
  const seen: SessionStatus[] = [];
  for (const name of raw.split(",").slice(0, known.length)) {
    const trimmed = name.trim();
    const match = known.find(
      (status) => status === trimmed || status.toLowerCase() === trimmed,
    );
    if (match === undefined) continue;
    if (!seen.includes(match as SessionStatus)) seen.push(match as SessionStatus);
  }
  return seen;
}

export function writeStatuses(statuses: readonly SessionStatus[]): string {
  return statuses.map((status) => status.toLowerCase()).join(",");
}

/**
 * The URL a bare `/calendar` sends someone to when a filter is remembered.
 *
 * Only the statuses are restored. `anchor: null` is the point of the rest:
 * coming back to the calendar should show now, not the month somebody was
 * reading on Friday.
 */
export function restoredLink(statuses: readonly SessionStatus[]): string {
  return calendarLink({ search: "", statuses }, { view: CalendarView.MONTH, anchor: null });
}

/**
 * Statuses read back from one parameter or several.
 *
 * The forms submit a checkbox per status, so `status=a&status=b` arrives from
 * the browser; the links write `status=a,b`. Both are accepted, and the tidying
 * settles the first into the second.
 */
export function statusValues(params: URLSearchParams): string[] {
  return params.getAll("status").flatMap((chunk) => chunk.split(","));
}

/**
 * The calendar's answer to `canonicalUrl` — see `lib/urlState.ts` for the rule.
 *
 * Only `view`, `date`, `q` and `status` reach the query; `calendarRange` reads
 * nothing else off the filters. So any other parameter on a calendar URL was
 * already being ignored, and dropping it from the address removes a lie rather
 * than a feature.
 *
 * `date` is dropped when it is today rather than kept because it was asked for.
 * A bare `/calendar` has always meant "now"; writing today's date beside it says
 * the same thing twice, and it was the single commonest piece of noise in a
 * filtered address. Paging to another month still writes the month.
 */
export function canonicalLink(
  params: URLSearchParams,
  state: {
    filters: Pick<SessionFilters, "search" | "statuses">;
    view: CalendarView;
    anchor: CivilDate;
    today: CivilDate;
  },
): string | null {
  return canonicalUrl(
    "/calendar",
    params,
    queryString(state.filters, {
      view: state.view,
      anchor: state.anchor,
      today: state.today,
    }),
  );
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
 * How many filters are set.
 *
 * The view and the date are not among them. They decide which range is drawn,
 * not which sessions are shown — the same reason they live in the header's
 * secondary row rather than in its toolbar, and the reason resetting the filter
 * leaves you on the week you were reading.
 */
export function activeCalendarFilters(
  filters: Pick<SessionFilters, "search" | "statuses">,
): number {
  return [filters.search !== "", narrowsByStatus(filters.statuses)].filter(Boolean).length;
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
  filters: Pick<SessionFilters, "search" | "statuses">,
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
  return readableQuery(params);
}

/**
 * The calendar at this state, as a path.
 *
 * A separate function because `queryString` is now empty for the default
 * screen, and `/calendar?` with a bare question mark is the kind of thing that
 * ends up in a bookmark.
 */
export function calendarLink(
  filters: Pick<SessionFilters, "search" | "statuses">,
  options: {
    view: CalendarView | string;
    anchor?: CivilDate | null;
    today?: CivilDate | null;
  },
): string {
  const query = queryString(filters, options);
  return query ? `/calendar?${query}` : "/calendar";
}
