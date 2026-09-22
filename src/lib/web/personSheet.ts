/**
 * What the person drawer is handed, which is not the row it was opened from.
 *
 * The same shape `sessionPeek.ts` follows, for the same reason: the drawer is a
 * client component, and a Prisma record carries `bigint` ids and columns that
 * screen has no business holding. A hand-built payload is the only version of
 * "adding a column does not widen what reaches the browser" that cannot be
 * forgotten.
 *
 * Every `ref`, never a database id — and no `passwordHash`, obviously, but
 * stated because the field it *does* carry is the one that says whether there
 * is one at all, which is what lets the drawer word the password panel
 * correctly for somebody who has never signed in.
 */

import type { Role, UserStatus } from "@/generated/prisma/enums";

export interface PersonSheetData {
  ref: string;
  firstName: string;
  lastName: string;
  /** What the header calls them, and what a notice names them by. */
  displayName: string;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  grade: string | null;
  status: string;
  /** Title-cased, already resolved — the drawer draws words, not enum members. */
  roleNames: readonly string[];
  /** Whether they can sign in at all yet. Never the hash, never its shape. */
  hasPassword: boolean;
  archived: boolean;
  /** `Sana Holm — Guardian`, as the directory already words them. */
  connections: readonly { kind: string; name: string }[];
  groups: readonly string[];
  lastLoginLabel: string | null;
  /**
   * Whether this viewer may set this person's password.
   *
   * Answered on the server by the same rules the service enforces — an
   * administrator, not themselves, not another administrator — because a
   * control drawn from a broad permission is a promise the write then refuses.
   * The service checks again regardless; this only decides what to draw.
   */
  canSetPassword: boolean;
  /** Whether this viewer may archive them. Same reasoning. */
  canArchive: boolean;
  /**
   * Where they are placed. Schools *or* regions, matching the create form —
   * derived region rows behind a school are not listed, so submitting this
   * set cannot trip the "not both" rule.
   */
  schoolRefs: readonly string[];
  regionRefs: readonly string[];
}

export interface PersonSheetSource {
  ref: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  timezone: string | null;
  grade: string | null;
  status: UserStatus;
  passwordHash: string | null;
  archivedAt: Date | null;
  roles: readonly { role: Role }[];
}

export function personSheetOf(
  user: PersonSheetSource,
  extras: {
    roleNames: readonly string[];
    connections: readonly { kind: string; name: string }[];
    groups: readonly string[];
    lastLoginLabel: string | null;
    canSetPassword: boolean;
    canArchive: boolean;
    schoolRefs?: readonly string[];
    regionRefs?: readonly string[];
  },
): PersonSheetData {
  return {
    ref: user.ref,
    firstName: user.firstName,
    lastName: user.lastName,
    displayName: `${user.firstName} ${user.lastName}`.trim() || user.ref,
    email: user.email,
    phone: user.phone,
    timezone: user.timezone,
    grade: user.grade,
    status: user.status.toLowerCase(),
    roleNames: extras.roleNames,
    hasPassword: user.passwordHash !== null,
    archived: user.archivedAt !== null,
    connections: extras.connections,
    groups: extras.groups,
    lastLoginLabel: extras.lastLoginLabel,
    canSetPassword: extras.canSetPassword,
    canArchive: extras.canArchive,
    schoolRefs: extras.schoolRefs ?? [],
    regionRefs: extras.regionRefs ?? [],
  };
}
