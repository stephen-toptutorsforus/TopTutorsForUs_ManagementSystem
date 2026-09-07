import { PrismaPg } from "@prisma/adapter-pg";

import type { Prisma } from "@/generated/prisma/client";
import { PrismaClient } from "@/generated/prisma/client";

/**
 * What a service writes through.
 *
 * Deliberately the *transaction* client rather than `PrismaClient`: a service
 * called inside `$transaction` is handed one of these, and a signature that
 * insisted on the full client could not be called from there at all. A full
 * client satisfies it, so a caller with no transaction to join still works.
 */
export type Db = Prisma.TransactionClient;

/**
 * One Prisma client per process, created on first use.
 *
 * Kept on `globalThis` because the dev server reloads modules on every edit,
 * and a fresh client per reload exhausts the connection pool within a few
 * minutes of ordinary work.
 *
 * Deliberately lazy. Constructing the client at import time means anything that
 * merely *imports* this module needs `DATABASE_URL` set — including the test
 * harness, which only wants `clientFor` and points at a different database
 * entirely.
 */
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/** A Prisma client bound to a specific database. */
export function clientFor(connectionString: string): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

export function getPrisma(): PrismaClient {
  if (globalForPrisma.prisma) return globalForPrisma.prisma;

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  // Cached in every environment, production included. The usual Next idiom
  // caches only outside production, but that idiom guards a client built once
  // at module scope; this one is built inside a function the proxy below calls
  // on *every property access*. Skipping the cache in production therefore
  // meant a new client, and a new connection pool, for each `prisma.something`
  // — which stays invisible until enough requests arrive at once and Postgres
  // answers "sorry, too many clients already".
  globalForPrisma.prisma = clientFor(connectionString);
  return globalForPrisma.prisma;
}

/**
 * The application's client. A proxy so the connection is opened on the first
 * property access rather than on import.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getPrisma(), property, receiver);
  },
});
