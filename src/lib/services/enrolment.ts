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
  assertSchoolsInScope,
  isSchoolScopedRole,
  schoolScope,
} from "@/lib/policies/schoolScope";
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
  assertSchoolsInScope(principal, schools);
  if (schoolScope(principal) !== null && schools.length === 0) {
    throw new ValidationError("place this person at your school");
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
  const regionIds = new Set<bigint>();

  for (const region of regions) {
    if (region.organizationId !== organization.id) {
      throw new ValidationError("that region is not in this organization");
    }
    regionIds.add(region.id);
  }

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
  if (isSchoolScopedRole(input.role) && schools.length !== 1) {
    throw new ValidationError("this role needs exactly one school");
  }
  assertSchoolsInScope(principal, schools);
  if (
    schoolScope(principal) !== null &&
    schools.length === 0 &&
    input.role !== Role.ADMIN
  ) {
    throw new ValidationError("place this person at your school");
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

export interface SetPlacementsInput {
  person: PersonRecord;
  schools?: readonly PlaceRef[];
  regions?: readonly PlaceRef[];
  requestMeta?: RequestMeta;
}

/**
 * Replace where somebody is placed.
 *
 * The same two rules as create: schools or regions, never both, and a school
 * expands upward. Existing place rows are dropped first so this is a write of
 * the whole set, not an append. Role grants are left alone — a regional
 * administrator's scope rides on `user_role`, not on these rows.
 */
export async function setPlacements(
  db: Db,
  organization: OrganizationRef,
  principal: Principal,
  input: SetPlacementsInput,
): Promise<void> {
  principal.require(P.USER_MANAGE);

  const { person } = input;
  const schools = input.schools ?? [];
  const regions = input.regions ?? [];

  if (person.organizationId !== organization.id) {
    throw new ValidationError("that person is not in this organization");
  }
  if (schools.length > 0 && regions.length > 0) {
    throw new ValidationError(
      "attach this person to schools or to regions, not both — " +
        "a school already carries its district and region",
    );
  }
  if (hasRole(person, Role.SCHOOL_ADMIN) || hasRole(person, Role.PRINCIPAL)) {
    if (schools.length !== 1 || regions.length > 0) {
      throw new ValidationError("this role needs exactly one school");
    }
  }
  assertSchoolsInScope(principal, schools);

  await db.userSchool.deleteMany({ where: { userId: person.id } });
  await db.userDistrict.deleteMany({ where: { userId: person.id } });
  await db.userRegion.deleteMany({ where: { userId: person.id } });
  await attachLocations(db, organization, person, schools, regions);

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.placements_set",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    changes: {
      location_ref: {
        from: null,
        to:
          schools.length > 0
            ? schools.map((place) => place.ref)
            : regions.length > 0
              ? regions.map((place) => place.ref)
              : null,
      },
    },
    ...input.requestMeta,
  });
}

/**
 * The schools and regions a person currently holds, as `PlaceRef`s the write
 * path can take back. Districts are derived from schools and are not returned.
 */
export async function currentPlacements(
  db: Db,
  person: { id: bigint; organizationId: bigint },
): Promise<{ schools: PlaceRef[]; regions: PlaceRef[] }> {
  const [schoolRows, regionRows] = await Promise.all([
    db.userSchool.findMany({
      where: { userId: person.id, organizationId: person.organizationId },
      select: {
        school: {
          select: { id: true, ref: true, organizationId: true, districtId: true },
        },
      },
    }),
    db.userRegion.findMany({
      where: { userId: person.id, organizationId: person.organizationId },
      select: {
        region: { select: { id: true, ref: true, organizationId: true } },
      },
    }),
  ]);

  return {
    schools: schoolRows.map((row) => row.school),
    regions: regionRows.map((row) => row.region),
  };
}

/**
 * Add one school to somebody who is already school-placed, or unplaced.
 *
 * Refuses a person who is attached to regions only — that is the other method,
 * and converting it is a decision for their record, not a side-effect of
 * attaching them from a school page.
 */
export async function attachSchool(
  db: Db,
  organization: OrganizationRef,
  principal: Principal,
  input: {
    person: PersonRecord;
    school: PlaceRef;
    requestMeta?: RequestMeta;
  },
): Promise<void> {
  const current = await currentPlacements(db, input.person);
  if (current.regions.length > 0 && current.schools.length === 0) {
    throw new ValidationError(
      "this person is attached to regions; change that from their record",
    );
  }
  if (current.schools.some((school) => school.id === input.school.id)) return;

  await setPlacements(db, organization, principal, {
    person: input.person,
    schools: [...current.schools, input.school],
    requestMeta: input.requestMeta,
  });
}

/** Drop one school. Remaining schools keep their district and region rows. */
export async function detachSchool(
  db: Db,
  organization: OrganizationRef,
  principal: Principal,
  input: {
    person: PersonRecord;
    school: PlaceRef;
    requestMeta?: RequestMeta;
  },
): Promise<void> {
  const current = await currentPlacements(db, input.person);
  await setPlacements(db, organization, principal, {
    person: input.person,
    schools: current.schools.filter((school) => school.id !== input.school.id),
    requestMeta: input.requestMeta,
  });
}

/**
 * Every named student must be placed at this school.
 *
 * Used when the booking form has chosen a school: the list is already
 * narrowed, and this is what a crafted post cannot talk its way around.
 */
export async function assertStudentsAtSchool(
  db: Db,
  organization: OrganizationRef,
  school: PlaceRef,
  studentIds: readonly bigint[],
): Promise<void> {
  if (school.organizationId !== organization.id) {
    throw new ValidationError("that school is not in this organization");
  }
  if (studentIds.length === 0) return;

  const placed = await db.userSchool.findMany({
    where: {
      organizationId: organization.id,
      schoolId: school.id,
      userId: { in: [...studentIds] },
    },
    select: { userId: true },
  });
  if (placed.length !== studentIds.length) {
    throw new ValidationError("that student is not at this school");
  }
}
