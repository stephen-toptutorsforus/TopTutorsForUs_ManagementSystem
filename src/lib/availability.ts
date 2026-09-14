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

// --- One rule, two ways to feed it ------------------------------------------
//
// The layers are rows; turning rows into windows is the rule. The rule lives in
// exactly one place — `resolveFrom` — and everything that needs an answer feeds
// it. `resolveDay` fetches one instructor's one day. `resolveRange` fetches
// every instructor's whole range in the same five statements, which is what
// makes a fifty-six day matrix across a hundred instructors cost five queries
// rather than twenty-eight thousand.
//
// Keeping it one function rather than two implementations is the point. A grid
// and a list that each carried their own copy of "narrowest layer last" would
// eventually disagree, and the screen that showed a time would stop matching
// the preview that refused it.
//
// The cost is that `resolveDay` no longer returns early on a closed day: it
// asks for all five layers whichever way the answer goes. That is up to four
// extra statements on a day the organization is shut, and none at all on a day
// somebody is teaching — which is the case that runs in a loop.

/** Just the columns the rule reads, so `resolveFrom` needs no Prisma types. */
interface ExceptionLike {
  isAvailable: boolean;
  startTime: Date | null;
  endTime: Date | null;
  timezone: string | null;
}

interface RuleLike {
  startTime: Date;
  endTime: Date;
  timezone: string | null;
  effectiveFrom: Date | null;
  effectiveUntil: Date | null;
}

interface BlockLike {
  startsAt: Date;
  endsAt: Date;
}

/**
 * Every row the rule can need, indexed the way it asks for them.
 *
 * Keyed by strings rather than by nested maps because the two-part keys
 * (instructor and day, instructor and weekday) are looked up and never
 * enumerated.
 */
export interface AvailabilityLayers {
  /** Civil date to the closure's label. */
  offDays: Map<CivilDate, string>;
  /** `mon` … `sun` to the organization's open spans on it. */
  orgBounds: Map<string, Span[]>;
  /** `instructorId|day`. */
  exceptions: Map<string, ExceptionLike>;
  /** `instructorId|weekday`. */
  rules: Map<string, RuleLike[]>;
  /** `instructorId`. Blocks are filtered by instant, so the whole range is held. */
  blocks: Map<string, BlockLike[]>;
}

const dayKey = (instructorId: bigint, day: CivilDate) => `${instructorId}|${day}`;
const weekdayKey = (instructorId: bigint, weekday: string) => `${instructorId}|${weekday}`;

/**
 * The rule: rows in, one instructor's windows on one date out.
 *
 * Pure, and the only implementation. Narrowest layer last — a closure beats
 * everything, an exception replaces the weekly pattern, the organization's
 * hours bound whatever survives, and time off is subtracted from the result.
 */
export function resolveFrom(
  layers: AvailabilityLayers,
  organization: OrganizationRef,
  instructorId: bigint,
  day: CivilDate,
): DayAvailability {
  const weekday = WEEKDAY_BY_ISO[isoWeekday(day)]!;
  const closed = (reason: string): DayAvailability => ({ day, windows: [], closedReason: reason });

  const offDay = layers.offDays.get(day);
  if (offDay !== undefined) return closed(offDay);

  const orgBounds = layers.orgBounds.get(weekday) ?? [];
  const exception = layers.exceptions.get(dayKey(instructorId, day));

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
    const rules = layers.rules.get(weekdayKey(instructorId, weekday)) ?? [];
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

  // Held for the whole range, so narrow to the ones that touch this day's
  // windows — the same test the single-day query used to make in SQL.
  const first = windows[0]!.start.getTime();
  const last = windows[windows.length - 1]!.end.getTime();
  const blocks = (layers.blocks.get(String(instructorId)) ?? []).filter(
    (block) => block.startsAt.getTime() < last && block.endsAt.getTime() > first,
  );
  if (blocks.length > 0) {
    windows = subtractBlocks(windows, blocks);
    if (windows.length === 0) return closed("time off");
  }

  return { day, windows, closedReason: null };
}

/**
 * Every layer for a set of instructors over a date range, in five statements.
 *
 * The count does not depend on how many instructors or how many days are asked
 * for. That is the whole point: the caller that used to loop now fetches once
 * and decides in memory.
 */
export async function fetchLayers(
  db: Db,
  organization: OrganizationRef,
  instructorIds: readonly bigint[],
  from: CivilDate,
  to: CivilDate,
): Promise<AvailabilityLayers> {
  const ids = [...new Set(instructorIds)];
  const scope = { organizationId: organization.id };
  // Generous by a day at each end: a window resolved in a zone behind or ahead
  // of the organization's can begin before the range's first midnight or end
  // after its last, and a block that straddles the boundary still bites.
  const rangeStart = new Date(`${addDays(from, -1)}T00:00:00.000Z`);
  const rangeEnd = new Date(`${addDays(to, 2)}T00:00:00.000Z`);

  const [offDays, orgWindows, exceptions, rules, blocks] = await Promise.all([
    db.offDay.findMany({
      where: { ...scope, day: { gte: dateToDb(from), lte: dateToDb(to) } },
      select: { day: true, label: true },
    }),
    db.organizationAvailability.findMany({ where: { ...scope, isOpen: true } }),
    ids.length === 0
      ? []
      : db.availabilityException.findMany({
          where: {
            ...scope,
            instructorId: { in: ids },
            day: { gte: dateToDb(from), lte: dateToDb(to) },
          },
        }),
    ids.length === 0
      ? []
      : db.availabilityRule.findMany({ where: { ...scope, instructorId: { in: ids } } }),
    ids.length === 0
      ? []
      : db.timeOff.findMany({
          where: {
            ...scope,
            instructorId: { in: ids },
            startsAt: { lt: rangeEnd },
            endsAt: { gt: rangeStart },
          },
        }),
  ]);

  const layers: AvailabilityLayers = {
    offDays: new Map(offDays.map((row) => [dateFromDb(row.day), row.label])),
    orgBounds: new Map(),
    exceptions: new Map(),
    rules: new Map(),
    blocks: new Map(),
  };

  for (const window of orgWindows) {
    const spans = layers.orgBounds.get(window.weekday) ?? [];
    spans.push([timeFromDb(window.startTime), timeFromDb(window.endTime)]);
    layers.orgBounds.set(window.weekday, spans);
  }
  for (const exception of exceptions) {
    layers.exceptions.set(dayKey(exception.instructorId, dateFromDb(exception.day)), exception);
  }
  for (const rule of rules) {
    const key = weekdayKey(rule.instructorId, rule.weekday);
    const list = layers.rules.get(key) ?? [];
    list.push(rule);
    layers.rules.set(key, list);
  }
  for (const block of blocks) {
    const key = String(block.instructorId);
    const list = layers.blocks.get(key) ?? [];
    list.push(block);
    layers.blocks.set(key, list);
  }

  return layers;
}

/**
 * The instructor's bookable windows on one date, with every layer applied.
 */
export async function resolveDay(
  db: Db,
  organization: OrganizationRef,
  instructorId: bigint,
  day: CivilDate,
): Promise<DayAvailability> {
  const layers = await fetchLayers(db, organization, [instructorId], day, day);
  return resolveFrom(layers, organization, instructorId, day);
}

/**
 * Several instructors over a run of consecutive days, in five statements.
 *
 * Returned as a lookup keyed by instructor and date rather than as a nested
 * shape, because every caller asks about one pair at a time.
 */
export async function resolveRange(
  db: Db,
  organization: OrganizationRef,
  instructorIds: readonly bigint[],
  start: CivilDate,
  days: number,
): Promise<Map<string, DayAvailability>> {
  const last = addDays(start, Math.max(0, days - 1));
  const layers = await fetchLayers(db, organization, instructorIds, start, last);

  const out = new Map<string, DayAvailability>();
  for (const instructorId of new Set(instructorIds)) {
    for (let offset = 0; offset < days; offset += 1) {
      const day = addDays(start, offset);
      out.set(dayKey(instructorId, day), resolveFrom(layers, organization, instructorId, day));
    }
  }
  return out;
}

/**
 * When each instructor is already booked, keyed by instructor id.
 *
 * Declared hours say when somebody *works*; this says when they are already
 * spoken for, and the grids need both. It is fetched by `busyIntervals` in
 * `lib/conflicts.ts` and passed in rather than looked up here: the query needs
 * `BLOCKING_STATUSES`, which lives with the conflict check that agrees with the
 * database constraint, and that module already reads this one.
 */
export type BusyByInstructor = Map<string, Window[]>;

/** Does a proposed interval overlap anything already booked? Half-open. */
export function overlapsBusy(busy: readonly Window[] | undefined, start: Date, end: Date): boolean {
  if (busy === undefined) return false;
  return busy.some(
    (taken) => taken.start.getTime() < end.getTime() && taken.end.getTime() > start.getTime(),
  );
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
  const resolved = await resolveRange(db, organization, [instructorId], start, days);
  const out: DayAvailability[] = [];
  for (let i = 0; i < days; i += 1) {
    const day = addDays(start, i);
    out.push(resolved.get(dayKey(instructorId, day))!);
  }
  return out;
}

// --- The booking screen's two views -----------------------------------------
//
// The multi-day list answers "which day should I look at"; once a day is chosen
// that question is settled and the useful one becomes "who, and when within
// it". Both resolve through `resolveFrom`, so the grid can never disagree with
// the list that led you to it, and both fetch their layers in one go rather
// than a query per person per day.

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

/** Declared windows with what is already booked cut out of them. */
export function withoutBusy(windows: readonly Window[], busy: readonly Window[] | undefined): Window[] {
  if (busy === undefined || busy.length === 0) return [...windows];
  return subtractBlocks(
    windows,
    busy.map((taken) => ({ startsAt: taken.start, endsAt: taken.end })),
  );
}

/**
 * For each of the next `days` days, which candidates have a free window.
 *
 * "Free" is declared availability long enough for the session, with anything
 * already booked cut out of it first. A day whose only long-enough window is
 * taken is not a day to look at, and saying so here is what keeps this list
 * agreeing with the grid it leads to.
 *
 * It remains a narrowing rather than a promise: this asks about the
 * instructor, and the preview additionally asks about the students, the room
 * and the tenant's own rules. What it must not do is offer a time the write
 * will certainly refuse.
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
    /** Already-booked intervals by instructor id; see `busyIntervals`. */
    busy?: BusyByInstructor;
  },
): Promise<DayOpenings[]> {
  const { start, days, durationMinutes, showAtMost = 5, busy } = options;
  const needed = durationMinutes * 60_000;
  const result: DayOpenings[] = [];

  // Five statements for the whole matrix, however many people and days it
  // covers. This used to be one query per person per day.
  const resolved = await resolveRange(
    db,
    organization,
    candidates.map((person) => person.id),
    start,
    days,
  );

  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(start, offset);
    const free: [string, string][] = [];
    let earliest: Date | null = null;
    let total = 0;

    for (const person of candidates) {
      const availability = resolved.get(dayKey(person.id, day));
      if (availability === undefined) continue;
      const open = withoutBusy(availability.windows, busy?.get(String(person.id)));
      const usable = open.filter(
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
  /**
   * Which of the not-free columns are not free *because something is already
   * booked* there, rather than because nobody declared hours.
   *
   * Two different things to be told, and the table says which: "he does not
   * work then" is fixed by choosing another time, "he is teaching then" by
   * choosing another instructor. Parallel to `free` rather than folded into it
   * so a cell can be drawn as taken without the code that reads `free` having
   * to learn a third state.
   */
  taken: boolean[];
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
  return clockLabelOf(local.hour * 60 + local.minute);
}

/** The same label, from a clock reading rather than from an instant. */
function clockLabelOf(minutes: number): string {
  const hour24 = Math.floor(minutes / 60);
  const minute = minutes % 60;
  const hour = hour24 % 12 || 12;
  const suffix = hour24 < 12 ? "AM" : "PM";
  return minute ? `${hour}:${String(minute).padStart(2, "0")} ${suffix}` : `${hour} ${suffix}`;
}

const MINUTES_IN_DAY = 24 * 60;

function minutesOfClock(time: CivilTime): number {
  const [hour = "0", minute = "0"] = time.split(":");
  const total = Number.parseInt(hour, 10) * 60 + Number.parseInt(minute, 10);
  return Number.isFinite(total) ? total : 0;
}

function clockOfMinutes(minutes: number): CivilTime {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
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
 *
 * A column already booked is not free either, and for a stronger reason. This
 * grid is about **one specific date**, so a clash here is exactly the clash the
 * preview will report, and `INSTRUCTOR_BUSY` is one of the kinds no override
 * clears. Offering it would be offering a time the database itself refuses. It
 * is reported separately in `taken` so the cell can say which of the two it is.
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
    /** Already-booked intervals by instructor id; see `busyIntervals`. */
    busy?: BusyByInstructor;
  },
): Promise<DayGrid> {
  const { day, fromTime, durationMinutes, timezone, busy } = options;
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

  const resolved = await resolveRange(
    db,
    organization,
    candidates.map((person) => person.id),
    day,
    1,
  );

  const rows: GridRow[] = [];
  for (const person of candidates) {
    const availability = resolved.get(dayKey(person.id, day))!;
    const booked = busy?.get(String(person.id));
    const declared = slots.map((slot) =>
      availability.windows.some((window) =>
        windowContains(window, slot.start, new Date(slot.start.getTime() + needed)),
      ),
    );
    const taken = slots.map(
      (slot, index) =>
        declared[index] === true &&
        overlapsBusy(booked, slot.start, new Date(slot.start.getTime() + needed)),
    );
    rows.push({
      ref: person.ref,
      name: displayNameOf(person),
      email: person.email ?? "",
      initials: initialsOf(person),
      // Declared *and* not already booked. `taken` marks only the cells the
      // second test removed, so the table can distinguish "does not work then"
      // from "is teaching then" without a third state to reason about.
      free: declared.map((open, index) => open && taken[index] !== true),
      taken,
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
  /**
   * Which columns are already booked **on this row's representative date**.
   *
   * Unlike `dayGrid`'s, this does not make the column unfree. The row stands
   * for a weekday across a whole run, and a clash on the first Wednesday says
   * nothing about the fifth: it costs that one occurrence, not the time. So the
   * cell is marked and still offered, and Preview stays the authority on which
   * occurrences actually clash.
   */
  taken: boolean[];
  closedReason: string | null;
}

export interface WeekdayGrid {
  columns: GridColumn[];
  rows: WeekdayRow[];
}

/**
 * One instructor, several weekdays: which start times each of them can hold.
 *
 * The columns are a fixed run of clock readings, and every row is asked about
 * *the same clock times* on its own date rather than about the same instants.
 * That is the difference between a table whose header means one thing and one
 * whose Wednesday column silently means an hour earlier than its Monday column
 * across a daylight-saving change. They are built by clock arithmetic rather
 * than by adding an hour to an instant for the same reason: on the day the
 * clocks go forward the second walk yields 23 readings and drops one of the
 * headings, so the axis would depend on which weekday happened to sort first.
 *
 * `fromTime` is where the axis begins, not where the chosen time is. The
 * caller that draws the repeat table passes midnight and asks for the whole
 * day, because an axis that moved to wherever the last cell was pressed would
 * redraw itself under the person using it. `dayGrid`'s axis does start at the
 * chosen time, and that stays true: there the person is picking one time on one
 * date and eight columns of 3 a.m. would bury the answer.
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
    /** Already-booked intervals by instructor id; see `busyIntervals`. */
    busy?: BusyByInstructor;
  },
): Promise<WeekdayGrid> {
  const { from, fromTime, timezone, busy } = options;
  const wantedColumns = options.columns ?? 16;
  const step = options.stepMinutes ?? 30;

  const days = wanted
    .map((row) => ({ ...row, day: onOrAfter(from, row.weekday) }))
    .sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0));

  const anchor = days[0]?.day ?? from;

  const columns: GridColumn[] = [];
  for (
    let minutes = minutesOfClock(fromTime);
    minutes < MINUTES_IN_DAY && columns.length < wantedColumns;
    minutes += step
  ) {
    const value = clockOfMinutes(minutes);
    columns.push({
      start: resolveCivil(anchor, value, timezone).instant,
      label: clockLabelOf(minutes),
      value,
    });
  }

  // Every row falls inside one week of `from`, so one fetch covers them all
  // even though the dates are not consecutive.
  const layers = await fetchLayers(db, organization, [instructorId], from, addDays(from, 6));
  const booked = busy?.get(String(instructorId));

  const rows: WeekdayRow[] = [];
  for (const entry of days) {
    const availability = resolveFrom(layers, organization, instructorId, entry.day);
    const needed = entry.durationMinutes * 60_000;
    const starts = columns.map(
      (column) => resolveCivil(entry.day, column.value, timezone).instant,
    );
    rows.push({
      weekday: entry.weekday,
      day: entry.day,
      durationMinutes: entry.durationMinutes,
      free: starts.map((start) =>
        availability.windows.some((window) =>
          windowContains(window, start, new Date(start.getTime() + needed)),
        ),
      ),
      taken: starts.map((start) =>
        overlapsBusy(booked, start, new Date(start.getTime() + needed)),
      ),
      closedReason: availability.closedReason,
    });
  }

  return { columns, rows };
}
