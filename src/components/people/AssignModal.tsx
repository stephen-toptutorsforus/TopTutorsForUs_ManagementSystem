"use client";

/**
 * Assign a student to an instructor.
 *
 * Ported from the assign modal in `app/templates/people.html`. Where the
 * organization restricts booking to assigned people, this link is what makes
 * each of them bookable by the other.
 */

import { useActionState } from "react";

import { assignStudentAction } from "@/app/actions/people";
import { Modal } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";

export function AssignModal({
  csrfToken,
  instructors,
  students,
}: {
  csrfToken: string;
  instructors: { ref: string; label: string }[];
  students: { ref: string; label: string }[];
}) {
  const [state, submit, pending] = useActionState(assignStudentAction, {});

  return (
    <Modal
      id="assign-people"
      title="Assign a student to an instructor"
      subtitle="Where the organization restricts booking to assigned people, this link is what makes each of them bookable by the other."
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
          <div className="field">
            <label htmlFor="assign-instructor">Instructor</label>
            <select id="assign-instructor" name="instructor_ref" required>
              {instructors.map((person) => (
                <option value={person.ref} key={person.ref}>
                  {person.label}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="assign-student">Student</label>
            <select id="assign-student" name="student_ref" required>
              {students.map((person) => (
                <option value={person.ref} key={person.ref}>
                  {person.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="modal-actions">
          <a className="btn" href="#">
            Cancel
          </a>
          <button className="btn btn-primary" type="submit" disabled={pending}>
            Assign
          </button>
        </div>
      </form>
    </Modal>
  );
}
