"use client";

/**
 * The forms on the groups and locations screens.
 *
 * Ported from `app/templates/structure/*.html`. Each carries its own result
 * line, so a refusal lands beside the form that caused it.
 */

import { useActionState } from "react";

import {
  addGroupMemberAction,
  archiveGroupAction,
  archiveLocationAction,
  createGroupAction,
  createLocationAction,
  removeGroupMemberAction,
} from "@/app/actions/structure";
import { CSRF_FIELD } from "@/lib/names";
import type { FormResult } from "@/lib/web/formState";

interface Choice {
  ref: string;
  label: string;
}

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

export function NewGroupForm({
  csrfToken,
  programs,
}: {
  csrfToken: string;
  programs: Choice[];
}) {
  const [state, submit, pending] = useActionState(createGroupAction, {});

  return (
    <div className="card">
      <h2>New group</h2>
      <Result state={state} />
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="group-name">Name</label>
            <input id="group-name" name="name" type="text" required maxLength={160} />
          </div>
          <div className="field">
            <label htmlFor="group-capacity">Capacity</label>
            <input
              id="group-capacity"
              name="capacity"
              type="number"
              min={1}
              aria-describedby="capacity-hint"
            />
            <span className="hint" id="capacity-hint">
              Leave empty for no limit.
            </span>
          </div>
          <div className="field">
            <label htmlFor="group-program">Program</label>
            <select id="group-program" name="program_ref">
              <option value="">No program</option>
              {programs.map((program) => (
                <option value={program.ref} key={program.ref}>
                  {program.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          Create group
        </button>
      </form>
    </div>
  );
}

export function AddMemberForms({
  groupRef,
  csrfToken,
  students,
  instructors,
}: {
  groupRef: string;
  csrfToken: string;
  students: Choice[];
  instructors: Choice[];
}) {
  const [state, submit, pending] = useActionState(
    addGroupMemberAction.bind(null, groupRef),
    {},
  );

  return (
    <div className="card">
      <h2>Add a member</h2>
      <Result state={state} />
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="member-student">Student</label>
            <select id="member-student" name="user_ref">
              <option value="">Choose a student</option>
              {students.map((person) => (
                <option value={person.ref} key={person.ref}>
                  {person.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input type="hidden" name="member_role" value="student" />
        <button className="btn btn-primary" type="submit" disabled={pending}>
          Add student
        </button>
      </form>

      <form action={submit} className="section-gap">
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="member-instructor">Instructor</label>
            <select id="member-instructor" name="user_ref">
              <option value="">Choose an instructor</option>
              {instructors.map((person) => (
                <option value={person.ref} key={person.ref}>
                  {person.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <input type="hidden" name="member_role" value="instructor" />
        <button className="btn" type="submit" disabled={pending}>
          Add instructor
        </button>
      </form>
    </div>
  );
}

/** A destructive action always confirms, naming what will happen. */
function ConfirmButton({ label, message }: { label: string; message: string }) {
  return (
    <button
      className="btn btn-small"
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {label}
    </button>
  );
}

export function RemoveMemberForm({
  groupRef,
  csrfToken,
  memberId,
  name,
}: {
  groupRef: string;
  csrfToken: string;
  memberId: string;
  name: string;
}) {
  const [, submit] = useActionState(removeGroupMemberAction.bind(null, groupRef), {});

  return (
    <form action={submit}>
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      <input type="hidden" name="member_id" value={memberId} />
      <ConfirmButton
        label="Remove"
        message={`Remove ${name} from this group? Sessions already booked keep them.`}
      />
    </form>
  );
}

export function ArchiveGroupForm({
  groupRef,
  csrfToken,
  name,
}: {
  groupRef: string;
  csrfToken: string;
  name: string;
}) {
  const [, submit] = useActionState(archiveGroupAction.bind(null, groupRef), {});

  return (
    <form action={submit}>
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      <ConfirmButton
        label="Archive group"
        message={`Archive ${name}? Sessions already booked with it keep it.`}
      />
    </form>
  );
}

export function NewLocationForm({
  csrfToken,
  schools,
}: {
  csrfToken: string;
  schools: Choice[];
}) {
  const [state, submit, pending] = useActionState(createLocationAction, {});

  return (
    <div className="card">
      <h2>New location</h2>
      <Result state={state} />
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <div className="field">
            <label htmlFor="location-name">Name</label>
            <input id="location-name" name="name" type="text" required maxLength={160} />
          </div>
          <div className="field">
            <label htmlFor="location-capacity">Capacity</label>
            <input id="location-capacity" name="capacity" type="number" min={1} />
          </div>
          <div className="field">
            <label htmlFor="location-school">School</label>
            <select id="location-school" name="school_ref">
              <option value="">No school</option>
              {schools.map((school) => (
                <option value={school.ref} key={school.ref}>
                  {school.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="field">
          <label htmlFor="location-address">Address</label>
          <textarea id="location-address" name="address" rows={2} />
        </div>
        <button className="btn btn-primary" type="submit" disabled={pending}>
          Create location
        </button>
      </form>
    </div>
  );
}

export function ArchiveLocationForm({
  locationRef,
  csrfToken,
  name,
}: {
  locationRef: string;
  csrfToken: string;
  name: string;
}) {
  const [, submit] = useActionState(archiveLocationAction.bind(null, locationRef), {});

  return (
    <form action={submit}>
      <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
      <ConfirmButton
        label="Archive"
        message={`Archive ${name}? Sessions already held there keep it.`}
      />
    </form>
  );
}
