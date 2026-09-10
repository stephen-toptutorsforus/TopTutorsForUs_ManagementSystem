/**
 * How the domain's states are drawn.
 *
 * Ported from the presentation half of `app/web/rendering.py`.
 *
 * **Every badge pairs a colour with an icon and a word**, so no state is
 * conveyed by hue alone — required for WCAG 2.1 AA, and for anyone reading a
 * printed roster.
 */

import {
  AttendanceStatus,
  DeliveryType,
  Role,
  SessionStatus,
  UserStatus,
} from "@/generated/prisma/enums";

export interface Badge {
  label: string;
  tone: string;
  icon: string;
}

export const STATUS_META: Record<SessionStatus, Badge> = {
  [SessionStatus.REQUESTED]: { label: "Requested", tone: "pending", icon: "?" },
  [SessionStatus.REJECTED]: { label: "Rejected", tone: "bad", icon: "⊘" },
  [SessionStatus.SCHEDULED]: { label: "Scheduled", tone: "info", icon: "●" },
  [SessionStatus.RESCHEDULED]: { label: "Rescheduled", tone: "moved", icon: "↻" },
  [SessionStatus.IN_PROGRESS]: { label: "In progress", tone: "live", icon: "▶" },
  [SessionStatus.COMPLETED]: { label: "Completed", tone: "good", icon: "✓" },
  [SessionStatus.CANCELLED]: { label: "Cancelled", tone: "muted", icon: "✕" },
  [SessionStatus.MISSED]: { label: "Missed", tone: "warn", icon: "!" },
};

/**
 * The order statuses are offered in for filtering. Lifecycle order, not the
 * enum's declaration order and not alphabetical: it is the sequence a
 * coordinator thinks in, so the list reads as a story rather than a set.
 *
 * `in_progress` is deliberately absent. Nothing in the platform sets it today —
 * it becomes reachable when the classroom integration marks a session live in
 * Phase 5 — and a filter option that can never match anything is worse than no
 * option. It stays in the enum, and its badge stays defined, so a session that
 * reaches it still displays correctly; it is only missing from the filter.
 *
 * **This list defines the unfiltered screen**, because a full set of ticks is
 * what an untouched filter looks like and a full set of ticks means "no
 * narrowing" — see `lib/selection.ts`. So the day `in_progress` starts being
 * set it has to be added here, or a live session will be filterable by nothing
 * and hidden by any tick somebody removes. `tests/presentation.test.ts` fails
 * when a status is added to the enum and not answered for here.
 */
export const STATUS_FILTER_ORDER: readonly SessionStatus[] = [
  SessionStatus.SCHEDULED,
  SessionStatus.RESCHEDULED,
  SessionStatus.CANCELLED,
  SessionStatus.COMPLETED,
  SessionStatus.REQUESTED,
  SessionStatus.REJECTED,
  SessionStatus.MISSED,
];

export const ATTENDANCE_META: Record<AttendanceStatus, Badge> = {
  [AttendanceStatus.UNMARKED]: { label: "Unmarked", tone: "muted", icon: "○" },
  [AttendanceStatus.PRESENT]: { label: "Present", tone: "good", icon: "✓" },
  [AttendanceStatus.LATE]: { label: "Late", tone: "warn", icon: "◔" },
  [AttendanceStatus.LEFT_EARLY]: { label: "Left early", tone: "warn", icon: "◑" },
  [AttendanceStatus.INCOMPLETE]: { label: "Incomplete", tone: "warn", icon: "◐" },
  [AttendanceStatus.ABSENT]: { label: "Absent", tone: "bad", icon: "✕" },
  [AttendanceStatus.EXCUSED]: { label: "Excused", tone: "info", icon: "◇" },
};

/**
 * `label` is the short form badges and grids use, where the column is narrow
 * and the icon already carries most of the meaning. `choice` is the long form
 * the booking form's Type list uses, where the person is choosing between them
 * for the first time and needs to be told which is which.
 */
export const DELIVERY_META: Record<DeliveryType, Badge & { choice: string }> = {
  [DeliveryType.ADVANCED_CLASSROOM]: {
    label: "Classroom",
    choice: "TopTutorsForUs Advanced Online Classroom",
    icon: "▣",
    tone: "info",
  },
  [DeliveryType.EXTERNAL_LINK]: {
    label: "Online",
    // Not "Other Online Classroom" any more. It was named against the
    // advanced classroom beside it, and that one is behind a feature flag no
    // tenant has on, so "other" contrasted with nothing.
    choice: "Online Classroom (Zoom, etc.)",
    icon: "↗",
    tone: "info",
  },
  [DeliveryType.IN_PERSON]: {
    label: "In person",
    choice: "In-person",
    icon: "⌂",
    tone: "info",
  },
};

const UNKNOWN: Badge = { label: "Unknown", tone: "muted", icon: "•" };

export function statusMeta(status: SessionStatus): Badge {
  return STATUS_META[status] ?? UNKNOWN;
}

export function attendanceMeta(status: AttendanceStatus): Badge {
  return ATTENDANCE_META[status] ?? UNKNOWN;
}

export function deliveryMeta(delivery: DeliveryType): Badge & { choice: string } {
  return DELIVERY_META[delivery] ?? { ...UNKNOWN, choice: "Unknown" };
}

// --- Filter menus -----------------------------------------------------------
//
// The calendar filters by status and the directory filters by role. They are
// the same control — a disclosure holding checkboxes, applied when it closes —
// so they are rendered by one component over one shape, rather than by two
// blocks of markup that drift apart the first time either is touched.

/**
 * One choice in a filter menu.
 *
 * `tone` and `icon` are optional. A status carries a colour and a glyph because
 * that is how it is drawn everywhere else in the product, and the filter has to
 * agree with the badges it filters. A role is only ever a word, so its options
 * show a word — the menu leaves the swatch out rather than inventing a colour
 * vocabulary for something that does not have one.
 */
export interface FilterOption {
  value: string;
  label: string;
  tone?: string;
  icon?: string;
}

/** The statuses a person may filter by, in the order they think in. */
export function statusFilterOptions(): FilterOption[] {
  return STATUS_FILTER_ORDER.map((status) => ({
    value: status.toLowerCase(),
    ...statusMeta(status),
  }));
}

/**
 * The roles the directory filters by. Not every role in the enum: `payer` is
 * granted by assigning somebody to pay rather than held as a job, and
 * `regional_admin` is a narrowing of `admin` rather than a different kind of
 * person. Both still appear as tags on the rows they belong to.
 */
export const ROLE_FILTER_ORDER: readonly Role[] = [
  Role.INSTRUCTOR,
  Role.STUDENT,
  Role.PARENT,
  Role.ADMIN,
];

/**
 * What each account state means, and how it is drawn.
 *
 * The directory drew all five as one of two badges — green and ticked for
 * active, grey and hollow for every other — so "invited", "bounced" and
 * "disabled" were the same picture with a different word under it, and the
 * difference between "we are waiting for them" and "the address does not work"
 * was invisible at a glance.
 *
 * `meaning` is the sentence: the states are not self-explanatory, and nothing
 * in the product defined them anywhere a person could read. It is the badge's
 * `title` and the same words appear on the help page, so one definition serves
 * the hover and the reference.
 *
 * `bounced` is a warning rather than a failure. Nobody did anything wrong and
 * the account is not broken — an address needs correcting, which is work, not
 * damage.
 */
export const USER_STATUS_META: Record<UserStatus, Badge & { meaning: string }> = {
  [UserStatus.ACTIVE]: {
    label: "Active",
    tone: "good",
    icon: "✓",
    meaning: "Account setup is complete; the user can sign in.",
  },
  [UserStatus.INVITED]: {
    label: "Invited",
    tone: "info",
    icon: "✉",
    meaning: "The invitation was sent, but registration is unfinished.",
  },
  [UserStatus.PENDING_INVITE]: {
    label: "Pending invite",
    tone: "pending",
    icon: "◷",
    meaning: "The user was created; the invitation is waiting to be sent.",
  },
  [UserStatus.BOUNCED]: {
    label: "Bounced",
    tone: "warn",
    icon: "!",
    meaning: "The invitation email could not be delivered.",
  },
  [UserStatus.DISABLED]: {
    label: "Disabled",
    tone: "muted",
    icon: "⊘",
    meaning: "Access was turned off; the user cannot sign in.",
  },
};

export function userStatusMeta(status: UserStatus): Badge & { meaning: string } {
  return USER_STATUS_META[status] ?? { ...UNKNOWN, meaning: "" };
}

/**
 * The account states the directory filters by — every one in the enum, unlike
 * the roles. Here so the page that draws the ticks and the query that reads
 * them share one list; two copies would disagree about what "all of them"
 * means, and that is the thing that decides whether a filter is written to the
 * address at all.
 */
export const USER_STATUS_FILTER_ORDER: readonly UserStatus[] = [
  UserStatus.ACTIVE,
  UserStatus.INVITED,
  UserStatus.PENDING_INVITE,
  UserStatus.BOUNCED,
  UserStatus.DISABLED,
];

export function roleFilterOptions(): FilterOption[] {
  return ROLE_FILTER_ORDER.map((role) => ({
    value: role.toLowerCase(),
    label: role
      .toLowerCase()
      .replace(/_/g, " ")
      .replace(/\b\w/g, (letter) => letter.toUpperCase()),
  }));
}

/** ISO weekday names as they are shown. Stored as names, never as indices. */
export const WEEKDAY_LABELS: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

// --- Numbers people read ----------------------------------------------------

/** Human duration. An em dash for unknown, never "0 min". */
export function durationLabel(minutes: number | null): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return `${hours} h ${rest} min`;
  if (hours) return `${hours} h`;
  return `${rest} min`;
}

/**
 * `15 minutes`, `1 hour`, `1 hour 30 minutes` — the spelled-out form used in
 * the length picker, where the person is choosing rather than scanning.
 */
export function durationWords(minutes: number | null): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} hour${hours === 1 ? "" : "s"}`);
  if (rest) parts.push(`${rest} minute${rest === 1 ? "" : "s"}`);
  return parts.join(" ") || "0 minutes";
}

/**
 * `0:15`, `3:30` — the compact form used beside the length picker, where two
 * bounds sit side by side and "3 h 30 min" is three times the width.
 */
export function clockDuration(minutes: number | null): string {
  if (minutes === null) return "—";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return `${hours}:${String(rest).padStart(2, "0")}`;
}

export function percent(value: number | null): string {
  return value === null ? "—" : `${Math.round(value * 100)}%`;
}

// --- The clock, and the week -------------------------------------------------
//
// Both are drawn by client components, so they live here rather than in
// `lib/web/booking.ts`: that module reaches the eligibility service and,
// through it, Prisma, and nothing that imports it can cross into the browser.

const MERIDIEM_HOURS = 12;

/** `"16:45"` → `"4:45 PM"`. The form people read a class time in. */
export function clockTime(value: string): string {
  const [rawHour = "0", rawMinute = "0"] = value.split(":");
  const hour24 = Number.parseInt(rawHour, 10);
  if (!Number.isFinite(hour24)) return value;
  const hour = hour24 % MERIDIEM_HOURS || MERIDIEM_HOURS;
  const suffix = hour24 < MERIDIEM_HOURS ? "AM" : "PM";
  return `${hour}:${rawMinute.padStart(2, "0")} ${suffix}`;
}

/**
 * Every time of day, at a step.
 *
 * A list rather than a picker. The native time input opens a dropdown that
 * closes on the first choice, so changing the hour, the minute and the
 * meridiem meant opening it three times — a select is one open and one choice,
 * it works with the script inert, and it needs no popover of our own to trap
 * focus in. The cost is that a time off the step cannot be typed, which is why
 * the step is the finest session length the tenant offers.
 */
export function clockTimes(stepMinutes = 15): { value: string; label: string }[] {
  const step = Number.isFinite(stepMinutes) && stepMinutes > 0 ? Math.floor(stepMinutes) : 15;
  const options: { value: string; label: string }[] = [];
  for (let minutes = 0; minutes < 24 * 60; minutes += step) {
    const value = `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(
      minutes % 60,
    ).padStart(2, "0")}`;
    options.push({ value, label: clockTime(value) });
  }
  return options;
}

/**
 * Snap a time onto the step, so a value stored before the step changed — or
 * typed into the API — still selects something rather than leaving the field
 * showing the first option and quietly moving the session to midnight.
 */
export function nearestClockTime(value: string, stepMinutes = 15): string {
  const [rawHour = "0", rawMinute = "0"] = value.split(":");
  const total = Number.parseInt(rawHour, 10) * 60 + Number.parseInt(rawMinute, 10);
  if (!Number.isFinite(total)) return "00:00";
  const step = stepMinutes > 0 ? stepMinutes : 15;
  const snapped = Math.min(24 * 60 - step, Math.round(total / step) * step);
  return `${String(Math.floor(snapped / 60)).padStart(2, "0")}:${String(
    snapped % 60,
  ).padStart(2, "0")}`;
}

/**
 * The week, in the order it is read, using the names the recurrence engine
 * stores. Monday first because the ISO weekday numbering the rest of the
 * scheduler counts in starts there.
 */
export const WEEKDAY_CHOICES: readonly { value: string; label: string }[] = [
  { value: "mon", label: "Monday" },
  { value: "tue", label: "Tuesday" },
  { value: "wed", label: "Wednesday" },
  { value: "thu", label: "Thursday" },
  { value: "fri", label: "Friday" },
  { value: "sat", label: "Saturday" },
  { value: "sun", label: "Sunday" },
];

/**
 * The most weekdays a run may repeat on.
 *
 * A week, and never more days than the run has sessions: a weekday that never
 * comes round is a row the preview cannot honour. The booking form draws the
 * ceiling and the action enforces it, so it is defined once — a second copy in
 * the action would also have to be `async`, because that file is `"use server"`
 * and may export nothing else.
 */
export function maxRepeatDays(occurrenceCount: number): number {
  return Math.max(1, Math.min(WEEKDAY_CHOICES.length, occurrenceCount));
}

/** The stored weekday name for a civil date, without importing the engine. */
export function weekdayOf(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return "mon";
  return WEEKDAY_CHOICES[(parsed.getUTCDay() + 6) % 7]!.value;
}
