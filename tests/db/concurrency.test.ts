/**
 * Concurrency: what happens when two requests race for the same slot.
 *
 * Ported from `tests/test_concurrency.py`. These use **real, separate database
 * connections** and real commits, not the shared reset the rest of the suite
 * uses. That is the whole point: a race that two commits could win is invisible
 * inside one transaction, and an application-level check-then-insert looks
 * perfectly correct until two of them interleave.
 *
 * They create and clean up their own rows, since they cannot ride the reset.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";

import type { PrismaClient } from "@/generated/prisma/client";
import { DeliveryType, Role, SessionStatus, UserStatus } from "@/generated/prisma/enums";
import { clientFor } from "@/lib/db";
import { newRef } from "@/lib/ref";

import { TEST_DATABASE_URL, migrateTestDatabase } from "./harness";

const describeDb = TEST_DATABASE_URL ? describe : describe.skip;
const NY = "America/New_York";
const START = new Date("2027-05-03T20:00:00.000Z");
const SLUG = "concurrency-test";

describeDb("concurrency", () => {
  let one: PrismaClient;
  let two: PrismaClient;
  let orgId: bigint;
  let instructorId: bigint;

  beforeAll(() => {
    migrateTestDatabase();
    // Two clients, so the two writers really are two connections. One client
    // would serialise them through its own pool and the race would not happen.
    one = clientFor(TEST_DATABASE_URL!);
    two = clientFor(TEST_DATABASE_URL!);
  });

  afterAll(async () => {
    await Promise.all([one.$disconnect(), two.$disconnect()]);
  });

  /** Remove every row belonging to the throwaway tenant, in foreign-key order. */
  async function purge() {
    const orgs = await one.organization.findMany({
      where: { slug: SLUG },
      select: { id: true },
    });
    if (orgs.length === 0) return;
    const ids = orgs.map((row) => row.id);
    await one.auditEvent.deleteMany({ where: { organizationId: { in: ids } } });
    await one.sessionParticipant.deleteMany({ where: { organizationId: { in: ids } } });
    await one.sessionOccurrence.deleteMany({ where: { organizationId: { in: ids } } });
    await one.userRole.deleteMany({ where: { organizationId: { in: ids } } });
    await one.user.deleteMany({ where: { organizationId: { in: ids } } });
    await one.organization.deleteMany({ where: { id: { in: ids } } });
  }

  beforeEach(async () => {
    // These tests commit for real, so clear any residue a previous run left
    // behind rather than depending on teardown having completed.
    await purge();

    const organization = await one.organization.create({
      data: {
        ref: newRef("org"),
        name: "Concurrency Test Collective",
        slug: SLUG,
        timezone: NY,
        features: {},
        settings: {},
      },
    });
    const instructor = await one.user.create({
      data: {
        ref: newRef("usr"),
        organizationId: organization.id,
        email: "race.subject@example.test",
        firstName: "Race",
        lastName: "Subject",
        status: UserStatus.ACTIVE,
        roles: { create: [{ organizationId: organization.id, role: Role.INSTRUCTOR }] },
      },
    });
    orgId = organization.id;
    instructorId = instructor.id;
  });

  afterEach(async () => {
    await purge();
  });

  function occurrenceData(title: string, start = START, minutes = 60) {
    return {
      ref: newRef("ses"),
      organizationId: orgId,
      title,
      deliveryType: DeliveryType.EXTERNAL_LINK,
      scheduledStart: start,
      scheduledEnd: new Date(start.getTime() + minutes * 60_000),
      timezone: NY,
      instructorId,
      status: SessionStatus.SCHEDULED,
    };
  }

  /**
   * Insert, hold the transaction open a moment, then commit.
   *
   * The pause is what forces both transactions to be open simultaneously,
   * which is exactly the interleaving an application-level check cannot
   * survive. Deliberately *not* a gate each waits on the other to open: the
   * loser's insert blocks on the constraint until the winner commits, so a
   * mutual gate would deadlock until the transaction timeout and test the
   * timeout instead of the constraint.
   */
  function commitOne(client: PrismaClient, title: string): Promise<void> {
    return client.$transaction(
      async (tx) => {
        await tx.sessionOccurrence.create({ data: occurrenceData(title) });
        await new Promise((resolve) => setTimeout(resolve, 50));
      },
      { timeout: 20_000 },
    );
  }

  it("cannot let two simultaneous bookings both win", async () => {
    // A check-then-insert in the service has a window between the check and the
    // insert in which both requests see an empty slot. The EXCLUDE constraint
    // has no such window.
    const results = await Promise.allSettled([
      commitOne(one, "First"),
      commitOne(two, "Second"),
    ]);

    const failures = results.filter((result) => result.status === "rejected");
    expect(failures.length, `expected exactly one loser, got ${JSON.stringify(results)}`).toBe(
      1,
    );
    expect(String((failures[0] as PromiseRejectedResult).reason)).toContain(
      "ex_session_instructor_overlap",
    );

    // Exactly one session exists.
    expect(await one.sessionOccurrence.count({ where: { organizationId: orgId } })).toBe(1);
  }, 60_000);

  it("lets two simultaneous bookings in adjacent slots both win", async () => {
    // The constraint must not be so broad that legitimate work is refused.
    const results = await Promise.allSettled([
      one.sessionOccurrence.create({ data: occurrenceData("Earlier", START) }),
      two.sessionOccurrence.create({
        data: occurrenceData("Later", new Date(START.getTime() + 3_600_000)),
      }),
    ]);

    expect(results.filter((result) => result.status === "rejected")).toEqual([]);
    expect(await one.sessionOccurrence.count({ where: { organizationId: orgId } })).toBe(2);
  }, 60_000);

  it("leaves no partial series when a booking fails", async () => {
    // A series whose second occurrence clashes must write nothing at all.
    await one.sessionOccurrence.create({
      data: occurrenceData("Blocker", new Date(START.getTime() + 7 * 86_400_000)),
    });

    await expect(
      one.$transaction(async (tx) => {
        for (let week = 0; week < 4; week += 1) {
          await tx.sessionOccurrence.create({
            data: occurrenceData(
              `Series ${week + 1}`,
              new Date(START.getTime() + week * 7 * 86_400_000),
            ),
          });
        }
      }),
    ).rejects.toThrow(/ex_session_instructor_overlap/);

    const titles = await one.sessionOccurrence.findMany({
      where: { organizationId: orgId },
      select: { title: true },
    });
    // No part of the series was written.
    expect(new Set(titles.map((row) => row.title))).toEqual(new Set(["Blocker"]));
  }, 60_000);
});
