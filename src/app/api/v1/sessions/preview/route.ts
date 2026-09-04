/**
 * Expand and check a rule without writing anything.
 *
 * Ported from `preview` in `app/web/api.py`. The same `plan()` the booking form
 * uses, so an integration previewing here and booking through the interface
 * cannot get different answers.
 */

import { DeliveryType } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { ValidationError, payloadFor, statusFor } from "@/lib/errors";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { dstAdjusted, shiftedByDst } from "@/lib/recurrence";
import {
  type BookingRequest,
  hasConflicts,
  isBlocked,
  isBookable,
  needsOverride,
  plan,
} from "@/lib/services/booking";
import { outMoment } from "@/lib/web/api";
import { requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

/** A recurrence to preview. Deliberately mirrors the booking form. */
interface PreviewIn {
  title?: string;
  start_date?: string;
  start_time?: string;
  duration_minutes?: number;
  timezone?: string;
  instructor_ref?: string;
  student_refs?: string[];
  repeat?: boolean;
  frequency?: "daily" | "weekly";
  interval_n?: number;
  weekdays?: string[];
  end_mode?: "count" | "until";
  occurrence_count?: number | null;
  until_date?: string | null;
  meeting_url?: string | null;
}

export async function POST(request: Request): Promise<Response> {
  try {
    const { principal, organization } = await requireContext();
    principal.require(Permission.SESSION_BOOK);

    let body: PreviewIn;
    try {
      body = (await request.json()) as PreviewIn;
    } catch {
      throw new ValidationError("the request body is not JSON");
    }

    const resolveUser = async (ref: string | undefined): Promise<bigint | null> => {
      if (!ref) return null;
      const found = await prisma.user.findFirst({
        where: { ...scoped(principal), ref },
        select: { id: true },
      });
      return found?.id ?? null;
    };

    const zone = body.timezone || principal.timezone;
    const studentIds: bigint[] = [];
    for (const ref of body.student_refs ?? []) {
      const id = await resolveUser(ref);
      if (id !== null) studentIds.push(id);
    }

    if (!body.start_date || !body.start_time || !body.duration_minutes) {
      throw new ValidationError("start_date, start_time and duration_minutes are required");
    }

    const booking: BookingRequest = {
      title: body.title ?? "Session",
      deliveryType: DeliveryType.EXTERNAL_LINK,
      // A placeholder rather than nothing: the preview never writes, and a link
      // is not required to book, but the caller may not have one to hand.
      meetingUrl: body.meeting_url || "https://example.test/placeholder",
      startDate: body.start_date,
      startTime: body.start_time,
      durationMinutes: body.duration_minutes,
      timezone: zone,
      instructorId: await resolveUser(body.instructor_ref),
      studentIds,
      repeat: body.repeat ?? false,
      frequency: body.frequency ?? "weekly",
      intervalN: body.interval_n ?? 1,
      weekdays: body.weekdays ?? [],
      endMode: body.end_mode ?? "count",
      occurrenceCount: body.occurrence_count ?? null,
      untilDate: body.until_date ?? null,
    };

    const bookingPlan = await plan(prisma, organization, principal, booking);
    // Named so the shape is obvious at the call site; the count is what the
    // response reports, not which occurrences they were.
    void dstAdjusted(bookingPlan.expansion);

    return Response.json({
      total: bookingPlan.sessions.length,
      bookable: isBookable(bookingPlan),
      needs_override: needsOverride(bookingPlan),
      truncated: bookingPlan.expansion.truncated,
      truncation_reason: bookingPlan.expansion.truncationReason,
      skipped_dates: bookingPlan.expansion.skippedDates,
      occurrences: bookingPlan.sessions.map((planned) => ({
        index: planned.occurrence.index,
        start: outMoment(planned.occurrence.start, zone),
        end: outMoment(planned.occurrence.end, zone),
        dst_adjusted: shiftedByDst(planned.occurrence),
        conflicts: planned.report.conflicts.map((conflict) => conflict.message),
        blocked: isBlocked(planned),
        has_conflicts: hasConflicts(planned),
      })),
    });
  } catch (error) {
    return Response.json(payloadFor(error), { status: statusFor(error) });
  }
}
