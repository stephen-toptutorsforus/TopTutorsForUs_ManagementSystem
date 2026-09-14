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

import { headers } from "next/headers";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ActionsPanel } from "@/components/session/ActionsPanel";
import { AttendanceCard, type ParticipantView } from "@/components/session/AttendanceCard";
import {
  Badge,
  Card,
  CardSection,
  Fact,
  LinkButton,
  PageHeader,
  StatusBadge,
  Tag,
  When,
  WhenTime,
} from "@/components/ui";
import { DeliveryType, ParticipantRole, SessionStatus } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { availableActions } from "@/lib/policies/sessions";
import { deliveryMeta, durationWords } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import { settingStrings, settingsReader } from "@/lib/organization";
import {
  actualDurationMinutes,
  attendanceRate,
  scheduledDurationMinutes,
} from "@/lib/services/sessionOps";
import { backTarget } from "@/lib/web/backLink";
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

  const [participantRows, series, seriesTotal, location, instructor, group, program, events] =
    await Promise.all([
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
      // The instructor, the group and the program: all three are columns on the
      // session, and none of them was drawn anywhere on this page. The
      // instructor appeared only as a row of the attendance table, which is a
      // register rather than an answer to "who is teaching this".
      session.instructorId
        ? prisma.user.findUnique({
            where: { id: session.instructorId },
            select: { firstName: true, lastName: true, ref: true },
          })
        : null,
      session.groupId
        ? prisma.group.findUnique({ where: { id: session.groupId }, select: { name: true } })
        : null,
      session.programId
        ? prisma.program.findUnique({ where: { id: session.programId }, select: { name: true } })
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

  // Names only, and students only: the attendance register below answers who
  // turned up, this answers who the session is for.
  const students = participantRows
    .filter((participant) => participant.role === ParticipantRole.STUDENT)
    .map((participant) =>
      `${participant.user.firstName} ${participant.user.lastName}`.trim(),
    )
    .filter((name) => name !== "");

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

  // Six screens link here, so the way back is read from the referrer rather
  // than fixed — see `lib/web/backLink.ts` for what it refuses to trust.
  const sent = await headers();
  const back = backTarget(sent.get("referer"), sent.get("host"), `/sessions/${session.ref}`);
  const start = new Moment(session.scheduledStart, zone);

  const localInput = (instant: Date | null) =>
    instant === null ? "" : new Moment(instant, zone).local.toFormat("yyyy-MM-dd'T'HH:mm");

  return (
    <>
      <PageHeader
        title={session.title}
        actions={<LinkButton href={back.href}>{back.label}</LinkButton>}
      />

      {/* What this session *is*, before what is known about it. Page-owned
          markup rather than a header slot: `PageHeader` deliberately has no
          subtitle, and this belongs to the record rather than to the shape of
          every screen's header. */}
      {/* Only what is *not* also a field below. Status, type and the series
          position each have their own box now, and saying them twice on one
          screen is how somebody starts wondering whether the two disagree.
          What is left is the pair of warnings, which have no field of their
          own because they are not things anybody set. */}
      {(session.detachedFromSeries || session.conflictOverridden) && (
        <p className="record-status">
          {session.detachedFromSeries && (
            <Tag>Edited on its own — series edits skip it</Tag>
          )}
          {session.conflictOverridden && (
            <Badge tone="warn" glyph="!">Booked over a conflict</Badge>
          )}
        </p>
      )}

      {/* The same groups the booking screen collects these in, in the same
          order and the same layout, so reading a session back is the form it
          was entered on rather than a second arrangement of the same facts.
          `Fact` is `Field` without a control — see its own file for why it is
          not simply a disabled input. */}
      <Card as="section" className="card-padded">
        <CardSection title="Session details">
          <div className="form-row">
            <Fact label="Type">{deliveryMeta(session.deliveryType).label}</Fact>
            <Fact label="Status">
              <StatusBadge status={session.status} />
            </Fact>
          </div>

          {session.deliveryType === DeliveryType.IN_PERSON ? (
            <Fact label="Location Details">
              {location?.name ?? session.locationDetail}
            </Fact>
          ) : (
            <Fact label="Online Classroom link">
              {/* Shown only to people already authorised to see this session,
                  and never written to logs or the audit trail. */}
              {session.meetingUrl ? (
                <a href={session.meetingUrl} rel="noopener noreferrer">
                  Join the meeting
                </a>
              ) : null}
            </Fact>
          )}

          <Fact label="Title">{session.title}</Fact>
          {/* Rendered as text. The reference sanitises author-supplied HTML
              with an allowlist; here there is no unescaped path at all, which
              is the same guarantee with nothing to get wrong. */}
          <Fact label="Description" wide>
            {session.description}
          </Fact>
        </CardSection>

        <CardSection title="Date and repeat">
          <div className="form-row">
            <Fact label="Session date">
              <time dateTime={start.isoDate}>{start.date}</time>
            </Fact>
            <Fact label="Session length">{durationWords(scheduled)}</Fact>
            <Fact label="Start time">
              <WhenTime instant={session.scheduledStart} zone={zone} />
            </Fact>
          </div>

          <div className="form-row">
            <Fact label="Ends">
              <WhenTime instant={session.scheduledEnd} zone={zone} />
            </Fact>
            <Fact label="Timezone">{zone}</Fact>
            <Fact label="Repeats">
              {series && session.seriesIndex && seriesTotal ? (
                <Link href={`/series/${series.ref}`}>
                  Session {session.seriesIndex} of {seriesTotal}
                </Link>
              ) : (
                "One session"
              )}
            </Fact>
          </div>

          {/* What the schedule said, against what happened — the half of this
              page the booking screen has no counterpart for, kept beside the
              times it is about rather than in a group of its own. */}
          <div className="form-row">
            <Fact label="Actually ran">
              {session.actualStart ? (
                <>
                  <When instant={session.actualStart} zone={zone} />
                  {" → "}
                  <WhenTime instant={session.actualEnd} zone={zone} />
                </>
              ) : (
                <Tag>Not recorded</Tag>
              )}
            </Fact>
            <Fact label="Actual length">
              {actual === null ? null : (
                <>
                  {durationWords(actual)}{" "}
                  {delta !== null && delta > 0 && (
                    <Badge tone="warn" glyph="▲">{delta} min over</Badge>
                  )}
                  {delta !== null && delta < 0 && (
                    <Badge tone="warn" glyph="▼">{-delta} min short</Badge>
                  )}
                  {delta === 0 && (
                    <Badge tone="good" glyph="✓">As scheduled</Badge>
                  )}
                </>
              )}
            </Fact>
          </div>
        </CardSection>

        <CardSection title="Instructor">
          <div className="form-row">
            <Fact label="Program">{program?.name}</Fact>
            <Fact label="Instructor">
              {instructor ? `${instructor.firstName} ${instructor.lastName}`.trim() : null}
            </Fact>
          </div>
        </CardSection>

        <CardSection title="Students and groups">
          <Fact label="Students" wide>
            {/* The names only. Who attended, and for how long, is the
                attendance register below — this answers who the session is
                for. */}
            {students.length > 0 ? students.join(", ") : null}
          </Fact>
          <div className="form-row">
            <Fact label="Group">{group?.name}</Fact>
            <Fact label="Billable">{session.billable ? "Yes" : "No"}</Fact>
            <Fact label="Reference">
              <code>{session.ref}</code>
            </Fact>
          </div>
        </CardSection>

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
        <Card as="section" className="card-padded">
          <CardSection title="History">
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
          </CardSection>
        </Card>
      )}
    </>
  );
}
