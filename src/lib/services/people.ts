/**
 * Creating and inviting people.
 *
 * Ported from `app/services/people.py`.
 *
 * A new account is created **without a password** in the `invited` state. There
 * is no path in this module that sets a password for someone else: an
 * administrator creating an account cannot learn or choose its credentials,
 * which keeps "administrator" and "able to impersonate anyone" separate
 * capabilities.
 *
 * Roles are granted here as rows, so a person can hold several from the start
 * or gain one later without a second account and a split history.
 */

import type { Prisma } from "@/generated/prisma/client";
import { AuditCategory, Role, UserStatus } from "@/generated/prisma/enums";
import { record } from "@/lib/audit";
import type { Db } from "@/lib/db";
export type { Db } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { newRef } from "@/lib/ref";
import { isValidZone } from "@/lib/time";

/**
 * Deliberately permissive: the authority on whether an address works is whether
 * mail reaches it, not a regex. This rejects only what is obviously not an
 * address, and never rejects a valid but unusual one.
 */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

/**
 * Deliberately loose: digits, and the punctuation people actually type around
 * them. Anything stricter rejects real numbers — extensions, country codes
 * written half a dozen ways — and this field is for a human to ring, not for a
 * machine to dial.
 */
export const PHONE_SHAPE = /^[0-9 ()+.\-]{6,32}$/;

/** Request context an audit event carries. Never a body, never a credential. */
export interface RequestMeta {
  ipAddress?: string | null;
  userAgent?: string | null;
}

/** A user row as this service returns it. */
export type PersonRecord = Prisma.UserGetPayload<{ include: { roles: true } }>;

export interface CreatePersonInput {
  email: string | null;
  firstName: string;
  lastName: string;
  roles: string[];
  timezone?: string | null;
  grade?: string | null;
  phone?: string | null;
  requestMeta?: RequestMeta;
}

function parseRoles(raw: readonly string[]): Set<Role> {
  const resolved = new Set<Role>();
  for (const value of raw) {
    const match = (Object.values(Role) as string[]).find(
      (role) => role === value || role.toLowerCase() === value,
    );
    if (match === undefined) throw new ValidationError(`unknown role: ${value}`);
    resolved.add(match as Role);
  }
  return resolved;
}

/** Roles sort by their wire value, so the audit entry reads the same either side. */
function sortedRoleValues(roles: Iterable<Role>): string[] {
  return [...roles].map((role) => role.toLowerCase()).sort();
}

/**
 * Create an invited account. Never sets a password.
 *
 * `email` may be null, and only for an account somebody else is going to
 * finish: a student whose guardian will set the address and the password. An
 * account without an address cannot be signed in to, because sign-in matches on
 * the address and NULL matches nothing.
 */
export async function createPerson(
  db: Db,
  organization: { id: bigint; timezone: string },
  principal: Principal,
  input: CreatePersonInput,
): Promise<PersonRecord> {
  principal.require(P.USER_MANAGE);

  const email = (input.email ?? "").trim().toLowerCase() || null;
  const firstName = input.firstName.trim();
  const lastName = input.lastName.trim();
  const phone = (input.phone ?? "").trim() || null;

  if (email !== null && !EMAIL_SHAPE.test(email)) {
    throw new ValidationError("that does not look like an email address");
  }
  if (phone !== null && !PHONE_SHAPE.test(phone)) {
    throw new ValidationError("that does not look like a phone number");
  }
  if (!firstName || !lastName) {
    throw new ValidationError("a person needs a first and last name");
  }
  if (input.timezone && !isValidZone(input.timezone)) {
    throw new ValidationError("unknown timezone");
  }

  const resolved = parseRoles(input.roles);
  if (resolved.size === 0) throw new ValidationError("choose at least one role");

  // Privilege escalation guard: granting administrator requires already being
  // one. A regional administrator holds USER_MANAGE but must not be able to
  // promote a new account past their own level.
  if (
    (resolved.has(Role.ADMIN) || resolved.has(Role.REGIONAL_ADMIN)) &&
    !principal.isAdmin
  ) {
    throw new ValidationError("only an administrator may grant an administrator role");
  }

  if (email !== null) {
    const existing = await db.user.findFirst({
      where: { organizationId: organization.id, email: { equals: email, mode: "insensitive" } },
      select: { id: true },
    });
    if (existing !== null) {
      throw new ValidationError("somebody with that email address already exists here");
    }
  }

  const person = await db.user.create({
    data: {
      ref: newRef("usr"),
      organizationId: organization.id,
      email,
      firstName,
      lastName,
      status: UserStatus.INVITED,
      timezone: input.timezone || organization.timezone,
      grade: input.grade || null,
      phone,
      passwordHash: null,
      roles: {
        create: [...resolved]
          .sort()
          .map((role) => ({ organizationId: organization.id, role })),
      },
    },
    include: { roles: true },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.created",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    // The address and the name are deliberately absent: an audit trail must not
    // become a second, less-protected copy of the directory.
    changes: {
      role: { from: null, to: sortedRoleValues(resolved) },
      user_status: { from: null, to: UserStatus.INVITED.toLowerCase() },
    },
    ...input.requestMeta,
  });

  return person;
}

function hasRole(person: PersonRecord, role: Role): boolean {
  return person.roles.some((grant) => grant.role === role);
}

/**
 * Resolve a student by email address, inviting one if there is no match.
 *
 * Used by the booking screen's "add by email". Two things it deliberately does
 * not do:
 *
 * * It never reveals whether an address exists in **another** organization. The
 *   lookup is tenant-scoped like every other, so a booker cannot use this box
 *   to probe the wider directory.
 * * It refuses rather than invents when the caller cannot manage people. An
 *   unmatched address then reads as "no student here with that address", which
 *   is true, instead of silently creating an account they may not create.
 */
export async function findOrInviteStudent(
  db: Db,
  organization: { id: bigint; timezone: string },
  principal: Principal,
  input: { email: string; requestMeta?: RequestMeta },
): Promise<PersonRecord> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_SHAPE.test(email)) {
    throw new ValidationError("that does not look like an email address");
  }

  const existing = await db.user.findFirst({
    where: {
      organizationId: organization.id,
      email: { equals: email, mode: "insensitive" },
      archivedAt: null,
    },
    include: { roles: true },
  });
  if (existing !== null) {
    if (!hasRole(existing, Role.STUDENT)) {
      throw new ValidationError("that person is not a student here");
    }
    return existing;
  }

  if (!principal.has(P.USER_MANAGE)) {
    throw new ValidationError("no student here has that email address");
  }

  // A local part like "amara.okonkwo" becomes "Amara Okonkwo": a placeholder an
  // administrator will correct, never a claim about who this person is.
  const local = email.split("@", 1)[0] ?? "";
  const parts = local.replace(/[._]/g, " ").split(/\s+/).filter(Boolean);
  const capitalize = (word: string) =>
    word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();

  return createPerson(db, organization, principal, {
    email,
    firstName: parts.length > 0 ? capitalize(parts[0]!) : "New",
    lastName: parts.length > 1 ? capitalize(parts[parts.length - 1]!) : "Student",
    roles: [Role.STUDENT],
    requestMeta: input.requestMeta,
  });
}

/**
 * Link an instructor to a student. Under `assigned_users_only`, this table is
 * what makes either of them bookable by the other.
 */
export async function assignStudent(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  input: {
    instructor: PersonRecord;
    student: PersonRecord;
    requestMeta?: RequestMeta;
  },
) {
  principal.require(P.USER_MANAGE);

  const { instructor, student } = input;
  if (
    instructor.organizationId !== organization.id ||
    student.organizationId !== organization.id
  ) {
    throw new ValidationError("both people must be in this organization");
  }
  if (!hasRole(instructor, Role.INSTRUCTOR)) {
    throw new ValidationError("that person is not an instructor");
  }
  if (!hasRole(student, Role.STUDENT)) {
    throw new ValidationError("that person is not a student");
  }

  const existing = await db.instructorStudent.findFirst({
    where: { instructorId: instructor.id, studentId: student.id },
  });
  if (existing !== null) return existing;

  const link = await db.instructorStudent.create({
    data: {
      organizationId: organization.id,
      instructorId: instructor.id,
      studentId: student.id,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.student_assigned",
    entityType: "instructor_student",
    entityId: link.id,
    entityRef: student.ref,
    changes: { participant_ref: { from: null, to: instructor.ref } },
    ...input.requestMeta,
  });

  return link;
}
