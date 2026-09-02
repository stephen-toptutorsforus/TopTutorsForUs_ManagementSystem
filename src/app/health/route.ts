/** Liveness: the process is up. Deliberately touches nothing else. */
export const dynamic = "force-dynamic";

export function GET() {
  return Response.json({ status: "ok" });
}
