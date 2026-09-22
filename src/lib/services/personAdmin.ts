/**
 * Administering somebody who already exists.
 *
 * `people.ts` is about bringing people into a tenant — creating them, inviting
 * a student by address, linking an instructor to one. This is the other half:
 * correcting a record, handing an account back to somebody locked out of it,
 * and stopping an account being used at all.
 *
 * They are separated because the guards differ sharply. Creating a person needs
 * `USER_MANAGE`; *setting their password* needs more than that, and refusing to
 * see the difference is how a regional administrator ends up able to take over
 * the account of anybody in the tenant.
 *
 * The shape checks are imported rather than restated. A second spelling of
 * "that does not look like an email address" is a second rule, and the one that
 * is wrong is whichever was edited last.
 */

import type { Prisma } from "@/generated/prisma/client";
import { AuditCategory, Role, UserStatus } from "@/generated/prisma/enums";
import { record } from "@/lib/audit";
import type { Db } from "@/lib/db";
import { Forbidden, ValidationError } from "@/lib/errors";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { peopleAtSchools, schoolScope } from "@/lib/policies/schoolScope";
import { scoped } from "@/lib/policies/scoping";
import { hashPassword } from "@/lib/security";
import { EMAIL_SHAPE, MIN_PASSWORD_LENGTH, PHONE_SHAPE } from "@/lib/shapes";
import { isValidZone } from "@/lib/time";

import type { PersonRecord, RequestMeta } from "./people";

/**
 * What may be changed about somebody after they exist.
 *
 * Deliberately not their roles. A role grant carries a regional
 * administrator's scope with it, so changing one is a privilege decision rather
 * than a detail edit; folding it into this form would let one careless Save
 * make it. It wants its own control with its own guard, which is Phase 2 work.
 */
export interface EditPersonInput {
  firstName?: string;
  lastName?: string;
  email?: string | null;
  phone?: string | null;
  timezone?: string | null;
  grade?: string | null;
  requestMeta?: RequestMeta;
}

/** One person in this tenant, with their role grants. Absent is 404, never 403. */
export async function findPerson(
  db: Db,
  principal: Principal,
  ref: string,
): Promise<PersonRecord | null> {
  principal.require(P.USER_VIEW);
  // Archived people are still readable here, and that is the point of the
  // screen: somebody has to be able to see who they archived and put them back.
  // Every *list* filters them out; this reads one by name.
  const scope = schoolScope(principal);
  return db.user.findFirst({
    where: {
      ...scoped(principal),
      ref,
      ...(scope ? peopleAtSchools(scope) : {}),
    },
    include: { roles: true },
  });
}

/** Change somebody's own details. */
export async function editPerson(
  db: Db,
  organization: { id: bigint },
  principal: Principal,
  person: PersonRecord,
  input: EditPersonInput,
): Promise<PersonRecord> {
  principal.require(P.USER_MANAGE);

  const data: Prisma.UserUpdateInput = {};

  if (input.firstName !== undefined) {
    const firstName = input.firstName.trim();
    if (!firstName) throw new ValidationError("a person needs a first and last name");
    data.firstName = firstName;
  }
  if (input.lastName !== undefined) {
    const lastName = input.lastName.trim();
    if (!lastName) throw new ValidationError("a person needs a first and last name");
    data.lastName = lastName;
  }
  if (input.email !== undefined) {
    const email = (input.email ?? "").trim().toLowerCase() || null;
    if (email !== null && !EMAIL_SHAPE.test(email)) {
      throw new ValidationError("that does not look like an email address");
    }
    if (email !== null) {
      // The partial unique index refuses this at the database too; asking first
      // is what turns a constraint violation into a sentence naming the field.
      // Excluding this person, so saving a form without touching the address is
      // not reported as a clash with themselves.
      const clash = await db.user.findFirst({
        where: {
          organizationId: organization.id,
          email: { equals: email, mode: "insensitive" },
          id: { not: person.id },
        },
        select: { id: true },
      });
      if (clash !== null) {
        throw new ValidationError("somebody with that email address already exists here");
      }
    }
    data.email = email;
  }
  if (input.phone !== undefined) {
    const phone = (input.phone ?? "").trim() || null;
    if (phone !== null && !PHONE_SHAPE.test(phone)) {
      throw new ValidationError("that does not look like a phone number");
    }
    data.phone = phone;
  }
  if (input.timezone !== undefined) {
    const zone = (input.timezone ?? "").trim() || null;
    if (zone !== null && !isValidZone(zone)) throw new ValidationError("unknown timezone");
    data.timezone = zone;
  }
  if (input.grade !== undefined) data.grade = (input.grade ?? "").trim() || null;

  const before = snapshotPerson(person);
  const updated = await db.user.update({
    where: { id: person.id },
    data,
    include: { roles: true },
  });
  const after = snapshotPerson(updated);

  // Nothing moved: no row in the trail, for the same reason `editDetails` skips
  // an unchanged session. An entry recording no change is noise in the one
  // place noise is expensive.
  if (JSON.stringify(before) === JSON.stringify(after)) return updated;

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.edited",
    entityType: "user_account",
    entityId: updated.id,
    entityRef: updated.ref,
    before,
    after,
    ...input.requestMeta,
  });

  return updated;
}

/**
 * What the trail records about a person, which is not what they are.
 *
 * Whether a field is set, never what it was set to. A name, an address and a
 * phone number are exactly what an audit trail must not quietly become a
 * second and less-protected copy of — the same rule `createPerson` follows when
 * it records the role and the status and nothing else. The timezone is the one
 * value written out, because it is a configuration choice rather than a fact
 * about a person, and "changed to New York" is the only useful form of it.
 */
function snapshotPerson(person: PersonRecord): Record<string, string> {
  return {
    first_name: person.firstName ? "set" : "empty",
    last_name: person.lastName ? "set" : "empty",
    email: person.email ? "set" : "empty",
    phone: person.phone ? "set" : "empty",
    timezone: person.timezone ?? "unset",
    grade: person.grade ? "set" : "empty",
  };
}

/** Refuse a password too short to be worth setting. */
export function assertPasswordStrength(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new ValidationError(
      `a password needs at least ${MIN_PASSWORD_LENGTH} characters`,
    );
  }
}

/**
 * Set somebody's password for them.
 *
 * A real workflow — a parent locked out, a student who never opened their
 * invitation — and also the most dangerous control in the directory, because it
 * hands over an account rather than editing one. So three guards that
 * `USER_MANAGE` alone would not give:
 *
 * * **Administrators only.** A regional administrator holds `USER_MANAGE`, and
 *   taking over an account is not a regional matter.
 * * **Never against another administrator.** Otherwise the weakest
 *   administrator account is the effective strength of every one of them, and a
 *   single stolen session takes the tenant.
 * * **Never against yourself.** Changing your own password is a different
 *   workflow with a different check — it asks for the current one — and this
 *   screen does not ask for it.
 *
 * Setting a password also makes the account usable, so somebody `INVITED`
 * becomes `ACTIVE`: a password that exists on an account that refuses it is not
 * a reset, it is a support call.
 */
export async function setPassword(
  db: Db,
  principal: Principal,
  person: PersonRecord,
  password: string,
  requestMeta: RequestMeta = {},
): Promise<void> {
  if (!principal.isAdmin) {
    throw new Forbidden("only an administrator may set somebody's password");
  }
  if (person.id === principal.userId) {
    throw new ValidationError("change your own password from your own profile");
  }
  if (person.roles.some((grant) => grant.role === Role.ADMIN)) {
    throw new Forbidden("an administrator's password cannot be set from here");
  }
  assertPasswordStrength(password);

  await db.user.update({
    where: { id: person.id },
    data: {
      passwordHash: await hashPassword(password),
      status: person.status === UserStatus.INVITED ? UserStatus.ACTIVE : person.status,
    },
  });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.password_set",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    // That it happened, and what it did to the account. Never the value, and
    // never a hint about its shape or its length.
    changes: {
      password: { from: person.passwordHash ? "set" : "unset", to: "set" },
      ...(person.status === UserStatus.INVITED
        ? { user_status: { from: "invited", to: "active" } }
        : {}),
    },
    ...requestMeta,
  });
}

/**
 * Stop somebody using their account, without removing what they did.
 *
 * Archived rather than deleted, and the difference is the whole of it: somebody
 * who taught forty sessions is named on forty records, so deleting the row
 * would either orphan them or take the history with it. `archivedAt` is what
 * every scoped read already filters on, so this takes them out of the
 * directory, out of the pickers and out of anywhere they could be booked, and
 * leaves every session they are on exactly as it was.
 *
 * Reversible on purpose — the column is a timestamp and restoring clears it.
 * Nothing here deletes anything.
 */
export async function archivePerson(
  db: Db,
  principal: Principal,
  person: PersonRecord,
  requestMeta: RequestMeta = {},
): Promise<void> {
  principal.require(P.USER_MANAGE);
  if (person.id === principal.userId) {
    throw new ValidationError("you cannot archive your own account");
  }
  // The escalation guard `createPerson` applies, from the other end: somebody
  // who may not *create* an administrator must not be able to lock one out.
  if (person.roles.some((grant) => grant.role === Role.ADMIN) && !principal.isAdmin) {
    throw new Forbidden("only an administrator may archive an administrator");
  }
  if (person.archivedAt !== null) return;

  await db.user.update({ where: { id: person.id }, data: { archivedAt: new Date() } });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.archived",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    changes: { archived: { from: false, to: true } },
    ...requestMeta,
  });
}

/** Put an archived person back. */
export async function restorePerson(
  db: Db,
  principal: Principal,
  person: PersonRecord,
  requestMeta: RequestMeta = {},
): Promise<void> {
  principal.require(P.USER_MANAGE);
  if (person.archivedAt === null) return;

  await db.user.update({ where: { id: person.id }, data: { archivedAt: null } });

  await record(db, principal, {
    category: AuditCategory.USER,
    action: "user.restored",
    entityType: "user_account",
    entityId: person.id,
    entityRef: person.ref,
    changes: { archived: { from: true, to: false } },
    ...requestMeta,
  });
}
