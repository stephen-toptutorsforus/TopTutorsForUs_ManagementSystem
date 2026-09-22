/**
 * The permission catalogue and how a role resolves to a set of permissions.
 *
 * Ported from `app/policies/permissions.py`.
 *
 * **The floor rule.** A tenant's configuration may only *remove* a permission
 * the code default already grants. It can never add one. Written as:
 *
 *     effective = codeDefault AND (tenantOverride is not false)
 *
 * This is the property that makes the catalogue reviewable: reading this file
 * tells you the maximum any tenant can grant, and no amount of configuration —
 * including a compromised settings row — widens it. Configuration can only ever
 * tighten.
 *
 * **Permissions are checked, not displayed.** The UI hides what a person cannot
 * do, but hiding is a courtesy. Every mutation re-checks server-side, because a
 * hidden button is not an access control.
 */

import { Role } from "@/generated/prisma/enums";
import { type SettingsReader, settingStrings } from "@/lib/organization";

/**
 * Named capabilities. Grouped by area; the string is the wire format, and it
 * appears in refusal messages, so it is deliberately the same in both services.
 */
export enum Permission {
  // People
  USER_VIEW = "user.view",
  USER_MANAGE = "user.manage",
  USER_INVITE = "user.invite",

  // Structure
  STRUCTURE_VIEW = "structure.view",
  STRUCTURE_MANAGE = "structure.manage",

  // Availability
  AVAILABILITY_VIEW_OWN = "availability.view_own",
  AVAILABILITY_EDIT_OWN = "availability.edit_own",
  AVAILABILITY_VIEW_ANY = "availability.view_any",
  AVAILABILITY_EDIT_ANY = "availability.edit_any",

  // Sessions
  SESSION_VIEW_OWN = "session.view_own",
  SESSION_VIEW_ANY = "session.view_any",
  SESSION_BOOK = "session.book",
  SESSION_BOOK_HISTORICAL = "session.book_historical",
  SESSION_EDIT_OWN = "session.edit_own",
  SESSION_EDIT_ANY = "session.edit_any",
  SESSION_CANCEL_OWN = "session.cancel_own",
  SESSION_CANCEL_ANY = "session.cancel_any",
  SESSION_DELETE = "session.delete",
  SESSION_OVERRIDE_CONFLICT = "session.override_conflict",
  SESSION_EDIT_SERIES = "session.edit_series",
  SESSION_APPROVE_REQUEST = "session.approve_request",

  // Attendance
  ATTENDANCE_MARK_OWN = "attendance.mark_own",
  ATTENDANCE_MARK_ANY = "attendance.mark_any",
  ATTENDANCE_CORRECT_ACTUALS = "attendance.correct_actuals",

  // Audit, export and import
  AUDIT_VIEW = "audit.view",
  EXPORT_SESSIONS = "export.sessions",
  /**
   * Loading another system's records into this tenant.
   *
   * Administrators only, and that falls out of the table below rather than
   * being stated twice: `ADMIN` is granted `ALL_PERMISSIONS`, and every other
   * role's grants are listed one by one — so a new member of this enum reaches
   * administrators and nobody else. It is deliberately absent from
   * `ROLE_LIST_SETTINGS`, so no tenant setting can hand it to another role.
   */
  DATA_IMPORT = "data.import",

  // Configuration
  ORG_CONFIGURE = "org.configure",
}

/** Every permission in the catalogue. The administrator's grant, and the ceiling. */
export const ALL_PERMISSIONS: readonly Permission[] = Object.values(Permission);

const P = Permission;

/** The maximum any tenant can grant to a role. Configuration only subtracts. */
export const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  [Role.ADMIN]: new Set(ALL_PERMISSIONS),
  [Role.SCHOOL_ADMIN]: new Set([
    P.USER_VIEW,
    P.USER_MANAGE,
    P.USER_INVITE,
    P.STRUCTURE_VIEW,
    P.AVAILABILITY_VIEW_ANY,
    P.AVAILABILITY_EDIT_ANY,
    P.SESSION_VIEW_ANY,
    P.SESSION_BOOK,
    P.SESSION_EDIT_ANY,
    P.SESSION_CANCEL_ANY,
    P.SESSION_EDIT_SERIES,
    P.SESSION_APPROVE_REQUEST,
    P.ATTENDANCE_MARK_ANY,
    P.AUDIT_VIEW,
    P.EXPORT_SESSIONS,
  ]),
  [Role.PRINCIPAL]: new Set([
    P.USER_VIEW,
    P.STRUCTURE_VIEW,
    P.AVAILABILITY_VIEW_ANY,
    P.SESSION_VIEW_ANY,
    P.AUDIT_VIEW,
    P.EXPORT_SESSIONS,
  ]),
  [Role.REGIONAL_ADMIN]: new Set([
    P.USER_VIEW,
    P.USER_MANAGE,
    P.USER_INVITE,
    P.STRUCTURE_VIEW,
    P.AVAILABILITY_VIEW_ANY,
    P.AVAILABILITY_EDIT_ANY,
    P.SESSION_VIEW_ANY,
    P.SESSION_BOOK,
    P.SESSION_EDIT_ANY,
    P.SESSION_CANCEL_ANY,
    P.SESSION_EDIT_SERIES,
    P.SESSION_APPROVE_REQUEST,
    P.ATTENDANCE_MARK_ANY,
    P.AUDIT_VIEW,
    P.EXPORT_SESSIONS,
  ]),
  [Role.INSTRUCTOR]: new Set([
    P.USER_VIEW,
    P.STRUCTURE_VIEW,
    P.AVAILABILITY_VIEW_OWN,
    P.AVAILABILITY_EDIT_OWN,
    P.SESSION_VIEW_OWN,
    P.SESSION_BOOK,
    P.SESSION_EDIT_OWN,
    P.SESSION_CANCEL_OWN,
    // An instructor approves requests for their own time. The policy layer
    // restricts it to sessions they are on.
    P.SESSION_APPROVE_REQUEST,
    P.ATTENDANCE_MARK_OWN,
  ]),
  [Role.STUDENT]: new Set([
    P.SESSION_VIEW_OWN,
    P.SESSION_BOOK,
    P.SESSION_CANCEL_OWN,
    P.AVAILABILITY_VIEW_ANY,
  ]),
  [Role.PARENT]: new Set([
    P.SESSION_VIEW_OWN,
    P.SESSION_BOOK,
    P.SESSION_CANCEL_OWN,
    P.AVAILABILITY_VIEW_ANY,
  ]),
  [Role.PAYER]: new Set([P.SESSION_VIEW_OWN]),
};

/**
 * Booking settings that gate a permission by role list rather than by role. The
 * tenant lists which roles may do the thing; a role absent from the list loses
 * the permission even if its code default grants it.
 */
const ROLE_LIST_SETTINGS: ReadonlyArray<readonly [Permission, readonly string[]]> = [
  [P.SESSION_BOOK, ["booking", "who_can_book"]],
  [P.SESSION_BOOK_HISTORICAL, ["booking", "who_can_create_historical"]],
  [P.SESSION_DELETE, ["booking", "who_can_delete"]],
  [P.SESSION_OVERRIDE_CONFLICT, ["booking", "conflict_override_roles"]],
];

const EDIT_SETTING = ["booking", "who_can_edit"] as const;
const CANCEL_SETTING = ["booking", "who_can_cancel"] as const;

/**
 * The wire value of a role, which is what a settings role list holds.
 *
 * Every enum in the schema maps its members to the lowercased member name, so
 * this is a rule rather than a table that can drift. `tests/enums.test.ts` pins
 * it against the generated client.
 */
export function roleValue(role: Role): string {
  return role.toLowerCase();
}

/** The union of the code defaults for a set of roles, before any narrowing. */
export function codeDefault(roles: Iterable<Role>): Set<Permission> {
  const granted = new Set<Permission>();
  for (const role of roles) {
    for (const permission of ROLE_PERMISSIONS[role] ?? []) granted.add(permission);
  }
  return granted;
}

/**
 * Effective permissions for a role set under a tenant's configuration.
 *
 * `reader` is anything that can answer a settings path — in practice an
 * organization row wrapped by `settingsReader()`. When it is absent the code
 * defaults apply unchanged, which is the correct behaviour for a tenant that
 * has not been loaded rather than one that has been configured permissively.
 */
export function resolve(
  roles: Iterable<Role>,
  reader?: SettingsReader | null,
): Set<Permission> {
  const roleSet = new Set(roles);
  const granted = codeDefault(roleSet);
  if (!reader) return granted;

  const held = new Set([...roleSet].map(roleValue));
  const listedExcludesUs = (path: readonly string[]): boolean => {
    const listed = settingStrings(reader, path);
    if (listed === null) return false;
    return !listed.some((value) => held.has(value));
  };

  for (const [permission, path] of ROLE_LIST_SETTINGS) {
    if (listedExcludesUs(path)) granted.delete(permission);
  }

  if (listedExcludesUs(EDIT_SETTING)) {
    granted.delete(P.SESSION_EDIT_ANY);
    granted.delete(P.SESSION_EDIT_OWN);
    granted.delete(P.SESSION_EDIT_SERIES);
  }

  if (listedExcludesUs(CANCEL_SETTING)) {
    granted.delete(P.SESSION_CANCEL_ANY);
    granted.delete(P.SESSION_CANCEL_OWN);
  }

  // The floor rule, asserted rather than assumed: nothing was added.
  const ceiling = codeDefault(roleSet);
  for (const permission of granted) {
    if (!ceiling.has(permission)) granted.delete(permission);
  }
  return granted;
}
