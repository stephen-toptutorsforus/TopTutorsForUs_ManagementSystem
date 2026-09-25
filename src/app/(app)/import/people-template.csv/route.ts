/**
 * The people file the import screen reads, as a download.
 *
 * The same columns `previewImport` requires, so a template and the reader
 * cannot drift. Fictional rows only, on the reserved `.test` domain.
 */

import { payloadFor, statusFor } from "@/lib/errors";
import { Permission } from "@/lib/policies/permissions";
import { peopleTemplateCsv } from "@/lib/services/import";
import { NO_STORE } from "@/lib/web/caching";
import { requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    const { principal } = await requireContext();
    principal.require(Permission.DATA_IMPORT);

    return new Response(peopleTemplateCsv(), {
      headers: {
        "content-type": "text/csv; charset=utf-8",
        "content-disposition": 'attachment; filename="people-template.csv"',
        "cache-control": NO_STORE,
      },
    });
  } catch (error) {
    return Response.json(payloadFor(error), { status: statusFor(error) });
  }
}
