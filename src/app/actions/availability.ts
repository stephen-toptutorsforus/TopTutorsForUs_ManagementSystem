"use server";

/**
 * Declaring an instructor's availability.
 *
 * Ported from `availability_add` in `app/web/views.py`.
 */

import { revalidatePath } from "next/cache";

import { AuditCategory, Role } from "@/generated/prisma/enums";
import { record } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { NotFound, ValidationError, payloadFor } from "@/lib/errors";
import { Permission } from "@/lib/policies/permissions";
import { peopleAtSchools, schoolScope } from "@/lib/policies/schoolScope";
import { scoped } from "@/lib/policies/scoping";
import { WEEKDAY_LABELS } from "@/lib/presentation";
import { newRef } from "@/lib/ref";
import { timeToDb } from "@/lib/time";
import type { FormResult } from "@/lib/web/formState";
import { requestMeta, requireContext, verifyCsrf } from "@/lib/web/session";

const CIVIL_TIME = /^\d{2}:\d{2}$/;

export async function addAvailability(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  try {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const instructorRef = String(form.get("instructor_ref") ?? "");
    const bound = schoolScope(principal);
    const instructor = await prisma.user.findFirst({
      where: {
        ...scoped(principal),
        ref: instructorRef,
        archivedAt: null,
        ...(bound ? peopleAtSchools(bound) : {}),
      },
    });
    if (instructor === null) throw new NotFound("no such user");

    if (instructor.id === principal.userId) {
      principal.require(Permission.AVAILABILITY_EDIT_OWN);
    } else {
      principal.require(Permission.AVAILABILITY_EDIT_ANY);
    }

    // Holding the permission says you may edit somebody's availability. It does
    // not say this person has any. An availability rule against an
    // administrator is a row nothing reads and nothing can book against —
    // checked here rather than trusted from the form, which is where the wrong
    // ref came from.
    const isInstructor = await prisma.userRole.findFirst({
      where: {
        userId: instructor.id,
        organizationId: principal.organizationId,
        role: Role.INSTRUCTOR,
      },
    });
    if (isInstructor === null) {
      throw new ValidationError("availability can only be declared for an instructor");
    }

    const startTime = String(form.get("start_time") ?? "");
    const endTime = String(form.get("end_time") ?? "");
    const weekday = String(form.get("weekday") ?? "");
    if (!CIVIL_TIME.test(startTime) || !CIVIL_TIME.test(endTime)) {
      throw new ValidationError("check the times");
    }
    if (endTime <= startTime) {
      throw new ValidationError("the end of a window must be after its start");
    }
    if (!(weekday in WEEKDAY_LABELS)) throw new ValidationError("unknown weekday");

    await prisma.availabilityRule.create({
      data: {
        ref: newRef("avr"),
        organizationId: principal.organizationId,
        instructorId: instructor.id,
        weekday,
        startTime: timeToDb(startTime),
        endTime: timeToDb(endTime),
        timezone: principal.timezone,
      },
    });

    await record(prisma, principal, {
      category: AuditCategory.AVAILABILITY,
      action: "availability.added",
      entityType: "availability_rule",
      entityId: instructor.id,
      entityRef: instructor.ref,
      changes: { start_time: { from: null, to: startTime } },
      ...(await requestMeta()),
    });

    revalidatePath("/availability");
    return { notice: "Availability added." };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}
