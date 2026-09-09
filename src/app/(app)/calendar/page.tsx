/**
 * Month, week, day, and list, over one query and one set of filters.
 *
 * Ported from `calendar_page` in `app/web/views.py` and
 * `app/templates/sessions/calendar.html`.
 *
 * The whole screen's state — view, date, search text, statuses — lives in the
 * URL, so it survives a refresh, a back button, and being sent to a colleague.
 * It says no more than it has to: `lib/urlState.ts` holds the rule, and
 * `lib/calendar.ts` what it means here.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { FilterMenu } from "@/components/FilterMenu";
import { TimeGridView } from "@/components/calendar/TimeGridView";
import { Button, Card, Choice, ChoiceGroup, EmptyState, Field, FilterActions, FilterDrawer, FilterSection, Hint, LinkButton, PageHeader, PageToolbar, SearchField, StatusBadge, TableWrap, VisuallyHidden, WhenTime } from "@/components/ui";
import {
  CalendarView,
  MONTH_CELL_LIMIT,
  activeCalendarFilters,
  buildWindow,
  calendarLink,
  canonicalLink,
  carriesState,
  narrowsByStatus,
  parseAnchor,
  parseView,
  readStatuses,
  restoredLink,
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { statusFilterOptions, statusMeta } from "@/lib/presentation";
import { ticked } from "@/lib/selection";
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
    // A remembered set covering every status is not a filter. Restoring one
    // would redirect to an address the tidying below strips straight back to
    // `/calendar`, and the two would trade the request between them for ever.
    if (narrowsByStatus(remembered)) redirect(restoredLink(remembered));
  }

  const view = parseView(params.get("view"));
  const anchor = parseAnchor(params.get("date"), today);
  const window = buildWindow(view, anchor);
  const filters = parseFilters(params);

  // Where a reset goes: through the route that *forgets* the remembered status,
  // because a bare `/calendar` is what restores it. `keepSearch` is the
  // difference between widening the status filter and clearing the lot.
  const resetLink = (options: { keepSearch: boolean }) => {
    const back = new URLSearchParams();
    if (view !== CalendarView.MONTH) back.set("view", view);
    if (window.anchor !== today) back.set("date", window.anchor);
    if (options.keepSearch && filters.search) back.set("q", filters.search);
    return back.size > 0 ? `/calendar/reset?${back}` : "/calendar/reset";
  };

  // A status parameter that narrows nothing is somebody asking for everything —
  // by ticking the last box, or through "Select all". Tidying alone would send
  // them to a bare `/calendar`, which is precisely what restores the remembered
  // filter they had just widened out of, and they would watch it come back. So
  // it goes the way the reset menu item goes: forget, then land. The search
  // text is not what they widened, so it stays.
  //
  // No loop: the address this leads to carries no `status`, so it cannot arrive
  // here again.
  if (params.has("status") && !narrowsByStatus(filters.statuses)) {
    redirect(resetLink({ keepSearch: true }));
  }

  // Whatever produced this address — a link, the filter form, a cookie restore,
  // or something typed by hand — the bar ends up showing the least that still
  // says what is on screen.
  const tidy = canonicalLink(params, { filters, view, anchor: window.anchor, today });
  if (tidy !== null) redirect(tidy);

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
    calendarLink(filters, { ...options, today });

  // "Select all" — one gesture back to the resting state after unticking a few.
  // Not a link to the unfiltered calendar: that is a bare `/calendar`, which
  // would restore the very filter this is asking to be rid of. It forgets it
  // instead, and keeps the search text, which is a different filter.
  const allStatuses = resetLink({ keepSearch: true });

  // "Reset filter" — the lot, search included. The range is not among it: the
  // week somebody is reading is not something they asked to filter by, so it
  // rides along.
  const unfiltered = resetLink({ keepSearch: false });

  const isGrid = view === CalendarView.WEEK || view === CalendarView.DAY;
  const grid = isGrid ? build(buckets, window.days, zone) : null;

  return (
    <>
      {/* Keep the status filter for the next bare visit, or forget it. */}
      <StatusCookieWriter statuses={filters.statuses.map((s) => s.toLowerCase())} />

      <PageHeader
        title="Calendar"
        toolbar={
          <PageToolbar
            menu={
              <FilterActions
                active={activeCalendarFilters(filters)}
                resetHref={unfiltered}
              />
            }
            form={{ action: "/calendar", label: "Filter the calendar", role: "search" }}
            filters={
              <>
                {/* Neither the month nor today needs a hidden field: each is
                    what its own absence already means, and submitting it would
                    only be tidied straight back out of the address. */}
                {view !== CalendarView.MONTH && (
                  <input type="hidden" name="view" value={view} />
                )}
                {window.anchor !== today && (
                  <input type="hidden" name="date" value={window.anchor} />
                )}

                <SearchField
                  label="Search session titles"
                  placeholder="Session title"
                  defaultValue={filters.search}
                />

                <FilterMenu
                  name="status"
                  options={statusFilterOptions()}
                  selected={filters.statuses.map((status) => status.toLowerCase())}
                  singular="status"
                  plural="statuses"
                  legend="Show these statuses"
                  allLink={allStatuses}
                />

                {/* The menu applies itself on close, so there is no Apply
                    button. Without JavaScript nothing would submit the form, so
                    the button comes back for that case rather than the page
                    quietly not working. */}
                <noscript>
                  <Button type="submit">
                    Apply
                  </Button>
                </noscript>
              </>
            }
            actions={
              principal.has(Permission.SESSION_BOOK) ? (
                <LinkButton variant="primary" href="/sessions/new">
                  <span aria-hidden="true">＋</span> Book Session
                </LinkButton>
              ) : undefined
            }
          />
        }
        drawer={
          <FilterDrawer action="/calendar" resetHref={unfiltered}>
            {/* The range travels with the filter. Without these the drawer's
                Apply would submit a bare `/calendar` and drop somebody back on
                this month, having asked only to change a status — except where
                the range is already the default, which is what its absence
                means. */}
            {view !== CalendarView.MONTH && (
              <input type="hidden" name="view" value={view} />
            )}
            {window.anchor !== today && (
              <input type="hidden" name="date" value={window.anchor} />
            )}

            <FilterSection legend="Sessions">
              <Field id="filter-q" label="Search session titles">
                <input
                  id="filter-q"
                  name="q"
                  type="search"
                  defaultValue={filters.search}
                  placeholder="Session title"
                />
              </Field>

              <ChoiceGroup
                legend="Status"
                hint={<p className="hint">Untick a status to hide it.</p>}
              >
                {statusFilterOptions().map((option) => (
                  <Choice
                    key={option.value}
                    type="checkbox"
                    name="status"
                    value={option.value}
                    defaultChecked={ticked(
                      filters.statuses.map((status) => status.toLowerCase()),
                      option.value,
                    )}
                    label={option.label}
                  />
                ))}
              </ChoiceGroup>
            </FilterSection>
          </FilterDrawer>
        }
        secondary={
          <>
            {/* The range being shown sits between the two arrows that move it,
                so the label and the controls that change it read as one
                thing. */}
            <nav className="cal-nav" aria-label="Change date range">
              <LinkButton size="small"
                rel="prev"
                href={link({ view, anchor: window.previous })}
              >
                <span aria-hidden="true">‹</span>
                <VisuallyHidden>Previous {view}</VisuallyHidden>
              </LinkButton>
              <h2 className="cal-heading">{window.heading}</h2>
              <LinkButton size="small"
                rel="next"
                href={link({ view, anchor: window.following })}
              >
                <span aria-hidden="true">›</span>
                <VisuallyHidden>Next {view}</VisuallyHidden>
              </LinkButton>
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
                  href={link({ view: option, anchor: window.anchor })}
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
                  href={link({ view: "day", anchor: today })}
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
          </>
        }
      />

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
                  <Link href={link({ view: "day", anchor: day })} aria-hidden="true">
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
                    href={link({ view: "day", anchor: day })}
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
          linkFor={(day) => link({ view: "day", anchor: day })}
        />
      )}

      {view === CalendarView.LIST && (
        <Card>
          {total > 0 ? (
            window.days.map((day) => {
              const rows = buckets.get(day) ?? [];
              if (rows.length === 0) return null;
              return (
                <div key={day}>
                  <h3 className="cal-list-day">
                    <Link href={link({ view: "day", anchor: day })}>
                      {longDate(day)}
                    </Link>
                    <Hint>
                      {rows.length} session{rows.length === 1 ? "" : "s"}
                    </Hint>
                  </h3>
                  <TableWrap caption={<>Sessions on {longDate(day)}</>}>
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
                  </TableWrap>
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
        </Card>
      )}
    </>
  );
}
