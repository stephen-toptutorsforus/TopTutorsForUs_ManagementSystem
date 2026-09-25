/**
 * Tenant configuration: the shipped defaults, and the only sanctioned way to
 * read them.
 *
 * Ported from `app/models/organization.py`. Configuration lives in the
 * organization row rather than in code so that no tenant-specific person,
 * program, price, or link is ever hard-coded.
 *
 * **Nothing indexes into `settings` directly.** A tenant row written before a
 * key existed must still resolve it, so every read goes through `setting()`,
 * which falls back to the shipped default one path segment at a time.
 */

import type { Prisma } from "@/generated/prisma/client";

export type JsonObject = Record<string, unknown>;

/**
 * How many sessions one booking may create, and how far ahead it may reach.
 *
 * Named rather than written four times. They were: once in the shipped
 * defaults and once as the fallback at each of the three places that read
 * them, which is three chances for the refusal, the field's `max` attribute
 * and the expansion to disagree about the same number.
 *
 * 200 because a run is bounded by the horizon as well as by the count, and a
 * school year at five days a week is about 180 sessions — so this is roughly
 * the widest realistic run that fits inside one horizon year. A weekly run of
 * 100 sessions is two years and stops at the horizon instead, which the
 * preview reports rather than silently shortening.
 */
export const MAX_OCCURRENCES_PER_SERIES = 200;
export const MAX_SERIES_HORIZON_DAYS = 365;

/**
 * Booking, classroom, and notification defaults. Every key is overridable per
 * tenant; nothing here names a specific customer, program, or price.
 */
export const DEFAULT_SETTINGS: JsonObject = {
  booking: {
    // Students may request a session. Parents may not book. A student request
    // is not a booking until somebody accepts it — see `require_approval`.
    who_can_book: ["admin", "regional_admin", "instructor", "student"],
    who_can_create_historical: ["admin"],
    // Instructors keep edit, including a session that has already started.
    // Students and parents are not on this list: they cancel or reschedule,
    // and that is a different permission.
    who_can_edit: ["admin", "regional_admin", "instructor"],
    who_can_cancel: ["admin", "regional_admin", "instructor", "student", "parent"],
    who_can_delete: ["admin"],
    instructor_finder_enabled: true,
    direct_booking_enabled: true,
    assigned_users_only: true,
    // Staff may book from now. A student request needs twelve hours' notice.
    // Both may look a year ahead. The student figure is read only for a
    // student or parent; staff keep `lead_time_minutes`.
    lead_time_minutes: 0,
    student_lead_time_minutes: 12 * 60,
    max_future_days: 365,
    // How close to the start a student or parent may still cancel or move it.
    // Instructors and administrators are not held to it.
    cancellation_window_hours: 4,
    billable_cancellation_charges: true,
    // Whether money is part of this tenant's vocabulary at all.
    //
    // It ships `false`, because this product runs every session free. A
    // Billable box, a Payment column and an Invoice column are then three
    // controls asking a question nobody may answer and nothing reads — worse
    // than no control, by the rule the filters already follow. Off, none of
    // them is drawn on the booking form, the edit panel, the session's own
    // page, the grid, the export or the JSON API, and every session is written
    // not billable whatever a form sends: a screen that hides a control and a
    // handler that honours it anyway are the same bug seen from two sides.
    //
    // The column, `billable_cancellation_charges` and the payment and invoice
    // fields all stay in the schema. They are the seam Phase 3's invoicing
    // fills, and a tenant that ever charges turns this on rather than waiting
    // for a migration.
    billable_enabled: false,
    // What the booking form's Billable box starts as, when there is one. `true`
    // is what the screen used to force with a hidden field, so a tenant that
    // turns billing on and configures nothing else books exactly as it did
    // before; one that charges for nothing sets it false and every new session
    // is free, with the box still there for the exception.
    billable_default: true,
    // When true, a student or parent booking arrives as a request for an
    // instructor or administrator to decide.
    // A student booking arrives as a request. Staff bookings do not.
    require_approval: true,
    // A student request needs one credit per session. Staff are not asked.
    // Nothing here takes a payment; the number is a balance on the person.
    require_credits: true,
    auto_cancel_unpaid: false,
    // Through 3 hours 30 minutes, which is also the upper bound below.
    selectable_durations_minutes: [15, 30, 45, 60, 90, 120, 150, 180, 210],
    // The list above is what the picker offers; these are the outer bounds a
    // session may occupy, shown beside it so the offered set does not read as
    // the only thing the platform will ever allow.
    duration_bounds_minutes: [15, 210],
    max_occurrences_per_series: MAX_OCCURRENCES_PER_SERIES,
    max_series_horizon_days: MAX_SERIES_HORIZON_DAYS,
    conflict_override_roles: ["admin"],
  },
  classroom: {
    enabled_delivery_types: ["advanced_classroom", "external_link", "in_person"],
    waiting_room: true,
    persistent_series_classroom: false,
    instructor_early_access_minutes: 10,
    chat_enabled: true,
  },
  attendance: {
    late_threshold_minutes: 5,
    incomplete_threshold_percent: 50,
  },
  dashboard: {
    sections: ["today", "alerts", "upcoming", "analytics"],
  },
  notifications: {
    channels: ["in_app", "email"],
    reminder_offsets_minutes: [1440, 60],
    quiet_hours: { start: "21:00", end: "07:00" },
  },
  reason_codes: {
    cancellation: ["participant_request", "instructor_unavailable", "weather", "other"],
    missed: ["no_show", "technical_failure", "other"],
  },
};

export const DEFAULT_FEATURES: Record<string, boolean> = {
  credits: false,
  invoicing: false,
  storefront: false,
  sms: false,
  advanced_classroom: false,
  progress_forms: false,
};

/**
 * Anything that can answer a configuration question.
 *
 * An interface rather than the organization row itself, because the permission
 * resolver takes one and must be testable without a database — and because the
 * tenant that has not been loaded yet is a legitimate caller, passing `null`.
 */
export interface SettingsReader {
  setting(path: readonly string[], fallback?: unknown): unknown;
}

/** Just enough of an organization row to read configuration from. */
export interface ConfigurableOrganization {
  settings: Prisma.JsonValue | JsonObject | null;
  features?: Prisma.JsonValue | JsonObject | null;
}

function descend(node: unknown, path: readonly string[]): unknown {
  let current = node;
  for (const key of path) {
    current =
      current !== null && typeof current === "object" && !Array.isArray(current)
        ? (current as JsonObject)[key]
        : undefined;
  }
  return current;
}

/**
 * Read a nested setting, falling back to the shipped default.
 *
 * The fallback is walked in step with the stored value rather than consulted
 * only when the whole path misses. A tenant that has configured
 * `booking.lead_time_minutes` and nothing else still resolves every other
 * `booking.*` key, which is what makes partial configuration safe to write.
 */
export function setting(
  organization: ConfigurableOrganization | null | undefined,
  path: readonly string[],
  fallback?: unknown,
): unknown {
  const stored = descend(organization?.settings ?? {}, path);
  if (stored !== undefined && stored !== null) return stored;

  const shipped = descend(DEFAULT_SETTINGS, path);
  if (shipped !== undefined && shipped !== null) return shipped;
  return fallback;
}

/**
 * Delivery types that exist in the enum but need a feature switched on.
 *
 * The advanced classroom is a later phase: `DEFAULT_FEATURES` ships it off and
 * nothing implements it. It was still in `enabled_delivery_types` and so still
 * in the booking form's Type list, which offered a way to deliver a session
 * that does not exist — a seam made to look implemented. Listing it here gates
 * the option and the write together.
 */
export const DELIVERY_FEATURES: Readonly<Record<string, string>> = {
  advanced_classroom: "advanced_classroom",
};

/** Is this delivery type available here — enabled, and its feature on? */
export function deliveryAvailable(
  organization: ConfigurableOrganization | null | undefined,
  wire: string,
): boolean {
  const enabled = setting(organization, ["classroom", "enabled_delivery_types"]);
  const list = Array.isArray(enabled) ? enabled.map(String) : [];
  if (list.length > 0 && !list.includes(wire)) return false;
  const needed = DELIVERY_FEATURES[wire];
  return needed === undefined || feature(organization, needed);
}

/**
 * Is money part of this tenant's vocabulary?
 *
 * One function rather than a `settingBoolean` call at each of the nine places
 * that ask, because a rule spelled out nine times is one that gets a different
 * fallback in the tenth — and the difference between a screen that hides the
 * Billable box and a handler that still honours `billable=on` is exactly that
 * kind of drift. It ships off; see `booking.billable_enabled` above.
 */
export function billingEnabled(
  organization: ConfigurableOrganization | null | undefined,
): boolean {
  return Boolean(setting(organization, ["booking", "billable_enabled"], false));
}

export function feature(
  organization: ConfigurableOrganization | null | undefined,
  name: string,
): boolean {
  const features = organization?.features;
  const stored =
    features !== null && typeof features === "object" && !Array.isArray(features)
      ? (features as JsonObject)[name]
      : undefined;
  if (stored === undefined || stored === null) return DEFAULT_FEATURES[name] ?? false;
  return Boolean(stored);
}

/** Wrap an organization row as a `SettingsReader`. */
export function settingsReader(
  organization: ConfigurableOrganization | null | undefined,
): SettingsReader {
  return {
    setting: (path, fallback) => setting(organization, path, fallback),
  };
}

// --- Typed readers for the settings the scheduler actually branches on -------
//
// Every one of these has a shipped default, so they return a value rather than
// `T | undefined`. A caller that has to handle "unset" for a key that is always
// set writes a second, quieter default, and then there are two.

export function settingNumber(
  reader: SettingsReader | null | undefined,
  path: readonly string[],
  fallback: number,
): number {
  const value = reader?.setting(path, fallback) ?? fallback;
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function settingBoolean(
  reader: SettingsReader | null | undefined,
  path: readonly string[],
  fallback: boolean,
): boolean {
  const value = reader?.setting(path, fallback);
  return value === undefined || value === null ? fallback : Boolean(value);
}

/**
 * The session lengths this tenant offers, in minutes.
 *
 * Lifted out of the booking context because the rescheduling panel wants the
 * same list: it had a number input stepping by five, which offered 35 minutes
 * and 115 and then had them refused by `validateRequest` — a control offering a
 * choice the write does not accept.
 */
export function selectableDurations(reader: SettingsReader | null | undefined): number[] {
  const stored = reader?.setting(["booking", "selectable_durations_minutes"], [60]);
  if (!Array.isArray(stored) || stored.length === 0) return [60];
  const minutes = stored.map(Number).filter((value) => Number.isFinite(value) && value > 0);
  return minutes.length > 0 ? minutes : [60];
}

export function settingStrings(
  reader: SettingsReader | null | undefined,
  path: readonly string[],
): string[] | null {
  const value = reader?.setting(path);
  if (!Array.isArray(value)) return null;
  return value.map(String);
}
