/**
 * One series: its rule, and every session generated from it.
 *
 * Ported from `series_detail` in `app/web/views.py` and
 * `app/templates/sessions/series_detail.html`.
 *
 * The occurrence list is narrowed by who this person is, not only by which
 * tenant they are in. `scoped` answers "same organization", which every
 * signed-in student satisfies — so the page would otherwise hand out a series
 * they had nothing to do with, its recurrence rule, and every occurrence's
 * date, status and attendance. `visibleSessions` is the clause the session list
 * already uses, so the two cannot disagree about what this person may see.
 */

import { notFound } from "next/navigation";

import { Card, EmptyState, LinkButton, PageHeader, StatusBadge, TableWrap, Tag, VisuallyHidden, When } from "@/components/ui";
import { prisma } from "@/lib/db";
import { scoped } from "@/lib/policies/scoping";
import { WEEKDAY_LABELS, durationLabel, percent } from "@/lib/presentation";
import { actualDurationMinutes } from "@/lib/services/sessionOps";
import { decorate, scheduleOf, visibleSessions } from "@/lib/services/sessionQuery";
import { dateFromDb } from "@/lib/time";
import { requireContext } from "@/lib/web/session";

export const dynamic = "force-dynamic";

export default async function SeriesDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const { principal } = await requireContext();

  const series = await prisma.sessionSeries.findFirst({
    where: { ...scoped(principal), ref, archivedAt: null },
  });
  if (series === null) notFound();

  const occurrences = await prisma.sessionOccurrence.findMany({
    where: { ...visibleSessions(principal), seriesId: series.id },
    orderBy: { scheduledStart: "asc" },
  });
  // 404 rather than 403: a refusal that distinguishes "not yours" from "no such
  // series" confirms the series exists, which is the disclosure this prevents.
  if (occurrences.length === 0) notFound();

  const rows = await decorate(prisma, principal, occurrences);
  // What the run actually does, rather than what its template says. The
  // template can only hold one start time and one length, so a series whose
  // weekdays carry their own is described by nothing but its occurrences —
  // and this is the screen with room to say it a weekday at a time.
  const schedule = scheduleOf(occurrences, series.timezone);

  return (
    <>
      <PageHeader title={series.title} />

      <Card>
        <h2>Rule</h2>
        <dl className="definition">
          <dt>Repeats</dt>
          <dd>
            {series.frequency.charAt(0) + series.frequency.slice(1).toLowerCase()}
            {series.intervalN > 1 && <>, every {series.intervalN}</>}
          </dd>
          <dt>Runs</dt>
          <dd>
            {schedule.byWeekday.length === 0
              ? "—"
              : schedule.byWeekday
                  .map(
                    (day) =>
                      `${WEEKDAY_LABELS[day.weekday] ?? day.weekday} ` +
                      `${day.startTimes.join(", ")} for ` +
                      `${day.durations.map((minutes) => durationLabel(minutes)).join(", ")}`,
                  )
                  .join(" · ")}{" "}
            <Tag>{series.timezone}</Tag>
          </dd>
          <dt>Ends</dt>
          <dd>
            {series.endMode === "COUNT"
              ? `after ${series.occurrenceCount} session(s)`
              : `on ${series.untilDate ? dateFromDb(series.untilDate) : "—"}`}
          </dd>
          <dt>Default length</dt>
          <dd>{durationLabel(series.defaultDurationMinutes)}</dd>
          <dt>Reference</dt>
          <dd>
            <code>{series.ref}</code>
          </dd>
        </dl>
        <p className="hint">
          The rule holds the defaults this series was generated from; Runs is read back
          from the sessions themselves. Each session below owns its own schedule —
          editing one does not change the others, and neither changes the rule.
        </p>
      </Card>

      <Card>
        <h2>Sessions</h2>
        {rows.length > 0 ? (
          <TableWrap caption="Sessions generated from this series">
            <thead>
              <tr>
                <th scope="col">#</th>
                <th scope="col">When</th>
                <th scope="col">Status</th>
                <th scope="col">Attendance</th>
                <th scope="col">Actual length</th>
                <th scope="col">
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={String(row.session.id)}>
                  <td data-label="#">{row.session.seriesIndex ?? "—"}</td>
                  <td data-label="When">
                    <When
                      instant={row.session.scheduledStart}
                      zone={row.session.timezone}
                    />
                    {row.session.detachedFromSeries && (
                      <Tag title="Edited on its own">
                        detached
                      </Tag>
                    )}
                  </td>
                  <td data-label="Status">
                    <StatusBadge status={row.session.status} endsAt={row.session.scheduledEnd} />
                  </td>
                  <td data-label="Attendance">{percent(row.attendanceRate)}</td>
                  <td data-label="Actual length">
                    {durationLabel(actualDurationMinutes(row.session))}
                  </td>
                  <td data-label="Actions">
                    <LinkButton size="small" href={`/sessions/${row.session.ref}`}>
                      Open
                    </LinkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            heading="No sessions in this series"
            message="Every occurrence has been archived."
            glyph="⟳"
          />
        )}
      </Card>
    </>
  );
}
