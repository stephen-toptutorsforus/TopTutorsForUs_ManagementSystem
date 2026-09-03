/**
 * Export the current filter as CSV.
 *
 * Ported from `sessions_export` in `app/web/views.py`. Permission-checked and
 * audited: taking the whole list away is a different act from reading a
 * screenful, and only the first is worth a record.
 */

import { AuditCategory } from "@/generated/prisma/enums";
import { record } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { payloadFor, statusFor } from "@/lib/errors";
import { Permission } from "@/lib/policies/permissions";
import { listSessions, parseFilters, toCsv } from "@/lib/services/sessionQuery";
import { civilDate } from "@/lib/time";
import { requestMeta, requirePrincipal } from "@/lib/web/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    const principal = await requirePrincipal();
    principal.require(Permission.EXPORT_SESSIONS);

    const zone = principal.timezone;
    const filters = parseFilters(new URL(request.url).searchParams);
    // Bounded so one request cannot pull an unbounded result set into memory.
    const results = await listSessions(prisma, principal, filters, { zone, limit: 5000 });

    await record(prisma, principal, {
      category: AuditCategory.EXPORT,
      action: "export.sessions",
      entityType: "session_occurrence",
      entityId: 0n,
      changes: { rows: { from: null, to: results.rows.length } },
      ...(await requestMeta()),
    });

    const stamp = civilDate(new Date(), zone);
    return new Response(toCsv(results.rows, filters.columns, zone), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": `attachment; filename="sessions-${stamp}.csv"`,
      },
    });
  } catch (error) {
    return Response.json(payloadFor(error), { status: statusFor(error) });
  }
}
