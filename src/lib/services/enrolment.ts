/**
 * Creating a student, with everything a student is created with.
 *
 * Ported from `app/services/enrolment.py`.
 *
 * `createPerson` makes an account. A student is an account plus the things that
 * make the account usable: who looks after them, who teaches them, and where
 * they are. Doing those as four separate calls from the route would mean a
 * student could end up half-created — an account with no guardian, and nothing
 * to say the guardian was ever meant to exist. They belong in one call, in one
 * transaction.
 *
 * Two rules the interface states and this module enforces, because a rule
 * stated only on the screen is not a rule:
 *
 * * **A student is attached to schools or to regions, not both.** Assigning a
 *   school already implies its district and its region; letting somebody also
 *   pick regions by hand invites a student attached to a school in one region
 *   and, separately, to another.
 * * **Assigning a school assigns that school's district and region too.**
 *   Written as rows rather than left to be inferred later, so a query for
 *   "students in this region" does not have to know the hierarchy to get the
 *   right answer.
 */

import { AuditCategory, GuardianRelationship, Role } from "@/generated/prisma/enums";
import { record } from "@/lib/audit";
import { ValidationError } from "@/lib/errors";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import {
  type Db,
  type PersonRecord,
  type RequestMeta,
  createPerson,
} from "@/lib/services/people";

export interface OrganizationRef {
  id: bigint;
  timezone: string;
}

/** Just enough of a school or region row to attach somebody to it. */
export interface PlaceRef {
  id: bigint;
  ref: string;
  organizationId: bigint;
  districtId?: bigint | null;
}

function hasRole(person: PersonRecord, role: Role): boolean {
  return person.roles.some((grant) => grant.role === role);
}

export interface CreateStudentInput {
  firstName: string;
  lastName: string;
  email?: string | null;
  requiresGuardian?: boolean;
  guardian?: PersonRecord | null;
  instructors?: readonly PersonRecord[];
  schools?: readonly PlaceRef[];
  regions?: readonly PlaceRef[];
  grade?: string | null;
  phone?: string | null;
  requestMeta?: RequestMeta;
}

/** Create a student and everything they are created with. */
export async function createStudent(
  db: Db,
  organization: OrganizationRef,
  principal: Principal,
  input: CreateStudentInput,
): Promise<PersonRecord> {
  principal.require(P.USER_MANAGE);

  const instructors = input.instructors ?? [];
  const schools = input.schools ?? [];
  const regions = input.regions ?? [];
  let email = input.email ?? null;

  if (input.requiresGuardian) {
    if (!input.guardian) {
      throw new ValidationError("choose the parent who will set up this student");
    }
    if (!hasRole(input.guardian, Role.PARENT)) {
      throw new ValidationError("that person is not a parent");
    }
    // The guardian sets the address and the password, so asking for an address
    // here would be asking for one nobody is going to use.
    email = null;
  } else if (!(email ?? "").trim()) {
    throw new ValidationError(
      "a student without a parent needs an email address to be onboarded",
    );
  }

  if (schools.length > 0 && regions.length > 0) {
    throw new ValidationError(
      "attach this student to schools or to regions, not both — " +
        "a school already carries its district and region",
    );
  }

  const person = await createPerson(db, organization, principal, {
    email,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: [Role.STUDENT],
    grade: input.grade,
    phone: input.phone,
    requestMeta: input.requestMeta,
  });

  const guardian = input.guardian ?? null;
  if (guardian !== null) {
    if (guardian.organizationId !== organization.id) {
      throw new ValidationError("that parent is not in this organization");
    }
    await db.guardianStudent.create({
      data: {
        organizationId: organization.id,
        guardianId: guardian.id,
        studentId: person.id,
        isPrimary: true,
      },
    });
  }

  for (const instructor of instructors) {
    if (instructor.organizationId !== organization.id) {
      throw new ValidationError("that instructor is not in this organization");
    }
    if (!hasRole(instructor, Role.INSTRUCTOR)) {
      throw new ValidationError(`${instructor.ref} is not an instructor`);
    }
    await db.instructorStudent.create({
      data: {
        organizationId: organization.id,
        instructorId: instructor.id,
        studentId: person.id,
      },
    });
  }

  await attachLocations(db, organization, person, schools, regions);

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.student_enrolled",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    // Refs and counts only — never a name, an address, or a school's name.
    changes: {
      participant_ref: { from: null, to: guardian ? guardian.ref : null },
      instructor_ref: {
        from: null,
        to: instructors.length > 0 ? instructors.map((i) => i.ref) : null,
      },
      location_ref: {
        from: null,
        to:
          schools.length > 0
            ? schools.map((s) => s.ref)
            : regions.length > 0
              ? regions.map((r) => r.ref)
              : null,
      },
    },
    ...input.requestMeta,
  });

  return person;
}

/** Write the location rows, expanding each school up its own hierarchy. */
async function attachLocations(
  db: Db,
  organization: OrganizationRef,
  person: PersonRecord,
  schools: readonly PlaceRef[],
  regions: readonly PlaceRef[],
): Promise<void> {
  const districtIds = new Set<bigint>();
  const regionIds = new Set<bigint>(regions.map((region) => region.id));

  for (const school of schools) {
    if (school.organizationId !== organization.id) {
      throw new ValidationError("that school is not in this organization");
    }
    await db.userSchool.create({
      data: {
        organizationId: organization.id,
        userId: person.id,
        schoolId: school.id,
      },
    });
    if (school.districtId) districtIds.add(school.districtId);
  }

  if (districtIds.size > 0) {
    // One query for the districts rather than one per school: the region a
    // district belongs to is what turns "assigned to a school" into "assigned
    // to that school's region".
    const found = await db.district.findMany({
      where: { organizationId: organization.id, id: { in: [...districtIds] } },
      select: { id: true, regionId: true },
    });
    for (const district of found) {
      if (district.regionId) regionIds.add(district.regionId);
    }
  }

  for (const districtId of districtIds) {
    await db.userDistrict.create({
      data: { organizationId: organization.id, userId: person.id, districtId },
    });
  }
  for (const regionId of regionIds) {
    await db.userRegion.create({
      data: { organizationId: organization.id, userId: person.id, regionId },
    });
  }
}

export interface CreateGuardianInput {
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  relationship?: string;
  students?: readonly PersonRecord[];
  requestMeta?: RequestMeta;
}

/**
 * Create a parent, and the links to the students they look after.
 *
 * "Parent" is the role; the relationship is what this person actually is to
 * each student — a coach and a teacher are guardians in the same sense here,
 * and a report that cannot tell them apart is a report nobody trusts.
 */
export async function createGuardian(
  db: Db,
  organization: OrganizationRef,
  principal: Principal,
  input: CreateGuardianInput,
): Promise<PersonRecord> {
  principal.require(P.USER_MANAGE);

  if (!(input.email ?? "").trim()) {
    throw new ValidationError("a parent needs an email address to be onboarded");
  }

  const relationship = input.relationship ?? GuardianRelationship.PARENT.toLowerCase();
  const kind = (Object.values(GuardianRelationship) as string[]).find(
    (value) => value === relationship || value.toLowerCase() === relationship,
  ) as GuardianRelationship | undefined;
  if (kind === undefined) {
    throw new ValidationError(`unknown relationship: ${relationship}`);
  }

  const students = input.students ?? [];

  const person = await createPerson(db, organization, principal, {
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: [Role.PARENT],
    phone: input.phone,
    requestMeta: input.requestMeta,
  });

  for (const [index, student] of students.entries()) {
    if (student.organizationId !== organization.id) {
      throw new ValidationError("that student is not in this organization");
    }
    if (!hasRole(student, Role.STUDENT)) {
      throw new ValidationError(`${student.ref} is not a student`);
    }
    await db.guardianStudent.create({
      data: {
        organizationId: organization.id,
        guardianId: person.id,
        studentId: student.id,
        // The first named is primary. Somebody has to be the one contacted
        // first, and leaving every link equal means nobody is.
        isPrimary: index === 0,
        relationshipKind: kind,
      },
    });
  }

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.guardian_enrolled",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    changes: {
      participant_ref: {
        from: null,
        to: students.length > 0 ? students.map((s) => s.ref) : null,
      },
      role: { from: null, to: kind.toLowerCase() },
    },
    ...input.requestMeta,
  });

  return person;
}

export interface CreateStaffInput {
  role: Role;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string | null;
  schools?: readonly PlaceRef[];
  regions?: readonly PlaceRef[];
  requestMeta?: RequestMeta;
}

/**
 * Create an instructor, an administrator, or a regional administrator.
 *
 * The three differ only in what they are attached to, so they share a path. An
 * instructor is attached to schools or regions the same way a student is; a
 * regional administrator is *bounded* by regions, which is a different thing
 * and is written onto the role rather than beside it.
 */
export async function createStaff(
  db: Db,
  organization: OrganizationRef,
  principal: Principal,
  input: CreateStaffInput,
): Promise<PersonRecord> {
  principal.require(P.USER_MANAGE);

  const schools = input.schools ?? [];
  const regions = input.regions ?? [];

  if (!(input.email ?? "").trim()) {
    throw new ValidationError("this account needs an email address to be onboarded");
  }
  if (schools.length > 0 && regions.length > 0) {
    throw new ValidationError(
      "attach this person to schools or to regions, not both — " +
        "a school already carries its district and region",
    );
  }
  if (input.role === Role.REGIONAL_ADMIN && regions.length === 0) {
    throw new ValidationError("a regional administrator needs at least one region");
  }

  const person = await createPerson(db, organization, principal, {
    email: input.email,
    firstName: input.firstName,
    lastName: input.lastName,
    roles: [input.role],
    phone: input.phone,
    requestMeta: input.requestMeta,
  });

  if (input.role === Role.REGIONAL_ADMIN) {
    // `Principal.regionIds` is read from the role rows, so this is what
    // actually bounds what they can see. One row per region, replacing the
    // unbounded grant `createPerson` wrote.
    await db.userRole.deleteMany({ where: { userId: person.id } });
    for (const region of regions) {
      await db.userRole.create({
        data: {
          organizationId: organization.id,
          userId: person.id,
          role: Role.REGIONAL_ADMIN,
          regionId: region.id,
        },
      });
    }
    person.roles = await db.userRole.findMany({ where: { userId: person.id } });
  }

  await attachLocations(db, organization, person, schools, regions);

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.staff_enrolled",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    changes: {
      role: { from: null, to: input.role.toLowerCase() },
      location_ref: {
        from: null,
        to:
          schools.length > 0
            ? schools.map((s) => s.ref)
            : regions.length > 0
              ? regions.map((r) => r.ref)
              : null,
      },
    },
    ...input.requestMeta,
  });

  return person;
}
