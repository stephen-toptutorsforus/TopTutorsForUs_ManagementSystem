/**
 * Resolving what an instructor is actually available for.
 *
 * Ported from `app/services/availability.py`. Three layers, narrowest last:
 *
 * 1. `availability_rule` — the weekly wall-clock pattern.
 * 2. `availability_exception` — a single date that replaces or removes that day.
 * 3. `time_off` — an instant range that blocks whatever it covers.
 *
 * The organization's own opening hours and closures bound all three. An
 * instructor cannot make themselves available on a day the organization is
 * shut.
 *
 * Everything resolves **per civil date in the instructor's stated zone** and
 * only then converts to instants, for the same reason the recurrence engine
 * does: a window stored as instants drifts by an hour twice a year and starts
 * refusing bookings that were fine last week.
 */

import type { Db } from "@/lib/db";
import {
  addDays,
  type CivilDate,
  type CivilTime,
  civilDate,
  dateFromDb,
  dateToDb,
  isoWeekday,
  resolveCivil,
  timeFromDb,
  toZone,
} from "@/lib/time";

/** A concrete bookable interval, half-open. */
export interface Window {
  readonly start: Date;
  readonly end: Date;
}

export function windowContains(window: Window, start: Date, end: Date): boolean {
  return window.start.getTime() <= start.getTime() && end.getTime() <= window.end.getTime();
}

/** One instructor's bookable windows on one civil date. */
export interface DayAvailability {
  readonly day: CivilDate;
  readonly windows: Window[];
  readonly closedReason: string | null;
}

export function isOpen(availability: DayAvailability): boolean {
  return availability.windows.length > 0;
}

/** A weekday name as stored: `mon` … `sun`. */
const WEEKDAY_BY_ISO: Record<number, string> = {
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
  7: "sun",
};

/** The organization row this module needs. */
export interface OrganizationRef {
  id: bigint;
  timezone: string;
}

/** Closure dates in a range. The recurrence preview uses these to skip days. */
export async function organizationOffDays(
  db: Db,
  organizationId: bigint,
  start: CivilDate,
  end: CivilDate,
): Promise<Set<CivilDate>> {
  const rows = await db.offDay.findMany({
    where: {
      organizationId,
      day: { gte: dateToDb(start), lte: dateToDb(end) },
    },
    select: { day: true },
  });
  return new Set(rows.map((row) => dateFromDb(row.day)));
}

type Span = readonly [CivilTime, CivilTime];

/**
 * The instructor's bookable windows on one date, with every layer applied.
 */
export async function resolveDay(
  db: Db,
  organization: OrganizationRef,
  instructorId: bigint,
  day: CivilDate,
): Promise<DayAvailability> {
  const weekday = WEEKDAY_BY_ISO[isoWeekday(day)]!;
  const closed = (reason: string): DayAvailability => ({ day, windows: [], closedReason: reason });

  const offDay = await db.offDay.findFirst({
    where: { organizationId: organization.id, day: dateToDb(day) },
  });
  if (offDay) return closed(offDay.label);

  const orgWindows = await db.organizationAvailability.findMany({
    where: { organizationId: organization.id, weekday, isOpen: true },
  });
  const orgBounds: Span[] = orgWindows.map((w) => [timeFromDb(w.startTime), timeFromDb(w.endTime)]);

  const exception = await db.availabilityException.findFirst({
    where: {
      organizationId: organization.id,
      instructorId,
      day: dateToDb(day),
    },
  });

  let spans: Span[];
  let zoneName: string;

  if (exception) {
    if (!exception.isAvailable) return closed("unavailable on this date");
    if (exception.startTime && exception.endTime) {
      spans = [[timeFromDb(exception.startTime), timeFromDb(exception.endTime)]];
      zoneName = exception.timezone || organization.timezone;
    } else {
      spans = [];
      zoneName = organization.timezone;
    }
  } else {
    const rules = await db.availabilityRule.findMany({
      where: { organizationId: organization.id, instructorId, weekday },
    });
    const applicable = rules.filter(
      (rule) =>
        (rule.effectiveFrom === null || dateFromDb(rule.effectiveFrom) <= day) &&
        (rule.effectiveUntil === null || day <= dateFromDb(rule.effectiveUntil)),
    );
    spans = applicable.map((rule) => [timeFromDb(rule.startTime), timeFromDb(rule.endTime)]);
    zoneName = applicable.find((rule) => rule.timezone)?.timezone || organization.timezone;
  }

  if (spans.length === 0) return closed("no availability declared");

  // The organization's hours are an outer bound the instructor cannot exceed.
  if (orgBounds.length > 0) {
    spans = intersectSpans(spans, orgBounds);
    if (spans.length === 0) return closed("outside the organization's opening hours");
  }

  const sorted = [...spans].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  let windows: Window[] = sorted.map(([start, end]) => ({
    start: resolveCivil(day, start, zoneName).instant,
    end: resolveCivil(day, end, zoneName).instant,
  }));

  const blocks = await db.timeOff.findMany({
    where: {
      organizationId: organization.id,
      instructorId,
      startsAt: { lt: windows[windows.length - 1]!.end },
      endsAt: { gt: windows[0]!.start },
    },
  });
  if (blocks.length > 0) {
    windows = subtractBlocks(windows, blocks);
    if (windows.length === 0) return closed("time off");
  }

  return { day, windows, closedReason: null };
}

/** Clip each declared span to the organization's opening hours. */
export function intersectSpans(spans: readonly Span[], bounds: readonly Span[]): Span[] {
  const clipped: Span[] = [];
  for (const [spanStart, spanEnd] of spans) {
    for (const [boundStart, boundEnd] of bounds) {
      const start = spanStart > boundStart ? spanStart : boundStart;
      const end = spanEnd < boundEnd ? spanEnd : boundEnd;
      if (start < end) clipped.push([start, end]);
    }
  }
  return clipped;
}

/** Remove time-off ranges from a day's windows, splitting where they bisect. */
export function subtractBlocks(
  windows: readonly Window[],
  blocks: readonly { startsAt: Date; endsAt: Date }[],
): Window[] {
  let remaining = [...windows];
  for (const block of blocks) {
    const next: Window[] = [];
    for (const window of remaining) {
      if (
        block.endsAt.getTime() <= window.start.getTime() ||
        block.startsAt.getTime() >= window.end.getTime()
      ) {
        next.push(window);
        continue;
      }
      if (block.startsAt.getTime() > window.start.getTime()) {
        next.push({ start: window.start, end: block.startsAt });
      }
      if (block.endsAt.getTime() < window.end.getTime()) {
        next.push({ start: block.endsAt, end: window.end });
      }
    }
    remaining = next;
  }
  return remaining;
}

export interface AvailabilityAnswer {
  available: boolean;
  reason: string | null;
}

/**
 * Does a proposed booking fall entirely inside a declared window?
 *
 * The date is taken in the display zone, so a late-evening session is checked
 * against the right day rather than against the next one in UTC.
 */
export async function isAvailable(
  db: Db,
  organization: OrganizationRef,
  instructorId: bigint,
  start: Date,
  end: Date,
  options: { displayZone?: string | null } = {},
): Promise<AvailabilityAnswer> {
  const zoneName = options.displayZone || organization.timezone;

  // A session may straddle midnight; check every civil date it touches.
  const days = [
    ...new Set([civilDate(start, zoneName), civilDate(new Date(end.getTime() - 1), zoneName)]),
  ].sort();

  for (const day of days) {
    const availability = await resolveDay(db, organization, instructorId, day);
    if (availability.windows.some((window) => windowContains(window, start, end))) {
      return { available: true, reason: null };
    }
    if (!isOpen(availability) && days.length === 1) {
      return {
        available: false,
        reason: availability.closedReason ?? "no availability declared",
      };
    }
  }
  return { available: false, reason: "outside declared availability" };
}

/** A run of consecutive days, for one instructor's availability grid. */
export async function matrix(
  db: Db,
  organization: OrganizationRef,
  instructorId: bigint,
  start: CivilDate,
  days: number,
): Promise<DayAvailability[]> {
  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i += 1) {
    out.push(await resolveDay(db, organization, instructorId, addDays(start, i)));
  }
  return out;
}

// --- The booking screen's two views -----------------------------------------
//
// The multi-day list answers "which day should I look at"; once a day is chosen
// that question is settled and the useful one becomes "who, and when within
// it". Both read `resolveDay`, so the grid can never disagree with the list
// that led you to it.

/** Just enough of a person to draw them in either view. */
export interface Candidate {
  id: bigint;
  ref: string;
  firstName: string;
  lastName: string;
  email?: string | null;
}

/**
 * Which instructors are free on one date, for the booking screen.
 *
 * The shown list is capped so a large roster does not turn one row into a wall
 * of initials; `total` is the honest count, so "5+ available" never overstates.
 */
export interface DayOpenings {
  day: CivilDate;
  /** `[ref, initials]`, capped. */
  instructors: [string, string][];
  total: number;
  earliest: Date | null;
}

export function openingsAreOpen(day: DayOpenings): boolean {
  return day.total > 0;
}

/**
 * Two letters, for the avatar. Never the full name — this list is dense and a
 * row of full names is unreadable; the ref carries the real identity.
 */
function initialsOf(person: Candidate): string {
  return ((person.firstName || "?").slice(0, 1) + (person.lastName || "").slice(0, 1))
    .toUpperCase();
}

function displayNameOf(person: Candidate): string {
  return `${person.firstName} ${person.lastName}`.trim() || person.ref;
}

/**
 * For each of the next `days` days, which candidates have a free window.
 *
 * "Free" here means **declared availability long enough for the session**, not
 * "has no other booking" — the conflict check does the second, and does it per
 * proposed occurrence. Showing a day as open and then reporting a clash at
 * preview is the honest order: this list narrows the search, the preview
 * decides.
 */
export async function openings(
  db: Db,
  organization: OrganizationRef,
  candidates: readonly Candidate[],
  options: {
    start: CivilDate;
    days: number;
    durationMinutes: number;
    showAtMost?: number;
  },
): Promise<DayOpenings[]> {
  const { start, days, durationMinutes, showAtMost = 5 } = options;
  const needed = durationMinutes * 60_000;
  const result: DayOpenings[] = [];

  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(start, offset);
    const free: [string, string][] = [];
    let earliest: Date | null = null;
    let total = 0;

    for (const person of candidates) {
      const availability = await resolveDay(db, organization, person.id, day);
      const usable = availability.windows.filter(
        (window) => window.end.getTime() - window.start.getTime() >= needed,
      );
      if (usable.length === 0) continue;

      total += 1;
      if (free.length < showAtMost) free.push([person.ref, initialsOf(person)]);

      const first = usable.reduce((a, b) => (a.start <= b.start ? a : b)).start;
      if (earliest === null || first < earliest) earliest = first;
    }

    result.push({ day, instructors: free, total, earliest });
  }
  return result;
}

/**
 * One time column of the day grid.
 *
 * `label` is for reading, `value` is for the Start time field — the same
 * instant said twice, so a cell the person clicks cannot put a different time
 * in the form than the one it displayed. Both are derived from the local clock,
 * so on the day a DST jump skips an hour the column shows and submits the clock
 * reading that actually exists.
 */
export interface GridColumn {
  start: Date;
  label: string;
  value: CivilTime;
}

/** One instructor's row: which columns they are free for. */
export interface GridRow {
  ref: string;
  name: string;
  email: string;
  initials: string;
  free: boolean[];
  closedReason: string | null;
}

export function rowIsOpen(row: GridRow): boolean {
  return row.free.some(Boolean);
}

/** Instructors down the side, time across the top, for one chosen date. */
export interface DayGrid {
  day: CivilDate;
  columns: GridColumn[];
  rows: GridRow[];
}

export function anyOpen(grid: DayGrid): boolean {
  return grid.rows.some(rowIsOpen);
}

/**
 * `"9 AM"`, `"9:30 AM"` — the minutes are dropped when they are zero, because a
 * header row of ":00" repeated twelve times is noise.
 */
function clockLabel(instant: Date, timezone: string): string {
  const local = toZone(instant, timezone);
  const hour = local.hour % 12 || 12;
  const suffix = local.hour < 12 ? "AM" : "PM";
  return local.minute
    ? `${hour}:${String(local.minute).padStart(2, "0")} ${suffix}`
    : `${hour} ${suffix}`;
}

/**
 * Who is free, hour by hour, on one date.
 *
 * Columns start at `fromTime` rather than at midnight: the person has already
 * said when they want the session, and a grid that opens on eight columns of
 * 3 a.m. buries the answer. Columns stop at the end of the civil day rather
 * than rolling into the next one, because a window that ends at midnight is
 * where this day's availability ends.
 *
 * A column is free when the instructor has one declared window covering the
 * whole session — not merely overlapping the column. A 30-minute gap cannot
 * hold a 60-minute session, and showing it as free would be a promise the
 * preview then has to break.
 */
export async function dayGrid(
  db: Db,
  organization: OrganizationRef,
  candidates: readonly Candidate[],
  options: {
    day: CivilDate;
    fromTime: CivilTime;
    durationMinutes: number;
    timezone: string;
    columns?: number;
    stepMinutes?: number;
  },
): Promise<DayGrid> {
  const { day, fromTime, durationMinutes, timezone } = options;
  const columns = options.columns ?? 12;
  const stepMs = (options.stepMinutes ?? 60) * 60_000;
  const needed = durationMinutes * 60_000;

  const dayEnd = resolveCivil(addDays(day, 1), "00:00", timezone).instant;
  let cursor = resolveCivil(day, fromTime, timezone).instant;

  const slots: GridColumn[] = [];
  while (slots.length < columns && cursor < dayEnd) {
    slots.push({
      start: cursor,
      label: clockLabel(cursor, timezone),
      value: toZone(cursor, timezone).toFormat("HH:mm"),
    });
    cursor = new Date(cursor.getTime() + stepMs);
  }

  const rows: GridRow[] = [];
  for (const person of candidates) {
    const availability = await resolveDay(db, organization, person.id, day);
    rows.push({
      ref: person.ref,
      name: displayNameOf(person),
      email: person.email ?? "",
      initials: initialsOf(person),
      free: slots.map((slot) =>
        availability.windows.some((window) =>
          windowContains(window, slot.start, new Date(slot.start.getTime() + needed)),
        ),
      ),
      closedReason: availability.closedReason,
    });
  }

  return { day, columns: slots, rows };
}

// --- The repeat grid ---------------------------------------------------------
//
// A fourth view, for the case the other three cannot answer. Once a run repeats
// on several weekdays with one instructor, "when is this person free" is a
// question per *weekday*, not per date: the useful table has Monday, Wednesday
// and Friday down the side rather than one chosen day. It is still `resolveDay`
// underneath, so it cannot disagree with the grid that led here.

/** The first date on or after `from` that falls on this weekday. */
export function onOrAfter(from: CivilDate, weekday: string): CivilDate {
  for (let ahead = 0; ahead < 7; ahead += 1) {
    const day = addDays(from, ahead);
    if (WEEKDAY_BY_ISO[isoWeekday(day)] === weekday) return day;
  }
  return from;
}

/** One weekday of a repeating run, and what the instructor has free on it. */
export interface WeekdayRow {
  weekday: string;
  /** The concrete date this weekday resolved to — never one in the past. */
  day: CivilDate;
  /**
   * The length this row was tested against, which is this weekday's own. A
   * thirty-minute Wednesday genuinely has more openings than a ninety-minute
   * Friday, and a table that tested them all against one length would be
   * telling the Friday row the Wednesday's answer.
   */
  durationMinutes: number;
  free: boolean[];
  closedReason: string | null;
}

export interface WeekdayGrid {
  columns: GridColumn[];
  rows: WeekdayRow[];
}

/**
 * One instructor, several weekdays: which start times each of them can hold.
 *
 * The columns are computed once, from the earliest row's date, and every other
 * row is asked about *the same clock times* on its own date rather than about
 * the same instants. That is the difference between a table whose header means
 * one thing and one whose Wednesday column silently means an hour earlier than
 * its Monday column across a daylight-saving change.
 *
 * Rows come back in date order, so the table reads as the run does. A weekday
 * earlier in the week than the start date resolves into the following week,
 * because that is when it will actually first be taught.
 */
export async function weekdayGrid(
  db: Db,
  organization: OrganizationRef,
  instructorId: bigint,
  wanted: readonly { weekday: string; durationMinutes: number }[],
  options: {
    from: CivilDate;
    fromTime: CivilTime;
    timezone: string;
    columns?: number;
    stepMinutes?: number;
  },
): Promise<WeekdayGrid> {
  const { from, fromTime, timezone } = options;
  const wantedColumns = options.columns ?? 16;
  const stepMs = (options.stepMinutes ?? 30) * 60_000;

  const days = wanted
    .map((row) => ({ ...row, day: onOrAfter(from, row.weekday) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const anchor = days[0]?.day ?? from;
  const dayEnd = resolveCivil(addDays(anchor, 1), "00:00", timezone).instant;
  let cursor = resolveCivil(anchor, fromTime, timezone).instant;

  const columns: GridColumn[] = [];
  while (columns.length < wantedColumns && cursor < dayEnd) {
    columns.push({
      start: cursor,
      label: clockLabel(cursor, timezone),
      value: toZone(cursor, timezone).toFormat("HH:mm"),
    });
    cursor = new Date(cursor.getTime() + stepMs);
  }

  const rows: WeekdayRow[] = [];
  for (const entry of days) {
    const availability = await resolveDay(db, organization, instructorId, entry.day);
    const needed = entry.durationMinutes * 60_000;
    rows.push({
      weekday: entry.weekday,
      day: entry.day,
      durationMinutes: entry.durationMinutes,
      free: columns.map((column) => {
        const start = resolveCivil(entry.day, column.value, timezone).instant;
        return availability.windows.some((window) =>
          windowContains(window, start, new Date(start.getTime() + needed)),
        );
      }),
      closedReason: availability.closedReason,
    });
  }

  return { columns, rows };
}
