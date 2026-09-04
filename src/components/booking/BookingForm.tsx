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
 */

import { useActionState, useRef, useState } from "react";

import { type BookingState, bookingStep } from "@/app/actions/booking";
import { CSRF_FIELD } from "@/lib/names";
import { clockDuration, durationWords } from "@/lib/presentation";

import { AvailabilityBlock } from "./AvailabilityBlock";
import { PreviewBlock } from "./PreviewBlock";

export function BookingForm({
  initial,
  csrfToken,
}: {
  initial: BookingState;
  csrfToken: string;
}) {
  const [state, submit, pending] = useActionState(bookingStep, initial);
  const form = useRef<HTMLFormElement>(null);

  const context = state.context;
  const values = state.values;
  const [students, setStudents] = useState<string[]>(state.selectedStudents);
  const [matrixDays, setMatrixDays] = useState(context.matrixDays);

  // Two pieces of state the person edits between submissions, re-seeded from
  // whatever the action just handed back. Adjusted during render rather than in
  // an effect: an effect would paint the stale chip list first and then correct
  // it, and React re-runs this component immediately without committing the
  // discarded pass.
  const [seen, setSeen] = useState(state);
  if (seen !== state) {
    setSeen(state);
    setStudents(state.selectedStudents);
    setMatrixDays(state.context.matrixDays);
  }

  const value = (name: string, fallback = "") => values[name] ?? fallback;
  const chosenDate = value("start_date");
  const counted = Number.parseInt(value("occurrence_count", "1"), 10) || 1;

  /** Ask for the availability block again, without previewing or writing. */
  const refresh = (days?: number) => {
    if (days !== undefined) setMatrixDays(days);
    // Deferred so the hidden day-count field is updated before the submit reads
    // it, and so a change event finishes before the form is replaced.
    queueMicrotask(() => form.current?.requestSubmit(refreshButton.current));
  };
  const refreshButton = useRef<HTMLButtonElement>(null);

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

      <section className="card booking-card">
        <h2>New Session</h2>

        <div className="booking-row booking-row-type">
          <div className="field">
            <label htmlFor="delivery_type">Type</label>
            <select
              id="delivery_type"
              name="delivery_type"
              defaultValue={value("delivery_type", "external_link")}
              key={`delivery-${value("delivery_type", "external_link")}`}
            >
              {context.deliveryTypes.map((type) => (
                <option value={type.value} key={type.value}>
                  {type.label}
                </option>
              ))}
            </select>
          </div>
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
        <div className="field" data-when-delivery="external_link">
          <label htmlFor="meeting_url">Other Online Classroom link</label>
          <input
            id="meeting_url"
            name="meeting_url"
            type="text"
            defaultValue={value("meeting_url")}
            placeholder="example: meet.google.com/hey-yoo-gyz"
          />
        </div>

        <div className="field" data-when-delivery="in_person">
          <label htmlFor="location_detail">Location Details</label>
          <input
            id="location_detail"
            name="location_detail"
            type="text"
            maxLength={500}
            defaultValue={value("location_detail")}
            placeholder="Address or other description"
          />
        </div>

        <div className="field">
          <label htmlFor="title">Title</label>
          <input
            id="title"
            name="title"
            type="text"
            required
            maxLength={200}
            defaultValue={value("title")}
            placeholder="Please enter title (i.e. Math, Reading, etc)"
          />
        </div>

        <div className="field">
          <label htmlFor="description">Description</label>
          <textarea
            id="description"
            name="description"
            defaultValue={value("description")}
            placeholder="Focus areas, upcoming tests, learning styles, etc."
          />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="start_date">Session date</label>
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
          </div>
          <div className="field">
            <label htmlFor="duration_minutes">Session length</label>
            <select
              id="duration_minutes"
              name="duration_minutes"
              required
              aria-describedby="length-hint"
              key={`len-${context.chosenDuration}`}
              defaultValue={String(context.chosenDuration)}
              onChange={() => refresh()}
            >
              {context.durations.map((minutes) => (
                <option value={minutes} key={minutes}>
                  {durationWords(minutes)}
                </option>
              ))}
            </select>
            <span className="hint hint-end" id="length-hint">
              min. {clockDuration(context.durationLimits[0])}, max.{" "}
              {clockDuration(context.durationLimits[1])}
            </span>
          </div>
          <div className="field">
            <label htmlFor="start_time">Start time</label>
            <input
              id="start_time"
              name="start_time"
              type="time"
              required
              key={`time-${value("start_time", "16:00")}`}
              defaultValue={value("start_time", "16:00")}
              aria-describedby="tz-hint"
              onChange={() => refresh()}
            />
            <span className="hint" id="tz-hint">
              {context.zone}
            </span>
            <input type="hidden" name="timezone" value={context.zone} />
          </div>
        </div>

        {/* The count is the only recurrence control on this form: weekday,
            interval and end date are not offered, and a repeat runs weekly on
            whichever day the chosen date falls on.

            It is disabled until a date has been chosen, because the number is
            meaningless before then — "4 sessions" cannot say which four until
            there is a first one. The ceiling comes from the organization's
            setting, so the field, the help text and the service check cannot
            disagree. */}
        <div className="field field-third">
          <label htmlFor="occurrence_count">Number of sessions</label>
          <input
            id="occurrence_count"
            name="occurrence_count"
            type="number"
            min={1}
            max={context.maxOccurrences}
            step={1}
            key={`count-${chosenDate}`}
            defaultValue={value("occurrence_count", "1")}
            disabled={!chosenDate}
            aria-describedby="count-hint count-repeat"
          />
          <span className="hint" id="count-hint">
            Total sessions, including the first. More than one repeats weekly on the
            selected date&rsquo;s weekday. Up to {context.maxOccurrences}.
          </span>
          <span className="hint" id="count-repeat">
            {!chosenDate
              ? "Choose a session date first."
              : counted > 1
                ? `${counted} sessions, repeating every ${context.chosenWeekday}.`
                : `One session on ${context.chosenWeekday}.`}
          </span>
        </div>

        <div className="field">
          <label htmlFor="program_ref">Program</label>
          <select
            id="program_ref"
            name="program_ref"
            defaultValue={value("program_ref")}
            key={`prog-${value("program_ref")}`}
          >
            <option value="">No program</option>
            {context.programs.map((program) => (
              <option value={program.ref} key={program.ref}>
                {program.label}
              </option>
            ))}
          </select>
        </div>

        <div className="field">
          <label htmlFor="instructor_ref">Instructor</label>
          <select
            id="instructor_ref"
            name="instructor_ref"
            required
            key={`inst-${context.chosenInstructorRef}`}
            defaultValue={context.chosenInstructorRef}
            onChange={() => refresh()}
          >
            <option value="">Choose an instructor</option>
            {context.instructors.map((person) => (
              <option value={person.ref} key={person.ref}>
                {person.label}
              </option>
            ))}
          </select>
        </div>

        {/* Before a date is chosen, the useful question is which day to look at.
            Once one is chosen that is settled, and the question becomes who;
            once a person is chosen, when. The block decides which of the three
            to draw. */}
        <div className="availability" aria-live="polite">
          {pending && (
            <p className="availability-busy">
              <span className="spinner" aria-hidden="true" />
              Updating availability…
            </p>
          )}
          <div>
            <AvailabilityBlock block={context} onLoadMoreDays={(days) => refresh(days)} />
          </div>
        </div>

        <h3 className="booking-subhead">Add students or a group</h3>

        <div className="field">
          <label htmlFor="student_picker">Students</label>
          {/* An ordinary one-line dropdown, not a multi-select list box: a
              native `multiple` select is rendered by some browsers as a column
              of check boxes, and it cannot start at the height of every other
              control on the form. Choosing somebody moves them into the chip
              list below, which is what grows as students are added. */}
          <select
            id="student_picker"
            aria-describedby="students-hint"
            value=""
            onChange={(event) => {
              const ref = event.target.value;
              if (ref && !students.includes(ref)) setStudents([...students, ref]);
            }}
          >
            <option value="">Choose a student</option>
            {context.students
              .filter((person) => !students.includes(person.ref))
              .map((person) => (
                <option value={person.ref} key={person.ref}>
                  {person.displayName}
                </option>
              ))}
          </select>
          <span className="hint" id="students-hint">
            Choose one at a time. Each is added below.
          </span>

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
        </div>

        <div className="field">
          <label htmlFor="group_ref">Group</label>
          <select
            id="group_ref"
            name="group_ref"
            aria-describedby="group-hint"
            defaultValue={value("group_ref")}
            key={`grp-${value("group_ref")}`}
          >
            <option value="">No group</option>
            {context.groups.map((group) => (
              <option value={group.ref} key={group.ref}>
                {group.label}
              </option>
            ))}
          </select>
          <span className="hint" id="group-hint">
            Members are added to each session as it is created. Later changes to the group
            do not alter sessions already booked.
          </span>
        </div>
      </section>

      {state.plan && <PreviewBlock plan={state.plan} canOverride={context.canOverride} />}

      <div className="booking-actions">
        <button className="btn" type="submit" name="action" value="preview" disabled={pending}>
          {state.plan
            ? "Update preview"
            : `Preview session${counted === 1 ? "" : "s"}`}
        </button>
        {state.plan && (
          // Disabled when the plan cannot be booked. The override path is the
          // checkbox in the preview, which only an authorised person is shown.
          <button
            className="btn btn-primary"
            type="submit"
            name="action"
            value="confirm"
            disabled={pending || state.plan.blocked || state.plan.selfOverlaps}
          >
            Book Session{state.plan.total === 1 ? "" : "s"}
          </button>
        )}
      </div>
    </form>
  );
}
