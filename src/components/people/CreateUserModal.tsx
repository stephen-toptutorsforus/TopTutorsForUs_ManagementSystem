"use client";

/**
 * Create one person.
 *
 * Ported from the create-user modal in `app/templates/people.html`.
 *
 * Three steps: who, then the details that differ by role, then a confirmation
 * read out of the form itself so it cannot drift from what will be submitted.
 * It is one form and one submission either way — the steps are a way of asking,
 * not three round trips.
 *
 * One role is chosen here. A person may hold several; the rest are added once
 * the account exists, so they keep one account and one history.
 *
 * The modal opens from the URL fragment, which is what the stylesheet's
 * `:target` rules key on — the panel opens, submits and closes with the script
 * doing nothing, and the script only adds the steps and the summary.
 */

import { useActionState, useState } from "react";

import { createPersonAction } from "@/app/actions/people";
import {
  Button,
  Choice,
  ChoiceGroup,
  EmailField,
  Field,
  Hint,
  Modal,
  OptionSelect,
  PhoneField,
} from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import { isEmail } from "@/lib/shapes";

import { LocationPickers } from "./LocationPickers";
import { Picker, type PickerOption } from "./Picker";

export interface CreateUserModalProps {
  csrfToken: string;
  creatableRoles: { value: string; label: string }[];
  guardianRelationships: { value: string; label: string }[];
  instructors: PickerOption[];
  students: PickerOption[];
  parents: { ref: string; label: string }[];
  schools: PickerOption[];
  regions: PickerOption[];
}

const STEPS = ["Who", "Details", "Confirm"] as const;

export function CreateUserModal(props: CreateUserModalProps) {
  const [state, submit, pending] = useActionState(createPersonAction, {});
  const [step, setStep] = useState(1);

  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  // The first role the form offers rather than an empty option. A select whose
  // first entry is an instruction has one row that is not a choice, and the
  // person has to make a decision before they can see what the decisions are.
  // Step two's fields are what actually differ by role, and they are one click
  // away either way.
  const [role, setRole] = useState(props.creatableRoles[0]?.value ?? "");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [requiresGuardian, setRequiresGuardian] = useState("no");
  const [guardianRef, setGuardianRef] = useState("");
  const [relationship, setRelationship] = useState("parent");

  const [instructorRefs, setInstructorRefs] = useState<string[]>([]);
  const [studentRefs, setStudentRefs] = useState<string[]>([]);
  const [schoolRefs, setSchoolRefs] = useState<string[]>([]);
  const [regionRefs, setRegionRefs] = useState<string[]>([]);

  const whoIsComplete = Boolean(firstName.trim() && lastName.trim() && role);

  /** A student whose parent will be doing the onboarding has no address. */
  const parentOnboards = role === "student" && requiresGuardian === "yes";

  /**
   * What step two actually asks, for this role and this branch of it.
   *
   * The state outlives the fields: switching from Parent to Admin leaves a
   * phone number in `phone`, and answering Yes to "requires a parent" leaves an
   * address in `email`. Neither is submitted — the input is not rendered, so it
   * is not in the form — but the confirmation read them straight out of state
   * and listed them, which is the one place a person is told what they are
   * about to create. So both the fields and the summary are drawn from this,
   * rather than from two conditions that agree until somebody edits one.
   */
  const asks = {
    email: !parentOnboards,
    phone: (role === "student" && !parentOnboards) || role === "parent",
    guardian: parentOnboards,
    relationship: role === "parent",
    instructors: role === "student",
    students: role === "parent",
    schools: role === "student" || role === "instructor",
    regions:
      role === "student" || role === "instructor" || role === "regional_admin",
  };

  // What step two needs before it can be left. Checked here as well as on the
  // server, because a hidden field is not a constraint.
  //
  // A *well-formed* address, not merely a present one. The field says so where
  // it was typed; this is what stops somebody carrying `bob@` past it, and it
  // matters more than it looks: the panels are `hidden` on the confirm step, so
  // an invalid `required` input there would fail submission with a browser
  // message about a control it cannot scroll to. The gate means that never
  // happens.
  const detailsComplete = (() => {
    if (parentOnboards) return Boolean(guardianRef);
    if (role === "regional_admin") return isEmail(email) && regionRefs.length > 0;
    return isEmail(email);
  })();

  const labelFor = (options: PickerOption[], refs: string[]) =>
    refs.map((ref) => options.find((option) => option.ref === ref)?.label ?? ref).join(", ");

  const summary: [string, string][] = [
    ["First name", firstName],
    ["Last name", lastName],
    ["Role", props.creatableRoles.find((r) => r.value === role)?.label ?? role],
    ...(asks.email && email ? ([["Email", email]] as [string, string][]) : []),
    ...(asks.phone && phone ? ([["Phone", phone]] as [string, string][]) : []),
    ...(asks.guardian
      ? ([
          [
            "Parent",
            props.parents.find((p) => p.ref === guardianRef)?.label ?? guardianRef,
          ],
        ] as [string, string][])
      : []),
    ...(asks.relationship
      ? ([
          [
            "Relationship",
            props.guardianRelationships.find((k) => k.value === relationship)?.label ??
              relationship,
          ],
        ] as [string, string][])
      : []),
    ...(asks.instructors && instructorRefs.length > 0
      ? ([["Instructors", labelFor(props.instructors, instructorRefs)]] as [string, string][])
      : []),
    ...(asks.students && studentRefs.length > 0
      ? ([["Students", labelFor(props.students, studentRefs)]] as [string, string][])
      : []),
    ...(asks.schools && schoolRefs.length > 0
      ? ([["Schools", labelFor(props.schools, schoolRefs)]] as [string, string][])
      : []),
    ...(asks.regions && regionRefs.length > 0
      ? ([["Regions", labelFor(props.regions, regionRefs)]] as [string, string][])
      : []),
  ];

  /** Both are visible with no script; with one, only the current step is. */
  const panel = (index: number) => ({
    className: "step-panel",
    "data-step": index,
    hidden: step !== index,
  });

  return (
    <Modal
      id="create-user"
      // One title for every step and every role: the heading names the
      // task, and a heading that changed under the person would read as a
      // different form each time.
      title="Create User"
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

      <ol className="steps" aria-hidden="true">
        {STEPS.map((label, index) => (
          <li
            className={`step ${step === index + 1 ? "is-current" : ""}`}
            key={label}
          >
            <span>{index + 1}</span> {label}
          </li>
        ))}
      </ol>

      <form action={submit}>
        <input type="hidden" name={CSRF_FIELD} value={csrfTokenOf(props)} />

        <section {...panel(1)}>
          <div className="form-row">
            <Field id="first_name" label="First name">
              <input
                id="first_name"
                name="first_name"
                type="text"
                required
                maxLength={80}
                value={firstName}
                onChange={(event) => setFirstName(event.target.value)}
              />
                        </Field>
            <Field id="last_name" label="Last name">
              <input
                id="last_name"
                name="last_name"
                type="text"
                required
                maxLength={80}
                value={lastName}
                onChange={(event) => setLastName(event.target.value)}
              />
                        </Field>
          </div>
          <Field id="new-role" label="Role">
            <OptionSelect
              id="new-role"
              name="role"
              required
              value={role}
              onChange={(event) => setRole(event.target.value)}
              options={props.creatableRoles}
            />
            <Hint>
              One role now. A person may hold several — add the rest once the account
              exists, so they keep one account and one history.
            </Hint>
                    </Field>

          {/* Only Next on the first step, and inert until the three fields
              above are filled. */}
          <div className="modal-actions">
            <Button variant="primary"
              type="button"
              disabled={!whoIsComplete}
              onClick={() => setStep(2)}
            >
              Next
            </Button>
          </div>
        </section>

        <section {...panel(2)}>
          {role === "student" && (
            <>
              <ChoiceGroup
                legend="Does this student require a parent?"
                legendClassName="fieldset-legend"
                hint={
                  <p className="hint">
                    If <strong>Yes</strong>, the parent will be in charge of setting the
                    student&rsquo;s email or username and the student&rsquo;s password
                    during the account creation process. To send the onboarding email
                    directly to the student, select <strong>No</strong>.
                  </p>
                }
              >
                <Choice
                  type="radio"
                  name="requires_guardian"
                  value="yes"
                  checked={requiresGuardian === "yes"}
                  onChange={() => setRequiresGuardian("yes")}
                  label="Yes"
                />
                <Choice
                  type="radio"
                  name="requires_guardian"
                  value="no"
                  checked={requiresGuardian === "no"}
                  onChange={() => setRequiresGuardian("no")}
                  label="No"
                />
              </ChoiceGroup>

              {requiresGuardian === "yes" ? (
                <Field id="guardian_ref" label="Select parent">
                  <OptionSelect
                    id="guardian_ref"
                    name="guardian_ref"
                    value={guardianRef}
                    onChange={(event) => setGuardianRef(event.target.value)}
                    placeholder="Choose a parent"
                    options={props.parents.map(({ ref, label }) => ({ value: ref, label }))}
                  />
                  {props.parents.length === 0 && (
                    <Hint>
                      No parents yet — create one first, or choose <strong>No</strong> to
                      onboard the student directly.
                    </Hint>
                  )}
                                </Field>
              ) : (
                // "Student email address", not "Email address": on this branch
                // the student is the one being written to, and the form has
                // just finished asking about a parent who might have been.
                <EmailField
                  id="student-email"
                  label="Student email address"
                  placeholder="student@example.com"
                  hint="The onboarding email goes here."
                  value={email}
                  onChange={setEmail}
                />
              )}

              {/* No phone when a parent is doing the onboarding. It would be
                  the parent's number under the student's name — the parent
                  already has their own, and nothing would ever ring this one. */}
              {asks.phone && (
                <PhoneField
                  id="student-phone"
                  label="Phone"
                  placeholder="e.g. 555 0134"
                  value={phone}
                  onChange={setPhone}
                />
              )}

              <Picker
                label="Select instructors"
                name="instructor"
                placeholder="Search instructors"
                options={props.instructors}
                chosen={instructorRefs}
                onChange={setInstructorRefs}
              />

              <LocationPickers
                subject="student"
                schools={props.schools}
                schoolRefs={schoolRefs}
                onSchools={setSchoolRefs}
                regions={props.regions}
                regionRefs={regionRefs}
                onRegions={setRegionRefs}
              />
            </>
          )}

          {role === "parent" && (
            <>
              <EmailField
                id="parent-email"
                label="Email"
                placeholder="parent@example.com"
                value={email}
                onChange={setEmail}
              />
              <PhoneField
                id="parent-phone"
                label="Phone"
                placeholder="e.g. 555 0134"
                value={phone}
                onChange={setPhone}
              />
              <Field id="relationship" label="Relationship">
                <OptionSelect
                  id="relationship"
                  name="relationship"
                  value={relationship}
                  onChange={(event) => setRelationship(event.target.value)}
                  options={props.guardianRelationships}
                />
                <Hint>
                  What this person is to the student. All four can be shown the
                  student&rsquo;s sessions; a report tells them apart.
                </Hint>
                            </Field>
              <Picker
                label="Select students"
                name="student"
                placeholder="Search students"
                options={props.students}
                chosen={studentRefs}
                onChange={setStudentRefs}
              />
            </>
          )}

          {role === "instructor" && (
            <>
              <EmailField
                id="instructor-email"
                label="Email"
                placeholder="instructor@example.com"
                value={email}
                onChange={setEmail}
              />
              <LocationPickers
                subject="instructor"
                schools={props.schools}
                schoolRefs={schoolRefs}
                onSchools={setSchoolRefs}
                regions={props.regions}
                regionRefs={regionRefs}
                onRegions={setRegionRefs}
              />
            </>
          )}

          {role === "admin" && (
            <EmailField
              id="admin-email"
              label="Email"
              placeholder="admin@example.com"
              hint="The onboarding email goes here."
              value={email}
              onChange={setEmail}
            />
          )}

          {role === "regional_admin" && (
            <>
              <EmailField
                id="regional-email"
                label="Email"
                placeholder="admin@example.com"
                value={email}
                onChange={setEmail}
              />
              {/* The regions are not decoration: `Principal.regionIds` is read
                  from the role rows, so what is chosen here is what bounds
                  everything this person will be allowed to see. */}
              <Picker
                label="Select Regions"
                name="region"
                placeholder="Search regions"
                options={props.regions}
                chosen={regionRefs}
                onChange={setRegionRefs}
                required
                hint="This is what bounds what they can see, so at least one is required."
              />
            </>
          )}

          <div className="modal-actions">
            <Button type="button" onClick={() => setStep(1)}>
              Back
            </Button>
            <Button variant="primary"
              type="button"
              disabled={!detailsComplete}
              onClick={() => setStep(3)}
            >
              Next
            </Button>
          </div>
        </section>

        {/* Everything shown here is read out of the form's own state, so it
            cannot drift from what will actually be submitted. */}
        <section {...panel(3)}>
          <h3 className="confirm-title">
            Create {props.creatableRoles.find((r) => r.value === role)?.label ?? "user"}:{" "}
            {`${firstName} ${lastName}`.trim()}
          </h3>
          <dl className="confirm-list">
            {summary.map(([term, value]) => (
              <div key={term}>
                <dt>{term}</dt>
                <dd>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="modal-actions">
            <Button type="button" onClick={() => setStep(2)}>
              Back
            </Button>
            <Button variant="primary" type="submit" disabled={pending}>
              Create user
            </Button>
          </div>
        </section>
      </form>
    </Modal>
  );
}

/** The token travels as a prop; named separately to keep the JSX readable. */
function csrfTokenOf(props: CreateUserModalProps): string {
  return props.csrfToken;
}
