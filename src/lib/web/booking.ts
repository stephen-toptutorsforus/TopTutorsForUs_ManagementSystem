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
  type BusyByInstructor,
  type Candidate,
  type DayGrid,
  type DayOpenings,
  type WeekdayGrid,
  dayGrid,
  openings,
  weekdayGrid,
} from "@/lib/availability";
import { busyIntervals } from "@/lib/conflicts";
import type { Db } from "@/lib/db";
import {
  MAX_OCCURRENCES_PER_SERIES,
  deliveryAvailable,
  settingBoolean,
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
import { type CivilDate, type CivilTime, addDays, civilDate, resolveCivil } from "@/lib/time";
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

/**
 * The repeat table's axis: the whole day, a quarter of an hour at a time,
 * grouped into hours.
 *
 * Fixed, and deliberately not `SUGGESTION_*`. That grid's columns begin at the
 * time already in the form, which is right when the question is "one session,
 * one date" — but wrong here, because pressing a cell in this table *sets* a
 * start time, and an axis anchored to it would slide out from under the person
 * on every press. A run of weekdays is also a wider question than one date: an
 * evening class and an early one can be in the same run, and eight columns
 * from the current time cannot hold both.
 *
 * The whole day is the only honest fixed answer, so it scrolls sideways
 * instead. Ninety-six columns is not a table anybody can read, and twenty-four
 * cannot offer the quarter past that every other time control on the form can
 * — so the resolution and the layout are separated: the axis is the hour, and
 * the four quarters live inside the hour they belong to. The step matches the
 * form's clock exactly, so a time this table offers is always a time the row's
 * own Start time select can hold.
 */
export const WEEKPLAN_START: CivilTime = "00:00";
export const WEEKPLAN_STEP_MINUTES = 15;
export const WEEKPLAN_SLOTS_PER_HOUR = 60 / WEEKPLAN_STEP_MINUTES;
export const WEEKPLAN_COLUMNS = 24 * WEEKPLAN_SLOTS_PER_HOUR;

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

/** One start time inside an hour: `:15`, and the `16:15` it sets. */
export interface WeekPlanSlot {
  value: CivilTime;
  label: string;
}

/** One column: an hour, and the quarters it is divided into. */
export interface WeekPlanHour {
  label: string;
  slots: WeekPlanSlot[];
}

/** The repeat grid: weekdays down the side, hours across the top. */
export interface SerialisedWeekPlan {
  columns: WeekPlanHour[];
  rows: {
    weekday: string;
    /** `Monday` — the row's own heading. */
    name: string;
    /** `Monday, Sep 14` — the date it resolved to, so the row is checkable. */
    dayLabel: string;
    durationMinutes: number;
    /**
     * This weekday's start time as the form currently holds it, so the cell
     * that matches can be drawn as the chosen one. Off-step times have no cell
     * and light none, which is the truth: the select below still shows 9:15.
     */
    startTime: CivilTime;
    /**
     * Which quarters of this weekday are already booked, on the date the row
     * resolved to, flattened in column order.
     *
     * Unlike the day grid's, this does not take the quarter away. The row
     * stands for a weekday across a whole run, and a clash on the first
     * Wednesday costs that one occurrence rather than the time itself — so it
     * is marked and still offered, and Preview stays the authority on which
     * occurrences actually clash. Carried per row where `free` is not,
     * because "already teaching" is a fact about a real date this table can
     * state, and "outside declared hours" is an overridable conflict it cannot.
     */
    taken: boolean[];
    closedReason: string | null;
  }[];
  /**
   * Whether any of these weekdays has a declared window long enough for it.
   *
   * The only thing left of the per-quarter answer, because the table draws
   * every quarter the same: it offers times rather than narrowing them, and
   * `outside_availability` is an overridable conflict the preview reports
   * rather than a rule this table could enforce. Kept as one boolean per grid
   * so the block can still say when a run is asking for days the instructor
   * has not declared at all.
   */
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
    /**
     * Which columns this person is not free for *because they are already
     * booked*, rather than because they do not work then. Two different things
     * to be told, and two different fixes — another time, or another person.
     */
    taken: boolean[];
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
  /**
   * The tenant's managed rooms. Offered for an in-person session because a room
   * is the only thing the location exclusion constraint can key on; the free
   * text beside it is directions to it, not a substitute for it.
   */
  locations: Choice[];
  durations: number[];
  deliveryTypes: { value: string; label: string }[];
  canOverride: boolean;
  /**
   * What the Billable box starts as. The screen used to force it on with a
   * hidden field, so this ships `true` and a tenant that configures nothing
   * books exactly as before.
   */
  billableDefault: boolean;
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

function serialiseWeekPlan(
  grid: WeekdayGrid,
  chosen: readonly RepeatDayInput[],
): SerialisedWeekPlan {
  // The quarter-hour columns, gathered into the hour each falls in. Grouped by
  // the hour the column *says* rather than by counting off four at a time, so
  // this cannot quietly mis-group if the axis ever starts somewhere other than
  // midnight or the step stops dividing an hour. The hour takes its heading
  // from its first column, which is the one on the hour.
  //
  // `grid.rows[].free` is deliberately not carried across. Every quarter is
  // offered whatever the declared hours say, so a hundred booleans a row would
  // be a hundred booleans nothing reads — `anyOpen` below is all that survives
  // of it. `taken` *is* carried, because that one is not about declared hours:
  // it says the instructor is already teaching then, which is a fact about a
  // real date rather than a rule this table could enforce.
  const columns: WeekPlanHour[] = [];
  let currentHour: string | null = null;
  for (const column of grid.columns) {
    const hour = column.value.slice(0, 2);
    if (hour !== currentHour) {
      currentHour = hour;
      columns.push({ label: column.label, slots: [] });
    }
    columns[columns.length - 1]!.slots.push({
      value: column.value,
      label: `:${column.value.slice(3)}`,
    });
  }

  return {
    columns,
    rows: grid.rows.map((row) => ({
      weekday: row.weekday,
      name: weekdayName(row.day),
      dayLabel: dayLabel(row.day),
      durationMinutes: row.durationMinutes,
      startTime: chosen.find((day) => day.weekday === row.weekday)?.startTime ?? "",
      taken: row.taken,
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

  /**
   * What each candidate already has booked over the span this state draws.
   *
   * Fetched here and handed down rather than looked up inside the grid, so the
   * whole block costs one statement for it however many rows and columns are
   * drawn. Declared hours say when somebody works; this says when they are
   * already spoken for, and a table that knew only the first would offer times
   * the write refuses outright.
   */
  const bookedOver = async (
    people: readonly Candidate[],
    from: CivilDate,
    days: number,
  ): Promise<BusyByInstructor> =>
    busyIntervals(
      db,
      organization,
      people.map((person) => person.id),
      resolveCivil(from, "00:00", zone).instant,
      resolveCivil(addDays(from, days), "00:00", zone).instant,
    );

  if (day !== null && selected !== null && repeatDays.length > 0) {
    // One row per weekday the run falls on, resolved forward from the session
    // date so no row is a date that has already passed. Seven days covers every
    // row, whichever weekdays the run names.
    weekPlan = await weekdayGrid(db, organization, selected.id, repeatDays, {
      from: day,
      fromTime: WEEKPLAN_START,
      timezone: zone,
      columns: WEEKPLAN_COLUMNS,
      stepMinutes: WEEKPLAN_STEP_MINUTES,
      busy: await bookedOver([selected], day, 7),
    });
  } else if (day !== null && selected !== null) {
    suggestions = await dayGrid(db, organization, [selected], {
      day,
      fromTime,
      durationMinutes,
      timezone: zone,
      columns: SUGGESTION_COLUMNS,
      stepMinutes: SUGGESTION_STEP_MINUTES,
      busy: await bookedOver([selected], day, 1),
    });
  } else if (day !== null) {
    const shown = instructors.slice(0, MAX_GRID_INSTRUCTORS);
    grid = await dayGrid(db, organization, shown, {
      day,
      fromTime,
      durationMinutes,
      timezone: zone,
      columns: GRID_COLUMNS,
      stepMinutes: GRID_STEP_MINUTES,
      busy: await bookedOver(shown, day, 1),
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
              busy: await bookedOver(shortlist, civilDate(new Date(), zone), matrixDays),
            }),
          )
        : [],
    grid: grid ? serialiseGrid(grid) : null,
    suggestions: suggestions ? serialiseGrid(suggestions) : null,
    weekPlan: weekPlan ? serialiseWeekPlan(weekPlan, repeatDays) : null,
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
  const [students, programs, groups, locations] = await Promise.all([
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
    db.location.findMany({
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
    locations: locations.map((location) => ({ ref: location.ref, label: location.name })),
    durations,
    deliveryTypes: deliveryTypes.length > 0 ? deliveryTypes : [
      { value: "external_link", label: deliveryMeta(DeliveryType.EXTERNAL_LINK).choice },
    ],
    canOverride: principal.has(Permission.SESSION_OVERRIDE_CONFLICT),
    billableDefault: settingBoolean(reader, ["booking", "billable_default"], true),
  };
}
