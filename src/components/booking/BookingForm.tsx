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
import { Button, Card, Field, Hint, OptionSelect } from "@/components/ui";
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
          <Field id="meeting_url" label="Other Online Classroom link" data-when-delivery="external_link">
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
              key={`count-${chosenDate}`}
              defaultValue={value("occurrence_count", "1")}
              disabled={!chosenDate}
              aria-describedby="count-hint count-repeat"
            />
            <Hint id="count-hint">
              Total sessions, including the first. More than one repeats weekly on the
              selected date&rsquo;s weekday. Up to {context.maxOccurrences}.
            </Hint>
            <Hint id="count-repeat">
              {!chosenDate
                ? "Choose a session date first."
                : counted > 1
                  ? `${counted} sessions, repeating every ${context.chosenWeekday}.`
                  : `One session on ${context.chosenWeekday}.`}
            </Hint>
                    </Field>

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
            <OptionSelect
              id="instructor_ref"
              name="instructor_ref"
              required
              key={`inst-${context.chosenInstructorRef}`}
              defaultValue={context.chosenInstructorRef}
              onChange={() => refresh()}
              placeholder="Choose an instructor"
              options={context.instructors.map(({ ref, label }) => ({ value: ref, label }))}
            />
                    </Field>

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
            <OptionSelect
              id="group_ref"
              name="group_ref"
              aria-describedby="group-hint"
              defaultValue={value("group_ref")}
              key={`grp-${value("group_ref")}`}
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
