/**
 * One session, as JSON.
 *
 * Ported from `get_session` in `app/web/api.py`. A caller who may not see the
 * session is refused with 404, never 403 — a 403 would confirm it exists.
 */

import { prisma } from "@/lib/db";
import { NotFound, payloadFor, statusFor } from "@/lib/errors";
import { scoped } from "@/lib/policies/scoping";
import { availableActions, canView } from "@/lib/policies/sessions";
import { decorate } from "@/lib/services/sessionQuery";
import { toSessionOut } from "@/lib/web/api";
import { NO_STORE_HEADERS } from "@/lib/web/caching";
import { requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ ref: string }> },
): Promise<Response> {
  try {
    const { ref } = await params;
    const { principal, organization } = await requireContext();

    const occurrence = await prisma.sessionOccurrence.findFirst({
      where: { ...scoped(principal), ref, archivedAt: null },
    });
    if (occurrence === null) throw new NotFound("no such session");

    const participants = await prisma.sessionParticipant.findMany({
      where: { sessionId: occurrence.id },
      select: { userId: true },
    });
    const guardianOf = await prisma.guardianStudent.findMany({
      where: {
        guardianId: principal.userId,
        organizationId: principal.organizationId,
      },
      select: { studentId: true },
    });

    const decision = canView(principal, occurrence, {
      participantUserIds: participants.map((row) => row.userId),
      guardianOfIds: guardianOf.map((row) => row.studentId),
    });
    if (!decision.allowed) throw new NotFound("no such session");

    const [row] = await decorate(prisma, principal, [occurrence]);
    const series = occurrence.seriesId
      ? await prisma.sessionSeries.findUnique({
          where: { id: occurrence.seriesId },
          select: { ref: true },
        })
      : null;

    return Response.json(
      toSessionOut(row!, {
        seriesRef: series?.ref ?? null,
        actions: availableActions(principal, occurrence, organization),
        organization,
      }),
    );
  } catch (error) {
    return Response.json(payloadFor(error), { status: statusFor(error), headers: NO_STORE_HEADERS });
  }
}
