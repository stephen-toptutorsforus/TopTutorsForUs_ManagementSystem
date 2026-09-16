import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";

/**
 * Readiness: the database answers and the migrations are applied.
 *
 * Separate from `/health` because "the process is up" and "the process can do
 * its job" are different questions, and a load balancer needs the first while a
 * deployment gate needs the second.
 *
 * **It answers to anybody.** A readiness probe that needs a credential is one
 * the orchestrator cannot use, so this is unauthenticated by design — which
 * makes what it says on failure part of its interface. It used to return
 * `error.message`, and a driver's message names the host it dialled, the
 * database, the role, and sometimes the statement. That is a map of the
 * deployment handed to anyone who can reach the port at the moment it is least
 * able to defend itself. The caller needs one bit — ready, or not — and gets it.
 * Whoever is on call needs the detail and gets it from the log, on the server.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    // A tagged template, not `$queryRawUnsafe`. The string is a constant and
    // was never injectable, but "unsafe" in a call is a thing a reader has to
    // stop and clear, and the safe form says the same thing in the same space.
    const applied = await prisma.$queryRaw<{ count: bigint }[]>(
      Prisma.sql`SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    return Response.json({
      status: "ok",
      migrations: Number(applied[0]?.count ?? 0),
    });
  } catch (error) {
    // Logged, not returned. Nothing from the driver reaches the response.
    console.error("readiness check failed", error);
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
