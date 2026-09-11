/**
 * Everything the booking screen needs to draw its choices.
 *
 * Ported from `_booking_context` and `_availability_context` in
 * `app/web/views.py`.
 *
 * The first paint and every live refresh build the block here. Two context
 * builders rendering the same block is how a live refresh quietly starts
 * disagreeing with the first paint, so there is one.
 *
 * Everything returned is plain data — strings, numbers, booleans — because it
 * crosses to a client component. Nothing here carries a database id.
 */

import { DeliveryType } from "@/generated/prisma/enums";
import {
  type Candidate,
  type DayGrid,
  type DayOpenings,
  type WeekdayGrid,
  dayGrid,
  openings,
  weekdayGrid,
} from "@/lib/availability";
import type { Db } from "@/lib/db";
import {
  MAX_OCCURRENCES_PER_SERIES,
  deliveryAvailable,
  settingNumber,
  settingsReader,
} from "@/lib/organization";
import {
  eligibleInstructors,
  resolveRosterFromRefs,
} from "@/lib/services/instructorEligibility";
import { Permission } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { scoped } from "@/lib/policies/scoping";
import { deliveryMeta } from "@/lib/presentation";
import { type CivilDate, type CivilTime, civilDate } from "@/lib/time";
import type { OrganizationRecord } from "@/lib/web/session";

/** How many days the "which day" list shows, and how far it will extend. */
export const MATRIX_PAGE_DAYS = 7;
export const MATRIX_MAX_DAYS = 56;

/** The "who, on this date" grid. */
export const GRID_COLUMNS = 12;
export const GRID_STEP_MINUTES = 60;
export const MAX_GRID_INSTRUCTORS = 25;

/** The "when, with this person" grid — finer, because the choice is narrower. */
export const SUGGESTION_COLUMNS = 16;
export const SUGGESTION_STEP_MINUTES = 30;

/** One weekday of a repeating run, as the form submits it. */
export interface RepeatDayInput {
  weekday: string;
  startTime: CivilTime;
  durationMinutes: number;
}

export interface Choice {
  ref: string;
  label: string;
}

/** A person in a picker: the label already includes the address where there is one. */
export interface PersonChoice extends Choice {
  email: string;
  displayName: string;
}

export interface AvailabilityBlock {
  error?: string;
  zone: string;
  matrixDays: number;
  matrixCanExtend: boolean;
  matrixNext: number;
  chosenInstructorRef: string;
  chosenDuration: number;
  chosenTime: CivilTime;
  canViewAvailability: boolean;
  selectedInstructor: PersonChoice | null;
  instructorsNotShown: number;
  /**
   * Who may teach the roster as it currently stands. The dropdown and every
   * state of the grid are drawn from this one list, so the two cannot offer
   * different people.
   */
  instructors: PersonChoice[];
  /** How many students the roster holds, after the group is expanded. */
  rosterSize: number;
  /** Whether the roster actually narrowed the list — see `eligibleInstructors`. */
  eligibilityNarrowed: boolean;
  /**
   * The instructor that was chosen has been dropped, because the roster changed
   * under them. The form clears the field; this is what lets it say why.
   */
  instructorCleared: boolean;
  /** State 1: no date yet, so the question is which day. */
  openings: SerialisedOpenings[];
  /** State 2: a date is chosen, an instructor is not. */
  grid: SerialisedGrid | null;
  /** State 3: both are chosen, so the question is when. */
  suggestions: SerialisedGrid | null;
  /**
   * State 4: a run on several weekdays with one instructor, so the question is
   * when *on each of those weekdays*. It replaces state 3 rather than joining
   * it — a single chosen date is not the useful unit once the run repeats.
   */
  weekPlan: SerialisedWeekPlan | null;
}

/** The repeat grid: weekdays down the side, start times across the top. */
export interface SerialisedWeekPlan {
  columns: { label: string; value: CivilTime }[];
  rows: {
    weekday: string;
    /** `Monday` — the row's own heading. */
    name: string;
    /** `Monday, Sep 14` — the date it resolved to, so the row is checkable. */
    dayLabel: string;
    durationMinutes: number;
    free: boolean[];
    closedReason: string | null;
  }[];
  anyOpen: boolean;
}

export interface SerialisedOpenings {
  day: CivilDate;
  /** `[ref, initials]`, capped. */
  instructors: [string, string][];
  total: number;
  isOpen: boolean;
}

export interface SerialisedGrid {
  day: CivilDate;
  dayLabel: string;
  columns: { label: string; value: CivilTime }[];
  rows: {
    ref: string;
    name: string;
    email: string;
    initials: string;
    free: boolean[];
    closedReason: string | null;
  }[];
  anyOpen: boolean;
}

export interface BookingContext extends AvailabilityBlock {
  maxOccurrences: number;
  /** The weekday a repeat would land on, named rather than left to be worked out. */
  chosenWeekday: string;
  durationLimits: [number, number];
  today: CivilDate;
  students: PersonChoice[];
  programs: Choice[];
  groups: Choice[];
  durations: number[];
  deliveryTypes: { value: string; label: string }[];
  canOverride: boolean;
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
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** `Monday, Apr 6` — the form of date this screen's headings use. */
export function dayLabel(day: CivilDate): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  const dow = (parsed.getUTCDay() + 6) % 7;
  return `${DOW_LONG[dow]}, ${MONTHS_SHORT[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
}

export function weekdayName(day: CivilDate): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  return DOW_LONG[(parsed.getUTCDay() + 6) % 7]!;
}

function personChoice(person: {
  ref: string;
  firstName: string;
  lastName: string;
  email: string | null;
}): PersonChoice {
  const displayName = `${person.firstName} ${person.lastName}`.trim() || person.ref;
  return {
    ref: person.ref,
    displayName,
    email: person.email ?? "",
    label: person.email ? `${displayName} (${person.email})` : displayName,
  };
}

function serialiseGrid(grid: DayGrid): SerialisedGrid {
  return {
    day: grid.day,
    dayLabel: dayLabel(grid.day),
    columns: grid.columns.map((column) => ({ label: column.label, value: column.value })),
    rows: grid.rows.map((row) => ({ ...row })),
    anyOpen: grid.rows.some((row) => row.free.some(Boolean)),
  };
}

function serialiseWeekPlan(grid: WeekdayGrid): SerialisedWeekPlan {
  return {
    columns: grid.columns.map((column) => ({ label: column.label, value: column.value })),
    rows: grid.rows.map((row) => ({
      weekday: row.weekday,
      name: weekdayName(row.day),
      dayLabel: dayLabel(row.day),
      durationMinutes: row.durationMinutes,
      free: [...row.free],
      closedReason: row.closedReason,
    })),
    anyOpen: grid.rows.some((row) => row.free.some(Boolean)),
  };
}

function serialiseOpenings(days: DayOpenings[]): SerialisedOpenings[] {
  return days.map((opening) => ({
    day: opening.day,
    instructors: opening.instructors,
    total: opening.total,
    isOpen: opening.total > 0,
  }));
}

/**
 * The availability block, in whichever of its three states applies.
 *
 * The three states answer three different questions, in the order they get
 * asked: which day, then who on that day, then when with that person. All
 * three are asked **of the eligible instructors only** — the roster narrows
 * who is a candidate, and the calendar then says which of those is free. Asking
 * the calendar about somebody the tenant will not let teach this student
 * produces a name that Preview would refuse.
 */
export async function availabilityContext(
  db: Db,
  principal: Principal,
  organization: OrganizationRecord,
  options: {
    zone: string;
    day: CivilDate | null;
    fromTime: CivilTime;
    durationMinutes: number;
    instructorRef: string;
    matrixDays: number;
    /** The students chosen individually, by public ref. */
    studentRefs: readonly string[];
    /** The chosen group, by public ref, expanded to its current members. */
    groupRef: string;
    /**
     * The weekdays a repeating run falls on, with each one's own length. Empty
     * for a single session, which is what keeps the older three states intact.
     */
    repeatDays: readonly RepeatDayInput[];
  },
): Promise<AvailabilityBlock> {
  const {
    zone,
    day,
    fromTime,
    durationMinutes,
    instructorRef,
    matrixDays,
    studentRefs,
    groupRef,
    repeatDays,
  } = options;

  const studentIds = await resolveRosterFromRefs(db, principal, { studentRefs, groupRef });
  const eligibility = await eligibleInstructors(db, { organization, principal, studentIds });
  const instructors = eligibility.instructors;
  const selected = instructors.find((person) => person.ref === instructorRef) ?? null;

  // Chosen, and no longer offered. The form drops the field's value either way;
  // saying so is only honest when a roster is what took them away — an unknown
  // ref in a stale form is not something to announce.
  const instructorCleared =
    instructorRef !== "" && selected === null && eligibility.narrowed;

  // Narrowing to one instructor is a filter on every state, not only the grid:
  // having chosen somebody, "which day" means which day *they* are free.
  const shortlist: Candidate[] = selected ? [selected] : instructors;

  let grid: DayGrid | null = null;
  let suggestions: DayGrid | null = null;
  let weekPlan: WeekdayGrid | null = null;

  if (day !== null && selected !== null && repeatDays.length > 0) {
    // One row per weekday the run falls on, resolved forward from the session
    // date so no row is a date that has already passed.
    weekPlan = await weekdayGrid(db, organization, selected.id, repeatDays, {
      from: day,
      fromTime,
      timezone: zone,
      columns: SUGGESTION_COLUMNS,
      stepMinutes: SUGGESTION_STEP_MINUTES,
    });
  } else if (day !== null && selected !== null) {
    suggestions = await dayGrid(db, organization, [selected], {
      day,
      fromTime,
      durationMinutes,
      timezone: zone,
      columns: SUGGESTION_COLUMNS,
      stepMinutes: SUGGESTION_STEP_MINUTES,
    });
  } else if (day !== null) {
    grid = await dayGrid(db, organization, instructors.slice(0, MAX_GRID_INSTRUCTORS), {
      day,
      fromTime,
      durationMinutes,
      timezone: zone,
      columns: GRID_COLUMNS,
      stepMinutes: GRID_STEP_MINUTES,
    });
  }

  return {
    zone,
    matrixDays,
    matrixCanExtend: matrixDays < MATRIX_MAX_DAYS,
    matrixNext: Math.min(MATRIX_MAX_DAYS, matrixDays + MATRIX_PAGE_DAYS),
    chosenInstructorRef: selected?.ref ?? "",
    chosenDuration: durationMinutes,
    chosenTime: fromTime,
    // Whether the viewer may open the instructor's own availability screen. The
    // card links there only when the link would actually open.
    canViewAvailability: principal.has(Permission.AVAILABILITY_VIEW_ANY),
    selectedInstructor: selected ? personChoice(selected) : null,
    instructors: instructors.map(personChoice),
    rosterSize: eligibility.studentIds.length,
    eligibilityNarrowed: eligibility.narrowed,
    instructorCleared,
    // Not an error, and not worth hiding either: the grid is honest about being
    // a first page rather than the whole roster.
    instructorsNotShown: grid ? Math.max(0, instructors.length - MAX_GRID_INSTRUCTORS) : 0,
    openings:
      day === null
        ? serialiseOpenings(
            await openings(db, organization, shortlist, {
              start: civilDate(new Date(), zone),
              days: matrixDays,
              durationMinutes,
            }),
          )
        : [],
    grid: grid ? serialiseGrid(grid) : null,
    suggestions: suggestions ? serialiseGrid(suggestions) : null,
    weekPlan: weekPlan ? serialiseWeekPlan(weekPlan) : null,
  };
}

/** Everything the booking form needs to render its choices. */
export async function bookingContext(
  db: Db,
  principal: Principal,
  organization: OrganizationRecord,
  chosen: {
    day: CivilDate | null;
    fromTime: CivilTime;
    durationMinutes?: number;
    instructorRef: string;
    matrixDays: number;
    studentRefs?: readonly string[];
    groupRef?: string;
    repeatDays?: readonly RepeatDayInput[];
  },
): Promise<BookingContext> {
  const zone = principal.timezone;
  const reader = settingsReader(organization);

  const durationsSetting = reader.setting(["booking", "selectable_durations_minutes"], [60]);
  const durations =
    Array.isArray(durationsSetting) && durationsSetting.length > 0
      ? durationsSetting.map(Number)
      : [60];

  const durationMinutes = chosen.durationMinutes ?? Math.min(...durations);

  const availability = await availabilityContext(db, principal, organization, {
    zone,
    day: chosen.day,
    fromTime: chosen.fromTime,
    durationMinutes,
    instructorRef: chosen.instructorRef,
    matrixDays: chosen.matrixDays,
    studentRefs: chosen.studentRefs ?? [],
    groupRef: chosen.groupRef ?? "",
    repeatDays: chosen.repeatDays ?? [],
  });

  // One value for the field's max attribute, the help text, and the service
  // check, so the three cannot drift apart.
  const maxOccurrences = settingNumber(
    reader,
    ["booking", "max_occurrences_per_series"],
    MAX_OCCURRENCES_PER_SERIES,
  );

  const boundsSetting = reader.setting(["booking", "duration_bounds_minutes"]);
  const bounds: [number, number] =
    Array.isArray(boundsSetting) && boundsSetting.length === 2
      ? [Number(boundsSetting[0]), Number(boundsSetting[1])]
      : [Math.min(...durations), Math.max(...durations)];

  // No instructor query here: the eligible list came back from
  // `availabilityContext` and is spread in below. Asking a second time is how
  // the dropdown and the grid start offering different people.
  const [students, programs, groups] = await Promise.all([
    db.user.findMany({
      where: { ...scoped(principal), archivedAt: null, roles: { some: { role: "STUDENT" } } },
      select: { ref: true, firstName: true, lastName: true, email: true },
      orderBy: { lastName: "asc" },
    }),
    db.program.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, name: true },
      orderBy: { name: "asc" },
    }),
    db.group.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const deliveryTypes = (Object.values(DeliveryType) as DeliveryType[])
    .filter((type) => deliveryAvailable(organization, type.toLowerCase()))
    .map((type) => ({ value: type.toLowerCase(), label: deliveryMeta(type).choice }));

  return {
    ...availability,
    maxOccurrences,
    chosenWeekday: chosen.day ? weekdayName(chosen.day) : "",
    durationLimits: bounds,
    today: civilDate(new Date(), zone),
    students: students.map(personChoice),
    programs: programs.map((program) => ({ ref: program.ref, label: program.name })),
    groups: groups.map((group) => ({ ref: group.ref, label: group.name })),
    durations,
    deliveryTypes: deliveryTypes.length > 0 ? deliveryTypes : [
      { value: "external_link", label: deliveryMeta(DeliveryType.EXTERNAL_LINK).choice },
    ],
    canOverride: principal.has(Permission.SESSION_OVERRIDE_CONFLICT),
  };
}
