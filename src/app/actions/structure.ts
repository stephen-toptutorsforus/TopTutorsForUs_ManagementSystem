"use server";

/**
 * Groups and locations.
 *
 * Ported from the `/groups` and `/locations` handlers in `app/web/views.py`.
 */

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { NotFound, ValidationError, payloadFor } from "@/lib/errors";
import { scoped } from "@/lib/policies/scoping";
import {
  addMember,
  archiveGroup,
  archiveLocation,
  createGroup,
  createLocation,
  removeMember,
} from "@/lib/services/structure";
import type { MemberRole } from "@/lib/services/structure";
import type { FormResult } from "@/lib/web/formState";
import { requestMeta, requireContext, verifyCsrf } from "@/lib/web/session";

/** An empty box means "no limit"; anything else must be a whole number. */
function optionalInt(raw: FormDataEntryValue | null, field: string): number | null {
  const text = String(raw ?? "").trim();
  if (!text) return null;
  const parsed = Number.parseInt(text, 10);
  if (!Number.isFinite(parsed) || String(parsed) !== text) {
    throw new ValidationError(`${field} must be a whole number, or left empty`);
  }
  return parsed;
}

async function run(path: string, work: () => Promise<string>): Promise<FormResult> {
  try {
    const notice = await work();
    revalidatePath(path);
    return { notice };
  } catch (error) {
    return { error: payloadFor(error).message };
  }
}

export async function createGroupAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/groups", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const programRef = String(form.get("program_ref") ?? "").trim();
    const program = programRef
      ? await prisma.program.findFirst({
          where: { ...scoped(principal), ref: programRef },
          select: { id: true },
        })
      : null;

    const group = await createGroup(prisma, organization, principal, {
      name: String(form.get("name") ?? ""),
      capacity: optionalInt(form.get("capacity"), "capacity"),
      programId: program?.id ?? null,
      requestMeta: await requestMeta(),
    });
    return `Created ${group.name}.`;
  });
}

export async function addGroupMemberAction(
  groupRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(`/groups/${groupRef}`, async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const group = await prisma.group.findFirst({
      where: { ...scoped(principal), ref: groupRef, archivedAt: null },
    });
    if (group === null) throw new NotFound("no such group");

    const user = await prisma.user.findFirst({
      where: { ...scoped(principal), ref: String(form.get("user_ref") ?? ""), archivedAt: null },
      include: { roles: true },
    });
    if (user === null) throw new NotFound("no such user");

    const asked = String(form.get("member_role") ?? "student");
    const memberRole: MemberRole = asked === "instructor" ? "instructor" : "student";

    await addMember(prisma, organization, principal, {
      group,
      user,
      memberRole,
      requestMeta: await requestMeta(),
    });
    return `Added ${`${user.firstName} ${user.lastName}`.trim() || user.ref}.`;
  });
}

export async function removeGroupMemberAction(
  groupRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run(`/groups/${groupRef}`, async () => {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const group = await prisma.group.findFirst({
      where: { ...scoped(principal), ref: groupRef, archivedAt: null },
    });
    if (group === null) throw new NotFound("no such group");

    const memberId = String(form.get("member_id") ?? "");
    if (!/^\d+$/.test(memberId)) throw new NotFound("no such member");

    // Scoped by hand because the lookup is by id, not by ref.
    const member = await prisma.groupMember.findFirst({
      where: { id: BigInt(memberId), organizationId: principal.organizationId },
    });
    if (member === null) throw new NotFound("no such member");

    await removeMember(prisma, principal, {
      group,
      member,
      requestMeta: await requestMeta(),
    });
    return "Removed from the group.";
  });
}

export async function archiveGroupAction(
  groupRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/groups", async () => {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const group = await prisma.group.findFirst({
      where: { ...scoped(principal), ref: groupRef, archivedAt: null },
    });
    if (group === null) throw new NotFound("no such group");

    await archiveGroup(prisma, principal, { group, requestMeta: await requestMeta() });
    return `Archived ${group.name}.`;
  });
}

export async function createLocationAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/locations", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const schoolRef = String(form.get("school_ref") ?? "").trim();
    const school = schoolRef
      ? await prisma.school.findFirst({
          where: { ...scoped(principal), ref: schoolRef },
          select: { id: true },
        })
      : null;

    const location = await createLocation(prisma, organization, principal, {
      name: String(form.get("name") ?? ""),
      address: String(form.get("address") ?? ""),
      capacity: optionalInt(form.get("capacity"), "capacity"),
      schoolId: school?.id ?? null,
      requestMeta: await requestMeta(),
    });
    return `Created ${location.name}.`;
  });
}

export async function archiveLocationAction(
  locationRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/locations", async () => {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const location = await prisma.location.findFirst({
      where: { ...scoped(principal), ref: locationRef, archivedAt: null },
    });
    if (location === null) throw new NotFound("no such location");

    await archiveLocation(prisma, principal, {
      location,
      requestMeta: await requestMeta(),
    });
    return `Archived ${location.name}.`;
  });
}
