"use server";

/**
 * The booking screen's one action.
 *
 * Ported from `new_session_submit` and `new_session_availability` in
 * `app/web/views.py`.
 *
 * **Preview and confirm share one path.** `plan()` produces the preview and
 * `createFromPlan()` writes exactly that plan, so the confirmed booking is the
 * previewed booking rather than a second expansion that might differ.
 *
 * Refreshing the availability block is the same action with `step: "refresh"`.
 * It loads, renders and returns: it creates no session, reserves no slot and
 * writes no audit event, so somebody changing the length four times running has
 * changed nothing. It builds the block from the same context function as the
 * first paint, which is the reason it is here rather than a second endpoint —
 * a second implementation of "who is free" would be a second answer, free to
 * disagree.
 */

import { redirect } from "next/navigation";

import { DeliveryType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { ValidationError, payloadFor } from "@/lib/errors";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import {
  type BookingRequest,
  createFromPlan,
  plan as planBooking,
} from "@/lib/services/booking";
import type { WeekdaySchedule } from "@/lib/recurrence";
import { type CivilDate, type CivilTime, isValidZone } from "@/lib/time";
import { maxRepeatDays, weekdayOf } from "@/lib/presentation";
import {
  MATRIX_MAX_DAYS,
  MATRIX_PAGE_DAYS,
  type BookingContext,
  bookingContext,
} from "@/lib/web/booking";
import type { PlanView } from "@/lib/web/planView";
import { toPlanView } from "@/lib/web/planView";
import { requestMeta, requireContext, verifyCsrf } from "@/lib/web/session";

export interface BookingState {
  context: BookingContext;
  /** Everything the form last held, so a refused submission does not lose it. */
  values: Record<string, string>;
  selectedStudents: string[];
  plan: PlanView | null;
  error?: string;
  conflictDetails?: string[];
}

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CIVIL_TIME = /^\d{2}:\d{2}$/;

function one(form: FormData, name: string, fallback = ""): string {
  const value = form.get(name);
  return (typeof value === "string" ? value : "").trim() || fallback;
}

function dateOrNull(value: string): CivilDate | null {
  if (!CIVIL_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

function timeOr(value: string, fallback: CivilTime): CivilTime {
  return CIVIL_TIME.test(value) ? value : fallback;
}

function intOr(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * Which instructor the form is asking about.
 *
 * The grid's Select button submits `pick_instructor`, which outranks the field,
 * and "Change instructor" submits `clear_instructor` under its own name — an
 * empty `pick_instructor` would fall back to whatever the select still holds
 * and the choice would come straight back.
 */
function chosenInstructorRef(form: FormData): string {
  if (one(form, "clear_instructor")) return "";
  return one(form, "pick_instructor") || one(form, "instructor_ref");
}

/** Everything the form said, kept so a refused submission does not lose it. */
function capturedValues(form: FormData): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [key, value] of form.entries()) {
    if (typeof value !== "string") continue;
    // Lists, all of them, and a `Record<string, string>` would keep only the
    // last of each. The form owns these in React state and the server echoes
    // nothing back, the same way it does not echo the chip list.
    if (key === "student_refs") continue;
    if (key.startsWith("repeat_")) continue;
    values[key] = value;
  }
  // A date or time picked from the grid outranks the field, the same way the
  // instructor does: it is the more recent statement.
  const pickedDate = one(form, "pick_date");
  const pickedTime = one(form, "pick_time");
  if (pickedDate) values.start_date = pickedDate;
  if (pickedTime) values.start_time = pickedTime;
  values.instructor_ref = chosenInstructorRef(form);
  delete values.pick_date;
  delete values.pick_time;
  delete values.pick_instructor;
  delete values.clear_instructor;
  return values;
}

/**
 * The repeat panel, as rows.
 *
 * Three parallel lists rather than one encoded field, because that is what a
 * repeated set of `<select>`s submits and it needs no format nobody can read in
 * a request log. Index `i` of each is one row; a row missing any of the three
 * is dropped rather than half-read.
 */
function repeatRows(form: FormData): { weekday: string; schedule: WeekdaySchedule }[] {
  const strings = (name: string) =>
    form.getAll(name).filter((value): value is string => typeof value === "string");

  const weekdays = strings("repeat_weekday");
  const times = strings("repeat_time");
  const lengths = strings("repeat_length");

  const rows: { weekday: string; schedule: WeekdaySchedule }[] = [];
  for (const [index, weekday] of weekdays.entries()) {
    const startTime = times[index] ?? "";
    const minutes = Number.parseInt(lengths[index] ?? "", 10);
    if (!weekday || !CIVIL_TIME.test(startTime) || !Number.isFinite(minutes)) continue;
    rows.push({ weekday, schedule: { startTime, durationMinutes: minutes } });
  }
  return rows;
}

/**
 * Translate form fields into a validated booking request.
 *
 * Refs are resolved to ids through tenant-scoped lookups, so a ref belonging to
 * another organization resolves to nothing rather than to their record.
 */
async function bookingFromForm(
  principal: Awaited<ReturnType<typeof requireContext>>["principal"],
  form: FormData,
): Promise<BookingRequest> {
  const resolve = async (
    delegate: { findFirst(args: { where: Record<string, unknown> }): Promise<{ id: bigint } | null> },
    ref: string,
  ): Promise<bigint | null> => {
    if (!ref) return null;
    const found = await delegate.findFirst({ where: { ...scoped(principal), ref } });
    return found?.id ?? null;
  };

  const chosenDate = one(form, "pick_date") || one(form, "start_date");
  if (!chosenDate) {
    // Its own message: the date field starts empty, so "not chosen yet" is the
    // ordinary first submission rather than a typo.
    throw new ValidationError("choose a session date");
  }
  const startDate = dateOrNull(chosenDate);
  const startTime = one(form, "pick_time") || one(form, "start_time");
  const duration = Number.parseInt(one(form, "duration_minutes", "60"), 10);
  if (startDate === null || !CIVIL_TIME.test(startTime) || !Number.isFinite(duration)) {
    throw new ValidationError("check the date, time, and length");
  }

  const studentIds: bigint[] = [];
  for (const ref of form.getAll("student_refs")) {
    if (typeof ref !== "string" || !ref) continue;
    const resolved = await resolve(prisma.user, ref);
    if (resolved !== null) studentIds.push(resolved);
  }

  // The number of sessions is what decides whether this is a series. There is
  // no separate "repeat" toggle to contradict it: asking for four sessions and
  // leaving repeat unticked has no sensible meaning.
  const endMode = one(form, "end_mode") === "until" ? "until" : "count";
  let repeat = false;
  let count: number | null = null;
  let until: CivilDate | null = null;

  if (endMode === "until") {
    repeat = true;
    until = dateOrNull(one(form, "until_date"));
    if (until === null) throw new ValidationError("check the end date");
  } else {
    count = Number.parseInt(one(form, "occurrence_count", "1"), 10);
    if (!Number.isFinite(count)) {
      throw new ValidationError("the number of sessions must be a whole number");
    }
    if (count < 1) throw new ValidationError("book at least one session");
    repeat = count > 1;
  }

  // The repeat panel. It only exists above one session, and its fields still
  // submit when it is hidden, so a single booking ignores it entirely.
  let weekdays: string[] | undefined;
  let perWeekday: Record<string, WeekdaySchedule> | undefined;
  let patternStart: WeekdaySchedule | undefined;

  if (repeat) {
    const rows = repeatRows(form);
    if (rows.length > 0) {
      const seen = new Set<string>();
      for (const row of rows) {
        if (seen.has(row.weekday)) {
          // Two rows on one weekday would silently become one, and the second
          // row's time would be the one that survived — a change nobody made.
          throw new ValidationError("each repeat day must be a different weekday");
        }
        seen.add(row.weekday);
      }
      const ceiling = maxRepeatDays(count ?? rows.length);
      if (rows.length > ceiling) {
        throw new ValidationError(
          `a run of ${count} sessions can repeat on at most ${ceiling} ` +
            `${ceiling === 1 ? "day" : "days"}`,
        );
      }

      weekdays = rows.map((row) => row.weekday);
      perWeekday = Object.fromEntries(rows.map((row) => [row.weekday, row.schedule]));
      // The lead-time and horizon checks are made against the request's own
      // start time, so it has to be the time the first session actually runs
      // at: the row for the start date's own weekday when there is one, and
      // otherwise the first row, which is the earliest the run can begin.
      patternStart = perWeekday[weekdayOf(startDate)] ?? rows[0]!.schedule;
    }
  }

  const asked = one(form, "delivery_type", "external_link");
  const delivery = (Object.values(DeliveryType) as DeliveryType[]).find(
    (type) => type.toLowerCase() === asked,
  );
  if (delivery === undefined) throw new ValidationError("unknown delivery type");

  // Only the field belonging to the chosen type is read. The form shows one or
  // the other, but a stale value can still arrive from a browser that filled
  // both before the type changed, and the session should not carry a link it is
  // not delivered over.
  const link = delivery === DeliveryType.EXTERNAL_LINK ? one(form, "meeting_url") : "";
  const detail = delivery === DeliveryType.IN_PERSON ? one(form, "location_detail") : "";
  // The managed room, which is the only thing the exclusion constraint can key
  // on. `locationDetail` beside it is directions to it, never a substitute for
  // it — the schema says so too, and a booking that carried only the free text
  // could be double-booked into a room the database was ready to protect.
  const room =
    delivery === DeliveryType.IN_PERSON
      ? await resolve(prisma.location, one(form, "location_ref"))
      : null;

  const timezone = one(form, "timezone") || principal.timezone;
  if (!isValidZone(timezone)) throw new ValidationError("unknown timezone");

  return {
    title: one(form, "title"),
    description: one(form, "description") || null,
    deliveryType: delivery,
    meetingUrl: link || null,
    locationId: room,
    locationDetail: detail || null,
    startDate,
    startTime: patternStart?.startTime ?? startTime,
    durationMinutes: patternStart?.durationMinutes ?? duration,
    timezone,
    instructorId: await resolve(prisma.user, chosenInstructorRef(form)),
    studentIds,
    groupId: await resolve(prisma.group, one(form, "group_ref")),
    programId: await resolve(prisma.program, one(form, "program_ref")),
    billable: one(form, "billable") === "on",
    repeat,
    // Weekly. With no repeat panel the weekday list is empty, which is how
    // `buildRule` is asked for "whichever weekday the first session falls on"
    // — the behaviour every booking had before the panel existed.
    frequency: "weekly",
    weekdays,
    perWeekday,
    endMode,
    occurrenceCount: count,
    untilDate: until,
    overrideConflicts: one(form, "override_conflicts") === "on",
  };
}

export async function bookingStep(
  _previous: BookingState,
  form: FormData,
): Promise<BookingState> {
  await verifyCsrf(form);
  const { principal, organization } = await requireContext();
  principal.require(Permission.SESSION_BOOK);

  const step = one(form, "action", "preview");
  const values = capturedValues(form);
  const selectedStudents = form
    .getAll("student_refs")
    .filter((ref): ref is string => typeof ref === "string" && ref !== "");

  const askedDays = intOr(one(form, "matrix_days"), MATRIX_PAGE_DAYS);
  const matrixDays = Math.min(MATRIX_MAX_DAYS, Math.max(MATRIX_PAGE_DAYS, askedDays));

  const context = await bookingContext(prisma, principal, organization, {
    day: dateOrNull(values.start_date ?? ""),
    fromTime: timeOr(values.start_time ?? "", "09:00"),
    durationMinutes: intOr(one(form, "duration_minutes"), 0) || undefined,
    instructorRef: values.instructor_ref ?? "",
    matrixDays,
    // The roster as the form currently holds it. It is what decides which
    // instructors are offered, so a refresh triggered by adding a student has
    // to carry the student that was just added — which is why the form waits
    // for React to commit the new hidden inputs before submitting.
    studentRefs: selectedStudents,
    groupRef: one(form, "group_ref"),
    // The weekdays the run falls on, so a chosen instructor's availability can
    // be drawn a row per weekday. Only above one session: below it the panel is
    // hidden and its fields still submit.
    repeatDays:
      intOr(one(form, "occurrence_count"), 1) > 1
        ? repeatRows(form).map((row) => ({ weekday: row.weekday, ...row.schedule }))
        : [],
  });

  const base: BookingState = { context, values, selectedStudents, plan: null };

  // A refresh answers "who is free" and nothing else. No plan, no write.
  if (step === "refresh") return base;

  let booking: BookingRequest;
  let bookingPlan: Awaited<ReturnType<typeof planBooking>>;
  try {
    booking = await bookingFromForm(principal, form);
    bookingPlan = await planBooking(prisma, organization, principal, booking);
  } catch (error) {
    return { ...base, error: payloadFor(error).message };
  }

  const view = toPlanView(bookingPlan, booking.timezone);
  if (step !== "confirm") return { ...base, plan: view };

  let created: Awaited<ReturnType<typeof createFromPlan>>;
  try {
    created = await createFromPlan(prisma, organization, principal, bookingPlan, {
      ...(await requestMeta()),
    });
  } catch (error) {
    const payload = payloadFor(error);
    return {
      ...base,
      plan: view,
      error: payload.message,
      conflictDetails: Array.isArray(payload.details)
        ? payload.details.map(String)
        : undefined,
    };
  }

  // Post/redirect/get: a refresh re-runs the GET, never the write.
  if (created.series !== null) {
    redirect(`/series/${created.series.ref}?notice=${encodeURIComponent(
      `Created ${created.created.length} sessions.`,
    )}`);
  }
  redirect(
    `/sessions/${created.created[0]!.ref}?notice=${encodeURIComponent("Session created.")}`,
  );
}
