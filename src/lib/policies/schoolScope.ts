/**
 * School as a scope of authority, not a tenant.
 *
 * Organization is still the tenant. Super admin (`ADMIN`) sees every school
 * in it. Everybody else who has been placed at a school is bounded by those
 * ids; another school's record is 404, never 403.
 *
 * An empty `schoolIds` on a non-admin is *not* "all schools". It means they
 * are not school-scoped yet — a region-only instructor, a test account —
 * and existing own-visibility stands. School admin and principal are
 * granted with exactly one school, so they never land here.
 */

import { ParticipantRole, Role } from "@/generated/prisma/enums";
import type { Prisma } from "@/generated/prisma/client";
import { ValidationError } from "@/lib/errors";
import type { Principal } from "@/lib/policies/principal";

/** Roles that must be placed at exactly one school, and never act outside it. */
export const SCHOOL_SCOPED_ROLES: readonly Role[] = [Role.SCHOOL_ADMIN, Role.PRINCIPAL];

export function isSchoolScopedRole(role: Role): boolean {
  return SCHOOL_SCOPED_ROLES.includes(role);
}

/**
 * Schools this person may act in, or `null` if they may act in every school
 * in the tenant.
 */
export function schoolScope(principal: Principal): readonly bigint[] | null {
  if (principal.roles.has(Role.ADMIN)) return null;
  if (principal.schoolIds.size === 0) return null;
  return [...principal.schoolIds];
}

export function sessionAtSchools(
  organizationId: bigint,
  schoolIds: readonly bigint[],
): Prisma.SessionOccurrenceWhereInput {
  return {
    participants: {
      some: {
        organizationId,
        role: ParticipantRole.STUDENT,
        user: { schools: { some: { schoolId: { in: [...schoolIds] } } } },
      },
    },
  };
}

export function peopleAtSchools(schoolIds: readonly bigint[]): Prisma.UserWhereInput {
  return {
    schools: { some: { schoolId: { in: [...schoolIds] } } },
  };
}

export function sessionInSchoolScope(
  principal: Principal,
  studentSchoolIds: Iterable<bigint>,
): boolean {
  const scope = schoolScope(principal);
  if (scope === null) return true;
  const held = new Set(studentSchoolIds);
  return scope.some((id) => held.has(id));
}

export function assertSchoolsInScope(
  principal: Principal,
  schools: readonly { id: bigint }[],
): void {
  const scope = schoolScope(principal);
  if (scope === null) return;
  const allowed = new Set(scope);
  if (schools.some((school) => !allowed.has(school.id))) {
    throw new ValidationError("that school is outside your scope");
  }
}
