"use client";

/**
 * The booking form.
 *
 * Ported from `app/templates/sessions/new.html`.
 *
 * One form, one action, three things it can be asked to do: refresh the
 * availability block, preview, or confirm. Preview and confirm run the same
 * `plan()`, so the booking that gets written is the one that was shown.
 *
 * The availability block refreshes in place. The reference does that with a
 * fetch that replaces one region; here the whole state comes back from the
 * action and React replaces only what changed, which has the same effect — a
 * title half-typed and students already added are never touched by a refresh.
 *
 * **The roster drives the refresh, not only the calendar fields.** Who may
 * teach depends on who is being taught, so adding or removing a student, or
 * changing the group, asks the server the same question a change of date does.
 * Two things make that safe. The submit happens from an effect rather than
 * from the click handler, because the request sends the form and the hidden
 * `student_refs` inputs for the new roster only exist once React has committed
 * the render — submitting from the handler would send yesterday's roster. And
 * the chip list is client state that the server only ever echoes, so a reply
 * that arrives after a newer selection cannot put a removed student back.
 */

import { useActionState, useCallback, useEffect, useRef, useState } from "react";

import { type BookingState, bookingStep } from "@/app/actions/booking";
import { Button, Card, Field, Hint, Notice, OptionSelect, TrashIcon } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import { noEligibleInstructors } from "@/lib/web/eligibilityCopy";
import {
  WEEKDAY_CHOICES,
  clockDuration,
  clockTimes,
  durationWords,
  maxRepeatDays,
  nearestClockTime,
  weekdayOf,
} from "@/lib/presentation";

import { AvailabilityBlock } from "./AvailabilityBlock";
import { PreviewBlock } from "./PreviewBlock";

/**
 * How long a burst of changes is allowed to settle before the block is asked
 * for again. Short enough that it reads as immediate; long enough that adding
 * three students is one question rather than three.
 */
const REFRESH_DELAY_MS = 200;

/**
 * The clock's grid, and the repeat panel's ceiling.
 *
 * Quarter hours because that is the finest session length the product offers,
 * and because a select of every minute is 1,440 options nobody can scroll.
 * Seven days because a weekly pattern cannot hold an eighth — and a run of
 * three sessions cannot usefully name more than three weekdays either, so the
 * ceiling is the smaller of the two.
 */
const CLOCK_STEP_MINUTES = 15;
const TIME_OPTIONS = clockTimes(CLOCK_STEP_MINUTES);

/** One row of the repeat panel: a weekday, and what it runs at. */
interface RepeatDay {
  /**
   * Identity, not content.
   *
   * The rows were keyed by their weekday, which meant changing a row's day
   * unmounted it and mounted a different one — and a controlled `<select>`
   * that comes back from a remount comes back showing its first option, so
   * the state said Wednesday while the control said Monday. A key has to
   * survive every edit to the thing it identifies.
   */
  id: string;
  weekday: string;
  length: string;
  time: string;
}

/**
 * Row identity. A counter rather than `crypto.randomUUID`, because these are
 * only ever compared with each other and a readable id is easier to find in a
 * failing test. Safe across the server render: the panel is hidden at one
 * session, so the first paint creates no rows at all.
 */
let nextRowId = 0;
function rowId(): string {
  nextRowId += 1;
  return `d${nextRowId}`;
}

/** What the panel is anchored to. A change in any of these re-seeds its first row. */
interface RepeatAnchor {
  repeating: boolean;
  date: string;
  length: number;
  time: string;
  count: number;
}

/**
 * Bring the rows back into line with the fields above them.
 *
 * The first row *is* the session date, its length and its time, said again in
 * the shape the rest of the run is said in — so when one of those three
 * changes, the corresponding part of the first row follows it. Only the part
 * that changed: re-seeding the whole row when somebody edits the start time
 * would silently undo a weekday they had chosen.
 *
 * Later rows are left alone except for two rules that cannot be broken — no
 * two rows on one weekday, and never more rows than the run has sessions,
 * because a weekday that never comes round is a promise the preview cannot
 * keep.
 */
function reconcile(rows: RepeatDay[], previous: RepeatAnchor, next: RepeatAnchor): RepeatDay[] {
  if (!next.repeating) return rows.length === 0 ? rows : [];

  const seeded = {
    weekday: weekdayOf(next.date),
    length: String(next.length),
    time: next.time,
  };
  const first = rows[0];
  const head: RepeatDay =
    first === undefined
      ? { id: rowId(), ...seeded }
      : {
          id: first.id,
          weekday: next.date !== previous.date ? seeded.weekday : first.weekday,
          length: next.length !== previous.length ? seeded.length : first.length,
          time: next.time !== previous.time ? seeded.time : first.time,
        };

  const rest = rows.slice(1).filter((row) => row.weekday !== head.weekday);
  const settled = [head, ...rest].slice(0, maxRepeatDays(next.count));

  // Same content, same array: an adjustment during render that always produced
  // a new reference would re-render on every pass.
  const unchanged =
    settled.length === rows.length &&
    settled.every((row, index) => {
      const was = rows[index]!;
      return (
        row.id === was.id &&
        row.weekday === was.weekday &&
        row.length === was.length &&
        row.time === was.time
      );
    });
  return unchanged ? rows : settled;
}

/** The next weekday not already claimed by a row, so Add Day never duplicates. */
function freeWeekday(taken: readonly RepeatDay[]): string {
  const used = new Set(taken.map((day) => day.weekday));
  return (
    WEEKDAY_CHOICES.find((choice) => !used.has(choice.value))?.value ??
    WEEKDAY_CHOICES[0]!.value
  );
}

export function BookingForm({
  initial,
  csrfToken,
}: {
  initial: BookingState;
  csrfToken: string;
}) {
  const [state, submit, pending] = useActionState(bookingStep, initial);
  const form = useRef<HTMLFormElement>(null);

  /**
   * What the last background refresh submitted as the session count.
   *
   * The reply echoes the count back, and the count is re-seeded from that echo
   * because the server clamps it. But a reply is an answer to the question that
   * was asked, not to the field as it now stands: nudge the number down while
   * one is in flight and the echo of the old number would put it straight back
   * up. Comparing the echo with what was sent tells the two apart — a number
   * the server changed is a clamp and is taken; a number it merely repeated has
   * nothing to say about an edit made since.
   *
   * State rather than a ref because it is read while rendering, and a ref read
   * during render is a value React does not promise anything about.
   */
  const [sentCount, setSentCount] = useState<string | null>(null);

  const context = state.context;
  const values = state.values;
  const [students, setStudents] = useState<string[]>(state.selectedStudents);
  const [matrixDays, setMatrixDays] = useState(context.matrixDays);

  const value = (name: string, fallback = "") => values[name] ?? fallback;
  const chosenDate = value("start_date");
  // Snapped onto the clock's grid, so a time stored off it — by the API, or by
  // a tenant whose step used to differ — still selects something rather than
  // leaving the field on the first option and silently moving the session.
  const chosenTime = nearestClockTime(value("start_time", "16:00"), CLOCK_STEP_MINUTES);
  const [counted, setCounted] = useState(
    () => Number.parseInt(values.occurrence_count ?? "1", 10) || 1,
  );
  // The day count is re-seeded from whatever the action handed back, but only
  // where the server changed it — see `sentCount`. The chip list deliberately
  // is not re-seeded at all: the server only ever echoes the roster it was
  // sent, so re-seeding could only ever overwrite a newer selection with an
  // older reply. Adjusted during render rather than in an effect, which would
  // paint the stale value first and then correct it.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setMatrixDays(state.context.matrixDays);
    const echoed = state.values.occurrence_count ?? "1";
    if (echoed !== sentCount) setCounted(Number.parseInt(echoed, 10) || 1);
    setSentCount(null);
  }

  const repeating = counted > 1;

  const [repeatDays, setRepeatDays] = useState<RepeatDay[]>(() =>
    reconcile(
      [],
      { repeating, date: chosenDate, length: context.chosenDuration, time: chosenTime, count: counted },
      { repeating, date: chosenDate, length: context.chosenDuration, time: chosenTime, count: counted },
    ),
  );

  // Adjusted during render rather than in an effect, the same way the day count
  // above is: an effect would paint a panel that disagrees with the date field
  // and then correct it, and React re-runs this component without committing
  // the discarded pass.
  const anchor: RepeatAnchor = {
    repeating,
    date: chosenDate,
    length: context.chosenDuration,
    time: chosenTime,
    count: counted,
  };
  const [anchored, setAnchored] = useState(anchor);
  if (
    anchored.repeating !== anchor.repeating ||
    anchored.date !== anchor.date ||
    anchored.length !== anchor.length ||
    anchored.time !== anchor.time ||
    anchored.count !== anchor.count
  ) {
    setAnchored(anchor);
    setRepeatDays((rows) => reconcile(rows, anchored, anchor));
  }

  const editRow = (index: number, patch: Partial<RepeatDay>) => {
    setRepeatDays((rows) =>
      rows.map((row, position) => (position === index ? { ...row, ...patch } : row)),
    );
    // The instructor's availability is drawn a row per weekday, so which
    // weekdays — and how long each one runs — changes what that table says.
    refresh();
  };

  const refreshButton = useRef<HTMLButtonElement>(null);
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /**
   * Ask for the availability block again, without previewing or writing.
   *
   * Coalesced rather than sent per keystroke. Typing into a date field fires a
   * change for every digit, and adding three students in three seconds used to
   * mean three round trips whose answers arrived in no guaranteed order. The
   * delay also gives React time to commit whatever state the caller just set,
   * so the submit reads the fields as they now are rather than as they were.
   */
  /**
   * Known limitation, stated where somebody will hit it. React resets the form
   * after each action, restoring every uncontrolled field to the
   * `defaultValue` it was last rendered with. So an edit made between a
   * refresh being sent and its reply landing — roughly the debounce plus one
   * round trip — is discarded. The debounce coalesces each action into a
   * single request, which keeps the window small, and closing it entirely
   * means holding every scheduling field in client state behind a `key` that
   * changes with its value: that would remount the date input on each segment
   * typed, which is a worse fault than the one it fixes.
   *
   * The session count is the exception, because it is already held in client
   * state — the repeat panel is drawn from it — so a stale reply there took
   * the panel away as well as the number. `sentCount` closes it for that one
   * field.
   */
  const refresh = useCallback((days?: number) => {
    if (days !== undefined) setMatrixDays(days);
    if (refreshTimer.current !== null) clearTimeout(refreshTimer.current);
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null;
      // Read off the control rather than off state, because the control is
      // what is about to be serialised into the request.
      setSentCount(
        form.current?.querySelector<HTMLInputElement>("#occurrence_count")?.value ?? null,
      );
      form.current?.requestSubmit(refreshButton.current);
    }, REFRESH_DELAY_MS);
  }, []);

  // Nothing should fire after the form has gone. `form.current` would be null
  // by then and the submit a no-op, but a timer outliving its component is the
  // kind of tidy-up that stops being harmless the moment somebody adds to it.
  useEffect(() => {
    const timer = refreshTimer;
    return () => {
      if (timer.current !== null) clearTimeout(timer.current);
    };
  }, []);

  // Adding or removing a student changes who is eligible to teach, so the
  // block has to be asked again — but only once the new hidden inputs are in
  // the DOM, which is what an effect guarantees and a click handler does not.
  // The guard starts holding the first render's roster, so the initial paint
  // does not immediately re-request what the server has just rendered.
  // `|` is not in the ref alphabet, so this cannot collide with a ref.
  const roster = students.join("|");
  const lastRoster = useRef(roster);
  useEffect(() => {
    if (lastRoster.current === roster) return;
    lastRoster.current = roster;
    refresh();
  }, [refresh, roster]);

  const byName = new Map(context.students.map((person) => [person.ref, person]));

  return (
    <form action={submit} noValidate className="booking" ref={form}>
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      <input type="hidden" name="matrix_days" value={matrixDays} />
      {/* The refresh path, submitted programmatically. It is a real button so
          the form works with the script inert — it simply reads as a third
          action rather than as magic. */}
      <button
        ref={refreshButton}
        type="submit"
        name="action"
        value="refresh"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
      >
        Refresh availability
      </button>

      {state.error && (
        <div className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>{state.error}</strong>
            {state.conflictDetails && state.conflictDetails.length > 0 && (
              <ul>
                {state.conflictDetails.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}

      <Card as="section" className="booking-card">
        <h2>New Session</h2>

        {/* Four groups rather than one run of nineteen fields. Still one form
            and one submit: the review proposed a four-step wizard, which would
            put steps between what the preview shows and what gets written, and
            those being the same call is a guarantee here rather than a style.
            Borderless fieldsets — the card already draws the boundary, and real
            fieldsets mean the grouping is in the markup, not only in the
            spacing. */}
        <fieldset className="booking-section">

          <div className="booking-row booking-row-type">
            <Field id="delivery_type" label="Type">
              <OptionSelect
                id="delivery_type"
                name="delivery_type"
                defaultValue={value("delivery_type", "external_link")}
                key={`delivery-${value("delivery_type", "external_link")}`}
                options={context.deliveryTypes}
              />
                        </Field>
            {/* The Billable switch is not offered here, but the value still has to
                be sent: the action reads `billable == "on"`, so simply dropping
                the control would book every new session as non-billable — a
                silent change to what gets charged, from a change to a form.
                Billable is still editable on the session itself. */}
            <input type="hidden" name="billable" value="on" />
          </div>

          {/* Only one of these belongs to the chosen type. Both stay in the form;
              the action reads only the one that matches the type, so a stale
              value from a browser that filled both cannot reach the session. */}
          <Field id="meeting_url" label="Online Classroom link" data-when-delivery="external_link">
            <input
              id="meeting_url"
              name="meeting_url"
              type="text"
              defaultValue={value("meeting_url")}
              placeholder="example: meet.google.com/hey-yoo-gyz"
            />
          </Field>

          <Field id="location_detail" label="Location Details" data-when-delivery="in_person">
            <input
              id="location_detail"
              name="location_detail"
              type="text"
              maxLength={500}
              defaultValue={value("location_detail")}
              placeholder="Address or other description"
            />
          </Field>

          <Field id="title" label="Title">
            <input
              id="title"
              name="title"
              type="text"
              required
              maxLength={200}
              defaultValue={value("title")}
              placeholder="Please enter title (i.e. Math, Reading, etc)"
            />
                    </Field>

          <Field id="description" label="Description">
            <textarea
              id="description"
              name="description"
              defaultValue={value("description")}
              placeholder="Focus areas, upcoming tests, learning styles, etc."
            />
                    </Field>

        </fieldset>

        <fieldset className="booking-section">
          <legend className="booking-subhead">Date and repeat</legend>
          <div className="form-row">
            <Field id="start_date" label="Session date">
              <input
                id="start_date"
                name="start_date"
                type="date"
                required
                key={`date-${chosenDate}`}
                defaultValue={chosenDate}
                min={context.today}
                onChange={() => refresh()}
              />
                        </Field>
            <Field id="duration_minutes" label="Session length">
              <OptionSelect
                id="duration_minutes"
                name="duration_minutes"
                required
                aria-describedby="length-hint"
                key={`len-${context.chosenDuration}`}
                defaultValue={String(context.chosenDuration)}
                onChange={() => refresh()}
                options={context.durations.map((minutes) => ({
                  value: String(minutes),
                  label: durationWords(minutes),
                }))}
              />
              <Hint className="hint-end" id="length-hint">
                min. {clockDuration(context.durationLimits[0])}, max.{" "}
                {clockDuration(context.durationLimits[1])}
              </Hint>
                        </Field>
            <Field id="start_time" label="Start time">
              {/* A list, not the browser's time picker. That picker closes on
                  the first choice, so setting an hour, a minute and a meridiem
                  meant opening it three times; this is one open and one
                  choice, and it works with the script inert. */}
              <OptionSelect
                id="start_time"
                name="start_time"
                required
                key={`time-${chosenTime}`}
                defaultValue={chosenTime}
                aria-describedby="tz-hint"
                onChange={() => refresh()}
                options={TIME_OPTIONS}
              />
              <Hint id="tz-hint">
                {context.zone}
              </Hint>
              <input type="hidden" name="timezone" value={context.zone} />
                        </Field>
          </div>

          {/* The count is the only recurrence control on this form: weekday,
              interval and end date are not offered, and a repeat runs weekly on
              whichever day the chosen date falls on.

              It is disabled until a date has been chosen, because the number is
              meaningless before then — "4 sessions" cannot say which four until
              there is a first one. The ceiling comes from the organization's
              setting, so the field, the help text and the service check cannot
              disagree. */}
          <Field id="occurrence_count" label="Number of sessions" className="field-third">
            <input
              id="occurrence_count"
              name="occurrence_count"
              type="number"
              min={1}
              max={context.maxOccurrences}
              step={1}
              // Keyed on its own value, the way the date, time and length
              // fields beside it are. Keyed on the date it was not remounted
              // when the count changed, so React never refreshed its `value`
              // attribute — and the form reset that follows every action
              // restored the number to the one it was mounted with. React
              // state said four sessions while the field said one, and the
              // next refresh submitted the one.
              //
              // The value is `counted` rather than the echo, so that the field
              // and the panel are restored to the same number: the echo can be
              // an answer to a question asked before the last keystroke.
              key={`count-${counted}`}
              defaultValue={String(counted)}
              disabled={!chosenDate}
              aria-describedby="count-hint count-repeat"
              onChange={(event) => {
                setCounted(Number.parseInt(event.target.value, 10) || 1);
                // Crossing one session changes which availability table is
                // useful — the run's weekdays, or the one chosen date — and
                // that is drawn from the returned context, so the server has
                // to be asked again rather than only the panel appearing.
                refresh();
              }}
            />
            <Hint id="count-hint">
              Total sessions, including the first. More than one repeats weekly on the
              selected date&rsquo;s weekday. Up to {context.maxOccurrences}.
            </Hint>
            <Hint id="count-repeat">
              {!chosenDate
                ? "Choose a session date first."
                : repeating
                  ? `${counted} sessions, on the days below.`
                  : `One session on ${context.chosenWeekday}.`}
            </Hint>
                    </Field>

          {/* Above one session the run needs days, and each may run at its own
              time and length — "Mondays at 4 for an hour, Wednesdays at 5:30
              for half of one" is one arrangement a family keeps, not two
              bookings. The panel is hidden rather than unmounted below two
              sessions so that nothing typed into it is lost by nudging the
              count down and back up; its fields are ignored by the action
              unless the run repeats. */}
          <div className="repeat-panel" hidden={!repeating}>
            <p className="repeat-heading" id="repeat-heading">
              Repeat days
            </p>
            <ul className="repeat-rows" aria-labelledby="repeat-heading">
              {repeatDays.map((row, index) => {
                const taken = new Set(
                  repeatDays.filter((_, other) => other !== index).map((other) => other.weekday),
                );
                const named =
                  WEEKDAY_CHOICES.find((choice) => choice.value === row.weekday)?.label ??
                  row.weekday;
                return (
                  <li className="repeat-row" key={row.id}>
                    <Field id={`repeat_weekday_${index}`} label="Repeat Every">
                      {/* `key` and `defaultValue` rather than a controlled
                          `value`, which is the idiom the rest of this form
                          uses and for a reason worth stating: React resets the
                          form after a form action, and a reset restores each
                          control to its *attribute* default. A controlled
                          select has no `selected` attribute, so every refresh
                          silently put these three back to their first option
                          while React state still held the real answer. */}
                      <OptionSelect
                        id={`repeat_weekday_${index}`}
                        name="repeat_weekday"
                        key={`wd-${row.id}-${row.weekday}`}
                        defaultValue={row.weekday}
                        onChange={(event) => editRow(index, { weekday: event.target.value })}
                        // Only the days still free, plus this row's own. Two
                        // rows on one weekday is refused by the action, and an
                        // option that is always refused should not be offered.
                        options={WEEKDAY_CHOICES.filter(
                          (choice) => !taken.has(choice.value),
                        )}
                      />
                    </Field>
                    <Field id={`repeat_length_${index}`} label="Session Length">
                      <OptionSelect
                        id={`repeat_length_${index}`}
                        name="repeat_length"
                        key={`len-${row.id}-${row.length}`}
                        defaultValue={row.length}
                        onChange={(event) => editRow(index, { length: event.target.value })}
                        options={context.durations.map((minutes) => ({
                          value: String(minutes),
                          label: durationWords(minutes),
                        }))}
                      />
                    </Field>
                    <Field id={`repeat_time_${index}`} label="Start Time">
                      <OptionSelect
                        id={`repeat_time_${index}`}
                        name="repeat_time"
                        key={`at-${row.id}-${row.time}`}
                        defaultValue={row.time}
                        onChange={(event) => editRow(index, { time: event.target.value })}
                        options={TIME_OPTIONS}
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="link"
                      className="repeat-remove"
                      aria-label={`Remove ${named} from the repeat`}
                      disabled={repeatDays.length === 1}
                      onClick={() => {
                        setRepeatDays((rows) =>
                          rows.filter((_, position) => position !== index),
                        );
                        refresh();
                      }}
                    >
                      <TrashIcon />
                    </Button>
                  </li>
                );
              })}
            </ul>

            {repeatDays.length < maxRepeatDays(counted) && (
              <Button
                type="button"
                variant="primary"
                size="small"
                className="repeat-add"
                onClick={() => {
                  setRepeatDays((rows) => [
                    ...rows,
                    {
                      id: rowId(),
                      weekday: freeWeekday(rows),
                      length: String(context.chosenDuration),
                      time: chosenTime,
                    },
                  ]);
                  refresh();
                }}
              >
                Add Day
              </Button>
            )}
            <Hint>
              {counted < WEEKDAY_CHOICES.length
                ? `Up to ${maxRepeatDays(counted)} ${
                    maxRepeatDays(counted) === 1 ? "day" : "days"
                  }, because the run is ${counted} sessions long.`
                : "Up to seven days — the run repeats weekly on the days listed."}
            </Hint>
          </div>

        </fieldset>

        <fieldset className="booking-section">
          <legend className="booking-subhead">Instructor</legend>
          <Field id="program_ref" label="Program">
            <OptionSelect
              id="program_ref"
              name="program_ref"
              defaultValue={value("program_ref")}
              key={`prog-${value("program_ref")}`}
              placeholder="No program"
              options={context.programs.map(({ ref, label }) => ({ value: ref, label }))}
            />
                    </Field>

          <Field id="instructor_ref" label="Instructor">
            {/* Cleared, and told why. Silently emptying the field leaves
                somebody looking for a name that was there a moment ago. */}
            {context.instructorCleared && (
              <Notice tone="warn">
                The instructor you had chosen cannot teach{" "}
                {context.rosterSize === 1 ? "the student" : "every student"} now on this
                session, so the choice has been cleared. Pick one of the instructors
                listed.
              </Notice>
            )}
            <OptionSelect
              id="instructor_ref"
              name="instructor_ref"
              required
              aria-describedby="instructor-hint"
              key={`inst-${context.chosenInstructorRef}`}
              defaultValue={context.chosenInstructorRef}
              onChange={() => refresh()}
              placeholder="Choose an instructor"
              options={context.instructors.map(({ ref, label }) => ({ value: ref, label }))}
            />
            <Hint id="instructor-hint">
              {!context.eligibilityNarrowed
                ? "Every instructor here. Choosing students narrows this list to the ones who may teach them."
                : context.instructors.length === 0
                  ? noEligibleInstructors(context.rosterSize)
                  : `${context.instructors.length} of your instructors may teach ${
                      context.rosterSize === 1 ? "this student" : "these students"
                    }.`}
            </Hint>
                    </Field>

          {/* Before a date is chosen, the useful question is which day to look at.
              Once one is chosen that is settled, and the question becomes who;
              once a person is chosen, when. The block decides which of the three
              to draw. */}
          <div className="availability" aria-live="polite" aria-busy={pending}>
            {pending && (
              <p className="availability-busy">
                <span className="spinner" aria-hidden="true" />
                Updating availability…
              </p>
            )}
            <div>
              <AvailabilityBlock
                block={context}
                onLoadMoreDays={(days) => refresh(days)}
                onPickRepeatTime={(weekday, time) => {
                  setRepeatDays((rows) =>
                    rows.map((row) => (row.weekday === weekday ? { ...row, time } : row)),
                  );
                  refresh();
                }}
              />
            </div>
          </div>

        </fieldset>

        <fieldset className="booking-section">
          <legend className="booking-subhead">Students and groups</legend>

          <Field id="student_picker" label="Students">
            {/* An ordinary one-line dropdown, not a multi-select list box: a
                native `multiple` select is rendered by some browsers as a column
                of check boxes, and it cannot start at the height of every other
                control on the form. Choosing somebody moves them into the chip
                list below, which is what grows as students are added. */}
            <OptionSelect
              id="student_picker"
              aria-describedby="students-hint"
              value=""
              onChange={(event) => {
                const ref = event.target.value;
                if (ref && !students.includes(ref)) setStudents([...students, ref]);
              }}
              placeholder="Choose a student"
              options={context.students
                .filter((person) => !students.includes(person.ref))
                .map((person) => ({ value: person.ref, label: person.displayName }))}
            />
            <Hint id="students-hint">
              Choose one at a time. Each is added below.
            </Hint>

            <ul className="chips">
              {students.map((ref) => (
                <li className="chip" key={ref}>
                  <span>{byName.get(ref)?.displayName ?? ref}</span>
                  <button
                    type="button"
                    className="chip-remove"
                    aria-label={`Remove ${byName.get(ref)?.displayName ?? ref}`}
                    onClick={() => setStudents(students.filter((other) => other !== ref))}
                  >
                    ×
                  </button>
                  <input type="hidden" name="student_refs" value={ref} />
                </li>
              ))}
            </ul>
                    </Field>

          <Field id="group_ref" label="Group">
            {/* A group is a roster too, so changing it changes who may teach.
                Its value is committed by the time the change event fires, so
                unlike the chips this needs no deferral. */}
            <OptionSelect
              id="group_ref"
              name="group_ref"
              aria-describedby="group-hint"
              defaultValue={value("group_ref")}
              key={`grp-${value("group_ref")}`}
              onChange={() => refresh()}
              placeholder="No group"
              options={context.groups.map(({ ref, label }) => ({ value: ref, label }))}
            />
            <Hint id="group-hint">
              Members are added to each session as it is created. Later changes to the group
              do not alter sessions already booked.
            </Hint>
                    </Field>
        </fieldset>
      </Card>

      {state.plan && <PreviewBlock plan={state.plan} canOverride={context.canOverride} />}

      <div className="booking-actions">
        <Button type="submit" name="action" value="preview" disabled={pending}>
          {state.plan
            ? "Update preview"
            : `Preview session${counted === 1 ? "" : "s"}`}
        </Button>
        {state.plan && (
          // Disabled when the plan cannot be booked. The override path is the
          // checkbox in the preview, which only an authorised person is shown.
          <Button variant="primary"
            type="submit"
            name="action"
            value="confirm"
            disabled={pending || state.plan.blocked || state.plan.selfOverlaps}
          >
            Book Session{state.plan.total === 1 ? "" : "s"}
          </Button>
        )}
      </div>
    </form>
  );
}
