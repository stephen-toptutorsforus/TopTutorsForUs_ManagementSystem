/**
 * One session, everything known about it, and what may be done to it.
 *
 * Ported from `session_detail` in `app/web/views.py` and
 * `app/templates/sessions/detail.html`.
 *
 * The action panel renders exactly `availableActions`, so a completed session
 * never shows a cancel control. The history is shown only to somebody holding
 * `audit.view`.
 */

import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionsPanel } from "@/components/session/ActionsPanel";
import { AttendanceCard, type ParticipantView } from "@/components/session/AttendanceCard";
import { Badge, Card, CardGrid, DeliveryBadge, LinkButton, PageHeader, StatusBadge, Tag, When, WhenTime } from "@/components/ui";
import { SessionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { availableActions } from "@/lib/policies/sessions";
import { deliveryMeta, durationLabel } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import { settingStrings, settingsReader } from "@/lib/organization";
import {
  actualDurationMinutes,
  attendanceRate,
  scheduledDurationMinutes,
} from "@/lib/services/sessionOps";
import { csrfToken, requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const { principal, organization } = await requireContext();

  const session = await prisma.sessionOccurrence.findFirst({
    where: { ...scoped(principal), ref, archivedAt: null },
  });
  // 404, never 403: a refusal that confirms the record exists is itself a
  // cross-tenant disclosure.
  if (session === null) notFound();

  const zone = session.timezone;

  const [participantRows, series, seriesTotal, location, events] = await Promise.all([
    prisma.sessionParticipant.findMany({
      where: { sessionId: session.id },
      orderBy: [{ role: "asc" }, { id: "asc" }],
      include: { user: { select: { firstName: true, lastName: true, ref: true } } },
    }),
    session.seriesId
      ? prisma.sessionSeries.findUnique({ where: { id: session.seriesId } })
      : null,
    session.seriesId
      ? prisma.sessionOccurrence.count({
          where: { seriesId: session.seriesId, archivedAt: null },
        })
      : null,
    session.locationId
      ? prisma.location.findUnique({ where: { id: session.locationId } })
      : null,
    principal.has(Permission.AUDIT_VIEW)
      ? prisma.auditEvent.findMany({
          where: { ...scoped(principal), entityRef: session.ref },
          orderBy: { occurredAt: "desc" },
          take: 50,
        })
      : [],
  ]);

  const actions = availableActions(principal, session, organization);
  const scheduled = scheduledDurationMinutes(session);
  const actual = actualDurationMinutes(session);
  const delta = actual === null ? null : actual - scheduled;

  const participants: ParticipantView[] = participantRows.map((participant) => ({
    id: String(participant.id),
    name: `${participant.user.firstName} ${participant.user.lastName}`.trim() || "—",
    role: participant.role,
    joinedAt: participant.joinedAt?.toISOString() ?? null,
    leftAt: participant.leftAt?.toISOString() ?? null,
    attendedMinutes: participant.attendedMinutes,
    attendance: participant.attendance,
  }));

  const reader = settingsReader(organization);
  const token = await csrfToken();
  const start = new Moment(session.scheduledStart, zone);

  const localInput = (instant: Date | null) =>
    instant === null ? "" : new Moment(instant, zone).local.toFormat("yyyy-MM-dd'T'HH:mm");

  return (
    <>
      <PageHeader title={session.title} subtitle={<><StatusBadge status={session.status} />{" "}
            <DeliveryBadge delivery={session.deliveryType} />{" "}
            {series && session.seriesIndex && seriesTotal && (
              <Link className="tag" href={`/series/${series.ref}`}>
                Session {session.seriesIndex} of {seriesTotal} in this series
              </Link>
            )}
            {session.detachedFromSeries && (
              <Tag>Edited on its own — series edits skip it</Tag>
            )}
            {session.conflictOverridden && (
              <Badge tone="warn" glyph="!">Booked over a conflict</Badge>
            )}</>} actions={<LinkButton href="/sessions">
          Back to sessions
        </LinkButton>} />

      <CardGrid>
        <Card>
          <h2>Schedule</h2>
          <dl className="definition">
            <dt>Scheduled</dt>
            <dd>
              <When instant={session.scheduledStart} zone={zone} /> →{" "}
              <WhenTime instant={session.scheduledEnd} zone={zone} />
            </dd>
            <dt>Scheduled length</dt>
            <dd>{durationLabel(scheduled)}</dd>
            <dt>Actually ran</dt>
            <dd>
              {session.actualStart ? (
                <>
                  <When instant={session.actualStart} zone={zone} /> →{" "}
                  <WhenTime instant={session.actualEnd} zone={zone} />
                </>
              ) : (
                <Tag>Not recorded</Tag>
              )}
            </dd>
            <dt>Actual length</dt>
            <dd>
              {durationLabel(actual)}{" "}
              {delta !== null && delta > 0 && (
                <Badge tone="warn" glyph="▲">{delta} min over</Badge>
              )}
              {delta !== null && delta < 0 && (
                <Badge tone="warn" glyph="▼">{-delta} min short</Badge>
              )}
              {delta === 0 && (
                <Badge tone="good" glyph="✓">As scheduled</Badge>
              )}
            </dd>
            <dt>Timezone</dt>
            <dd>{zone}</dd>
          </dl>
        </Card>

        <Card>
          <h2>Delivery</h2>
          <dl className="definition">
            <dt>Type</dt>
            <dd>{deliveryMeta(session.deliveryType).label}</dd>
            {session.deliveryType === "IN_PERSON" ? (
              <>
                <dt>Location</dt>
                <dd>{location?.name ?? session.locationDetail ?? "—"}</dd>
              </>
            ) : (
              session.meetingUrl && (
                <>
                  <dt>Meeting link</dt>
                  <dd>
                    {/* Shown only to people already authorised to see this
                        session, and never written to logs or the audit trail. */}
                    <a href={session.meetingUrl} rel="noopener noreferrer">
                      Join the meeting
                    </a>
                  </dd>
                </>
              )
            )}
            <dt>Billable</dt>
            <dd>{session.billable ? "Yes" : "No"}</dd>
            <dt>Reference</dt>
            <dd>
              <code>{session.ref}</code>
            </dd>
          </dl>

          {session.description && (
            <>
              <h3>Notes</h3>
              {/* Rendered as text. The reference sanitises author-supplied HTML
                  with an allowlist; here there is no unescaped path at all,
                  which is the same guarantee with nothing to get wrong. */}
              <p className="prose">{session.description}</p>
            </>
          )}

          {session.status === SessionStatus.CANCELLED && (
            <p className="notice notice-warn">
              <span aria-hidden="true">✕</span>
              <span>
                Cancelled
                {session.cancelledAt && (
                  <>
                    {" "}
                    on <When instant={session.cancelledAt} zone={zone} />
                  </>
                )}
                . Reason: {(session.cancellationReason ?? "").replace(/_/g, " ")}.
                {session.cancellationNote && (
                  <>
                    <br />
                    {session.cancellationNote}
                  </>
                )}
              </span>
            </p>
          )}
        </Card>
      </CardGrid>

      <AttendanceCard
        sessionRef={session.ref}
        csrfToken={token}
        timezone={zone}
        participants={participants}
        attendanceRate={attendanceRate(participantRows)}
        editable={actions.includes("attendance")}
      />

      <ActionsPanel
        sessionRef={session.ref}
        csrfToken={token}
        actions={actions}
        timezone={zone}
        title={session.title}
        description={session.description}
        billable={session.billable}
        startDate={start.isoDate}
        startTime={start.time}
        durationMinutes={scheduled}
        actualStartLocal={localInput(session.actualStart)}
        actualEndLocal={localInput(session.actualEnd)}
        cancellationReasons={settingStrings(reader, ["reason_codes", "cancellation"]) ?? []}
        missedReasons={settingStrings(reader, ["reason_codes", "missed"]) ?? []}
      />

      {events.length > 0 && (
        <Card>
          <h2>History</h2>
          <ol className="timeline">
            {events.map((event) => (
              <li key={String(event.id)}>
                <p className="when">
                  <When instant={event.occurredAt} zone={principal.timezone} /> ·{" "}
                  {event.actorLabel ?? "System"} ({(event.actorRole ?? "").replace(/_/g, " ")})
                </p>
                <p className="what">
                  {event.action.replace(/\./g, " · ").replace(/_/g, " ")}
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
      )}
    </>
  );
}
