"use client";

/**
 * Assign a student to an instructor.
 *
 * Ported from the assign modal in `app/templates/people.html`. Where the
 * organization restricts booking to assigned people, this link is what makes
 * each of them bookable by the other.
 *
 * One dialog for the whole table, opened from any row's button — see
 * `PeopleOverlays`. The row travels with the request, so the person whose row
 * was pressed starts chosen; before, the dialog opened empty and you had to
 * find them again in a select of everybody.
 *
 * Only a student can be preselected, because only a student is what the free
 * end of this relationship is. A row for somebody who is neither opens the
 * dialog with nothing chosen rather than with a guess.
 */

import { useActionState, useRef } from "react";

import { assignStudentAction } from "@/app/actions/people";
import { Button, Field, Modal, OptionSelect } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";

import type { AssignTarget } from "./PeopleOverlays";

export function AssignModal({
  open,
  onOpenChange,
  csrfToken,
  instructors,
  students,
  target,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  csrfToken: string;
  instructors: { ref: string; label: string }[];
  students: { ref: string; label: string }[];
  target?: AssignTarget | null;
}) {
  const [state, submit, pending] = useActionState(assignStudentAction, {});
  const firstField = useRef<HTMLSelectElement>(null);

  const chosenStudent = students.some((student) => student.ref === target?.ref)
    ? target?.ref
    : undefined;

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Assign a student to an instructor"
      subtitle="Where the organization restricts booking to assigned people, this link is what makes each of them bookable by the other."
      // The instructor, not the close button: the student half is usually
      // already answered by the row this was opened from.
      initialFocusRef={firstField}
    >
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
        <div className="form-row">
          <Field id="assign-instructor" label="Instructor">
            <OptionSelect
              id="assign-instructor"
              name="instructor_ref"
              ref={firstField}
              required
              options={instructors.map(({ ref, label }) => ({ value: ref, label }))}
            />
          </Field>
          <Field id="assign-student" label="Student">
            <OptionSelect
              id="assign-student"
              name="student_ref"
              required
              defaultValue={chosenStudent}
              options={students.map(({ ref, label }) => ({ value: ref, label }))}
            />
          </Field>
        </div>
        <div className="modal-actions">
          {/* A button, not a link to `#`. It closes the dialog and submits
              nothing — `type="button"` is what makes that true inside a form. */}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" disabled={pending}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}
