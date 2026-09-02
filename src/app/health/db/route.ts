import { prisma } from "@/lib/db";

/**
 * Readiness: the database answers and the migrations are applied.
 *
 * Separate from `/health` because "the process is up" and "the process can do
 * its job" are different questions, and a load balancer needs the first while a
 * deployment gate needs the second.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    const applied = await prisma.$queryRawUnsafe<{ count: bigint }[]>(
      `SELECT count(*)::bigint AS count FROM "_prisma_migrations" WHERE finished_at IS NOT NULL`,
    );
    return Response.json({
      status: "ok",
      migrations: Number(applied[0]?.count ?? 0),
    });
  } catch (error) {
    return Response.json(
      { status: "unavailable", reason: error instanceof Error ? error.message : "unknown" },
      { status: 503 },
    );
  }
}
