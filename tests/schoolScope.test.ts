/**
 * School as a scope of authority, not a tenant.
 *
 * Super admin sees every school. Everybody else with a school placement is
 * bounded by those ids. An empty set is not "all schools" — it is unscoped,
 * so a region-only instructor is not bricked.
 */

import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";
import { ValidationError } from "@/lib/errors";
import { resolve } from "@/lib/policies/permissions";
import { Principal } from "@/lib/policies/principal";
import {
  assertSchoolsInScope,
  isSchoolScopedRole,
  schoolScope,
  sessionInSchoolScope,
} from "@/lib/policies/schoolScope";

const NY = "America/New_York";

function principalWith(
  roles: Role[],
  schoolIds: bigint[] = [],
): Principal {
  const roleSet = new Set(roles);
  return new Principal({
    userId: 1n,
    userRef: "usr_test",
    organizationId: 1n,
    organizationRef: "org_test",
    displayName: "Test Person",
    roles: roleSet,
    permissions: resolve(roleSet),
    regionIds: new Set(),
    schoolIds: new Set(schoolIds),
    timezone: NY,
  });
}

describe("schoolScope", () => {
  it("leaves a super admin unscoped even when they are placed at a school", () => {
    expect(schoolScope(principalWith([Role.ADMIN], [7n]))).toBeNull();
  });

  it("leaves a person with no school placement unscoped", () => {
    expect(schoolScope(principalWith([Role.INSTRUCTOR]))).toBeNull();
    expect(schoolScope(principalWith([Role.SCHOOL_ADMIN]))).toBeNull();
  });

  it("bounds a school admin or instructor who has been placed", () => {
    expect(schoolScope(principalWith([Role.SCHOOL_ADMIN], [7n]))).toEqual([7n]);
    expect(schoolScope(principalWith([Role.INSTRUCTOR], [7n, 8n]))).toEqual([7n, 8n]);
  });
});

describe("sessionInSchoolScope", () => {
  it("matches when any student school overlaps the viewer's", () => {
    const admin = principalWith([Role.SCHOOL_ADMIN], [7n]);
    expect(sessionInSchoolScope(admin, [7n, 8n])).toBe(true);
    expect(sessionInSchoolScope(admin, [8n])).toBe(false);
    expect(sessionInSchoolScope(principalWith([Role.ADMIN], [7n]), [8n])).toBe(true);
  });
});

describe("assertSchoolsInScope", () => {
  it("refuses a school outside the viewer's placement", () => {
    const admin = principalWith([Role.SCHOOL_ADMIN], [7n]);
    expect(() => assertSchoolsInScope(admin, [{ id: 8n }])).toThrow(ValidationError);
    expect(() => assertSchoolsInScope(admin, [{ id: 7n }])).not.toThrow();
    expect(() =>
      assertSchoolsInScope(principalWith([Role.ADMIN], [7n]), [{ id: 8n }]),
    ).not.toThrow();
  });
});

describe("isSchoolScopedRole", () => {
  it("names the two roles that must sit at exactly one school", () => {
    expect(isSchoolScopedRole(Role.SCHOOL_ADMIN)).toBe(true);
    expect(isSchoolScopedRole(Role.PRINCIPAL)).toBe(true);
    expect(isSchoolScopedRole(Role.ADMIN)).toBe(false);
    expect(isSchoolScopedRole(Role.INSTRUCTOR)).toBe(false);
  });
});
