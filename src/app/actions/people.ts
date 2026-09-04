"use server";

/**
 * Creating people, and assigning a student to an instructor.
 *
 * Ported from `people_create` and `people_assign` in `app/web/views.py`.
 *
 * One role, chosen in the first step of the form, because the second step is
 * different for each and a form cannot be two shapes at once. More roles are
 * added afterwards: the model has always allowed a person to hold several.
 *
 * No password is set here. An administrator creating an account cannot learn or
 * choose its credentials, which keeps "administrator" and "able to impersonate
 * anyone" separate capabilities.
 */

import { revalidatePath } from "next/cache";

import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { NotFound, ValidationError, payloadFor } from "@/lib/errors";
import type { Principal } from "@/lib/policies/principal";
import { scoped } from "@/lib/policies/scoping";
import { createGuardian, createStaff, createStudent } from "@/lib/services/enrolment";
import type { PlaceRef } from "@/lib/services/enrolment";
import { assignStudent } from "@/lib/services/people";
import type { PersonRecord } from "@/lib/services/people";
import type { FormResult } from "@/lib/web/formState";
import { requestMeta, requireContext, verifyCsrf } from "@/lib/web/session";

/**
 * Resolve a picker to records.
 *
 * The chips submit refs. Without the script the search box submits whatever was
 * typed, so the same field is resolved by name as well — one typed name works,
 * several need the script. Both paths are tenant-scoped, and anything that
 * matches nothing is dropped rather than failing the whole form.
 */
async function pickPeople(
  principal: Principal,
  form: FormData,
  field: string,
): Promise<PersonRecord[]> {
  const found = new Map<bigint, PersonRecord>();

  const refs = form.getAll(`${field}_refs`).map(String).filter(Boolean);
  if (refs.length > 0) {
    for (const row of await prisma.user.findMany({
      where: { ...scoped(principal), ref: { in: refs } },
      include: { roles: true },
    })) {
      found.set(row.id, row);
    }
  }

  const names = form.getAll(`${field}_names`).map(String).map((n) => n.trim()).filter(Boolean);
  for (const name of names) {
    const parts = name.split(/\s+/);
    const row = await prisma.user.findFirst({
      where: {
        ...scoped(principal),
        firstName: { equals: parts[0], mode: "insensitive" },
        lastName: { equals: parts[parts.length - 1], mode: "insensitive" },
      },
      include: { roles: true },
    });
    if (row) found.set(row.id, row);
  }

  return [...found.values()];
}

/** The same, for a named place — a school or a region. */
async function pickPlaces(
  principal: Principal,
  form: FormData,
  field: string,
  delegate: {
    findMany(args: { where: Record<string, unknown> }): Promise<PlaceRef[]>;
  },
): Promise<PlaceRef[]> {
  const found = new Map<bigint, PlaceRef>();

  const refs = form.getAll(`${field}_refs`).map(String).filter(Boolean);
  if (refs.length > 0) {
    for (const row of await delegate.findMany({
      where: { ...scoped(principal), ref: { in: refs } },
    })) {
      found.set(row.id, row);
    }
  }

  const names = form.getAll(`${field}_names`).map(String).map((n) => n.trim()).filter(Boolean);
  for (const name of names) {
    for (const row of await delegate.findMany({
      where: { ...scoped(principal), name: { equals: name, mode: "insensitive" } },
    })) {
      found.set(row.id, row);
    }
  }

  return [...found.values()];
}

export async function createPersonAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  try {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();
    const meta = await requestMeta();

    const firstName = String(form.get("first_name") ?? "");
    const lastName = String(form.get("last_name") ?? "");
    const email = String(form.get("email") ?? "");
    const phone = String(form.get("phone") ?? "");
    const grade = String(form.get("grade") ?? "");
    const asked = String(form.get("role") ?? "");

    const role = (Object.values(Role) as string[]).find(
      (value) => value.toLowerCase() === asked,
    ) as Role | undefined;
    if (role === undefined) throw new ValidationError(`unknown role: ${asked}`);

    let person;
    if (role === Role.STUDENT) {
      const requiresGuardian = String(form.get("requires_guardian") ?? "") === "yes";
      const guardianRef = String(form.get("guardian_ref") ?? "").trim();
      const guardian =
        requiresGuardian && guardianRef
          ? await prisma.user.findFirst({
              where: { ...scoped(principal), ref: guardianRef, archivedAt: null },
              include: { roles: true },
            })
          : null;
      if (requiresGuardian && guardianRef && guardian === null) {
        throw new NotFound("no such user");
      }

      person = await createStudent(prisma, organization, principal, {
        firstName,
        lastName,
        email,
        requiresGuardian,
        guardian,
        instructors: await pickPeople(principal, form, "instructor"),
        schools: await pickPlaces(principal, form, "school", prisma.school),
        regions: await pickPlaces(principal, form, "region", prisma.region),
        grade: grade || null,
        phone,
        requestMeta: meta,
      });
    } else if (role === Role.PARENT) {
      person = await createGuardian(prisma, organization, principal, {
        firstName,
        lastName,
        email,
        phone,
        relationship: String(form.get("relationship") ?? "parent"),
        students: await pickPeople(principal, form, "student"),
        requestMeta: meta,
      });
    } else {
      person = await createStaff(prisma, organization, principal, {
        role,
        firstName,
        lastName,
        email,
        phone,
        schools: await pickPlaces(principal, form, "school", prisma.school),
        regions: await pickPlaces(principal, form, "region", prisma.region),
        requestMeta: meta,
      });
    }

    revalidatePath("/people");
    const name = `${person.firstName} ${person.lastName}`.trim() || person.ref;
    return { notice: `Invited ${name}.` };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}

export async function assignStudentAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  try {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const load = async (ref: string) => {
      const found = await prisma.user.findFirst({
        where: { ...scoped(principal), ref, archivedAt: null },
        include: { roles: true },
      });
      if (found === null) throw new NotFound("no such user");
      return found;
    };

    const instructor = await load(String(form.get("instructor_ref") ?? ""));
    const student = await load(String(form.get("student_ref") ?? ""));

    await assignStudent(prisma, organization, principal, {
      instructor,
      student,
      requestMeta: await requestMeta(),
    });

    revalidatePath("/people");
    const name = (person: typeof instructor) =>
      `${person.firstName} ${person.lastName}`.trim() || person.ref;
    return { notice: `Assigned ${name(student)} to ${name(instructor)}.` };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}
