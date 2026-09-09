/**
 * The series list.
 *
 * Ported from `series_grid` in `app/web/views.py` and
 * `app/templates/sessions/series_grid.html`. The counts are how a series
 * actually turned out — scheduled, completed, missed, cancelled, late — which
 * is the question somebody opens this page to ask.
 */

import Link from "next/link";

import { Card, EmptyState, PageHeader, TableWrap, Tag } from "@/components/ui";
import { prisma } from "@/lib/db";
import { WEEKDAY_LABELS, durationLabel } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import { listSeries } from "@/lib/services/sessionQuery";
import { timeFromDb } from "@/lib/time";
import { requireContext } from "@/lib/web/session";

export const metadata = { title: "Series · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function SeriesPage() {
  const { principal } = await requireContext();
  const zone = principal.timezone;
  const rows = await listSeries(prisma, principal);

  return (
    <>
      <PageHeader
        title="Series"
        
      />

      {rows.length > 0 ? (
        <TableWrap caption="Recurring session series">
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Runs</th>
              <th scope="col">Instructor</th>
              <th scope="col">Weekdays</th>
              <th scope="col">Start time</th>
              <th scope="col">Length</th>
              <th scope="col" className="numeric">Total</th>
              <th scope="col" className="numeric">Scheduled</th>
              <th scope="col" className="numeric">Completed</th>
              <th scope="col" className="numeric">Missed</th>
              <th scope="col" className="numeric">Cancelled</th>
              <th scope="col" className="numeric">Late</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const series = row.series;
              const weekdays = (series.weekdays as string[] | null) ?? [];
              return (
                <tr key={String(series.id)}>
                  <td data-label="Title">
                    <Link href={`/series/${series.ref}`}>{series.title}</Link>
                  </td>
                  <td data-label="Runs">
                    {row.firstDate && row.lastDate ? (
                      <>
                        {new Moment(row.firstDate, series.timezone).date} →{" "}
                        {new Moment(row.lastDate, series.timezone).date}
                      </>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td data-label="Instructor">{row.instructorName ?? "—"}</td>
                  <td data-label="Weekdays">
                    {weekdays.length > 0
                      ? weekdays.map((day) => <Tag key={day}>{WEEKDAY_LABELS[day] ?? day}</Tag>)
                      : "—"}
                  </td>
                  <td data-label="Start time">
                    {timeFromDb(series.startTime)} <Tag>{series.timezone}</Tag>
                  </td>
                  <td data-label="Length">{durationLabel(series.defaultDurationMinutes)}</td>
                  <td data-label="Total" className="numeric">{row.total}</td>
                  <td data-label="Scheduled" className="numeric">{row.scheduled}</td>
                  <td data-label="Completed" className="numeric">{row.completed}</td>
                  <td data-label="Missed" className="numeric">{row.missed}</td>
                  <td data-label="Cancelled" className="numeric">{row.cancelled}</td>
                  <td data-label="Late" className="numeric">{row.late}</td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <EmptyState
            heading="No series yet"
            message="Book a session with Repeat ticked and it will appear here."
            glyph="⟳"
          />
        </Card>
      )}
    </>
  );
}
