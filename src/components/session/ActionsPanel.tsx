"use client";

/**
 * The session detail page's action panel.
 *
 * Ported from the Actions block of `app/templates/sessions/detail.html`.
 *
 * Which forms appear is decided on the server by `availableActions`, and passed
 * in — a control hidden here is a courtesy, and every one of these actions
 * re-checks policy in the service it calls. A completed session therefore never
 * shows a cancel control, which is both correct and one less way for a person
 * to be told "no" after clicking.
 */

import { useActionState } from "react";

import {
  cancelSession,
  changeStatus,
  correctActualTimes,
  decideRequest,
  editSession,
  rescheduleSession,
} from "@/app/actions/sessions";
import { Button, ButtonRow, Card, Choice, Field, Hint, OptionSelect, ScopeChoice } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import { CLOCK_STEP_MINUTES, clockTimes, durationWords, nearestClockTime } from "@/lib/presentation";
import type { FormResult } from "@/lib/web/formState";

export interface ActionsPanelProps {
  sessionRef: string;
  csrfToken: string;
  actions: string[];
  timezone: string;
  title: string;
  description: string | null;
  billable: boolean;
  /**
   * The lengths this tenant offers, from `booking.selectable_durations_minutes`.
   * The same list the booking screen draws, so a session cannot be rescheduled
   * to a length it could not have been booked at.
   */
  durations: number[];
  /**
   * Whether the Billable box is drawn. `booking.billable_enabled` ships off,
   * because this product charges for nothing — and `editDetails` ignores the
   * field on a tenant with billing off regardless, so hiding it here is the
   * courtesy and the service is the rule.
   */
  billableEnabled: boolean;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  actualStartLocal: string;
  actualEndLocal: string;
  cancellationReasons: string[];
  missedReasons: string[];
  /**
   * Which scope starts chosen, and which panel starts open. Both come from the
   * button that was pressed — "Edit Series", "Edit Session", "Cancel session"
   * are one screen asked three ways — and neither narrows what is on it: every
   * panel is still here and the scope is still a choice.
   */
  defaultScope?: string;
  openPanel?: "edit" | "move" | "cancel" | null;
}

function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The same quarter hours the booking screen offers. */
const TIME_OPTIONS = clockTimes(CLOCK_STEP_MINUTES);

/**
 * The lengths to offer, with the session's own always among them.
 *
 * A session booked before the tenant narrowed its list still has whatever
 * length it has, and a select that did not contain it would silently reschedule
 * it to something else on the next save.
 */
function durationOptions(offered: number[], current: number) {
  const all = offered.includes(current) ? offered : [...offered, current];
  return [...all]
    .sort((a, b) => a - b)
    .map((minutes) => ({ value: String(minutes), label: durationWords(minutes) }));
}

/** One form's own result line, so an error lands beside the form that caused it. */
function Result({ state }: { state: FormResult }) {
  if (state.error) {
    return (
      <p className="notice notice-bad" role="alert">
        <span aria-hidden="true">!</span> <span>{state.error}</span>
      </p>
    );
  }
  if (state.notice) {
    return (
      <p className="notice notice-good">
        <span aria-hidden="true">✓</span> <span>{state.notice}</span>
      </p>
    );
  }
  return null;
}

export function ActionsPanel(props: ActionsPanelProps) {
  const { sessionRef, csrfToken, actions, defaultScope = "this", openPanel = null } = props;
  const has = (action: string) => actions.includes(action);
  const series = has("edit_series");

  const [decideState, decide] = useActionState(decideRequest.bind(null, sessionRef), {});
  const [editState, edit] = useActionState(editSession.bind(null, sessionRef), {});
  const [moveState, move] = useActionState(rescheduleSession.bind(null, sessionRef), {});
  const [timesState, times] = useActionState(correctActualTimes.bind(null, sessionRef), {});
  const [cancelState, cancel] = useActionState(cancelSession.bind(null, sessionRef), {});
  const [statusState, status] = useActionState(changeStatus.bind(null, sessionRef), {});

  if (actions.length === 0) return null;

  return (
    <Card>
      <h2>Actions</h2>

      {(has("approve") || has("reject")) && (
        <>
          <div className="notice notice-info">
            <span aria-hidden="true">?</span>
            <span>
              This is a booking <strong>request</strong>. It does not hold the time slot
              until it is approved, so approving re-checks for clashes.
            </span>
          </div>
          <Result state={decideState} />
          <ButtonRow as="form" action={decide} className="form-actions">
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <label className="visually-hidden" htmlFor="decide-reason">
              Reason for rejecting
            </label>
            <input
              id="decide-reason"
              name="reason"
              type="text"
              placeholder="Reason (only used when rejecting)"
              className="field-short"
            />
            {has("approve") && (
              <Button variant="primary" type="submit" name="decision" value="approve">
                Approve request
              </Button>
            )}
            {has("reject") && (
              <Button variant="danger" type="submit" name="decision" value="reject">
                Reject request
              </Button>
            )}
          </ButtonRow>
        </>
      )}

      {has("edit") && (
        <details open={openPanel === "edit"}>
          <summary>Edit details</summary>
          <Result state={editState} />
          <form action={edit}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <Field id="edit-title" label="Title">
              <input
                id="edit-title"
                name="title"
                type="text"
                required
                defaultValue={props.title}
              />
                        </Field>
            <Field id="edit-description" label="Description">
              <textarea
                id="edit-description"
                name="description"
                defaultValue={props.description ?? ""}
              />
                        </Field>
            {props.billableEnabled && (
              <Choice
                type="checkbox"
                name="billable"
                defaultChecked={props.billable}
                label="Billable"
              />
            )}
            <ScopeChoice series={series} defaultValue={defaultScope} />
            <Button variant="primary" type="submit">
              Save changes
            </Button>
          </form>
        </details>
      )}

      {has("reschedule") && (
        <details open={openPanel === "move"}>
          <summary>Reschedule</summary>
          <Result state={moveState} />
          <form action={move}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <div className="form-row">
              <Field id="new-date" label="New date">
                <input
                  id="new-date"
                  name="start_date"
                  type="date"
                  required
                  defaultValue={props.startDate}
                />
                            </Field>
              <Field id="new-time" label={<>New start time ({props.timezone})</>}>
                {/* The booking form's control, not the browser's time picker
                    — one list, one open, one choice, and the same quarter
                    hours the booking screen offers. The picker closed on the
                    first choice, so setting an hour, a minute and a meridiem
                    meant opening it three times, and it offered minutes this
                    service then refused. */}
                <OptionSelect
                  id="new-time"
                  name="start_time"
                  required
                  defaultValue={nearestClockTime(props.startTime, CLOCK_STEP_MINUTES)}
                  options={TIME_OPTIONS}
                />
                            </Field>
              <Field id="new-duration" label="Length">
                {/* The tenant's own list, for the same reason. A number input
                    stepping by five offered 35 minutes and 115, neither of
                    which `validateRequest` accepts — a control offering a
                    choice the write refuses. */}
                <OptionSelect
                  id="new-duration"
                  name="duration_minutes"
                  required
                  defaultValue={String(props.durationMinutes)}
                  options={durationOptions(props.durations, props.durationMinutes)}
                />
                            </Field>
            </div>
            <Field id="reschedule-reason" label="Reason (optional)">
              <input id="reschedule-reason" name="reason" type="text" />
                        </Field>
            <ScopeChoice series={series} defaultValue={defaultScope} />
            <p className="hint">
              A series-wide move keeps each session on its own date and moves it to the new
              wall-clock time, so a series spanning a daylight-saving change stays at the
              hour you choose.
            </p>
            <Button variant="primary" type="submit">
              Reschedule
            </Button>
          </form>
        </details>
      )}

      {has("correct_actuals") && (
        <details>
          <summary>Correct recorded times</summary>
          <Result state={timesState} />
          <form action={times}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <div className="form-row">
              <Field id="actual-start" label={<>Actually started ({props.timezone})</>}>
                <input
                  id="actual-start"
                  name="actual_start"
                  type="datetime-local"
                  defaultValue={props.actualStartLocal}
                />
                            </Field>
              <Field id="actual-end" label={<>Actually ended ({props.timezone})</>}>
                <input
                  id="actual-end"
                  name="actual_end"
                  type="datetime-local"
                  defaultValue={props.actualEndLocal}
                />
                            </Field>
            </div>
            <p className="hint">This rewrites the record of what happened, and is audited.</p>
            <Button variant="primary" type="submit">
              Save corrected times
            </Button>
          </form>
        </details>
      )}

      {has("cancel") && (
        <details open={openPanel === "cancel"}>
          <summary>Cancel</summary>
          <Result state={cancelState} />
          <form action={cancel}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <Field id="cancel-reason" label="Reason">
              <OptionSelect
                id="cancel-reason"
                name="reason"
                required
                options={props.cancellationReasons.map((reason) => ({
                  value: reason,
                  label: sentenceCase(reason),
                }))}
              />
                        </Field>
            <Field id="cancel-note" label="Note (optional)">
              <textarea id="cancel-note" name="note" />
              <Hint>
                The audit trail records that a note was given, not what it says.
              </Hint>
                        </Field>
            <ScopeChoice series={series} legend="Cancel" defaultValue={defaultScope} />
            {/* A destructive action always confirms, and the confirmation names
                what will happen rather than asking "are you sure?". */}
            <Button variant="danger"
              type="submit"
              onClick={(event) => {
                if (
                  !window.confirm(
                    "Cancel this session? Participants keep the record that it was booked.",
                  )
                ) {
                  event.preventDefault();
                }
              }}
            >
              Cancel session
            </Button>
          </form>
        </details>
      )}

      <Result state={statusState} />
      <ButtonRow>
        {has("complete") && (
          <form action={status}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <input type="hidden" name="action" value="complete" />
            <Button type="submit">
              Mark completed
            </Button>
          </form>
        )}
        {has("restore") && (
          <form action={status}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <input type="hidden" name="action" value="restore" />
            <Button type="submit">
              Restore to scheduled
            </Button>
          </form>
        )}
        {has("mark_missed") && (
          <ButtonRow as="form" action={status}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <input type="hidden" name="action" value="mark_missed" />
            <label className="visually-hidden" htmlFor="missed-reason">
              Missed reason
            </label>
            <OptionSelect
              id="missed-reason"
              name="reason"
              className="field-auto"
              options={props.missedReasons.map((reason) => ({
                value: reason,
                label: sentenceCase(reason),
              }))}
            />
            <Button type="submit">
              Mark missed
            </Button>
          </ButtonRow>
        )}
      </ButtonRow>
    </Card>
  );
}
