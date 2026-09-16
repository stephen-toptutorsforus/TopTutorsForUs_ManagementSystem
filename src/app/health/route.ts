import { NO_STORE_PROBE } from "@/lib/web/caching";

/** Liveness: the process is up. Deliberately touches nothing else. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "cache-control": NO_STORE_PROBE } });
}
