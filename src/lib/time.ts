/**
 * Timezone-safe scheduling primitives.
 *
 * Ported from `app/timeutil.py`. Three rules hold everywhere:
 *
 * 1. **Storage is UTC.** Every datetime column is `timestamptz` and every value
 *    handed to the database is an instant. There is no floating wall-clock time
 *    in the persistence layer.
 * 2. **Recurrence walks civil dates, never elapsed time.** A weekly 16:00
 *    session stays at 16:00 across a DST transition, even though that week is
 *    167 or 169 hours long. Adding seven days of milliseconds to an instant is
 *    the bug this module exists to prevent.
 * 3. **Display carries its zone.** A formatted time with no IANA label is
 *    ambiguous to the reader, so every formatter here takes an explicit zone.
 *
 * DST edge policy, chosen deliberately and tested:
 *
 * - **Spring-forward gap** (a civil time that does not exist): shift *forward*
 *   by the size of the gap. A 02:30 session in a zone that jumps 02:00 → 03:00
 *   lands at 03:30. Shifting forward keeps the occurrence on its intended day
 *   and never silently moves it before an earlier session.
 * - **Fall-back overlap** (a civil time that happens twice): take the **first**
 *   occurrence, the pre-transition offset. Somebody who set a reminder by wall
 *   clock arrives for the first one.
 *
 * Both are reported by `resolveCivil`, so a recurrence preview can show the
 * adjustment rather than springing it on somebody later.
 *
 * **Why the resolution is written out rather than left to the library.** Luxon
 * has its own answers for gaps and overlaps, and they are reasonable — but they
 * are the library's policy, not this product's, and they can change under a
 * minor version. The two-candidate algorithm below only asks the zone what its
 * offset was at a given instant, which is a fact rather than a policy, and
 * leaves the choice where it belongs: here, next to the reason for it.
 */

import { DateTime, IANAZone } from "luxon";

/** A calendar date with no zone and no time: `"2026-03-08"`. */
export type CivilDate = string;

/** A wall-clock time with no date and no zone: `"16:00"` or `"16:00:30"`. */
export type CivilTime = string;

/** What happened when a civil time was mapped onto a real instant. */
export enum DstEdge {
  NONE = "none",
  GAP_SHIFTED = "gap_shifted",
  AMBIGUOUS_FIRST = "ambiguous_first",
}

export interface Resolved {
  /** The instant, as stored. */
  instant: Date;
  edge: DstEdge;
}

/** Raised for anything that is not a usable IANA zone name. */
export class ZoneError extends Error {}

/** Raised for a malformed civil date or time. */
export class CivilFormatError extends Error {}

const MINUTE_MS = 60_000;
const DAY_MS = 86_400_000;

/**
 * An IANA name is short and made of a small alphabet: `America/New_York`,
 * `UTC`, `Etc/GMT+5`. Anything else is not a zone, and is worth rejecting
 * before it reaches a lookup that may consult the filesystem.
 */
const ZONE_NAME = /^[A-Za-z0-9_+-]+(?:\/[A-Za-z0-9_+-]+){0,2}$/;
const ZONE_NAME_MAX = 64;

const CIVIL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const CIVIL_TIME = /^(\d{2}):(\d{2})(?::(\d{2}))?$/;

const zoneCache = new Map<string, IANAZone>();

/**
 * Return an IANA zone, throwing `ZoneError` rather than anything lower level.
 *
 * The shape is checked before the lookup so the usual rejection is cheap and
 * never touches the disk. In the Python service this mattered for a concrete
 * reason: `ZoneInfo` resolves a name by opening a file, so a few thousand
 * characters raised `OSError` instead of "not a zone", escaped the helper, and
 * became a 500 in every caller — including the booking form, from a value a
 * browser submits.
 */
export function zone(name: string): IANAZone {
  if (typeof name !== "string" || name.length > ZONE_NAME_MAX || !ZONE_NAME.test(name)) {
    throw new ZoneError(`unknown timezone: ${JSON.stringify(name?.slice?.(0, ZONE_NAME_MAX))}`);
  }
  const cached = zoneCache.get(name);
  if (cached) return cached;

  let resolved: IANAZone;
  try {
    resolved = IANAZone.create(name);
  } catch {
    throw new ZoneError(`unknown timezone: ${JSON.stringify(name)}`);
  }
  if (!resolved.isValid) {
    throw new ZoneError(`unknown timezone: ${JSON.stringify(name)}`);
  }
  zoneCache.set(name, resolved);
  return resolved;
}

export function isValidZone(name: string): boolean {
  try {
    zone(name);
    return true;
  } catch {
    return false;
  }
}

interface Wall {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function parseCivil(day: CivilDate, timeOfDay: CivilTime): Wall {
  const d = CIVIL_DATE.exec(day);
  if (!d) throw new CivilFormatError(`not a date: ${JSON.stringify(day)}`);
  const t = CIVIL_TIME.exec(timeOfDay);
  if (!t) throw new CivilFormatError(`not a time: ${JSON.stringify(timeOfDay)}`);

  const wall: Wall = {
    year: Number(d[1]),
    month: Number(d[2]),
    day: Number(d[3]),
    hour: Number(t[1]),
    minute: Number(t[2]),
    second: t[3] === undefined ? 0 : Number(t[3]),
  };
  // Reject 2026-02-30 and 25:00 rather than letting them roll over silently
  // into a neighbouring day, which is how an off-by-one becomes a booking on
  // the wrong date.
  const asUtc = new Date(wallMs(wall));
  if (
    asUtc.getUTCFullYear() !== wall.year ||
    asUtc.getUTCMonth() + 1 !== wall.month ||
    asUtc.getUTCDate() !== wall.day ||
    wall.hour > 23 ||
    wall.minute > 59 ||
    wall.second > 59
  ) {
    throw new CivilFormatError(`not a real civil time: ${day} ${timeOfDay}`);
  }
  return wall;
}

/** The wall clock read as though it were UTC. Not an instant — an intermediate. */
function wallMs(w: Wall): number {
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second);
}

/** The wall clock an instant shows in a zone, in the same intermediate form. */
function wallOf(zoneOf: IANAZone, instantMs: number): number {
  return instantMs + zoneOf.offset(instantMs) * MINUTE_MS;
}

/**
 * Map a wall-clock date and time in `zoneName` to an instant.
 *
 * The only sanctioned way to turn "16:00 on 2026-03-08 in America/New_York"
 * into a stored value. It applies the documented DST policy and reports which
 * edge, if any, was hit.
 */
export function resolveCivil(
  day: CivilDate,
  timeOfDay: CivilTime,
  zoneName: string,
): Resolved {
  const tz = zone(zoneName);
  const wall = parseCivil(day, timeOfDay);
  const target = wallMs(wall);

  // The two offsets that could apply: the one in force a day before the wall
  // clock, and the one a day after. Either side of a transition these differ,
  // and each gives a candidate instant for the same wall clock.
  //
  // Probing a day out on both sides rather than at the wall clock itself is
  // what makes an overlap visible. During a fall-back the wall time and its
  // first candidate both still sit on the pre-transition side, so asking the
  // zone at either of them returns the same offset twice and the second
  // candidate — the one after the clocks go back — is never found. A
  // transition is always inside that window when the time is ambiguous, and
  // never two transitions wide.
  const offsetBefore = tz.offset(target - DAY_MS);
  const offsetAfter = tz.offset(target + DAY_MS);
  const candidateA = target - offsetBefore * MINUTE_MS;
  const candidateB = target - offsetAfter * MINUTE_MS;

  // A candidate is real only if reading it back in the zone gives the wall
  // clock that was asked for. In a gap neither does; in an overlap both do.
  const real = [...new Set([candidateA, candidateB])].filter(
    (ms) => wallOf(tz, ms) === target,
  );

  if (real.length === 1) {
    return { instant: new Date(real[0]!), edge: DstEdge.NONE };
  }

  if (real.length > 1) {
    // Fall-back: the civil time happens twice. Take the earlier instant, which
    // is the one with the larger offset — the pre-transition side.
    return { instant: new Date(Math.min(...real)), edge: DstEdge.AMBIGUOUS_FIRST };
  }

  // Spring-forward gap. Shifting the wall clock on by the size of the gap and
  // resolving that is the same arithmetic as using the *before* offset here,
  // and this way the intent is legible: the session moves forward, onto the
  // first moment that exists, and stays on its own day.
  const before = Math.min(offsetBefore, offsetAfter);
  return { instant: new Date(target - before * MINUTE_MS), edge: DstEdge.GAP_SHIFTED };
}

/** Render a stored instant in a display zone. */
export function toZone(instant: Date, zoneName: string): DateTime {
  return DateTime.fromJSDate(ensureUtc(instant), { zone: zone(zoneName) });
}

/**
 * Coerce to an instant, refusing anything that is not one rather than guessing.
 *
 * The Python original rejects a naive datetime here. A JavaScript `Date` is
 * always an instant, so the equivalent mistake is an invalid one — the result
 * of parsing something unparseable — which propagates as `NaN` through every
 * comparison and sorts silently rather than failing.
 */
export function ensureUtc(value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new TypeError("not an instant: an invalid Date crossed the persistence boundary");
  }
  return value;
}

export function nowUtc(): Date {
  return new Date();
}

/**
 * The calendar date an instant falls on, in a given zone.
 *
 * Calendar bucketing must use the viewer's zone. Using UTC puts a 20:00 New
 * York session on the following day for the whole of the year.
 */
export function civilDate(instant: Date, zoneName: string): CivilDate {
  return toZone(instant, zoneName).toFormat("yyyy-MM-dd");
}

/** The wall-clock time an instant shows in a zone. */
export function civilTime(instant: Date, zoneName: string): CivilTime {
  return toZone(instant, zoneName).toFormat("HH:mm");
}

/**
 * Half-open interval overlap, `[start, end)`.
 *
 * Half-open is what makes back-to-back sessions legal: 15:00–16:00 and
 * 16:00–17:00 do not collide. The database constraints use `'[)'` for the same
 * reason, and the two have to agree.
 */
export function overlaps(aStart: Date, aEnd: Date, bStart: Date, bEnd: Date): boolean {
  return aStart.getTime() < bEnd.getTime() && bStart.getTime() < aEnd.getTime();
}

/** Format for display, always suffixed with the zone abbreviation. */
export function formatWithZone(
  instant: Date,
  zoneName: string,
  format = "ccc dd LLL yyyy, HH:mm",
): string {
  const local = toZone(instant, zoneName);
  return `${local.toFormat(format)} ${local.toFormat("ZZZZ")}`;
}

// --- Civil date arithmetic ---------------------------------------------------
//
// Recurrence steps through dates on a calendar, so these never touch a zone or
// an instant. Keeping them here, beside the resolution they feed, is what stops
// somebody reaching for millisecond arithmetic on a stored instant instead.

/** Add whole days to a civil date. */
export function addDays(day: CivilDate, days: number): CivilDate {
  const w = parseCivil(day, "00:00");
  const moved = new Date(wallMs(w) + days * 86_400_000);
  return moved.toISOString().slice(0, 10);
}

/** ISO weekday, 1 = Monday, matching the stored weekday names. */
export function isoWeekday(day: CivilDate): number {
  const w = parseCivil(day, "00:00");
  const dow = new Date(wallMs(w)).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

/** Whole days from `from` to `to`, negative when `to` is earlier. */
export function daysBetween(from: CivilDate, to: CivilDate): number {
  const a = wallMs(parseCivil(from, "00:00"));
  const b = wallMs(parseCivil(to, "00:00"));
  return Math.round((b - a) / 86_400_000);
}

/** The civil date of an instant is a string, so ordering is lexicographic. */
export function compareCivilDates(a: CivilDate, b: CivilDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

// --- The Prisma boundary -----------------------------------------------------
//
// `@db.Date` and `@db.Time` columns come back as JavaScript `Date` objects with
// the missing half filled in — a date at UTC midnight, or a time on
// 1970-01-01. Those are not dates and times, they are instants pretending, and
// reading `.getHours()` on one silently applies the *server's* zone.
//
// These four functions are the only place that representation is handled, so
// the rest of the code works in the civil types above and cannot make that
// mistake by accident.

/** A `@db.Date` column as a civil date. */
export function dateFromDb(value: Date): CivilDate {
  return ensureUtc(value).toISOString().slice(0, 10);
}

/** A civil date as a value for a `@db.Date` column. */
export function dateToDb(day: CivilDate): Date {
  parseCivil(day, "00:00");
  return new Date(`${day}T00:00:00.000Z`);
}

/** A `@db.Time` column as a civil time. */
export function timeFromDb(value: Date): CivilTime {
  return ensureUtc(value).toISOString().slice(11, 16);
}

/** A civil time as a value for a `@db.Time` column. */
export function timeToDb(timeOfDay: CivilTime): Date {
  const match = CIVIL_TIME.exec(timeOfDay);
  if (!match) throw new CivilFormatError(`not a time: ${JSON.stringify(timeOfDay)}`);
  const seconds = match[3] ?? "00";
  return new Date(`1970-01-01T${match[1]}:${match[2]}:${seconds}.000Z`);
}
