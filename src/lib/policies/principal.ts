/**
 * The authenticated actor, resolved from the database on every request.
 *
 * Ported from `app/policies/principal.py`.
 *
 * **The session cookie carries an id and nothing else.** Roles, tenant, and
 * archive state are read fresh from the database each time. Putting roles in
 * the token means a demoted administrator keeps administering until their
 * cookie expires, and an archived account keeps working. Neither is acceptable
 * for a system holding minors' schedules, and the cost is one indexed
 * primary-key read.
 *
 * A `Principal` is therefore always current, and `organizationId` on it is the
 * only tenant value the application trusts. Nothing tenant-scoped is ever read
 * from a request parameter, a header, or a hidden form field.
 */

import type { PrismaClient } from "@/generated/prisma/client";
import { Role, UserStatus } from "@/generated/prisma/enums";
import { Forbidden, Unauthenticated } from "@/lib/errors";
import { settingsReader } from "@/lib/organization";
import { type Permission, resolve } from "@/lib/policies/permissions";

export interface PrincipalFields {
  readonly userId: bigint;
  readonly userRef: string;
  readonly organizationId: bigint;
  readonly organizationRef: string;
  readonly displayName: string;
  readonly roles: ReadonlySet<Role>;
  readonly permissions: ReadonlySet<Permission>;
  readonly regionIds: ReadonlySet<bigint>;
  /**
   * Schools this person is placed at. Super admin ignores the set (they see
   * every school). A school admin or principal is granted with exactly one.
   */
  readonly schoolIds?: ReadonlySet<bigint>;
  readonly timezone: string;
}

/**
 * Ordered by breadth, so a parent who also tutors lands on the instructor
 * workspace — the one with work waiting in it.
 */
const ROLE_PRECEDENCE: readonly Role[] = [
  Role.ADMIN,
  Role.SCHOOL_ADMIN,
  Role.PRINCIPAL,
  Role.REGIONAL_ADMIN,
  Role.INSTRUCTOR,
  Role.PARENT,
  Role.STUDENT,
  Role.PAYER,
];

/** Who is acting, in which tenant, with what effective permissions. */
export class Principal implements PrincipalFields {
  readonly userId: bigint;
  readonly userRef: string;
  readonly organizationId: bigint;
  readonly organizationRef: string;
  readonly displayName: string;
  readonly roles: ReadonlySet<Role>;
  readonly permissions: ReadonlySet<Permission>;
  readonly regionIds: ReadonlySet<bigint>;
  readonly schoolIds: ReadonlySet<bigint>;
  readonly timezone: string;

  constructor(fields: PrincipalFields) {
    this.userId = fields.userId;
    this.userRef = fields.userRef;
    this.organizationId = fields.organizationId;
    this.organizationRef = fields.organizationRef;
    this.displayName = fields.displayName;
    this.roles = fields.roles;
    this.permissions = fields.permissions;
    this.regionIds = fields.regionIds;
    this.schoolIds = fields.schoolIds ?? new Set();
    this.timezone = fields.timezone;
  }

  /** True if every named permission is held. */
  has(...permissions: Permission[]): boolean {
    return permissions.every((permission) => this.permissions.has(permission));
  }

  hasAny(...permissions: Permission[]): boolean {
    return permissions.some((permission) => this.permissions.has(permission));
  }

  /**
   * Throw unless every named permission is held.
   *
   * The message names the permission, not the record, so a refusal never
   * discloses that the record exists.
   */
  require(...permissions: Permission[]): void {
    const missing = permissions.filter((permission) => !this.permissions.has(permission));
    if (missing.length > 0) throw new Forbidden(`this action requires ${missing[0]}`);
  }

  get isAdmin(): boolean {
    return this.roles.has(Role.ADMIN);
  }

  /** The role to show in the interface when a person holds several. */
  get primaryRole(): Role {
    for (const role of ROLE_PRECEDENCE) {
      if (this.roles.has(role)) return role;
    }
    throw new Forbidden("this account holds no role");
  }
}

/**
 * Build a principal from live database state, or refuse.
 *
 * Refuses an archived user, a disabled user, and a user whose organization is
 * archived. That last check is the one that is easy to forget and the one that
 * matters: archiving a tenant must stop its users immediately, not when their
 * cookies expire.
 */
export async function loadPrincipal(
  db: PrismaClient,
  userId: bigint,
): Promise<Principal> {
  const user = await db.user.findUnique({
    where: { id: userId },
    include: { roles: true, organization: true, schools: { select: { schoolId: true } } },
  });

  const signedOut = new Unauthenticated("this session is no longer valid");
  if (!user || user.archivedAt !== null || user.status !== UserStatus.ACTIVE) throw signedOut;
  if (!user.organization || user.organization.archivedAt !== null) throw signedOut;

  const roles = new Set(user.roles.map((grant) => grant.role));
  if (roles.size === 0) throw new Forbidden("this account holds no role");

  const organization = user.organization;
  const fullName = `${user.firstName} ${user.lastName}`.trim();

  return new Principal({
    userId: user.id,
    userRef: user.ref,
    organizationId: organization.id,
    organizationRef: organization.ref,
    // Never the email address: this string lands in headings and lists.
    displayName: fullName || user.ref,
    roles,
    permissions: resolve(roles, settingsReader(organization)),
    regionIds: new Set(
      user.roles
        .map((grant) => grant.regionId)
        .filter((regionId): regionId is bigint => regionId !== null),
    ),
    schoolIds: new Set(user.schools.map((row) => row.schoolId)),
    timezone: user.timezone ?? organization.timezone,
  });
}
