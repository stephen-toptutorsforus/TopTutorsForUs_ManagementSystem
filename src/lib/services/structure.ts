/**
 * Groups, locations, and the place hierarchy: the tenant's own vocabulary for
 * who and where.
 *
 * Ported from `app/services/structure.py`. Regions, districts and schools were
 * seed-only in Phase 1; the same two rules apply to them as to a group.
 *
 * Two rules shared with the rest of the platform:
 *
 * * **Uniqueness is scoped to the organization**, so two tenants may both have
 *   a "Wednesday Maths" group without colliding and without either seeing the
 *   other.
 * * **Archival, not deletion.** A group that ran sessions last term still has
 *   to resolve on this term's reports, and a location has to resolve on the
 *   record of a session held in it.
 */

import type { Prisma } from "@/generated/prisma/client";
import { AuditCategory, Role } from "@/generated/prisma/enums";
import { record } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { newRef } from "@/lib/ref";
import type { Db, PersonRecord, RequestMeta } from "@/lib/services/people";
import { isValidZone } from "@/lib/time";

export const MEMBER_ROLES = ["student", "instructor"] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];

export type GroupRecord = Prisma.GroupGetPayload<object>;
export type GroupMemberRecord = Prisma.GroupMemberGetPayload<object>;
export type LocationRecord = Prisma.LocationGetPayload<object>;
export type RegionRecord = Prisma.RegionGetPayload<object>;
export type DistrictRecord = Prisma.DistrictGetPayload<object>;
export type SchoolRecord = Prisma.SchoolGetPayload<object>;

export interface CreateGroupInput {
  name: string;
  capacity?: number | null;
  programId?: bigint | null;
  requestMeta?: RequestMeta;
}

export async function createGroup(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: CreateGroupInput,
): Promise<GroupRecord> {
  principal.require(P.STRUCTURE_MANAGE);

  const name = input.name.trim();
  const capacity = input.capacity ?? null;
  if (!name) throw new ValidationError("a group needs a name");
  if (capacity !== null && capacity < 1) {
    throw new ValidationError("capacity must be at least 1, or left empty");
  }

  const clash = await db.group.findFirst({
    where: {
      organizationId: organization.id,
      name: { equals: name, mode: "insensitive" },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (clash !== null) {
    throw new ValidationError("a group with that name already exists here");
  }

  const group = await db.group.create({
    data: {
      ref: newRef("grp"),
      organizationId: organization.id,
      name,
      capacity,
      programId: input.programId ?? null,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "group.created",
    entityType: "student_group",
    entityId: group.id,
    entityRef: group.ref,
    changes: { title: { from: null, to: name } },
    ...input.requestMeta,
  });

  return group;
}

export interface AddMemberInput {
  group: GroupRecord;
  user: PersonRecord;
  memberRole?: MemberRole;
  requestMeta?: RequestMeta;
}

/**
 * Add somebody to a group, respecting its capacity.
 *
 * Capacity is checked here rather than at booking time because the honest
 * moment to refuse is when the group is filled, not when a session using it is
 * booked weeks later.
 */
export async function addMember(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: AddMemberInput,
): Promise<GroupMemberRecord> {
  principal.require(P.STRUCTURE_MANAGE);

  const { group, user } = input;
  const memberRole = input.memberRole ?? "student";
  if (!(MEMBER_ROLES as readonly string[]).includes(memberRole)) {
    throw new ValidationError("a member is either a student or an instructor");
  }
  if (group.organizationId !== organization.id || user.organizationId !== organization.id) {
    throw new ValidationError("both the group and the person must be in this organization");
  }

  const expected = memberRole === "student" ? Role.STUDENT : Role.INSTRUCTOR;
  if (!user.roles.some((grant) => grant.role === expected)) {
    const article = memberRole === "student" ? "a" : "an";
    throw new ValidationError(`that person is not ${article} ${memberRole}`);
  }

  const existing = await db.groupMember.findFirst({
    where: { groupId: group.id, userId: user.id, memberRole },
  });
  if (existing !== null) return existing;

  if (memberRole === "student" && group.capacity !== null) {
    const current = await countMembers(db, group.id, "student");
    if (current >= group.capacity) {
      throw new ValidationError(`this group is full — its capacity is ${group.capacity}`);
    }
  }

  const member = await db.groupMember.create({
    data: {
      organizationId: organization.id,
      groupId: group.id,
      userId: user.id,
      memberRole,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "group.member_added",
    entityType: "group_member",
    entityId: member.id,
    entityRef: group.ref,
    // The person is named by ref, never by name or address — the trail must not
    // become a second copy of the directory.
    changes: { participant_ref: { from: null, to: user.ref } },
    ...input.requestMeta,
  });

  return member;
}

/**
 * Remove somebody from a group.
 *
 * Deleted outright rather than archived: membership is a present-tense fact,
 * and sessions already booked keep their own participant rows, so removing
 * somebody here cannot rewrite a session that has already happened.
 */
export async function removeMember(
  db: Db,
  principal: Principal,
  input: {
    group: GroupRecord;
    member: GroupMemberRecord;
    requestMeta?: RequestMeta;
  },
): Promise<void> {
  principal.require(P.STRUCTURE_MANAGE);
  const { group, member } = input;
  if (member.groupId !== group.id) {
    throw new ValidationError("that person is not in this group");
  }

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "group.member_removed",
    entityType: "group_member",
    entityId: member.id,
    entityRef: group.ref,
    changes: { participant_ref: { from: String(member.userId), to: null } },
    ...input.requestMeta,
  });
  await db.groupMember.delete({ where: { id: member.id } });
}

export async function countMembers(
  db: Db,
  groupId: bigint,
  memberRole: MemberRole,
): Promise<number> {
  return db.groupMember.count({ where: { groupId, memberRole } });
}

/** Retire a group without breaking the sessions that used it. */
export async function archiveGroup(
  db: Db,
  principal: Principal,
  input: { group: GroupRecord; requestMeta?: RequestMeta },
): Promise<GroupRecord> {
  principal.require(P.STRUCTURE_MANAGE);
  const { group } = input;

  const archived = await db.group.update({
    where: { id: group.id },
    data: { archivedAt: new Date() },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "group.archived",
    entityType: "student_group",
    entityId: group.id,
    entityRef: group.ref,
    changes: { title: { from: group.name, to: null } },
    ...input.requestMeta,
  });

  return archived;
}

export interface CreateLocationInput {
  name: string;
  address?: string | null;
  capacity?: number | null;
  schoolId?: bigint | null;
  requestMeta?: RequestMeta;
}

export async function createLocation(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: CreateLocationInput,
): Promise<LocationRecord> {
  principal.require(P.STRUCTURE_MANAGE);

  const name = input.name.trim();
  const capacity = input.capacity ?? null;
  if (!name) throw new ValidationError("a location needs a name");
  if (capacity !== null && capacity < 1) {
    throw new ValidationError("capacity must be at least 1, or left empty");
  }

  const clash = await db.location.findFirst({
    where: {
      organizationId: organization.id,
      name: { equals: name, mode: "insensitive" },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (clash !== null) {
    throw new ValidationError("a location with that name already exists here");
  }

  const schoolId = input.schoolId ?? null;
  if (schoolId !== null) {
    const school = await db.school.findUnique({
      where: { id: schoolId },
      select: { organizationId: true },
    });
    if (school === null || school.organizationId !== organization.id) {
      throw new ValidationError("no such school");
    }
  }

  const location = await db.location.create({
    data: {
      ref: newRef("loc"),
      organizationId: organization.id,
      name,
      address: (input.address ?? "").trim() || null,
      capacity,
      schoolId,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "location.created",
    entityType: "location",
    entityId: location.id,
    entityRef: location.ref,
    changes: { title: { from: null, to: name } },
    ...input.requestMeta,
  });

  return location;
}

/** Retire a room. Sessions already held there keep resolving it. */
export async function archiveLocation(
  db: Db,
  principal: Principal,
  input: { location: LocationRecord; requestMeta?: RequestMeta },
): Promise<LocationRecord> {
  principal.require(P.STRUCTURE_MANAGE);
  const { location } = input;

  const archived = await db.location.update({
    where: { id: location.id },
    data: { archivedAt: new Date() },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "location.archived",
    entityType: "location",
    entityId: location.id,
    entityRef: location.ref,
    changes: { title: { from: location.name, to: null } },
    ...input.requestMeta,
  });

  return archived;
}

// --- Places ----------------------------------------------------------------

export interface CreateRegionInput {
  name: string;
  requestMeta?: RequestMeta;
}

export async function createRegion(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: CreateRegionInput,
): Promise<RegionRecord> {
  principal.require(P.STRUCTURE_MANAGE);

  const name = input.name.trim();
  if (!name) throw new ValidationError("a region needs a name");

  const clash = await db.region.findFirst({
    where: {
      organizationId: organization.id,
      name: { equals: name, mode: "insensitive" },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (clash !== null) {
    throw new ValidationError("a region with that name already exists here");
  }

  const region = await db.region.create({
    data: {
      ref: newRef("reg"),
      organizationId: organization.id,
      name,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "region.created",
    entityType: "region",
    entityId: region.id,
    entityRef: region.ref,
    changes: { title: { from: null, to: name } },
    ...input.requestMeta,
  });

  return region;
}

export async function archiveRegion(
  db: Db,
  principal: Principal,
  input: { region: RegionRecord; requestMeta?: RequestMeta },
): Promise<RegionRecord> {
  principal.require(P.STRUCTURE_MANAGE);
  const { region } = input;

  const archived = await db.region.update({
    where: { id: region.id },
    data: { archivedAt: new Date() },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "region.archived",
    entityType: "region",
    entityId: region.id,
    entityRef: region.ref,
    changes: { title: { from: region.name, to: null } },
    ...input.requestMeta,
  });

  return archived;
}

export interface CreateDistrictInput {
  name: string;
  regionId?: bigint | null;
  requestMeta?: RequestMeta;
}

export async function createDistrict(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: CreateDistrictInput,
): Promise<DistrictRecord> {
  principal.require(P.STRUCTURE_MANAGE);

  const name = input.name.trim();
  if (!name) throw new ValidationError("a district needs a name");

  const clash = await db.district.findFirst({
    where: {
      organizationId: organization.id,
      name: { equals: name, mode: "insensitive" },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (clash !== null) {
    throw new ValidationError("a district with that name already exists here");
  }

  const regionId = input.regionId ?? null;
  if (regionId !== null) {
    const region = await db.region.findFirst({
      where: { id: regionId, organizationId: organization.id, archivedAt: null },
      select: { id: true },
    });
    if (region === null) throw new ValidationError("no such region");
  }

  const district = await db.district.create({
    data: {
      ref: newRef("dis"),
      organizationId: organization.id,
      name,
      regionId,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "district.created",
    entityType: "district",
    entityId: district.id,
    entityRef: district.ref,
    changes: { title: { from: null, to: name } },
    ...input.requestMeta,
  });

  return district;
}

export async function archiveDistrict(
  db: Db,
  principal: Principal,
  input: { district: DistrictRecord; requestMeta?: RequestMeta },
): Promise<DistrictRecord> {
  principal.require(P.STRUCTURE_MANAGE);
  const { district } = input;

  const archived = await db.district.update({
    where: { id: district.id },
    data: { archivedAt: new Date() },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "district.archived",
    entityType: "district",
    entityId: district.id,
    entityRef: district.ref,
    changes: { title: { from: district.name, to: null } },
    ...input.requestMeta,
  });

  return archived;
}

export interface CreateSchoolInput {
  name: string;
  districtId?: bigint | null;
  timezone?: string | null;
  requestMeta?: RequestMeta;
}

export async function createSchool(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: CreateSchoolInput,
): Promise<SchoolRecord> {
  principal.require(P.STRUCTURE_MANAGE);

  const name = input.name.trim();
  if (!name) throw new ValidationError("a school needs a name");

  const clash = await db.school.findFirst({
    where: {
      organizationId: organization.id,
      name: { equals: name, mode: "insensitive" },
      archivedAt: null,
    },
    select: { id: true },
  });
  if (clash !== null) {
    throw new ValidationError("a school with that name already exists here");
  }

  const districtId = input.districtId ?? null;
  if (districtId !== null) {
    const district = await db.district.findFirst({
      where: { id: districtId, organizationId: organization.id, archivedAt: null },
      select: { id: true },
    });
    if (district === null) throw new ValidationError("no such district");
  }

  const timezone = (input.timezone ?? "").trim() || null;
  if (timezone !== null && !isValidZone(timezone)) {
    throw new ValidationError("unknown timezone");
  }

  const school = await db.school.create({
    data: {
      ref: newRef("sch"),
      organizationId: organization.id,
      name,
      districtId,
      timezone,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "school.created",
    entityType: "school",
    entityId: school.id,
    entityRef: school.ref,
    changes: { title: { from: null, to: name } },
    ...input.requestMeta,
  });

  return school;
}

export async function archiveSchool(
  db: Db,
  principal: Principal,
  input: { school: SchoolRecord; requestMeta?: RequestMeta },
): Promise<SchoolRecord> {
  principal.require(P.STRUCTURE_MANAGE);
  const { school } = input;

  const archived = await db.school.update({
    where: { id: school.id },
    data: { archivedAt: new Date() },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "school.archived",
    entityType: "school",
    entityId: school.id,
    entityRef: school.ref,
    changes: { title: { from: school.name, to: null } },
    ...input.requestMeta,
  });

  return archived;
}
