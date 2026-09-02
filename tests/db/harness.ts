/**
 * The database-backed suite's fixtures.
 *
 * The schema is built by **replaying the migrations**, not by pushing the
 * Prisma schema. Building from the schema file would exercise a database no
 * environment actually runs: the exclusion constraints, the append-only rules
 * and the partial unique indexes exist only in the migration SQL, and they are
 * where several of the guarantees live.
 */

import { execFileSync } from "node:child_process";

import { config } from "dotenv";

import type { PrismaClient } from "@/generated/prisma/client";
import { clientFor } from "@/lib/db";

config();

export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

let migrated = false;

export function migrateTestDatabase(): void {
  if (migrated || !TEST_DATABASE_URL) return;
  execFileSync("npx", ["prisma", "migrate", "deploy"], {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
    stdio: "pipe",
    shell: process.platform === "win32",
  });
  migrated = true;
}

export function testClient(): PrismaClient {
  if (!TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is not set");
  migrateTestDatabase();
  return clientFor(TEST_DATABASE_URL);
}

/**
 * Empty every table. `TRUNCATE ... CASCADE` rather than a delete per table, so
 * the order the foreign keys need is Postgres's problem rather than a list here
 * that goes stale the next time a table is added.
 */
export async function reset(db: PrismaClient): Promise<void> {
  const rows = await db.$queryRawUnsafe<{ tablename: string }[]>(
    `SELECT tablename FROM pg_tables
     WHERE schemaname = 'public' AND tablename NOT LIKE '_prisma%'`,
  );
  const names = rows.map((row) => `"${row.tablename}"`).join(", ");
  if (names) {
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  }
}

const REF_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789"; // no look-alike characters

/** A short, opaque, URL-safe public identifier, e.g. `ses_k7m2q9x4`. */
export function newRef(prefix: string): string {
  let body = "";
  for (let i = 0; i < 10; i += 1) {
    body += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `${prefix}_${body}`;
}

export async function makeOrganization(
  db: PrismaClient,
  overrides: { slug?: string; timezone?: string; name?: string } = {},
) {
  return db.organization.create({
    data: {
      ref: newRef("org"),
      name: overrides.name ?? "Northgate Learning Collective",
      slug: overrides.slug ?? newRef("slug"),
      country: "US",
      timezone: overrides.timezone ?? "America/New_York",
      currency: "USD",
      features: {},
      settings: {},
    },
  });
}

export async function makeUser(
  db: PrismaClient,
  organizationId: bigint,
  overrides: { first?: string; last?: string; email?: string | null } = {},
) {
  return db.user.create({
    data: {
      ref: newRef("usr"),
      organizationId,
      email: overrides.email === undefined ? `${newRef("who")}@example.test` : overrides.email,
      firstName: overrides.first ?? "Imani",
      lastName: overrides.last ?? "Okafor",
      status: "ACTIVE",
    },
  });
}
