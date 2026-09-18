/**
 * The session list, as JSON.
 *
 * Ported from `list_sessions` in `app/web/api.py`. The same services and the
 * same policy layer as the HTML routes — authorization lives underneath both
 * rather than in either, so there is no path where the API is more permissive
 * than the interface.
 */

import { prisma } from "@/lib/db";
import { payloadFor, statusFor } from "@/lib/errors";
import {
  listSessions,
  pageCount,
  parseFilters,
} from "@/lib/services/sessionQuery";
import { toSessionOut } from "@/lib/web/api";
import { NO_STORE_HEADERS } from "@/lib/web/caching";
import { requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  try {
    // The organization as well as the principal, because whether this tenant
    // charges for anything decides whether `billable` is in the response at
    // all — the same question the grid asks before drawing the column.
    const { principal, organization } = await requireContext();
    const filters = parseFilters(new URL(request.url).searchParams);
    const results = await listSessions(prisma, principal, filters, {
      zone: principal.timezone,
    });

    return Response.json({
      results: results.rows.map((row) => toSessionOut(row, { organization })),
      total: results.total,
      page: results.page,
      pages: pageCount(results),
    }, { headers: NO_STORE_HEADERS });
  } catch (error) {
    return Response.json(payloadFor(error), { status: statusFor(error), headers: NO_STORE_HEADERS });
  }
}
