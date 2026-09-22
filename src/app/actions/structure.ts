"use server";

/**
 * Groups, locations, and the place hierarchy.
 *
 * Ported from the `/groups` and `/locations` handlers in `app/web/views.py`.
 * Regions, districts and schools share the same actions and the same screen.
 */

import { revalidatePath } from "next/cache";

import { prisma } from "@/lib/db";
import { NotFound, ValidationError, payloadFor } from "@/lib/errors";
import { scoped } from "@/lib/policies/scoping";
import { attachSchool, detachSchool } from "@/lib/services/enrolment";
import {
  addMember,
  archiveDistrict,
  archiveGroup,
  archiveLocation,
  archiveRegion,
  archiveSchool,
  createDistrict,
  createGroup,
  createLocation,
  createRegion,
  createSchool,
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

export async function createRegionAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const region = await createRegion(prisma, organization, principal, {
      name: String(form.get("name") ?? ""),
      requestMeta: await requestMeta(),
    });
    return `Created ${region.name}.`;
  });
}

export async function archiveRegionAction(
  regionRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const region = await prisma.region.findFirst({
      where: { ...scoped(principal), ref: regionRef, archivedAt: null },
    });
    if (region === null) throw new NotFound("no such region");

    await archiveRegion(prisma, principal, { region, requestMeta: await requestMeta() });
    return `Archived ${region.name}.`;
  });
}

export async function createDistrictAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const regionRef = String(form.get("region_ref") ?? "").trim();
    const region = regionRef
      ? await prisma.region.findFirst({
          where: { ...scoped(principal), ref: regionRef, archivedAt: null },
          select: { id: true },
        })
      : null;

    const district = await createDistrict(prisma, organization, principal, {
      name: String(form.get("name") ?? ""),
      regionId: region?.id ?? null,
      requestMeta: await requestMeta(),
    });
    return `Created ${district.name}.`;
  });
}

export async function archiveDistrictAction(
  districtRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const district = await prisma.district.findFirst({
      where: { ...scoped(principal), ref: districtRef, archivedAt: null },
    });
    if (district === null) throw new NotFound("no such district");

    await archiveDistrict(prisma, principal, { district, requestMeta: await requestMeta() });
    return `Archived ${district.name}.`;
  });
}

export async function createSchoolAction(
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const districtRef = String(form.get("district_ref") ?? "").trim();
    const district = districtRef
      ? await prisma.district.findFirst({
          where: { ...scoped(principal), ref: districtRef, archivedAt: null },
          select: { id: true },
        })
      : null;

    const school = await createSchool(prisma, organization, principal, {
      name: String(form.get("name") ?? ""),
      districtId: district?.id ?? null,
      timezone: String(form.get("timezone") ?? ""),
      requestMeta: await requestMeta(),
    });
    return `Created ${school.name}.`;
  });
}

export async function archiveSchoolAction(
  schoolRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal } = await requireContext();

    const school = await prisma.school.findFirst({
      where: { ...scoped(principal), ref: schoolRef, archivedAt: null },
    });
    if (school === null) throw new NotFound("no such school");

    await archiveSchool(prisma, principal, { school, requestMeta: await requestMeta() });
    return `Archived ${school.name}.`;
  });
}

export async function attachSchoolPersonAction(
  schoolRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const school = await prisma.school.findFirst({
      where: { ...scoped(principal), ref: schoolRef, archivedAt: null },
    });
    if (school === null) throw new NotFound("no such school");

    const user = await prisma.user.findFirst({
      where: { ...scoped(principal), ref: String(form.get("user_ref") ?? ""), archivedAt: null },
      include: { roles: true },
    });
    if (user === null) throw new NotFound("no such user");

    await attachSchool(prisma, organization, principal, {
      person: user,
      school,
      requestMeta: await requestMeta(),
    });
    revalidatePath("/people");
    return `Placed ${`${user.firstName} ${user.lastName}`.trim() || user.ref} at ${school.name}.`;
  });
}

export async function detachSchoolPersonAction(
  schoolRef: string,
  _previous: FormResult,
  form: FormData,
): Promise<FormResult> {
  return run("/schools", async () => {
    await verifyCsrf(form);
    const { principal, organization } = await requireContext();

    const school = await prisma.school.findFirst({
      where: { ...scoped(principal), ref: schoolRef, archivedAt: null },
    });
    if (school === null) throw new NotFound("no such school");

    const user = await prisma.user.findFirst({
      where: { ...scoped(principal), ref: String(form.get("user_ref") ?? ""), archivedAt: null },
      include: { roles: true },
    });
    if (user === null) throw new NotFound("no such user");

    await detachSchool(prisma, organization, principal, {
      person: user,
      school,
      requestMeta: await requestMeta(),
    });
    revalidatePath("/people");
    return `Removed ${`${user.firstName} ${user.lastName}`.trim() || user.ref} from ${school.name}.`;
  });
}
