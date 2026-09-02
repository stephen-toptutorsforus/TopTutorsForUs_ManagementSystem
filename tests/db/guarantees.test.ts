/**
 * The guarantees that live in the database rather than in application code.
 *
 * These are the reason the schema is Postgres-specific and the reason the test
 * suite replays migrations instead of pushing a schema. Every one of them holds
 * against a direct insert — not merely against the service that usually does
 * the inserting — which is the whole point: a rule the writer can talk its way
 * around is not a guarantee.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import {
  makeOrganization,
  makeUser,
  newRef,
  reset,
  TEST_DATABASE_URL,
  testClient,
} from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;

describeDb("database-level guarantees", () => {
  let db: PrismaClient;

  beforeAll(() => {
    db = testClient();
  });

  afterAll(async () => {
    await db.$disconnect();
  });

  beforeEach(async () => {
    await reset(db);
  });

  async function fixture() {
    const org = await makeOrganization(db);
    const instructor = await makeUser(db, org.id);
    const location = await db.location.create({
      data: { ref: newRef("loc"), organizationId: org.id, name: "Study Room A" },
    });
    return { org, instructor, location };
  }

  function sessionData(
    org: { id: bigint; timezone: string },
    overrides: Record<string, unknown>,
  ) {
    return {
      ref: newRef("ses"),
      organizationId: org.id,
      title: "Fractions review",
      deliveryType: "EXTERNAL_LINK" as const,
      scheduledStart: new Date("2026-06-01T14:00:00Z"),
      scheduledEnd: new Date("2026-06-01T15:00:00Z"),
      timezone: org.timezone,
      status: "SCHEDULED" as const,
      ...overrides,
    };
  }

  describe("no instructor double-booking", () => {
    it("refuses a second overlapping session for the same instructor", async () => {
      const { org, instructor } = await fixture();
      await db.sessionOccurrence.create({
        data: sessionData(org, { instructorId: instructor.id }),
      });

      await expect(
        db.sessionOccurrence.create({
          data: sessionData(org, {
            instructorId: instructor.id,
            scheduledStart: new Date("2026-06-01T14:30:00Z"),
            scheduledEnd: new Date("2026-06-01T15:30:00Z"),
          }),
        }),
      ).rejects.toThrow(/ex_session_instructor_overlap/);
    });

    it("allows back-to-back sessions", async () => {
      // Half-open ranges: a session ending at 15:00 and one starting at 15:00
      // do not overlap. The application's own overlap check uses the same rule,
      // and the two have to agree.
      const { org, instructor } = await fixture();
      await db.sessionOccurrence.create({
        data: sessionData(org, { instructorId: instructor.id }),
      });

      await expect(
        db.sessionOccurrence.create({
          data: sessionData(org, {
            instructorId: instructor.id,
            scheduledStart: new Date("2026-06-01T15:00:00Z"),
            scheduledEnd: new Date("2026-06-01T16:00:00Z"),
          }),
        }),
      ).resolves.toBeTruthy();
    });

    it("releases the slot when a session is cancelled", async () => {
      const { org, instructor } = await fixture();
      const first = await db.sessionOccurrence.create({
        data: sessionData(org, { instructorId: instructor.id }),
      });
      await db.sessionOccurrence.update({
        where: { id: first.id },
        data: { status: "CANCELLED" },
      });

      await expect(
        db.sessionOccurrence.create({
          data: sessionData(org, { instructorId: instructor.id }),
        }),
      ).resolves.toBeTruthy();
    });

    it("does not let an unapproved request hold a slot", async () => {
      // A request is not yet a commitment.
      const { org, instructor } = await fixture();
      await db.sessionOccurrence.create({
        data: sessionData(org, { instructorId: instructor.id, status: "REQUESTED" }),
      });

      await expect(
        db.sessionOccurrence.create({
          data: sessionData(org, { instructorId: instructor.id }),
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("no room double-booking", () => {
    it("refuses two overlapping in-person sessions in one location", async () => {
      const { org, location } = await fixture();
      await db.sessionOccurrence.create({
        data: sessionData(org, { locationId: location.id, deliveryType: "IN_PERSON" }),
      });

      await expect(
        db.sessionOccurrence.create({
          data: sessionData(org, {
            locationId: location.id,
            deliveryType: "IN_PERSON",
            scheduledStart: new Date("2026-06-01T14:30:00Z"),
            scheduledEnd: new Date("2026-06-01T15:30:00Z"),
          }),
        }),
      ).rejects.toThrow(/ex_session_location_overlap/);
    });

    it("ignores a location on a session that is not in person", async () => {
      // An online session that happens to name a room does not occupy it.
      const { org, location } = await fixture();
      await db.sessionOccurrence.create({
        data: sessionData(org, { locationId: location.id, deliveryType: "IN_PERSON" }),
      });

      await expect(
        db.sessionOccurrence.create({
          data: sessionData(org, { locationId: location.id, deliveryType: "EXTERNAL_LINK" }),
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("the audit trail is append-only", () => {
    async function anEvent(organizationId: bigint) {
      return db.auditEvent.create({
        data: {
          ref: newRef("aud"),
          organizationId,
          category: "SESSION",
          action: "session.booked",
          entityType: "session_occurrence",
          entityId: BigInt(1),
          changes: {},
          occurredAt: new Date("2026-06-01T12:00:00Z"),
        },
      });
    }

    it("swallows an update, even from the process that writes the trail", async () => {
      const org = await makeOrganization(db);
      const event = await anEvent(org.id);

      await db.$executeRawUnsafe(
        `UPDATE audit_event SET action = 'tampered' WHERE id = ${event.id}`,
      );

      const after = await db.auditEvent.findUnique({ where: { id: event.id } });
      expect(after?.action).toBe("session.booked");
    });

    it("swallows a delete", async () => {
      const org = await makeOrganization(db);
      const event = await anEvent(org.id);

      await db.$executeRawUnsafe(`DELETE FROM audit_event WHERE id = ${event.id}`);

      expect(await db.auditEvent.findUnique({ where: { id: event.id } })).not.toBeNull();
    });
  });

  describe("the partial unique indexes", () => {
    it("allows one email per tenant and refuses a second", async () => {
      const org = await makeOrganization(db);
      await makeUser(db, org.id, { email: "rowan.mercer@example.test" });

      await expect(
        makeUser(db, org.id, { email: "rowan.mercer@example.test" }),
      ).rejects.toThrow(/uq_user_org_email/);
    });

    it("lets the same address exist in another tenant", async () => {
      // Somebody may hold accounts at two organizations without either seeing
      // the other.
      const first = await makeOrganization(db, { slug: "northgate" });
      const second = await makeOrganization(db, { slug: "harbour-point" });
      await makeUser(db, first.id, { email: "rowan.mercer@example.test" });

      await expect(
        makeUser(db, second.id, { email: "rowan.mercer@example.test" }),
      ).resolves.toBeTruthy();
    });

    it("allows any number of people with no address at all", async () => {
      // A student created by a guardian has none until the guardian sets one.
      // A plain unique constraint would be wrong in this direction rather than
      // the other.
      const org = await makeOrganization(db);
      await makeUser(db, org.id, { email: null, first: "Ottoline", last: "Rask" });

      await expect(
        makeUser(db, org.id, { email: null, first: "Wren", last: "Calloway" }),
      ).resolves.toBeTruthy();
    });

    it("refuses the same unbounded role twice", async () => {
      const org = await makeOrganization(db);
      const person = await makeUser(db, org.id);
      await db.userRole.create({
        data: { organizationId: org.id, userId: person.id, role: "INSTRUCTOR" },
      });

      await expect(
        db.userRole.create({
          data: { organizationId: org.id, userId: person.id, role: "INSTRUCTOR" },
        }),
      ).rejects.toThrow(/uq_user_role_unbounded/);
    });

    it("allows the same role held in two regions", async () => {
      // A regional administrator responsible for two regions is one role held
      // twice with different bounds.
      const org = await makeOrganization(db);
      const person = await makeUser(db, org.id);
      const north = await db.region.create({
        data: { ref: newRef("rgn"), organizationId: org.id, name: "North" },
      });
      const south = await db.region.create({
        data: { ref: newRef("rgn"), organizationId: org.id, name: "South" },
      });

      await db.userRole.create({
        data: {
          organizationId: org.id,
          userId: person.id,
          role: "REGIONAL_ADMIN",
          regionId: north.id,
        },
      });
      await expect(
        db.userRole.create({
          data: {
            organizationId: org.id,
            userId: person.id,
            role: "REGIONAL_ADMIN",
            regionId: south.id,
          },
        }),
      ).resolves.toBeTruthy();
    });
  });

  describe("enum values on the wire", () => {
    it("stores the lowercase values the URLs use", async () => {
      // The TypeScript member is `SCHEDULED`; what reaches the column is
      // `scheduled`, so `?status=scheduled` in a link keeps working and the two
      // services agree.
      const { org, instructor } = await fixture();
      await db.sessionOccurrence.create({
        data: sessionData(org, { instructorId: instructor.id }),
      });

      const rows = await db.$queryRawUnsafe<{ status: string }[]>(
        "SELECT status::text AS status FROM session_occurrence",
      );
      expect(rows[0]?.status).toBe("scheduled");
    });
  });
});
