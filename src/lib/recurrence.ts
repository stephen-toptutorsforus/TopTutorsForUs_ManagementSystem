/**
 * Recurrence expansion.
 *
 * Ported from `app/services/recurrence.py`. It turns a rule into a concrete
 * list of occurrences, and it is pure: no database, no clock, no I/O.
 *
 * That purity is deliberate. The recurrence *preview* the product shows and the
 * recurrence *generation* that writes rows must produce identical results, and
 * the only reliable way to guarantee that is for both to call this function.
 *
 * **It walks civil dates.** The loop advances a calendar date in the rule's own
 * zone and only converts to an instant at the very end, through `resolveCivil`.
 * It never adds elapsed time to an instant. That distinction is the entire
 * reason a weekly 16:00 session stays at 16:00 through a DST change instead of
 * drifting to 15:00 for half the year.
 *
 * **Bounds are always applied.** A rule ending on a distant date could
 * otherwise generate thousands of rows. Expansion stops at the tenant's
 * ceiling or horizon and *reports* that it did, so a preview can say "stopped
 * at 60 of a requested 104" rather than silently producing 60.
 */

import {
  addDays,
  type CivilDate,
  type CivilTime,
  daysBetween,
  DstEdge,
  isoWeekday,
  resolveCivil,
} from "@/lib/time";

/**
 * A ceiling on loop iterations, independent of the tenant's occurrence limit.
 * It bounds the walk even for a rule whose weekday selection matches rarely.
 */
export const MAX_CANDIDATE_DAYS = 3660; // ten years of daily candidates

export type RecurrenceFrequency = "daily" | "weekly";
export type RecurrenceEndMode = "count" | "until";
export type Weekday = "mon" | "tue" | "wed" | "thu" | "fri" | "sat" | "sun";

/** ISO weekday numbers, 1 = Monday, matching the stored names. */
const WEEKDAY_ISO: Record<Weekday, number> = {
  mon: 1,
  tue: 2,
  wed: 3,
  thu: 4,
  fri: 5,
  sat: 6,
  sun: 7,
};

const WEEKDAY_BY_ISO: Record<number, Weekday> = {
  1: "mon",
  2: "tue",
  3: "wed",
  4: "thu",
  5: "fri",
  6: "sat",
  7: "sun",
};

/** A rule that cannot be expanded. Thrown before any row is written. */
export class RecurrenceError extends Error {}

/** A validated recurrence. Build one through `buildRule` to get the checks. */
export interface RecurrenceRule {
  readonly frequency: RecurrenceFrequency;
  readonly intervalN: number;
  readonly weekdays: readonly Weekday[];
  readonly startDate: CivilDate;
  readonly startTime: CivilTime;
  readonly durationMinutes: number;
  readonly timezone: string;
  readonly endMode: RecurrenceEndMode;
  readonly occurrenceCount: number | null;
  readonly untilDate: CivilDate | null;
}

/** One occurrence a rule would produce, before anything is saved. */
export interface PlannedOccurrence {
  /** 1-based position in the series. */
  readonly index: number;
  readonly localDate: CivilDate;
  readonly start: Date;
  readonly end: Date;
  readonly dstEdge: DstEdge;
}

export function shiftedByDst(occurrence: PlannedOccurrence): boolean {
  return occurrence.dstEdge !== DstEdge.NONE;
}

/** The result of expanding a rule, including what was left out and why. */
export interface Expansion {
  readonly occurrences: PlannedOccurrence[];
  readonly truncated: boolean;
  readonly truncationReason: string | null;
  readonly requestedCount: number | null;
  readonly skippedDates: CivilDate[];
}

export function first(expansion: Expansion): PlannedOccurrence | null {
  return expansion.occurrences[0] ?? null;
}

export function last(expansion: Expansion): PlannedOccurrence | null {
  return expansion.occurrences[expansion.occurrences.length - 1] ?? null;
}

/** Occurrences a DST edge moved. The preview surfaces these explicitly. */
export function dstAdjusted(expansion: Expansion): PlannedOccurrence[] {
  return expansion.occurrences.filter(shiftedByDst);
}

export interface BuildRuleInput {
  frequency: RecurrenceFrequency;
  startDate: CivilDate;
  startTime: CivilTime;
  durationMinutes: number;
  timezone: string;
  endMode: RecurrenceEndMode;
  intervalN?: number;
  weekdays?: readonly string[] | null;
  occurrenceCount?: number | null;
  untilDate?: CivilDate | null;
}

/**
 * Validate a rule. Every failure here is a rejected request, not a bad series.
 */
export function buildRule(input: BuildRuleInput): RecurrenceRule {
  const intervalN = input.intervalN ?? 1;
  const occurrenceCount = input.occurrenceCount ?? null;
  const untilDate = input.untilDate ?? null;

  if (!Number.isInteger(intervalN) || intervalN < 1) {
    throw new RecurrenceError("interval must be at least 1");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < 1) {
    throw new RecurrenceError("duration must be at least 1 minute");
  }

  if (input.endMode === "count") {
    if (occurrenceCount === null || occurrenceCount < 1) {
      throw new RecurrenceError("a count-ended rule needs an occurrence count of at least 1");
    }
    if (untilDate !== null) {
      throw new RecurrenceError("a rule ends on a count or a date, never both");
    }
  } else {
    if (untilDate === null) {
      throw new RecurrenceError("a date-ended rule needs an end date");
    }
    if (occurrenceCount !== null) {
      throw new RecurrenceError("a rule ends on a count or a date, never both");
    }
    if (untilDate < input.startDate) {
      throw new RecurrenceError("the end date is before the start date");
    }
  }

  let weekdays: Weekday[] = [];
  if (input.frequency === "weekly") {
    if (!input.weekdays || input.weekdays.length === 0) {
      // No selection means "the weekday the series starts on", which is what
      // somebody picking a date and pressing repeat expects.
      weekdays = [WEEKDAY_BY_ISO[isoWeekday(input.startDate)]!];
    } else {
      const seen = new Set<Weekday>();
      for (const raw of input.weekdays) {
        if (!(raw in WEEKDAY_ISO)) {
          throw new RecurrenceError(
            `unknown weekday in ${JSON.stringify([...input.weekdays])}`,
          );
        }
        seen.add(raw as Weekday);
      }
      weekdays = [...seen].sort((a, b) => WEEKDAY_ISO[a] - WEEKDAY_ISO[b]);
    }
  }

  return {
    frequency: input.frequency,
    intervalN,
    weekdays,
    startDate: input.startDate,
    startTime: input.startTime,
    durationMinutes: input.durationMinutes,
    timezone: input.timezone,
    endMode: input.endMode,
    occurrenceCount,
    untilDate,
  };
}

export interface ExpandOptions {
  maxOccurrences?: number;
  maxHorizonDays?: number;
  /** Civil dates in the rule's zone that must not produce an occurrence. */
  skipDates?: Iterable<CivilDate>;
  startIndex?: number;
}

/**
 * Expand a rule into concrete occurrences.
 *
 * `skipDates` are the organization's and school's closures. A skipped date does
 * not consume a position in the count: asking for eight sessions yields eight,
 * with the run extending past the closure rather than falling short of it.
 *
 * `startIndex` lets a "this and future" edit continue an existing series'
 * numbering instead of restarting at 1.
 */
export function expand(rule: RecurrenceRule, options: ExpandOptions = {}): Expansion {
  const maxOccurrences = options.maxOccurrences ?? 60;
  const maxHorizonDays = options.maxHorizonDays ?? 365;
  const skip = new Set(options.skipDates ?? []);
  const horizonEnd = addDays(rule.startDate, maxHorizonDays);

  const occurrences: PlannedOccurrence[] = [];
  const skipped: CivilDate[] = [];
  let truncated = false;
  let reason: string | null = null;

  const durationMs = rule.durationMinutes * 60_000;
  let index = options.startIndex ?? 1;
  let day = rule.startDate;
  let examined = 0;

  for (;;) {
    if (examined >= MAX_CANDIDATE_DAYS) {
      truncated = true;
      reason = "the rule was still generating after ten years of candidate dates";
      break;
    }

    if (rule.endMode === "until" && rule.untilDate && day > rule.untilDate) break;
    if (day > horizonEnd) {
      truncated = true;
      reason = `stopped at the organization's ${maxHorizonDays}-day booking horizon`;
      break;
    }

    if (matches(rule, day)) {
      if (skip.has(day)) {
        skipped.push(day);
      } else {
        if (occurrences.length >= maxOccurrences) {
          truncated = true;
          reason = `stopped at the organization's limit of ${maxOccurrences} sessions`;
          break;
        }

        const resolved = resolveCivil(day, rule.startTime, rule.timezone);
        occurrences.push({
          index,
          localDate: day,
          start: resolved.instant,
          end: new Date(resolved.instant.getTime() + durationMs),
          dstEdge: resolved.edge,
        });
        index += 1;

        if (
          rule.endMode === "count" &&
          rule.occurrenceCount !== null &&
          occurrences.length >= rule.occurrenceCount
        ) {
          break;
        }
      }
    }

    day = addDays(day, 1);
    examined += 1;
  }

  return {
    occurrences,
    truncated,
    truncationReason: reason,
    requestedCount: rule.occurrenceCount,
    skippedDates: skipped,
  };
}

/**
 * Does this civil date fall on the rule?
 *
 * Interval is counted in whole calendar weeks for weekly rules, so "every other
 * Tuesday and Thursday" keeps both weekdays in the same fortnight rather than
 * alternating between them.
 */
function matches(rule: RecurrenceRule, day: CivilDate): boolean {
  if (day < rule.startDate) return false;

  if (rule.frequency === "daily") {
    return daysBetween(rule.startDate, day) % rule.intervalN === 0;
  }

  const weekday = WEEKDAY_BY_ISO[isoWeekday(day)]!;
  if (!rule.weekdays.includes(weekday)) return false;
  if (rule.intervalN === 1) return true;

  // Compare from each date's own Monday, so the interval counts calendar weeks
  // rather than 7-day blocks offset by whichever weekday the series began on.
  const startWeek = addDays(rule.startDate, -(isoWeekday(rule.startDate) - 1));
  const dayWeek = addDays(day, -(isoWeekday(day) - 1));
  return Math.floor(daysBetween(startWeek, dayWeek) / 7) % rule.intervalN === 0;
}
