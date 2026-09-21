/**
 * Editing, archiving and taking over one person's account.
 *
 * The guards are the point of this file, not the writes. `USER_MANAGE` is
 * enough to correct somebody's phone number and deliberately not enough to set
 * their password — and the difference between those two is what stops a
 * regional administrator taking the tenant.
 *
 * Every case here goes through the service rather than the screen, because the
 * screen is a courtesy: it hides the controls it knows will be refused, and
 * these are the refusals themselves.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { AuditCategory, Role, UserStatus } from "@/generated/prisma/enums";
import { Forbidden, ValidationError } from "@/lib/errors";
import { loadPrincipal } from "@/lib/policies/principal";
import type { Principal } from "@/lib/policies/principal";
import {
  archivePerson,
  editPerson,
  findPerson,
  restorePerson,
  setPassword,
} from "@/lib/services/personAdmin";
import { verifyPassword } from "@/lib/security";

import { TEST_DATABASE_URL, makeOrganization, makeUser, reset, testClient } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const GOOD_PASSWORD = "correct horse battery staple";

describeDb("administering a person", () => {
  let db: PrismaClient;
  let org: { id: bigint };
  let elsewhere: { id: bigint };
  let admin: Principal;
  let regional: Principal;
  let student: { id: bigint; ref: string };
  let otherAdmin: { id: bigint; ref: string };

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
    org = await makeOrganization(db, { timezone: "America/New_York" });
    elsewhere = await makeOrganization(db, { slug: "other" });

    const adminUser = await makeUser(db, org.id, {
      first: "Rowan",
      last: "Mercer",
      email: "rowan.mercer@example.test",
      roles: [Role.ADMIN],
    });
    const regionalUser = await makeUser(db, org.id, {
      first: "Noor",
      last: "Haddad",
      email: "noor.haddad@example.test",
      roles: [Role.REGIONAL_ADMIN],
    });
    otherAdmin = await makeUser(db, org.id, {
      first: "Bo",
      last: "Fischer",
      email: "bo.fischer@example.test",
      roles: [Role.ADMIN],
    });
    student = await makeUser(db, org.id, {
      first: "Teo",
      last: "Vasquez",
      email: "teo.vasquez@example.test",
      roles: [Role.STUDENT],
    });

    admin = await loadPrincipal(db, adminUser.id);
    regional = await loadPrincipal(db, regionalUser.id);
  });

  const load = async (ref: string) => {
    const found = await findPerson(db, admin, ref);
    if (found === null) throw new Error(`no such person: ${ref}`);
    return found;
  };

  describe("finding one", () => {
    it("is null for another tenant's person, not a refusal", async () => {
      const outsider = await makeUser(db, elsewhere.id, {
        first: "Mira",
        last: "Dane",
        email: "mira.dane@example.test",
        roles: [Role.STUDENT],
      });
      // Null becomes a 404 at the route. A 403 would confirm the record exists,
      // which is the disclosure the whole scoping rule exists to prevent.
      expect(await findPerson(db, admin, outsider.ref)).toBeNull();
    });

    it("still returns somebody who has been archived", async () => {
      await archivePerson(db, admin, await load(student.ref));
      // Every *list* filters them out. This reads one by name, and somebody has
      // to be able to see who they archived in order to put them back.
      const found = await findPerson(db, admin, student.ref);
      expect(found?.archivedAt).not.toBeNull();
    });
  });

  describe("editing", () => {
    it("changes what it was given and leaves the rest alone", async () => {
      const edited = await editPerson(db, org, admin, await load(student.ref), {
        firstName: "Teodoro",
        phone: "504-252-1545",
      });

      expect(edited.firstName).toBe("Teodoro");
      expect(edited.phone).toBe("504-252-1545");
      expect(edited.lastName).toBe("Vasquez");
    });

    it("refuses an address somebody else in the tenant already has", async () => {
      await expect(
        editPerson(db, org, admin, await load(student.ref), {
          email: "rowan.mercer@example.test",
        }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("does not call a person a clash with themselves", async () => {
      // Saving the form without touching the address is the ordinary case, and
      // an exclusion that forgot to skip this row would refuse every save.
      const edited = await editPerson(db, org, admin, await load(student.ref), {
        email: "teo.vasquez@example.test",
        firstName: "Teodoro",
      });
      expect(edited.firstName).toBe("Teodoro");
    });

    it("lets the same address exist in another tenant", async () => {
      await makeUser(db, elsewhere.id, {
        first: "Someone",
        last: "Else",
        email: "shared@example.test",
        roles: [Role.STUDENT],
      });
      const edited = await editPerson(db, org, admin, await load(student.ref), {
        email: "shared@example.test",
      });
      expect(edited.email).toBe("shared@example.test");
    });

    it("refuses a name that is only spaces, and an unknown zone", async () => {
      await expect(
        editPerson(db, org, admin, await load(student.ref), { firstName: "   " }),
      ).rejects.toBeInstanceOf(ValidationError);
      await expect(
        editPerson(db, org, admin, await load(student.ref), { timezone: "Mars/Olympus" }),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("records that a field changed, never what it changed to", async () => {
      await editPerson(db, org, admin, await load(student.ref), {
        phone: "504-252-1545",
        timezone: "America/Chicago",
      });

      const event = await db.auditEvent.findFirst({
        where: { action: "user.edited", entityId: student.id },
        orderBy: { id: "desc" },
      });
      const written = JSON.stringify(event?.changes);

      // The trail must not become a second and less-protected copy of the
      // directory. "set" and "empty", never the number itself.
      expect(written).not.toContain("504");
      expect(written).toContain("set");
      // The zone is the exception and is written out: it is a configuration
      // choice rather than a fact about a person.
      expect(written).toContain("America/Chicago");
      expect(event?.category).toBe(AuditCategory.USER);
    });

    it("writes no audit entry when nothing actually moved", async () => {
      const before = await db.auditEvent.count({ where: { action: "user.edited" } });
      await editPerson(db, org, admin, await load(student.ref), {
        firstName: "Teo",
        lastName: "Vasquez",
      });
      expect(await db.auditEvent.count({ where: { action: "user.edited" } })).toBe(before);
    });

    it("refuses somebody who may not manage people", async () => {
      const asStudent = await loadPrincipal(db, student.id);
      await expect(
        editPerson(db, org, asStudent, await load(student.ref), { firstName: "Nope" }),
      ).rejects.toBeInstanceOf(Forbidden);
    });
  });

  describe("setting a password", () => {
    it("sets one, and makes an invited account usable", async () => {
      // Invited on purpose: the harness makes people active, and the case worth
      // pinning is the one where somebody has never opened their invitation.
      await db.user.update({
        where: { id: student.id },
        data: { status: UserStatus.INVITED, passwordHash: null },
      });
      const person = await load(student.ref);

      await setPassword(db, admin, person, GOOD_PASSWORD);

      const after = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      expect(after.status).toBe(UserStatus.ACTIVE);
      // A password that exists on an account that refuses it is not a reset.
      expect((await verifyPassword(after.passwordHash!, GOOD_PASSWORD)).valid).toBe(true);
    });

    it("refuses a regional administrator, who holds USER_MANAGE", async () => {
      // The whole reason this is not gated on `USER_MANAGE`: taking over an
      // account is not a regional matter, and they may edit every other field.
      await expect(
        setPassword(db, regional, await load(student.ref), GOOD_PASSWORD),
      ).rejects.toBeInstanceOf(Forbidden);
    });

    it("refuses another administrator", async () => {
      // Otherwise the weakest administrator account is the effective strength
      // of every one of them.
      await expect(
        setPassword(db, admin, await load(otherAdmin.ref), GOOD_PASSWORD),
      ).rejects.toBeInstanceOf(Forbidden);
    });

    it("sends you to your own profile for your own password", async () => {
      const self = await db.user.findFirstOrThrow({
        where: { id: admin.userId },
        include: { roles: true },
      });
      // A `ValidationError` rather than a `Forbidden`, and the difference is
      // the message: this is "not from here", not "not by you". Changing your
      // own password is a workflow that asks for the current one, and this
      // screen does not.
      await expect(setPassword(db, admin, self, GOOD_PASSWORD)).rejects.toBeInstanceOf(
        ValidationError,
      );
    });

    it("refuses one too short to be worth setting", async () => {
      await expect(
        setPassword(db, admin, await load(student.ref), "short"),
      ).rejects.toBeInstanceOf(ValidationError);
    });

    it("records that it happened and nothing about the value", async () => {
      await setPassword(db, admin, await load(student.ref), GOOD_PASSWORD);

      const event = await db.auditEvent.findFirst({
        where: { action: "user.password_set", entityId: student.id },
      });
      const written = JSON.stringify(event?.changes);

      expect(written).toContain("set");
      expect(written).not.toContain(GOOD_PASSWORD);
      // Not the length either, which narrows a guess more than it looks.
      expect(written).not.toContain(String(GOOD_PASSWORD.length));
    });
  });

  describe("archiving", () => {
    it("stops the account and keeps everything they were named on", async () => {
      await archivePerson(db, admin, await load(student.ref));

      const after = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      expect(after.archivedAt).not.toBeNull();
      // The row is still there. Archiving is a column, not a delete: somebody
      // on forty sessions cannot be removed without orphaning forty records.
      expect(after.firstName).toBe("Teo");
    });

    it("puts them back", async () => {
      await archivePerson(db, admin, await load(student.ref));
      await restorePerson(db, admin, await load(student.ref));
      const after = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      expect(after.archivedAt).toBeNull();
    });

    it("refuses your own account", async () => {
      const self = await db.user.findFirstOrThrow({
        where: { id: admin.userId },
        include: { roles: true },
      });
      await expect(archivePerson(db, admin, self)).rejects.toBeInstanceOf(ValidationError);
    });

    it("does not let a regional administrator lock an administrator out", async () => {
      // The escalation guard `createPerson` applies, from the other end.
      await expect(
        archivePerson(db, regional, await load(otherAdmin.ref)),
      ).rejects.toBeInstanceOf(Forbidden);
      // And they may still archive anybody else.
      await archivePerson(db, regional, await load(student.ref));
      const after = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      expect(after.archivedAt).not.toBeNull();
    });

    it("is quiet about archiving somebody already archived", async () => {
      await archivePerson(db, admin, await load(student.ref));
      const first = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      await archivePerson(db, admin, await load(student.ref));
      const second = await db.user.findUniqueOrThrow({ where: { id: student.id } });
      // Not a second timestamp, and not a second audit entry.
      expect(second.archivedAt).toEqual(first.archivedAt);
      expect(await db.auditEvent.count({ where: { action: "user.archived" } })).toBe(1);
    });
  });
});
