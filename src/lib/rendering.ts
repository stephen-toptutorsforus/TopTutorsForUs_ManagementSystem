/**
 * Display helpers shared by every screen and by the CSV export.
 *
 * Ported from the presentation half of `app/web/rendering.py`.
 *
 * **Every time carries its zone.** A formatted time with no label is ambiguous
 * to the reader, and in a product where a coordinator in one zone books an
 * instructor in another, ambiguous means wrong. `Moment` is the only way a time
 * reaches a screen, so there is one place that can forget and it does not.
 */

import { DateTime } from "luxon";

import { toZone } from "@/lib/time";

/** An instant bound to the zone it should be displayed in. */
export class Moment {
  readonly instant: Date;
  readonly zone: string;

  constructor(instant: Date, zone: string) {
    this.instant = instant;
    this.zone = zone;
  }

  get local(): DateTime {
    return toZone(this.instant, this.zone);
  }

  /** `16:00`. */
  get time(): string {
    return this.local.toFormat("HH:mm");
  }

  /** `Mon 6 Apr 2026`. */
  get date(): string {
    return this.local.toFormat("ccc d LLL yyyy");
  }

  get dayNumber(): number {
    return this.local.day;
  }

  get isoDate(): string {
    return this.local.toFormat("yyyy-MM-dd");
  }

  /** `EDT`, falling back to the IANA name where a zone has no abbreviation. */
  get zoneLabel(): string {
    return this.local.toFormat("ZZZZ") || this.zone;
  }

  /** The canonical on-screen form: always date, time, and zone. */
  get full(): string {
    return `${this.date}, ${this.time} ${this.zoneLabel}`;
  }

  /** For `<time dateTime="...">`, which assistive technology reads. */
  get iso(): string {
    return this.local.toISO() ?? "";
  }
}

/** A duration in minutes as `1h 30m`, or `45m`. Never a bare number of minutes. */
export function humanDuration(minutes: number | null): string {
  if (minutes === null) return "";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest}m`;
  if (rest === 0) return `${hours}h`;
  return `${hours}h ${rest}m`;
}

/** An attendance rate as a whole percentage, or nothing when nobody was judged. */
export function attendancePercent(rate: number | null): string {
  return rate === null ? "" : `${Math.round(rate * 100)}%`;
}
