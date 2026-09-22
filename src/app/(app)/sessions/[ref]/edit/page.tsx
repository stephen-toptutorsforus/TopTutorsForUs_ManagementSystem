/**
 * Everything that changes one session, on a screen of its own.
 *
 * The detail page reads; this one writes. That split is what lets the calendar
 * offer "Session Details" and "Edit Session" as two different things rather
 * than one page that is quietly both, and it keeps a page somebody opens to
 * check a time from also being a page they can change it on by accident.
 *
 * **Three buttons, one screen.** "Edit Session", "Edit Series" and "Cancel
 * session" all arrive here; the query says which panel opens and which scope
 * starts chosen. Neither narrows what is available — every panel is still
 * here, and the scope is still a choice — because arriving from a button that
 * said "series" is a good reason to preselect it and a bad reason to decide it.
 * `sessionOps` re-checks the scope against `canEditSeries` on every write
 * regardless of what this screen offered.
 */

import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { ActionsPanel } from "@/components/session/ActionsPanel";
import { AttendanceCard } from "@/components/session/AttendanceCard";
import { Card, CardSection, Fact, LinkButton, PageHeader, StatusBadge } from "@/components/ui";
import { prisma } from "@/lib/db";
import {
  billingEnabled,
  selectableDurations,
  settingStrings,
  settingsReader,
} from "@/lib/organization";
import { rosterFor } from "@/lib/policies/roster";
import { visibleSessions } from "@/lib/services/sessionQuery";
import { availableActions } from "@/lib/policies/sessions";
import { durationWords } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import {
  attendanceRate,
  scheduledDurationMinutes,
} from "@/lib/services/sessionOps";
import { backTarget } from "@/lib/web/backLink";
import { participantViews } from "@/lib/web/participants";
import { csrfToken, requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

/** Which panel a button asked for. Anything else opens none. */
const PANELS = new Set(["edit", "move", "cancel"]);
/** Which scope a button asked for. Anything else is the narrowest. */
const SCOPES = new Set(["this", "this_and_future", "all"]);

export default async function EditSessionPage({
  params,
  searchParams,
}: {
  params: Promise<{ ref: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { ref } = await params;
  const search = await searchParams;
  const { principal, organization } = await requireContext();

  const session = await prisma.sessionOccurrence.findFirst({
    where: { ...visibleSessions(principal), ref },
  });
  // 404, never 403: a refusal that confirms the record exists is itself a
  // cross-tenant disclosure.
  if (session === null) notFound();

  const actions = availableActions(principal, session, organization);
  // Nothing to do here is not the same as nothing to see: the detail page is
  // still readable, so somebody with no action on this session is refused the
  // editing screen rather than shown an empty one with a heading.
  if (actions.length === 0) notFound();

  const zone = session.timezone;

  const [participantRows, instructor] = await Promise.all([
    prisma.sessionParticipant.findMany({
      where: { sessionId: session.id },
      orderBy: [{ role: "asc" }, { id: "asc" }],
      include: { user: { select: { firstName: true, lastName: true, ref: true } } },
    }),
    session.instructorId
      ? prisma.user.findUnique({
          where: { id: session.instructorId },
          select: { firstName: true, lastName: true },
        })
      : null,
  ]);

  // This screen is reachable by anybody with *an* action on the session, and
  // `session.cancel_own` is one — so a student can open their own session here.
  // The register is narrowed for the same reason it is on the reading screen.
  const roster = await rosterFor(prisma, principal);
  const { participants, hidden } = participantViews(roster, session, participantRows);

  const reader = settingsReader(organization);
  const token = await csrfToken();
  const start = new Moment(session.scheduledStart, zone);
  const scheduled = scheduledDurationMinutes(session);

  const asked = String(search.scope ?? "");
  const scope = SCOPES.has(asked) ? asked : "this";
  const wanted = String(search.do ?? "");
  const openPanel = PANELS.has(wanted) ? (wanted as "edit" | "move" | "cancel") : null;

  const sent = await headers();
  // `search.from` before the referrer: this page is re-rendered by every
  // server action on it, and the `Referer` on that POST is this page, so the
  // referrer alone turned "back to the calendar" into "back to the session
  // list" the moment anybody pressed Save.
  const back = backTarget(
    sent.get("referer"),
    sent.get("host"),
    `/sessions/${ref}/edit`,
    search.from,
  );

  const localInput = (instant: Date | null) =>
    instant === null ? "" : new Moment(instant, zone).local.toFormat("yyyy-MM-dd'T'HH:mm");

  return (
    <>
      <PageHeader
        className="page-header-back"
        title={`Edit ${session.title}`}
        actions={<LinkButton href={back}>Back</LinkButton>}
      />

      {/* Which session is being changed, said before anything that changes it.
          Read-only, and deliberately the few facts somebody needs to be sure
          they are on the right one — the whole record is a link away. */}
      <Card as="section" className="card-padded">
        <CardSection title="You are editing">
          <div className="form-row">
            <Fact label="Title">{session.title}</Fact>
            <Fact label="Status">
              <StatusBadge status={session.status} endsAt={session.scheduledEnd} />
            </Fact>
          </div>
          <div className="form-row">
            <Fact label="Session date">
              <time dateTime={start.isoDate}>{start.date}</time>
            </Fact>
            <Fact label="Start time">
              {start.time} {start.zoneLabel}
            </Fact>
            <Fact label="Session length">{durationWords(scheduled)}</Fact>
          </div>
          <div className="form-row">
            <Fact label="Instructor">
              {instructor ? `${instructor.firstName} ${instructor.lastName}`.trim() : null}
            </Fact>
            <Fact label="Series">
              {session.seriesIndex === null ? "One session" : `Session ${session.seriesIndex}`}
            </Fact>
          </div>
        </CardSection>
      </Card>

      <ActionsPanel
        sessionRef={session.ref}
        csrfToken={token}
        actions={actions}
        timezone={zone}
        title={session.title}
        description={session.description}
        billable={session.billable}
        billableEnabled={billingEnabled(organization)}
        startDate={start.isoDate}
        startTime={start.time}
        durationMinutes={scheduled}
        actualStartLocal={localInput(session.actualStart)}
        actualEndLocal={localInput(session.actualEnd)}
        durations={selectableDurations(reader)}
        cancellationReasons={settingStrings(reader, ["reason_codes", "cancellation"]) ?? []}
        missedReasons={settingStrings(reader, ["reason_codes", "missed"]) ?? []}
        defaultScope={scope}
        openPanel={openPanel}
      />

      <AttendanceCard
        sessionRef={session.ref}
        csrfToken={token}
        timezone={zone}
        participants={participants}
        hidden={hidden}
        attendanceRate={attendanceRate(participantRows)}
        editable={actions.includes("attendance")}
      />
    </>
  );
}
