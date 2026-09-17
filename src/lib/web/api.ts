/**
 * The JSON API's response shapes.
 *
 * Ported from the Pydantic models in `app/web/api.py`.
 *
 * **Responses are built field by field, never dumped from a row.** Adding a
 * column to a table must not silently widen what the API returns, and a
 * hand-written shape is the only version of that guarantee that cannot be
 * forgotten.
 *
 * Every `ref`, never a database id.
 */

import { Moment } from "@/lib/rendering";
import {
  actualDurationMinutes,
  attendanceRate,
  scheduledDurationMinutes,
} from "@/lib/services/sessionOps";
import type { SessionRow } from "@/lib/services/sessionQuery";

/**
 * A time always travels with its zone. A bare UTC string invites a caller to
 * render it in their own zone and quietly show the wrong hour.
 */
export interface MomentOut {
  instant: string;
  zone: string;
  local: string;
}

export function outMoment(instant: Date | null, zone: string): MomentOut | null {
  if (instant === null) return null;
  return {
    instant: instant.toISOString(),
    zone,
    local: new Moment(instant, zone).full,
  };
}

export interface SessionOut {
  ref: string;
  title: string;
  status: string;
  delivery_type: string;
  billable: boolean;
  timezone: string;
  scheduled_start: MomentOut;
  scheduled_end: MomentOut;
  scheduled_duration_minutes: number;
  actual_start: MomentOut | null;
  actual_end: MomentOut | null;
  actual_duration_minutes: number | null;
  series_ref: string | null;
  series_index: number | null;
  detached_from_series: boolean;
  instructor_name: string | null;
  student_names: string[];
  student_count: number;
  attendance_rate: number | null;
  actions: string[];
}

export function toSessionOut(
  row: SessionRow,
  options: { seriesRef?: string | null; actions?: string[] } = {},
): SessionOut {
  const occurrence = row.session;
  const zone = occurrence.timezone;
  return {
    ref: occurrence.ref,
    title: occurrence.title,
    status: occurrence.status.toLowerCase(),
    delivery_type: occurrence.deliveryType.toLowerCase(),
    billable: occurrence.billable,
    timezone: zone,
    scheduled_start: outMoment(occurrence.scheduledStart, zone)!,
    scheduled_end: outMoment(occurrence.scheduledEnd, zone)!,
    scheduled_duration_minutes: scheduledDurationMinutes(occurrence),
    actual_start: outMoment(occurrence.actualStart, zone),
    actual_end: outMoment(occurrence.actualEnd, zone),
    actual_duration_minutes: actualDurationMinutes(occurrence),
    series_ref: options.seriesRef ?? null,
    series_index: occurrence.seriesIndex,
    detached_from_series: occurrence.detachedFromSeries,
    instructor_name: row.instructorName,
    // Narrowed to the students this caller may be told about; `student_count`
    // is always the true total. A group session therefore still reads as one
    // through a student's own token without naming their classmates.
    student_names: row.studentNames,
    student_count: row.studentCount,
    attendance_rate: row.attendanceRate,
    actions: options.actions ?? [],
  };
}

export { attendanceRate };
