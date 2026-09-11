"use client";

/**
 * The availability block, in whichever of its three states applies.
 *
 * Ported from `app/templates/sessions/_availability.html`. Drawn on the first
 * paint and on every live refresh from the same context, so the two cannot
 * drift apart. Every control is a real submit button, so the block works with
 * the script doing nothing but saving the round trip.
 *
 * What this block answers is "does this instructor have a declared window long
 * enough for the whole session". It is deliberately *not* a conflict check —
 * nothing here has looked for a clashing booking, and Preview is what does.
 * Saying more than that would be a promise Preview then has to break.
 *
 * Nor is it an eligibility check. The candidates it was handed have already
 * been filtered to the people who may teach the chosen students, and the two
 * emptinesses are reported in different words on purpose: "nobody may teach
 * them" is a relationship to fix, "nobody is free" is a time to change, and one
 * message for both sends people to look in the wrong place.
 */

import { Button, Hint, VisuallyHidden } from "@/components/ui";
import { clockTime, durationWords } from "@/lib/presentation";
import {
  ELIGIBLE_BUT_UNAVAILABLE,
  noEligibleInstructors,
} from "@/lib/web/eligibilityCopy";
import type { AvailabilityBlock as Block } from "@/lib/web/booking";

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function dowOf(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  return DOW_SHORT[(parsed.getUTCDay() + 6) % 7]!;
}

function domOf(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  return `${MONTHS_SHORT[parsed.getUTCMonth()]} ${parsed.getUTCDate()}`;
}

export function AvailabilityBlock({
  block,
  onLoadMoreDays,
  onPickRepeatTime,
}: {
  block: Block;
  onLoadMoreDays: (days: number) => void;
  /** Set one repeat day's start time from its row in the week plan. */
  onPickRepeatTime?: (weekday: string, time: string) => void;
}) {
  if (block.error) {
    return (
      <div className="notice notice-bad availability-error" role="alert">
        <span aria-hidden="true">!</span>
        <div>
          <strong>Availability could not be loaded — {block.error}.</strong>
        </div>
      </div>
    );
  }

  // Nothing the calendar can usefully say: the roster has left no candidates at
  // all, so an empty grid would read as "everyone is busy".
  if (block.eligibilityNarrowed && block.instructors.length === 0) {
    return (
      <div className="notice notice-warn" role="status">
        <span aria-hidden="true">!</span>
        <div>
          <strong>{noEligibleInstructors(block.rosterSize)}</strong>
          <p>
            Remove a student, choose a different group, or ask an administrator to
            assign an instructor to them.
          </p>
        </div>
      </div>
    );
  }

  const { selectedInstructor, suggestions, grid, weekPlan } = block;
  const noneFreeMessage = block.eligibilityNarrowed
    ? ELIGIBLE_BUT_UNAVAILABLE
    : "No instructor has a window long enough for this session on that date.";

  return (
    <>
      {selectedInstructor && (
        <>
          <h3 className="booking-subhead" id="matrix-heading">
            Selected instructor
          </h3>
          <div className="chosen-instructor">
            <span className="avatar avatar-lg" aria-hidden="true">
              {selectedInstructor.displayName
                .split(" ")
                .map((part) => part.slice(0, 1))
                .slice(0, 2)
                .join("")
                .toUpperCase()}
            </span>
            <div className="chosen-instructor-who">
              <strong>{selectedInstructor.displayName}</strong>
              {selectedInstructor.email && (
                <Hint>{selectedInstructor.email}</Hint>
              )}
              {block.canViewAvailability && (
                <a
                  className="hint-link"
                  href={`/availability?instructor=${selectedInstructor.ref}`}
                >
                  View full availability
                </a>
              )}
            </div>
            {/* Its own name rather than an empty `pick_instructor`: an empty
                value would fall back to whatever the Instructor select still
                holds, and the choice would come straight back. */}
            <Button size="small"
              type="submit"
              name="clear_instructor"
              value="1"
            >
              Change instructor
              <VisuallyHidden>
                {" "}
                — clear {selectedInstructor.displayName}
              </VisuallyHidden>
            </Button>
          </div>
        </>
      )}

      {weekPlan ? (
        <>
          <h3 className="booking-subhead" id="weekplan-heading">
            Availability by day{" "}
            <span className="subhead-note">
              {selectedInstructor?.displayName} &middot; {block.zone}
            </span>
          </h3>
          <div className="daygrid-scroll daygrid-week-scroll">
            <table className="daygrid daygrid-suggest daygrid-week" aria-labelledby="weekplan-heading">
              <caption className="visually-hidden">
                One row per weekday the run repeats on, every hour of the day across
                the top, each divided into quarters. Any quarter can be chosen, and
                the pressed one in a row is that day&rsquo;s start time. Clashes with
                existing bookings, and times outside the instructor&rsquo;s declared
                hours, are reported by Preview.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="daygrid-who">
                    Day
                  </th>
                  {weekPlan.columns.map((column) => (
                    <th scope="col" key={column.slots[0]!.value}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {weekPlan.rows.map((row) => (
                  <tr key={row.weekday}>
                    <th scope="row" className="daygrid-who">
                      <span className="daygrid-person">
                        <span className="daygrid-name">{row.name}</span>
                        <Hint>
                          {row.dayLabel} &middot; {durationWords(row.durationMinutes)}
                          {row.startTime ? ` · ${clockTime(row.startTime)}` : ""}
                        </Hint>
                      </span>
                    </th>
                    {weekPlan.columns.map((column) => {
                      const holdsChosen = column.slots.some(
                        (slot) => slot.value === row.startTime,
                      );
                      return (
                        <td key={column.slots[0]!.value}>
                          {/* An hour, divided. The heading sits over the four
                              quarters until the hour is pointed at or tabbed
                              into, because four labels an hour is 96 readings
                              across the table and none of them legible. The
                              hour this row is set to shows its quarters
                              always: that is the one place the exact time is
                              worth reading without asking for it. */}
                          <span
                            className={`hourcell${holdsChosen ? " has-chosen" : ""}`}
                          >
                            <span className="hourcell-label" aria-hidden="true">
                              {column.label}
                            </span>
                            {column.slots.map((slot) => {
                              const chosen = slot.value === row.startTime;
                              // The column heading drops a ":00" that the
                              // Start time select keeps, so the spoken name is
                              // built from the value rather than from the
                              // heading: one says "9 AM" where the other says
                              // "9:00 AM", and the name should match the field
                              // it sets.
                              const label = clockTime(slot.value);
                              /* Every quarter is offered, and every quarter is
                                 drawn the same.
                                 `outside_availability` is an *overridable*
                                 conflict rather than a refusal — the service
                                 lets a run be booked outside declared hours by
                                 somebody permitted to override, and the Start
                                 time select above has always offered the whole
                                 day — so this table narrows nothing and says so
                                 by shading nothing. What the declared hours are
                                 is still reported: by the line under the table
                                 for a day with none, and by Preview for a time
                                 outside them. Deliberately not a screen-reader
                                 aside either, which would tell one reader what
                                 the fill no longer tells the other. */
                              return (
                                <button
                                  className={`quartercell${chosen ? " is-chosen" : ""}`}
                                  type="button"
                                  aria-pressed={chosen}
                                  key={slot.value}
                                  onClick={() => onPickRepeatTime?.(row.weekday, slot.value)}
                                >
                                  <span aria-hidden="true">{slot.label}</span>
                                  <VisuallyHidden>
                                    Start {row.name} sessions at {label}.
                                  </VisuallyHidden>
                                </button>
                              );
                            })}
                          </span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {weekPlan.rows.some((row) => row.closedReason !== null) && (
            <p className="hint">
              {weekPlan.rows
                .filter((row) => row.closedReason !== null)
                .map((row) => `${row.name}: ${row.closedReason}`)
                .join(" · ")}
            </p>
          )}
          {!weekPlan.anyOpen && (
            <p className="hint">
              {selectedInstructor?.displayName} has no declared window long enough on
              any of these days. Any time here can still be chosen — Preview will
              report it as outside their availability.
            </p>
          )}
        </>
      ) : suggestions ? (
        <>
          <h3 className="booking-subhead" id="suggested-heading">
            Suggested start times <span className="subhead-note">{block.zone}</span>
          </h3>
          <div className="daygrid-scroll">
            <table className="daygrid daygrid-suggest" aria-labelledby="suggested-heading">
              <caption className="visually-hidden">
                Start times across the top for {selectedInstructor?.displayName}. A time
                can be chosen when one declared availability window covers the whole
                session. Conflicts with existing bookings are checked by Preview.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="daygrid-who">
                    Date
                  </th>
                  {suggestions.columns.map((column) => (
                    <th scope="col" key={column.value}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {suggestions.rows.map((row) => (
                  <tr key={row.ref}>
                    <th scope="row" className="daygrid-who">
                      {suggestions.dayLabel}
                    </th>
                    {row.free.map((open, index) => {
                      const column = suggestions.columns[index]!;
                      return (
                        <td className={open ? "is-free" : ""} key={column.value}>
                          {open ? (
                            // A real button, not a link with no href. It submits
                            // the chosen time.
                            <button
                              className="timecell"
                              type="submit"
                              name="pick_time"
                              value={column.value}
                            >
                              <span aria-hidden="true">{column.label}</span>
                              <VisuallyHidden>
                                Select {column.label} with {row.name}.
                              </VisuallyHidden>
                            </button>
                          ) : (
                            <span className="timecell is-out">
                              <span aria-hidden="true">—</span>
                              <VisuallyHidden>
                                {column.label} unavailable for {row.name}.
                              </VisuallyHidden>
                            </span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!suggestions.anyOpen && (
            <p className="hint">
              {selectedInstructor?.displayName} has no declared window long enough for
              this session at these times. Try another date, an earlier start, or a
              shorter length.
            </p>
          )}
        </>
      ) : grid ? (
        <>
          <h3 className="booking-subhead" id="matrix-heading">
            Instructors available{" "}
            <span className="subhead-note">
              {grid.dayLabel} · {block.zone}
            </span>
          </h3>
          <div className="daygrid-scroll">
            <table className="daygrid" aria-labelledby="matrix-heading">
              <caption className="visually-hidden">
                Instructors down the side, start times across the top. A cell is marked
                available when one declared window covers the whole session; a window
                shorter than the session does not count. Whether the slot is free of
                other bookings is checked by Preview.
              </caption>
              <thead>
                <tr>
                  <th scope="col" className="daygrid-who">
                    {grid.dayLabel}
                  </th>
                  {grid.columns.map((column) => (
                    <th scope="col" key={column.value}>
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {grid.rows.map((row) => (
                  <tr key={row.ref}>
                    <th scope="row" className="daygrid-who">
                      <span className="avatar" aria-hidden="true">
                        {row.initials}
                      </span>
                      <span className="daygrid-person">
                        <span className="daygrid-name">
                          {row.name}
                          {row.email && ` (${row.email})`}
                        </span>
                        <Button size="small"
                          type="submit"
                          name="pick_instructor"
                          value={row.ref}
                        >
                          Select
                          <VisuallyHidden> {row.name} as the instructor</VisuallyHidden>
                        </Button>
                      </span>
                    </th>
                    {row.free.map((open, index) => (
                      <td
                        className={open ? "is-free" : ""}
                        key={grid.columns[index]!.value}
                      >
                        {/* A glyph as well as the fill, so the answer does not
                            depend on being able to tell the two colours apart. */}
                        <span aria-hidden="true">{open ? "●" : "—"}</span>
                        <VisuallyHidden>
                          {grid.columns[index]!.label}:{" "}
                          {open ? `${row.name} available` : `${row.name} not available`}
                        </VisuallyHidden>
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {block.instructorsNotShown > 0 && (
            <p className="hint">
              Showing the first {grid.rows.length} instructors. {block.instructorsNotShown}{" "}
              more are not listed — choose one from the Instructor field above to see
              their times.
            </p>
          )}
          {!grid.anyOpen && (
            <p className="hint">
              {noneFreeMessage} Try another date or a shorter length.
            </p>
          )}
        </>
      ) : (
        <>
          <h3 className="booking-subhead" id="matrix-heading">
            Instructors available soon <span className="subhead-note">{block.zone}</span>
          </h3>
          <div className="matrix-list" role="group" aria-labelledby="matrix-heading">
            {block.openings.map((opening) => (
              <div
                className={`matrix-row ${opening.isOpen ? "" : "is-closed"}`}
                key={opening.day}
              >
                <div className="matrix-date">
                  <span className="dow">{dowOf(opening.day)}</span>
                  <span className="dom">{domOf(opening.day)}</span>
                </div>
                <div className="matrix-people" aria-hidden="true">
                  {opening.instructors.map(([ref, initials]) => (
                    <span className="avatar" key={ref}>
                      {initials}
                    </span>
                  ))}
                </div>
                <p className="matrix-count">
                  {opening.isOpen ? (
                    `${opening.total} available`
                  ) : (
                    <Hint>None available</Hint>
                  )}
                </p>
                {opening.isOpen && (
                  <Button variant="primary" size="small"
                    type="submit"
                    name="pick_date"
                    value={opening.day}
                  >
                    Select
                    <VisuallyHidden>
                      {" "}
                      {opening.day} as the session date
                    </VisuallyHidden>
                  </Button>
                )}
              </div>
            ))}
          </div>
          {block.openings.every((opening) => !opening.isOpen) && (
            <p className="hint">
              {noneFreeMessage} Try a longer window, or a shorter session.
            </p>
          )}
          {block.matrixCanExtend && (
            <Button className="matrix-more"
              type="button"
              onClick={() => onLoadMoreDays(block.matrixNext)}
            >
              <span aria-hidden="true">＋</span> Load more days
            </Button>
          )}
        </>
      )}
    </>
  );
}
