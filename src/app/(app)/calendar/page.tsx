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

import { FilterMenu } from "@/components/FilterMenu";
import { TimeGridView } from "@/components/calendar/TimeGridView";
import { Button, Card, Choice, ChoiceGroup, EmptyState, Field, FilterControl, FilterSection, Hint, LinkButton, PageHeader, PageToolbar, SearchField, StatusBadge, TableWrap, VisuallyHidden, WhenTime } from "@/components/ui";
import {
  CalendarView,
  MONTH_CELL_LIMIT,
  activeCalendarFilters,
  buildWindow,
  parseAnchor,
  parseView,
} from "@/lib/calendar";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { applyCalendarState, resetCalendarFilters } from "@/app/actions/filters";
import { CALENDAR_FORM, GoTo } from "@/components/calendar/GoTo";
import { StateFields } from "@/components/ui/StateFields";
import { readScreenState } from "@/lib/web/filterState";
import { statusFilterOptions, statusMeta } from "@/lib/presentation";
import { ticked } from "@/lib/selection";
import { Moment } from "@/lib/rendering";
import { calendarRange, parseFilters, type SessionRow } from "@/lib/services/sessionQuery";
import { build } from "@/lib/timegrid";
import { type CivilDate, civilDate, isoWeekday } from "@/lib/time";
import { requireContext } from "@/lib/web/session";


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

/**
 * Nothing here reads `searchParams`.
 *
 * The screen's filter arrives from its cookie — see `lib/web/filterState.ts`.
 * A page that still took the address as an input would be a second source for
 * the same state, and the two would disagree the moment anybody typed one.
 */
export default async function CalendarPage() {
  const { principal } = await requireContext();
  const zone = principal.timezone;
  const today = civilDate(new Date(), zone);

  // The whole screen's state — view, date, search, statuses — from the cookie
  // rather than the address. A bare `/calendar` therefore shows what somebody
  // last chose without a redirect to spell it out, which is what the old
  // remembered-status cookie and its restore hop existed to fake.
  const state = await readScreenState("calendar");
  const view = parseView(state.get("view"));
  const anchor = parseAnchor(state.get("date"), today);
  const window = buildWindow(view, anchor);
  const filters = parseFilters(state);

  /**
   * The range, as hidden fields.
   *
   * Every form on this screen carries it: the week somebody is reading is not
   * something they filtered by, so changing a status must not send them back to
   * this month. Absent when it is already the default, because that is what its
   * absence means to the parsers.
   */
  const rangeFields = (
    <>
      {view !== CalendarView.MONTH && <input type="hidden" name="view" value={view} />}
      {window.anchor !== today && (
        <input type="hidden" name="date" value={window.anchor} />
      )}
    </>
  );

  const buckets = await calendarRange(prisma, principal, {
    first: window.first,
    last: window.last,
    zone,
    filters,
  });
  const total = [...buckets.values()].reduce((sum, rows) => sum + rows.length, 0);


  const isGrid = view === CalendarView.WEEK || view === CalendarView.DAY;
  const grid = isGrid ? build(buckets, window.days, zone) : null;

  return (
    <>
      {/* The one form every control on this screen submits into: the arrows,
          the view switcher, Today, each day number and each "+N more". It
          carries the state they are changing *from*; a button adds the one
          `goto_` field that says what to change. Declared once and reached by
          `form=`, because a form per day cell is forty-two forms on a month. */}
      <form id={CALENDAR_FORM} action={applyCalendarState} hidden>
        <StateFields state={state} />
      </form>

      <PageHeader
        title="Calendar"
        toolbar={
          // Keyed by the filter that is applied, so the search box and the
          // status menu are remounted when it changes. Their fields are
          // uncontrolled — `defaultValue`, `defaultChecked` — and a re-render
          // from a server action leaves the DOM values a person typed exactly
          // where they were, which is right until the *other* form changes
          // them. Applying from the drawer used to be a navigation, which
          // rebuilt both.
          <PageToolbar
            key={state.toString()}
            menu={
              <FilterControl
                active={activeCalendarFilters(filters)}
                reset={resetCalendarFilters}
                resetFields={rangeFields}
                action={applyCalendarState}
              >
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
              </FilterControl>
            }
            form={{
              action: applyCalendarState,
              label: "Filter the calendar",
              role: "search",
            }}
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
        secondary={
          <>
            {/* The range being shown sits between the two arrows that move it,
                so the label and the controls that change it read as one
                thing. */}
            <nav className="cal-nav" aria-label="Change date range">
              <GoTo className="btn btn-small" date={window.previous}>
                <span aria-hidden="true">‹</span>
                <VisuallyHidden>Previous {view}</VisuallyHidden>
              </GoTo>
              <h2 className="cal-heading">{window.heading}</h2>
              <GoTo className="btn btn-small" date={window.following}>
                <span aria-hidden="true">›</span>
                <VisuallyHidden>Next {view}</VisuallyHidden>
              </GoTo>
            </nav>

            {/* Today shares the group because that is where it is looked for, but
                it is a jump rather than a view: it never takes `aria-current`, and
                it keeps its own accessible name so it is not read as a fifth way of
                showing the calendar. */}
            <div className="cal-views" role="group" aria-label="Calendar view and date">
              {Object.values(CalendarView).map((option) => (
                <GoTo
                  key={option}
                  className={`cal-view ${option === view ? "is-current" : ""}`}
                  view={option}
                  ariaCurrent={option === view}
                >
                  {option.charAt(0).toUpperCase() + option.slice(1)}
                </GoTo>
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
                <GoTo
                  className={`cal-view cal-view-today ${
                    window.anchor === today ? "is-on-today" : ""
                  }`}
                  date={today}
                >
                  Today
                  <VisuallyHidden>— show today</VisuallyHidden>
                </GoTo>
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
                  <GoTo className="cal-daynum-link" date={day}>
                    <span aria-hidden="true">{dayNumber(day)}</span>
                  </GoTo>
                  {day === today && <VisuallyHidden>(today)</VisuallyHidden>}
                </p>
                {rows.slice(0, MONTH_CELL_LIMIT).map((row) => (
                  <EventLink key={String(row.session.id)} row={row} />
                ))}
                {rows.length > MONTH_CELL_LIMIT && (
                  <GoTo className="cal-more" date={day}>
                    +{rows.length - MONTH_CELL_LIMIT} more
                    <VisuallyHidden> on {longDate(day)}</VisuallyHidden>
                  </GoTo>
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
                    <GoTo className="cal-list-day-link" date={day}>
                      {longDate(day)}
                    </GoTo>
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
