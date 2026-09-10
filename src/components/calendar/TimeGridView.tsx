/**
 * The week and day views: dates across the top, time down the side.
 *
 * Ported from the time-grid block of `app/templates/sessions/calendar.html`.
 *
 * One CSS grid rather than a grid of grids, so every column shares the same
 * rows — a column whose rows meant different times from its neighbour's would
 * defeat the only thing this view is for. Positions arrive as classes, never as
 * inline styles: `style-src 'self'` forbids those, and widening the policy for
 * layout would be the wrong trade.
 */

import Link from "next/link";

import { Card, EmptyState, VisuallyHidden } from "@/components/ui";
import { statusMeta } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import { type CivilDate, isoWeekday } from "@/lib/time";
import { type TimeGrid, gridIsEmpty, positionClass } from "@/lib/timegrid";

import { GoTo } from "./GoTo";
import { ScrollToRow } from "./ScrollToRow";

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function TimeGridView({
  grid,
  days,
  today,
}: {
  grid: TimeGrid;
  days: readonly CivilDate[];
  today: CivilDate;
}) {
  return (
    <Card className="cal-grid-card">
      {/* The whole day is rendered and scrolls. The row named here is only
          where the scroll starts — the client nudges it there so an ordinary
          session is not below the fold on load. Without it the pane opens at
          midnight and scrolls, which works, just less kindly. */}
      <div
        className="cal-timegrid-scroll"
        data-scroll-to-row={grid.focusRow}
        tabIndex={0}
        role="region"
        aria-label="Session times, scrollable"
      >
        <ScrollToRow />
        <div
          className={`cal-timegrid ${days.length === 1 ? "is-single" : ""}`}
          role="grid"
          aria-label="Sessions by date and time"
        >
          <div className="tg-corner" aria-hidden="true" />

          {days.map((day, index) => (
            <h3
              key={`head-${day}`}
              className={`tg-dayhead c${index + 1} ${day === today ? "is-today" : ""}`}
            >
              {/* A submit into the calendar's own form, not a link: the day
                  it moves to is state this screen holds rather than an address
                  it goes to. See `components/calendar/GoTo.tsx`. */}
              <GoTo className="tg-dayhead-link" date={day}>
                <span className="tg-dow">{DOW_SHORT[isoWeekday(day) - 1]}</span>
                <span className="tg-dom">{Number(day.slice(8, 10))}</span>
                {day === today && <VisuallyHidden>(today)</VisuallyHidden>}
              </GoTo>
            </h3>
          ))}

          {/* One rule per day column, drawn behind everything, so the days are
              separated without wrapping each in an element that would take the
              sessions out of the shared grid. */}
          {days.map((day, index) => (
            <div
              key={`rule-${day}`}
              className={`tg-colrule c${index + 1} ${day === today ? "is-today" : ""}`}
              aria-hidden="true"
            />
          ))}

          {/* Every slot rules a line across the columns, which is also what
              gives the grid its full height when a column happens to be empty.
              Only the hours are labelled — a label every half hour is noise. */}
          {grid.slots.map((slot) => (
            <div
              key={`line-${slot.row}`}
              className={`tg-line r${slot.row} ${slot.isHour ? "is-hour" : ""}`}
              aria-hidden="true"
            />
          ))}
          {grid.slots
            .filter((slot) => slot.isHour)
            .map((slot) => (
              <span key={`time-${slot.row}`} className={`tg-time r${slot.row}`} aria-hidden="true">
                {slot.label}
              </span>
            ))}

          {grid.columns.flatMap((column, columnIndex) =>
            column.placed.map((item) => {
              const session = item.row.session;
              const meta = statusMeta(session.status);
              const start = new Moment(session.scheduledStart, session.timezone);
              const end = new Moment(session.scheduledEnd, session.timezone);
              return (
                <Link
                  key={String(session.id)}
                  className={`tg-event is-${session.status.toLowerCase()} c${columnIndex + 1} ${positionClass(item)}`}
                  href={`/sessions/${session.ref}`}
                >
                  <span className="tg-event-time">{start.time}</span>
                  <span className="tg-event-title">{session.title}</span>
                  {item.span > 2 && item.lanes === 1 && (
                    <span className="tg-event-who">
                      {item.row.instructorName ?? "No instructor"}
                      {item.row.studentNames.length > 0 && (
                        <> · {item.row.studentNames.join(", ")}</>
                      )}
                    </span>
                  )}
                  <span className={`tg-event-flag badge-${meta.tone}`} aria-hidden="true">
                    {meta.icon}
                  </span>
                  <VisuallyHidden>
                    — {session.title}, {meta.label}, {start.full} to {end.time}
                  </VisuallyHidden>
                </Link>
              );
            }),
          )}
        </div>
      </div>

      {gridIsEmpty(grid) && (
        <EmptyState
          heading="Nothing scheduled"
          message="Sessions booked in this range will appear on the grid above."
          glyph="◷"
        />
      )}
    </Card>
  );
}
