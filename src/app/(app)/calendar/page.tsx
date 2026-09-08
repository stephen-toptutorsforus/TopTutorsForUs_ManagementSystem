/**
 * Month, week, day, and list, over one query and one set of filters.
 *
 * Ported from `calendar_page` in `app/web/views.py` and
 * `app/templates/sessions/calendar.html`.
 *
 * The whole screen's state — view, date, search text, statuses — lives in the
 * URL, so it survives a refresh, a back button, and being sent to a colleague.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { FilterMenu } from "@/components/FilterMenu";
import { TimeGridView } from "@/components/calendar/TimeGridView";
import { EmptyState, Hint, StatusBadge, VisuallyHidden, WhenTime } from "@/components/ui";
import { SessionStatus } from "@/generated/prisma/enums";
import {
  CalendarView,
  MONTH_CELL_LIMIT,
  buildWindow,
  carriesState,
  parseAnchor,
  parseView,
  queryString,
  readStatuses,
  restoredLink,
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { statusFilterOptions, statusMeta } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import { calendarRange, parseFilters, type SessionRow } from "@/lib/services/sessionQuery";
import { build } from "@/lib/timegrid";
import { type CivilDate, civilDate, isoWeekday } from "@/lib/time";
import { requireContext, statusCookie } from "@/lib/web/session";

import { toSearchParams } from "../sessions/page";
import { StatusCookieWriter } from "./StatusCookieWriter";

export const metadata = { title: "Calendar · TopTutorsForUs" };
export const dynamic = "force-dynamic";

const DOW_LONG = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

function longDate(day: CivilDate): string {
  const [, month, dayOfMonth] = day.split("-");
  return `${DOW_LONG[isoWeekday(day) - 1]} ${dayOfMonth} ${MONTHS[Number(month) - 1]}`;
}

function dayNumber(day: CivilDate): number {
  return Number(day.slice(8, 10));
}

function monthOf(day: CivilDate): string {
  return day.slice(0, 7);
}

/** One event chip in a month cell or a list. */
function EventLink({ row, showNames = true }: { row: SessionRow; showNames?: boolean }) {
  const session = row.session;
  const meta = statusMeta(session.status);
  const moment = new Moment(session.scheduledStart, session.timezone);

  return (
    <Link
      className={`cal-event is-${session.status.toLowerCase()}`}
      href={`/sessions/${session.ref}`}
    >
      <span className="cal-time">{moment.time}</span>
      <span className="cal-label">
        {showNames && (row.instructorName || row.studentNames.length > 0) ? (
          <>
            {row.instructorName ?? "—"}
            {row.studentNames.length > 0 && <> &amp; {row.studentNames.join(", ")}</>}
          </>
        ) : (
          session.title
        )}
      </span>
      {/* The status travels as a glyph and, for a screen reader, as a word —
          the swatch colour is never the only signal. */}
      <span className={`cal-flag badge-${meta.tone}`} aria-hidden="true">
        {meta.icon}
      </span>
      <VisuallyHidden>
        — {session.title}, {meta.label}, {moment.full}
      </VisuallyHidden>
    </Link>
  );
}

export default async function CalendarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal } = await requireContext();
  const zone = principal.timezone;
  const today = civilDate(new Date(), zone);
  const params = toSearchParams(await searchParams);

  // A bare `/calendar` — which is what the sidebar link is — says nothing about
  // the status filter, so the last one chosen is restored and the person is
  // sent on to the URL that spells it out. See `lib/calendar.ts` for why this
  // is a redirect rather than a quiet filter.
  if (!carriesState(params)) {
    const remembered = readStatuses(await statusCookie());
    if (remembered.length > 0) redirect(`/calendar?${restoredLink(remembered)}`);
  }

  const view = parseView(params.get("view"));
  const anchor = parseAnchor(params.get("date"), today);
  const window = buildWindow(view, anchor);
  const filters = parseFilters(params);

  const buckets = await calendarRange(prisma, principal, {
    first: window.first,
    last: window.last,
    zone,
    filters,
  });
  const total = [...buckets.values()].reduce((sum, rows) => sum + rows.length, 0);

  // Every link on the page is built through this, so none of them can drop part
  // of the state by forgetting a parameter.
  const link = (options: { view: CalendarView | string; anchor?: CivilDate | null }) =>
    queryString(filters, options);

  const allStatuses = queryString(
    { search: filters.search, statuses: Object.values(SessionStatus) },
    { view, anchor },
  );
  const noStatuses = queryString(
    { search: filters.search, statuses: [] },
    { view, anchor },
  );

  const isGrid = view === CalendarView.WEEK || view === CalendarView.DAY;
  const grid = isGrid ? build(buckets, window.days, zone) : null;

  return (
    <>
      {/* Keep the status filter for the next bare visit, or forget it. */}
      <StatusCookieWriter statuses={filters.statuses.map((s) => s.toLowerCase())} />

      <div className="page-head">
        <div>
          <h1>Calendar</h1>
          <p className="subtitle">
            {total} session{total === 1 ? "" : "s"} in view · times in {zone}
          </p>
        </div>
      </div>

      <div className="cal-toolbar">
        <form className="cal-filters" method="get" action="/calendar" role="search">
          <input type="hidden" name="view" value={view} />
          <input type="hidden" name="date" value={window.anchor} />

          <div className="field cal-search">
            <label className="visually-hidden" htmlFor="q">
              Search session titles
            </label>
            <input
              id="q"
              name="q"
              type="search"
              defaultValue={filters.search}
              placeholder="Search"
            />
          </div>

          <FilterMenu
            name="status"
            options={statusFilterOptions()}
            selected={filters.statuses.map((status) => status.toLowerCase())}
            singular="status"
            plural="statuses"
            legend="Show these statuses"
            allLink={`/calendar?${allStatuses}`}
            noneLink={`/calendar?${noStatuses}`}
          />

          {/* The menu applies itself on close, so there is no Apply button.
              Without JavaScript nothing would submit the form, so the button
              comes back for that case rather than the page quietly not
              working. */}
          <noscript>
            <button className="btn" type="submit">
              Apply
            </button>
          </noscript>
        </form>

        {principal.has(Permission.SESSION_BOOK) && (
          <Link className="btn btn-primary cal-book" href="/sessions/new">
            <span aria-hidden="true">＋</span> Book Session
          </Link>
        )}
      </div>

      <div className="cal-bar">
        {/* The range being shown sits between the two arrows that move it, so
            the label and the controls that change it read as one thing. */}
        <nav className="cal-nav" aria-label="Change date range">
          <Link
            className="btn btn-small"
            rel="prev"
            href={`/calendar?${link({ view, anchor: window.previous })}`}
          >
            <span aria-hidden="true">‹</span>
            <VisuallyHidden>Previous {view}</VisuallyHidden>
          </Link>
          <h2 className="cal-heading">{window.heading}</h2>
          <Link
            className="btn btn-small"
            rel="next"
            href={`/calendar?${link({ view, anchor: window.following })}`}
          >
            <span aria-hidden="true">›</span>
            <VisuallyHidden>Next {view}</VisuallyHidden>
          </Link>
        </nav>

        {/* Today shares the group because that is where it is looked for, but
            it is a jump rather than a view: it never takes `aria-current`, and
            it keeps its own accessible name so it is not read as a fifth way of
            showing the calendar. */}
        <div className="cal-views" role="group" aria-label="Calendar view and date">
          {Object.values(CalendarView).map((option) => (
            <Link
              key={option}
              className={`cal-view ${option === view ? "is-current" : ""}`}
              href={`/calendar?${link({ view: option, anchor: window.anchor })}`}
              aria-current={option === view ? "true" : undefined}
            >
              {option.charAt(0).toUpperCase() + option.slice(1)}
            </Link>
          ))}
          {/* Today keeps its place at the end of the group in every view, so
              the group does not change width as the view changes and the
              control never moves out from under the pointer. It is only
              *available* in the day view: in month, week, or list the range
              already contains today more often than not, so the button would
              look broken by doing nothing.

              Unavailable is a disabled button rather than a missing one —
              assistive technology announces it as present but unavailable,
              which is the truth, where hiding it would say the control does not
              exist. */}
          {view === CalendarView.DAY ? (
            <Link
              className={`cal-view cal-view-today ${
                window.anchor === today ? "is-on-today" : ""
              }`}
              href={`/calendar?${link({ view: "day", anchor: today })}`}
            >
              Today
              <VisuallyHidden>— show today</VisuallyHidden>
            </Link>
          ) : (
            <button
              type="button"
              className="cal-view cal-view-today is-disabled"
              disabled
              title="Switch to the day view to jump to today"
            >
              Today
              <VisuallyHidden>— available in the day view</VisuallyHidden>
            </button>
          )}
        </div>
      </div>

      {view === CalendarView.MONTH && (
        <div className="cal-month">
          {["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"].map(
            (label) => (
              <div className="cal-dow" aria-hidden="true" key={label}>
                {label.slice(0, 3)}
              </div>
            ),
          )}

          {window.weeks.flat().map((day) => {
            const rows = buckets.get(day) ?? [];
            const outside = monthOf(day) !== monthOf(window.anchor);
            return (
              <div
                key={day}
                className={`cal-cell ${outside ? "is-outside" : ""} ${
                  day === today ? "is-today" : ""
                }`}
              >
                <p className="cal-daynum">
                  <VisuallyHidden>{longDate(day)}</VisuallyHidden>
                  <Link href={`/calendar?${link({ view: "day", anchor: day })}`} aria-hidden="true">
                    {dayNumber(day)}
                  </Link>
                  {day === today && <VisuallyHidden>(today)</VisuallyHidden>}
                </p>
                {rows.slice(0, MONTH_CELL_LIMIT).map((row) => (
                  <EventLink key={String(row.session.id)} row={row} />
                ))}
                {rows.length > MONTH_CELL_LIMIT && (
                  <Link
                    className="cal-more"
                    href={`/calendar?${link({ view: "day", anchor: day })}`}
                  >
                    +{rows.length - MONTH_CELL_LIMIT} more
                    <VisuallyHidden> on {longDate(day)}</VisuallyHidden>
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {isGrid && grid && (
        <TimeGridView
          grid={grid}
          days={window.days}
          today={today}
          linkFor={(day) => `/calendar?${link({ view: "day", anchor: day })}`}
        />
      )}

      {view === CalendarView.LIST && (
        <div className="card">
          {total > 0 ? (
            window.days.map((day) => {
              const rows = buckets.get(day) ?? [];
              if (rows.length === 0) return null;
              return (
                <div key={day}>
                  <h3 className="cal-list-day">
                    <Link href={`/calendar?${link({ view: "day", anchor: day })}`}>
                      {longDate(day)}
                    </Link>
                    <Hint>
                      {rows.length} session{rows.length === 1 ? "" : "s"}
                    </Hint>
                  </h3>
                  <div className="table-wrap">
                    <table>
                      <caption className="visually-hidden">Sessions on {longDate(day)}</caption>
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
                        {rows.map((row) => (
                          <tr key={String(row.session.id)}>
                            <td data-label="Time">
                              <WhenTime
                                instant={row.session.scheduledStart}
                                zone={row.session.timezone}
                              />
                            </td>
                            <td data-label="Session">
                              <Link href={`/sessions/${row.session.ref}`}>
                                {row.session.title}
                              </Link>
                            </td>
                            <td data-label="Instructor">{row.instructorName ?? "—"}</td>
                            <td data-label="Students">
                              {row.studentNames.join(", ") || "—"}
                            </td>
                            <td data-label="Status">
                              <StatusBadge status={row.session.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              );
            })
          ) : (
            <EmptyState
              heading="Nothing in this range"
              message="Try a different month, or clear the search and status filters."
              glyph="≡"
            />
          )}
        </div>
      )}
    </>
  );
}
