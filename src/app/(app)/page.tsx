/**
 * A role-appropriate landing page.
 *
 * Ported from the `dashboard` view in `app/web/views.py`. The counts are the
 * tenant's if the person may see the tenant, and their own otherwise — the same
 * `visibleSessions` clause the grid uses, so the two can never disagree about
 * what this person is allowed to count.
 */

import Link from "next/link";

import {
  AttendanceStatus,
  ParticipantRole,
  SessionStatus,
} from "@/generated/prisma/enums";
import { Card, CardGrid, EmptyState, LinkButton, PageHeader, StatusBadge, TableWrap, Tag, When, WhenTime } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { durationLabel } from "@/lib/presentation";
import { decorate, visibleSessions } from "@/lib/services/sessionQuery";
import { scheduledDurationMinutes } from "@/lib/services/sessionOps";
import { addDays, civilDate, resolveCivil } from "@/lib/time";
import { requireContext } from "@/lib/web/session";

export const metadata = { title: "Dashboard · TopTutorsForUs" };
export const dynamic = "force-dynamic";

const LONG_DATE = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "2-digit",
  month: "long",
  year: "numeric",
  timeZone: "UTC",
});

export default async function DashboardPage() {
  const { principal, organization } = await requireContext();
  const zone = principal.timezone;
  const today = civilDate(new Date(), zone);

  const dayStart = resolveCivil(today, "00:00", zone).instant;
  const dayEnd = resolveCivil(addDays(today, 1), "00:00", zone).instant;
  const visible = visibleSessions(principal);

  const [todays, upcoming, unmarked] = await Promise.all([
    prisma.sessionOccurrence.findMany({
      where: { ...visible, scheduledStart: { gte: dayStart, lt: dayEnd } },
      orderBy: { scheduledStart: "asc" },
    }),
    prisma.sessionOccurrence.findMany({
      where: {
        ...visible,
        scheduledStart: { gte: dayEnd },
        status: SessionStatus.SCHEDULED,
      },
      orderBy: { scheduledStart: "asc" },
      take: 8,
    }),
    // Counted over the sessions this person may see, not over the tenant. The
    // reference filtered on organizationId alone, so a student's dashboard
    // reported how many sessions across the whole organization were waiting to
    // be marked — a number about other people's lessons.
    prisma.sessionParticipant.count({
      where: {
        attendance: AttendanceStatus.UNMARKED,
        role: ParticipantRole.STUDENT,
        session: { ...visible, status: SessionStatus.COMPLETED },
      },
    }),
  ]);

  const counts = {
    today: todays.length,
    completed: todays.filter((s) => s.status === SessionStatus.COMPLETED).length,
    inProgress: todays.filter((s) => s.status === SessionStatus.IN_PROGRESS).length,
    missed: todays.filter((s) => s.status === SessionStatus.MISSED).length,
    cancelled: todays.filter((s) => s.status === SessionStatus.CANCELLED).length,
  };

  const [todayRows, upcomingRows] = await Promise.all([
    decorate(prisma, todays),
    decorate(prisma, upcoming),
  ]);

  return (
    <>
      <PageHeader
        title={<>Today at {organization.name}</>}
        subtitle={
          <>
            {LONG_DATE.format(new Date(`${today}T00:00:00Z`))} · all times shown in {zone}
          </>
        }
        actions={
          principal.has(Permission.SESSION_BOOK) && (
            <LinkButton variant="primary" href="/sessions/new">
              <span aria-hidden="true">＋</span> New session
            </LinkButton>
          )
        }
      />

      <CardGrid>
        <Card className="stat">
          <span className="value">{counts.today}</span>
          <span className="label">Sessions today</span>
        </Card>
        <Card className="stat">
          <span className="value">{counts.completed}</span>
          <span className="label">Completed</span>
        </Card>
        <Card className="stat">
          <span className="value">{counts.inProgress}</span>
          <span className="label">In progress</span>
        </Card>
        <Card className="stat">
          <span className="value">{counts.missed + counts.cancelled}</span>
          <span className="label">Missed or cancelled</span>
        </Card>
      </CardGrid>

      {unmarked > 0 && (
        <p className="notice notice-warn">
          <span aria-hidden="true">!</span>
          <span>
            <strong>{unmarked}</strong> student place{unmarked === 1 ? "" : "s"} on completed
            sessions still have no attendance recorded.{" "}
            <Link href="/sessions?status=completed">Review completed sessions</Link>.
          </span>
        </p>
      )}

      <Card>
        <h2>Today&rsquo;s schedule</h2>
        {todayRows.length > 0 ? (
          <TableWrap caption="Sessions scheduled today">
            <thead>
              <tr>
                <th scope="col">Time</th>
                <th scope="col">Session</th>
                <th scope="col">Instructor</th>
                <th scope="col">Students</th>
                <th scope="col">Status</th>
              </tr>
            </thead>
            <tbody>
              {todayRows.map((row) => (
                <tr key={String(row.session.id)}>
                  <td data-label="Time">
                    <WhenTime
                      instant={row.session.scheduledStart}
                      zone={row.session.timezone}
                    />
                  </td>
                  <td data-label="Session">
                    <Link href={`/sessions/${row.session.ref}`}>{row.session.title}</Link>
                  </td>
                  <td data-label="Instructor">{row.instructorName ?? "—"}</td>
                  <td data-label="Students">{row.studentNames.join(", ") || "—"}</td>
                  <td data-label="Status">
                    <StatusBadge status={row.session.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            heading="Nothing scheduled today"
            message="Sessions booked for today will appear here."
            glyph="◷"
          />
        )}
      </Card>

      <Card>
        <h2>Coming up</h2>
        {upcomingRows.length > 0 ? (
          <TableWrap caption="The next scheduled sessions">
            <thead>
              <tr>
                <th scope="col">When</th>
                <th scope="col">Session</th>
                <th scope="col">Instructor</th>
                <th scope="col">Length</th>
              </tr>
            </thead>
            <tbody>
              {upcomingRows.map((row) => (
                <tr key={String(row.session.id)}>
                  <td data-label="When">
                    <When instant={row.session.scheduledStart} zone={row.session.timezone} />
                  </td>
                  <td data-label="Session">
                    <Link href={`/sessions/${row.session.ref}`}>{row.session.title}</Link>
                    {row.seriesPosition && <Tag>{row.seriesPosition}</Tag>}
                  </td>
                  <td data-label="Instructor">{row.instructorName ?? "—"}</td>
                  <td data-label="Length">
                    {durationLabel(scheduledDurationMinutes(row.session))}
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            heading="Nothing coming up"
            message="Future sessions will be listed here once they are booked."
            glyph="▤"
          />
        )}
      </Card>
    </>
  );
}
