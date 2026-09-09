/**
 * The audit trail.
 *
 * Ported from `audit_log` in `app/web/views.py` and `app/templates/audit.html`.
 *
 * Append-only. It records which fields changed and what they changed to — never
 * the content of notes, messages, or contact details.
 */

import Link from "next/link";

import { Card, EmptyState, PageHeader, When } from "@/components/ui";
import { AuditCategory } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

export const metadata = { title: "Audit · TopTutorsForUs" };
export const dynamic = "force-dynamic";

function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function AuditPage() {
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.AUDIT_VIEW));

  const zone = principal.timezone;
  const events = await prisma.auditEvent.findMany({
    where: scoped(principal),
    orderBy: { occurredAt: "desc" },
    take: 200,
  });

  return (
    <>
      <PageHeader title="Audit trail" />

      {events.length > 0 ? (
        <Card>
          <ol className="timeline">
            {events.map((event) => (
              <li key={String(event.id)}>
                <p className="when">
                  <When instant={event.occurredAt} zone={zone} /> ·{" "}
                  {event.actorLabel ?? "System"} (
                  {(event.actorRole ?? "unknown").replace(/_/g, " ")})
                </p>
                <p className="what">
                  {event.action.replace(/\./g, " · ").replace(/_/g, " ")}
                  {event.entityRef && (
                    <>
                      {" — "}
                      {event.category === AuditCategory.SESSION ? (
                        <Link href={`/sessions/${event.entityRef}`}>
                          <code>{event.entityRef}</code>
                        </Link>
                      ) : (
                        <code>{event.entityRef}</code>
                      )}
                    </>
                  )}
                </p>
                {Object.entries(
                  (event.changes ?? {}) as Record<string, { from: unknown; to: unknown }>,
                ).map(([field, change]) => (
                  <p className="diff" key={field}>
                    {sentenceCase(field)}:{" "}
                    <span className="from">
                      {change.from === null || change.from === undefined
                        ? "unset"
                        : String(change.from)}
                    </span>{" "}
                    →{" "}
                    <span className="to">
                      {change.to === null || change.to === undefined
                        ? "unset"
                        : String(change.to)}
                    </span>
                  </p>
                ))}
                {event.note && <p className="hint">{event.note}</p>}
              </li>
            ))}
          </ol>
        </Card>
      ) : (
        <Card>
          <EmptyState
            heading="Nothing recorded yet"
            message="Changes to sessions, attendance, and permissions will appear here."
            glyph="◫"
          />
        </Card>
      )}
    </>
  );
}
