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
import { Button, Card, Field, Hint, OptionSelect } from "@/components/ui";
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
    <Card>
      <h2>New group</h2>
      <Result state={state} />
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <Field id="group-name" label="Name">
            <input id="group-name" name="name" type="text" required maxLength={160} />
                    </Field>
          <Field id="group-capacity" label="Capacity">
            <input
              id="group-capacity"
              name="capacity"
              type="number"
              min={1}
              aria-describedby="capacity-hint"
            />
            <Hint id="capacity-hint">
              Leave empty for no limit.
            </Hint>
                    </Field>
          <Field id="group-program" label="Program">
            <OptionSelect
              id="group-program"
              name="program_ref"
              placeholder="No program"
              options={programs.map(({ ref, label }) => ({ value: ref, label }))}
            />
                    </Field>
        </div>
        <Button variant="primary" type="submit" disabled={pending}>
          Create group
        </Button>
      </form>
    </Card>
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
    <Card>
      <h2>Add a member</h2>
      <Result state={state} />
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <Field id="member-student" label="Student">
            <OptionSelect
              id="member-student"
              name="user_ref"
              placeholder="Choose a student"
              options={students.map(({ ref, label }) => ({ value: ref, label }))}
            />
                    </Field>
        </div>
        <input type="hidden" name="member_role" value="student" />
        <Button variant="primary" type="submit" disabled={pending}>
          Add student
        </Button>
      </form>

      <form action={submit} className="section-gap">
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <Field id="member-instructor" label="Instructor">
            <OptionSelect
              id="member-instructor"
              name="user_ref"
              placeholder="Choose an instructor"
              options={instructors.map(({ ref, label }) => ({ value: ref, label }))}
            />
                    </Field>
        </div>
        <input type="hidden" name="member_role" value="instructor" />
        <Button type="submit" disabled={pending}>
          Add instructor
        </Button>
      </form>
    </Card>
  );
}

/** A destructive action always confirms, naming what will happen. */
function ConfirmButton({ label, message }: { label: string; message: string }) {
  return (
    <Button size="small"
      type="submit"
      onClick={(event) => {
        if (!window.confirm(message)) event.preventDefault();
      }}
    >
      {label}
    </Button>
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
    <Card>
      <h2>New location</h2>
      <Result state={state} />
      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
        <div className="form-row">
          <Field id="location-name" label="Name">
            <input id="location-name" name="name" type="text" required maxLength={160} />
                    </Field>
          <Field id="location-capacity" label="Capacity">
            <input id="location-capacity" name="capacity" type="number" min={1} />
                    </Field>
          <Field id="location-school" label="School">
            <OptionSelect
              id="location-school"
              name="school_ref"
              placeholder="No school"
              options={schools.map(({ ref, label }) => ({ value: ref, label }))}
            />
                    </Field>
        </div>
        <Field id="location-address" label="Address">
          <textarea id="location-address" name="address" rows={2} />
                </Field>
        <Button variant="primary" type="submit" disabled={pending}>
          Create location
        </Button>
      </form>
    </Card>
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
