/**
 * What Pearl's words mean here.
 *
 * Lifted out of `tools/import-pearl.ts`, which is now a caller rather than a
 * second copy: the CLI and the screen must agree about what "Missed By
 * Instructor" is, and two tables that start identical do not stay that way.
 *
 * Everything in this module is pure — no database, no filesystem, no clock that
 * is not passed in — so the mappings can be tested as the flat facts they are.
 */

import {
  AttendanceStatus,
  DeliveryType,
  Role,
  SessionStatus,
  UserStatus,
} from "@/generated/prisma/enums";
import { type CivilDate, resolveCivil } from "@/lib/time";

export const ROLES: Readonly<Record<string, Role>> = {
  Admin: Role.ADMIN,
  Instructor: Role.INSTRUCTOR,
  Student: Role.STUDENT,
  Parent: Role.PARENT,
};

export const ACCOUNT: Readonly<Record<string, UserStatus>> = {
  Active: UserStatus.ACTIVE,
  Invited: UserStatus.INVITED,
  "Invite Bounced": UserStatus.BOUNCED,
  "Pending Invite": UserStatus.PENDING_INVITE,
};

/**
 * `Lobby` and `Lesson` are the live-classroom states, which this schema spells
 * as one: `IN_PROGRESS`. Nothing here sets it yet — the Phase 4 classroom will —
 * so an import is the only writer of it, which is worth knowing when a handful
 * of sessions turn up in a state the product cannot currently produce.
 */
export const STATUS: Readonly<Record<string, SessionStatus>> = {
  Scheduled: SessionStatus.SCHEDULED,
  Rescheduled: SessionStatus.RESCHEDULED,
  Completed: SessionStatus.COMPLETED,
  Cancelled: SessionStatus.CANCELLED,
  Missed: SessionStatus.MISSED,
  Lobby: SessionStatus.IN_PROGRESS,
  Lesson: SessionStatus.IN_PROGRESS,
};

/**
 * Pearl records attendance once for the session; this schema records it per
 * participant, which is strictly more information and cannot be recovered from
 * less. So a rollup is spread across everybody on the session, and the two that
 * genuinely differ are kept apart: a session the *instructor* missed leaves its
 * students excused rather than absent, because an authorised absence is not a
 * mark against them and `attendanceRate` counts it that way.
 *
 * "Incomplete" is not a mark at all. Every Pearl row carrying it is a scheduled
 * session whose time has passed, which is this codebase's derived `Incomplete`
 * state rather than anything stored — so it maps to `UNMARKED`, and the
 * calendar works the state out again for itself.
 */
export const ATTENDANCE: Readonly<Record<string, AttendanceStatus>> = {
  "": AttendanceStatus.UNMARKED,
  Incomplete: AttendanceStatus.UNMARKED,
  Attended: AttendanceStatus.PRESENT,
  "Partially Attended": AttendanceStatus.LATE,
  Missed: AttendanceStatus.ABSENT,
  "Missed By Students": AttendanceStatus.ABSENT,
  "Missed By Instructor": AttendanceStatus.EXCUSED,
};

/** Pearl's own classroom, by the name it exports. */
export const PEARL_CLASSROOM = "Pearl Advanced Class";

export function deliveryOf(location: string): DeliveryType {
  if (location.startsWith("http")) return DeliveryType.EXTERNAL_LINK;
  if (location === PEARL_CLASSROOM) return DeliveryType.ADVANCED_CLASSROOM;
  return DeliveryType.IN_PERSON;
}

/** `1 hour 30 minutes`, `54 minutes`, `3 hours` — and `0:32` in the series file. */
export function minutesOf(text: string): number {
  const clock = /^(\d+):(\d\d)$/.exec(text.trim());
  if (clock) return Number(clock[1]) * 60 + Number(clock[2]);
  const hours = /(\d+)\s+hours?/.exec(text);
  const mins = /(\d+)\s+minutes?/.exec(text);
  return (hours ? Number(hours[1]) * 60 : 0) + (mins ? Number(mins[1]) : 0);
}

/**
 * `09/10/2026 9:00:00 PM` in a named zone, to an instant.
 *
 * The zone is a parameter rather than the constant the CLI used: a tenant is
 * not always in Chicago, and the organization already knows its own.
 */
export function startOf(text: string, zone: string): Date | null {
  const m = /^(\d\d)\/(\d\d)\/(\d{4}) (\d+):(\d\d):\d\d (AM|PM)$/.exec(text.trim());
  if (!m) return null;
  let hour = Number(m[4]) % 12;
  if (m[6] === "PM") hour += 12;
  const civil = `${m[3]}-${m[1]}-${m[2]}` as CivilDate;
  const clock = `${String(hour).padStart(2, "0")}:${m[5]}`;
  return resolveCivil(civil, clock, zone).instant;
}

/** `09/10/2026` — the series file's date columns, which carry no time. */
export function dayOf(text: string): CivilDate | null {
  const m = /^(\d\d)\/(\d\d)\/(\d{4})$/.exec(text.trim());
  return m ? (`${m[3]}-${m[1]}-${m[2]}` as CivilDate) : null;
}

/** `6:00 PM`, `18:00` — the series file's start times, which carry no date. */
export function clockOf(text: string): string | null {
  const meridiem = /^(\d{1,2}):(\d\d)\s*(AM|PM)$/i.exec(text.trim());
  if (meridiem) {
    let hour = Number(meridiem[1]) % 12;
    if (meridiem[3]!.toUpperCase() === "PM") hour += 12;
    return `${String(hour).padStart(2, "0")}:${meridiem[2]}`;
  }
  const plain = /^(\d{1,2}):(\d\d)$/.exec(text.trim());
  if (!plain) return null;
  const hour = Number(plain[1]);
  return hour < 24 ? `${String(hour).padStart(2, "0")}:${plain[2]}` : null;
}

const WEEKDAYS: Readonly<Record<string, string>> = {
  mon: "mon", monday: "mon",
  tue: "tue", tues: "tue", tuesday: "tue",
  wed: "wed", weds: "wed", wednesday: "wed",
  thu: "thu", thur: "thu", thurs: "thu", thursday: "thu",
  fri: "fri", friday: "fri",
  sat: "sat", saturday: "sat",
  sun: "sun", sunday: "sun",
};

const WEEK_ORDER = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/** `Monday, Wednesday` — to the stored weekday names, in week order. */
export function weekdaysOf(text: string): string[] {
  const found = new Set<string>();
  for (const part of text.split(",")) {
    const name = WEEKDAYS[part.trim().toLowerCase()];
    if (name) found.add(name);
  }
  return WEEK_ORDER.filter((day) => found.has(day));
}

/**
 * Split a display name into two fields.
 *
 * Everything before the last word is the given name, which is wrong for some of
 * these and right for most, and there is no more information in the export to
 * do better with. Suffixes are kept on the surname rather than becoming one.
 */
const SUFFIX = new Set(["jr", "jr.", "sr", "sr.", "ii", "iii", "iv"]);

export function splitName(full: string): [string, string] {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return ["Unknown", "Unknown"];
  if (parts.length === 1) return [parts[0]!, ""];
  let cut = parts.length - 1;
  if (SUFFIX.has(parts[cut]!.toLowerCase()) && cut > 1) cut -= 1;
  return [parts.slice(0, cut).join(" "), parts.slice(cut).join(" ")];
}

/** The roles a `Roles` cell names, dropping anything this schema has no word for. */
export function rolesOf(text: string): Role[] {
  return text
    .split(",")
    .map((part) => ROLES[part.trim()])
    .filter((role): role is Role => role !== undefined);
}

/** The names a `Students` cell lists. */
export function namesOf(text: string): string[] {
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/**
 * An email, or nothing.
 *
 * A bare username is left null rather than written as a non-address: the
 * per-tenant unique index is over the rows that *have* one, and a made-up
 * address would be both a false fact and a collision waiting to happen.
 */
export function emailOf(handle: string): string | null {
  const trimmed = handle.trim();
  return trimmed.includes("@") ? trimmed.toLowerCase() : null;
}
