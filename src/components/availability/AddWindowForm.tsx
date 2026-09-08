"use client";

/**
 * Add one weekly availability window.
 *
 * The times are wall-clock in the viewer's zone, so a window declared as
 * 09:00–17:00 stays 09:00–17:00 across a daylight-saving change rather than
 * drifting by an hour.
 */

import { useActionState } from "react";

import { addAvailability } from "@/app/actions/availability";
import { Button } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import { WEEKDAY_LABELS } from "@/lib/presentation";

export function AddWindowForm({
  instructorRef,
  csrfToken,
}: {
  instructorRef: string;
  csrfToken: string;
}) {
  const [state, submit, pending] = useActionState(addAvailability, {});

  return (
    <>
      <h3 className="section-gap">Add a window</h3>
      {state.error && (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span> <span>{state.error}</span>
        </p>
      )}
      {state.notice && (
        <p className="notice notice-good">
          <span aria-hidden="true">✓</span> <span>{state.notice}</span>
        </p>
      )}
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <input type="hidden" name="instructor_ref" value={instructorRef} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="weekday">Weekday</label>
            <select id="weekday" name="weekday" required>
              {Object.entries(WEEKDAY_LABELS).map(([value, label]) => (
                <option value={value} key={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="av-start">From</label>
            <input id="av-start" name="start_time" type="time" required defaultValue="09:00" />
          </div>
          <div className="field">
            <label htmlFor="av-end">To</label>
            <input id="av-end" name="end_time" type="time" required defaultValue="17:00" />
          </div>
        </div>
        <Button variant="primary" type="submit" disabled={pending}>
          Add window
        </Button>
      </form>
    </>
  );
}
