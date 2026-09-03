/**
 * A booking plan, flattened for the screen.
 *
 * A `BookingPlan` carries `Date`s and a report per occurrence. This is the same
 * plan as plain strings and booleans, because it crosses to a client component
 * — and because the preview should show only what the person needs to decide,
 * not the shape of the object behind it.
 *
 * Nothing here is re-derived. Every field is read off the plan the write will
 * use, so what is shown before pressing the button is what gets written.
 */

import { Moment } from "@/lib/rendering";
import {
  type BookingPlan,
  blockedSessions,
  conflictedSessions,
  hasConflicts,
  isBlocked,
  needsOverride,
} from "@/lib/services/booking";
import { dstAdjusted, first, last, shiftedByDst } from "@/lib/recurrence";

export interface PlannedView {
  index: number;
  when: string;
  endsAt: string;
  shiftedByDst: boolean;
  blocked: boolean;
  hasConflicts: boolean;
  conflicts: string[];
}

export interface PlanView {
  total: number;
  zone: string;
  firstWhen: string | null;
  lastWhen: string | null;
  startTime: string | null;
  endTime: string | null;
  repeatsOn: string | null;
  truncated: boolean;
  truncationReason: string | null;
  requestedCount: number | null;
  skippedDates: string[];
  dstAdjustedCount: number;
  selfOverlaps: boolean;
  blocked: boolean;
  needsOverride: boolean;
  sessions: PlannedView[];
}

const DOW_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

function weekdayOf(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  return DOW_LONG[(parsed.getUTCDay() + 6) % 7]!;
}

export function toPlanView(plan: BookingPlan, zone: string): PlanView {
  const firstOccurrence = first(plan.expansion);
  const lastOccurrence = last(plan.expansion);

  return {
    total: plan.sessions.length,
    zone,
    firstWhen: firstOccurrence ? new Moment(firstOccurrence.start, zone).full : null,
    lastWhen: lastOccurrence ? new Moment(lastOccurrence.start, zone).full : null,
    startTime: firstOccurrence ? new Moment(firstOccurrence.start, zone).time : null,
    endTime: firstOccurrence ? new Moment(firstOccurrence.end, zone).time : null,
    repeatsOn:
      plan.sessions.length > 1 && firstOccurrence
        ? weekdayOf(firstOccurrence.localDate)
        : null,
    truncated: plan.expansion.truncated,
    truncationReason: plan.expansion.truncationReason,
    requestedCount: plan.expansion.requestedCount,
    skippedDates: [...plan.expansion.skippedDates],
    dstAdjustedCount: dstAdjusted(plan.expansion).length,
    selfOverlaps: plan.selfOverlaps.length > 0,
    blocked: blockedSessions(plan).length > 0,
    needsOverride: needsOverride(plan) && conflictedSessions(plan).length > 0,
    sessions: plan.sessions.map((planned) => ({
      index: planned.occurrence.index,
      when: new Moment(planned.occurrence.start, zone).full,
      endsAt: new Moment(planned.occurrence.end, zone).time,
      shiftedByDst: shiftedByDst(planned.occurrence),
      blocked: isBlocked(planned),
      hasConflicts: hasConflicts(planned),
      conflicts: planned.report.conflicts.map((conflict) => conflict.message),
    })),
  };
}
