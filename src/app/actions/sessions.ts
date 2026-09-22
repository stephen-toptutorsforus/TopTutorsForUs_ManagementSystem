"use server";

/**
 * The session detail page's actions.
 *
 * Ported from the `/sessions/{ref}/…` handlers in `app/web/views.py`.
 *
 * Every one of them re-checks policy inside the service it calls, runs in a
 * transaction with its audit entry, and comes back to the same page with a
 * notice. None of them trusts a hidden field: the scope, the reason, and the
 * participant ids are all validated server-side, because a form is a
 * suggestion.
 */

import { revalidatePath } from "next/cache";

import { AttendanceStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { NotFound, ValidationError, payloadFor } from "@/lib/errors";
import { visibleSessions } from "@/lib/services/sessionQuery";
import { EditScope } from "@/lib/services/booking";
import * as sessionOps from "@/lib/services/sessionOps";
import { resolveCivil } from "@/lib/time";
import type { FormResult } from "@/lib/web/formState";
import { requestMeta, requireContext, verifyCsrf } from "@/lib/web/session";

/** The scope a form asked for, refusing anything that is not one. */
function readScope(value: FormDataEntryValue | null): EditScope {
  const scopes = Object.values(EditScope) as string[];
  const asked = String(value ?? EditScope.THIS);
  if (!scopes.includes(asked)) throw new ValidationError("unknown scope");
  return asked as EditScope;
}

function scopeNotice(scope: EditScope, verb: string): string {
  if (scope === EditScope.ALL) return `The whole series was ${verb}.`;
  if (scope === EditScope.THIS_AND_FUTURE) {
    return `This and every later session were ${verb}.`;
  }
  return `This session was ${verb}.`;
}

/**
 * A local wall-clock value from a `datetime-local` input, as an instant.
 *
 * Empty means "not recorded", which is a different fact from "recorded as the
 * scheduled time" and has to survive the round trip as null.
 */
function localToInstant(value: FormDataEntryValue | null, zone: string): Date | null {
  const text = String(value ?? "").trim();
  if (!text) return null;
  const [day, time] = text.split("T");
  if (!day || !time) throw new ValidationError("that is not a date and time");
  return resolveCivil(day, time.slice(0, 5), zone).instant;
}

/** Load one session in the caller's tenant, or 404. */
async function loadSession(ref: string) {
  const { principal, organization } = await requireContext();
  const occurrence = await prisma.sessionOccurrence.findFirst({
    where: { ...visibleSessions(principal), ref },
  });
  if (occurrence === null) throw new NotFound("no such session");
  return { principal, organization, occurrence };
}

/**
 * Every screen a session is drawn on.
 *
 * Editing one only revalidated its own page, so the rows it had just changed
 * went on being served from the router cache everywhere else: somebody moved a
 * session, pressed Back, and the calendar showed it at the old time. A
 * series-scoped edit is worse, because it can move a hundred of them.
 *
 * The two dynamic routes are named as patterns rather than as one ref, because
 * a series edit changes every occurrence and a `this_and_future` edit changes
 * an unknown number of them.
 */
const SESSION_SCREENS = [
  "/calendar",
  "/sessions",
  "/series",
  "/",
  "/audit",
] as const;

/** Every action answers the same shape, so one component can show the result. */
async function run(ref: string, work: () => Promise<string>): Promise<FormResult> {
  try {
    const notice = await work();
    revalidatePath(`/sessions/${ref}`);
    // The editing screen is a second page on the same record.
    revalidatePath(`/sessions/${ref}/edit`);
    for (const path of SESSION_SCREENS) revalidatePath(path);
    // Every other occurrence of the series, and every series page: a scoped
    // edit reaches rows this action never names.
    revalidatePath("/sessions/[ref]", "page");
    revalidatePath("/series/[ref]", "page");
    return { notice };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}

export async function rescheduleSession(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, organization, occurrence } = await loadSession(ref);
    const scope = readScope(form.get("scope"));

    const changed = await sessionOps.reschedule(
      prisma,
      organization,
      principal,
      occurrence,
      {
        startDate: String(form.get("start_date") ?? ""),
        startTime: String(form.get("start_time") ?? ""),
        durationMinutes: Number(form.get("duration_minutes") ?? 0),
        timezone: occurrence.timezone,
        reason: String(form.get("reason") ?? "") || null,
      },
      { scope, requestMeta: await requestMeta() },
    );
    if (changed.length === 0) return "Nothing moved — that is already the time.";
    return scopeNotice(scope, "rescheduled");
  });
}

export async function editSession(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, organization, occurrence } = await loadSession(ref);
    const scope = readScope(form.get("scope"));

    await sessionOps.editDetails(prisma, principal, occurrence, {
      scope,
      title: String(form.get("title") ?? ""),
      description: String(form.get("description") ?? "") || null,
      // Read either way and discarded by the service on a tenant that charges
      // for nothing — the panel does not draw the box there, and a hidden
      // control is a courtesy rather than the check.
      billable: form.get("billable") === "on",
      organization,
      requestMeta: await requestMeta(),
    });
    return scopeNotice(scope, "updated");
  });
}

export async function cancelSession(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, organization, occurrence } = await loadSession(ref);
    const scope = readScope(form.get("scope"));

    const cancelled = await sessionOps.cancel(prisma, organization, principal, occurrence, {
      reason: String(form.get("reason") ?? ""),
      note: String(form.get("note") ?? "") || null,
      scope,
      requestMeta: await requestMeta(),
    });
    return `Cancelled ${cancelled.length} session${cancelled.length === 1 ? "" : "s"}.`;
  });
}

export async function changeStatus(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, organization, occurrence } = await loadSession(ref);
    const meta = await requestMeta();

    switch (String(form.get("action") ?? "")) {
      case "complete":
        await sessionOps.complete(prisma, principal, occurrence, { requestMeta: meta });
        return "Session marked completed.";
      case "mark_missed":
        await sessionOps.markMissed(prisma, organization, principal, occurrence, {
          reason: String(form.get("reason") ?? ""),
          requestMeta: meta,
        });
        return "Session marked missed.";
      case "restore":
        await sessionOps.restore(prisma, principal, occurrence, { requestMeta: meta });
        return "Session restored to scheduled.";
      default:
        throw new ValidationError("unknown action");
    }
  });
}

export async function decideRequest(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, organization, occurrence } = await loadSession(ref);

    const decision = String(form.get("decision") ?? "");
    if (decision !== "approve" && decision !== "reject") {
      throw new ValidationError("unknown decision");
    }

    await sessionOps.decideRequest(prisma, organization, principal, occurrence, {
      approve: decision === "approve",
      reason: String(form.get("reason") ?? "") || null,
      requestMeta: await requestMeta(),
    });
    return decision === "approve"
      ? "Request approved — the session is now scheduled."
      : "Request rejected.";
  });
}

/** Record attendance for every participant submitted, in one transaction. */
export async function recordAttendance(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, occurrence } = await loadSession(ref);
    const meta = await requestMeta();

    if (form.get("bulk") === "all_present") {
      const touched = await sessionOps.markAllPresent(prisma, principal, occurrence, {
        requestMeta: meta,
      });
      return `Marked ${touched.length} unmarked student${
        touched.length === 1 ? "" : "s"
      } present.`;
    }

    const participants = new Map(
      (
        await prisma.sessionParticipant.findMany({ where: { sessionId: occurrence.id } })
      ).map((participant) => [String(participant.id), participant]),
    );

    const known = Object.values(AttendanceStatus) as string[];
    let updated = 0;

    for (const [key, value] of form.entries()) {
      if (!key.startsWith("attendance_")) continue;
      const participant = participants.get(key.slice("attendance_".length));
      const asked = String(value);
      const status = known.find((s) => s === asked || s.toLowerCase() === asked);
      // An unknown participant or an unknown status is skipped rather than
      // failing the batch: the form is submitted whole, and one stale field
      // must not lose every other mark on the page.
      if (!participant || status === undefined) continue;
      if (participant.attendance === status) continue;

      await sessionOps.markAttendance(prisma, principal, occurrence, participant, {
        status: status as AttendanceStatus,
        requestMeta: meta,
      });
      updated += 1;
    }

    return `Recorded attendance for ${updated} participant${updated === 1 ? "" : "s"}.`;
  });
}

export async function correctActualTimes(
  ref: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(ref, async () => {
    await verifyCsrf(form);
    const { principal, occurrence } = await loadSession(ref);

    await sessionOps.correctActualTimes(prisma, principal, occurrence, {
      actualStart: localToInstant(form.get("actual_start"), occurrence.timezone),
      actualEnd: localToInstant(form.get("actual_end"), occurrence.timezone),
      requestMeta: await requestMeta(),
    });
    return "Recorded times corrected.";
  });
}
