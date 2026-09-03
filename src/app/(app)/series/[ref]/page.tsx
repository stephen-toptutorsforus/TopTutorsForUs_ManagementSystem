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

import Link from "next/link";
import { notFound } from "next/navigation";

import { EmptyState, StatusBadge, When } from "@/components/ui";
import { prisma } from "@/lib/db";
import { scoped } from "@/lib/policies/scoping";
import { WEEKDAY_LABELS, durationLabel, percent } from "@/lib/presentation";
import { actualDurationMinutes } from "@/lib/services/sessionOps";
import { decorate, visibleSessions } from "@/lib/services/sessionQuery";
import { dateFromDb, timeFromDb } from "@/lib/time";
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

  const rows = await decorate(prisma, occurrences);
  const weekdays = (series.weekdays as string[] | null) ?? [];

  return (
    <>
      <div className="page-head">
        <div>
          <h1>{series.title}</h1>
          <p className="subtitle">
            {rows.length} session{rows.length === 1 ? "" : "s"} ·{" "}
            {weekdays.map((day) => (
              <span className="tag" key={day}>
                {WEEKDAY_LABELS[day] ?? day}
              </span>
            ))}{" "}
            at {timeFromDb(series.startTime)} <span className="tag">{series.timezone}</span>
          </p>
        </div>
        <Link className="btn" href="/series">
          Back to series
        </Link>
      </div>

      <div className="card">
        <h2>Rule</h2>
        <dl className="definition">
          <dt>Repeats</dt>
          <dd>
            {series.frequency.charAt(0) + series.frequency.slice(1).toLowerCase()}
            {series.intervalN > 1 && <>, every {series.intervalN}</>}
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
          The rule holds the defaults this series was generated from. Each session below
          owns its own schedule — editing one does not change the others.
        </p>
      </div>

      <div className="card">
        <h2>Sessions</h2>
        {rows.length > 0 ? (
          <div className="table-wrap">
            <table>
              <caption className="visually-hidden">
                Sessions generated from this series
              </caption>
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">When</th>
                  <th scope="col">Status</th>
                  <th scope="col">Attendance</th>
                  <th scope="col">Actual length</th>
                  <th scope="col">
                    <span className="visually-hidden">Actions</span>
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
                        <span className="tag" title="Edited on its own">
                          detached
                        </span>
                      )}
                    </td>
                    <td data-label="Status">
                      <StatusBadge status={row.session.status} />
                    </td>
                    <td data-label="Attendance">{percent(row.attendanceRate)}</td>
                    <td data-label="Actual length">
                      {durationLabel(actualDurationMinutes(row.session))}
                    </td>
                    <td data-label="Actions">
                      <Link className="btn btn-small" href={`/sessions/${row.session.ref}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <EmptyState
            heading="No sessions in this series"
            message="Every occurrence has been archived."
            glyph="⟳"
          />
        )}
      </div>
    </>
  );
}
