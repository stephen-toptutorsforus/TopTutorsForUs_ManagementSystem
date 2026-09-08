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
import { Button, ButtonRow, Card, Field, Hint, ScopeChoice } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import type { FormResult } from "@/lib/web/formState";

export interface ActionsPanelProps {
  sessionRef: string;
  csrfToken: string;
  actions: string[];
  timezone: string;
  title: string;
  description: string | null;
  billable: boolean;
  startDate: string;
  startTime: string;
  durationMinutes: number;
  actualStartLocal: string;
  actualEndLocal: string;
  cancellationReasons: string[];
  missedReasons: string[];
}

function sentenceCase(value: string): string {
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
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
  const { sessionRef, csrfToken, actions } = props;
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
        <details>
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
            <label className="choice">
              <input type="checkbox" name="billable" defaultChecked={props.billable} />
              <span>Billable</span>
            </label>
            <ScopeChoice series={series} />
            <Button variant="primary" type="submit">
              Save changes
            </Button>
          </form>
        </details>
      )}

      {has("reschedule") && (
        <details>
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
                <input
                  id="new-time"
                  name="start_time"
                  type="time"
                  required
                  defaultValue={props.startTime}
                />
                            </Field>
              <Field id="new-duration" label="Length in minutes">
                <input
                  id="new-duration"
                  name="duration_minutes"
                  type="number"
                  min={5}
                  step={5}
                  required
                  defaultValue={props.durationMinutes}
                />
                            </Field>
            </div>
            <Field id="reschedule-reason" label="Reason (optional)">
              <input id="reschedule-reason" name="reason" type="text" />
                        </Field>
            <ScopeChoice series={series} />
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
        <details>
          <summary>Cancel</summary>
          <Result state={cancelState} />
          <form action={cancel}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
            <Field id="cancel-reason" label="Reason">
              <select id="cancel-reason" name="reason" required>
                {props.cancellationReasons.map((reason) => (
                  <option key={reason} value={reason}>
                    {sentenceCase(reason)}
                  </option>
                ))}
              </select>
                        </Field>
            <Field id="cancel-note" label="Note (optional)">
              <textarea id="cancel-note" name="note" />
              <Hint>
                The audit trail records that a note was given, not what it says.
              </Hint>
                        </Field>
            <ScopeChoice series={series} legend="Cancel" />
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
            <select id="missed-reason" name="reason" className="field-auto">
              {props.missedReasons.map((reason) => (
                <option key={reason} value={reason}>
                  {sentenceCase(reason)}
                </option>
              ))}
            </select>
            <Button type="submit">
              Mark missed
            </Button>
          </ButtonRow>
        )}
      </ButtonRow>
    </Card>
  );
}
