"use client";

/**
 * One person's record, opened from their name in the directory.
 *
 * Three forms, not one, because they are three decisions with three different
 * guards: correcting a detail needs `USER_MANAGE`, setting a password needs an
 * administrator, and archiving is the one that takes an account away. A single
 * Save doing all three is a form where a slip of the hand is a lockout.
 *
 * Laid out as two columns on a wide screen — the record on the left, the
 * password on the right — because those are the two things somebody opens this
 * for, and stacking them puts the second below the fold of a long form. Below
 * the breakpoint they stack in that order, which is also their order of use.
 *
 * **The archive control is last, and says what it does before it says its own
 * name.** It is the only irreversible-feeling thing here — it is not actually
 * irreversible, and the sentence beside it says so.
 */

import { useActionState, useState } from "react";

import {
  archivePersonAction,
  editPersonAction,
  setPasswordAction,
  setPlacementsAction,
} from "@/app/actions/people";
import {
  Button,
  Card,
  CardSection,
  Choice,
  Fact,
  Field,
  Hint,
  Tag,
  UserStatusBadge,
  useSettled,
} from "@/components/ui";
import { UserStatus } from "@/generated/prisma/enums";
import { CSRF_FIELD } from "@/lib/names";
import { MIN_PASSWORD_LENGTH } from "@/lib/shapes";
import type { PersonSheetData } from "@/lib/web/personSheet";
import type { FormResult } from "@/lib/web/formState";

import { LocationPickers } from "./LocationPickers";
import type { PickerOption } from "./Picker";

/** One form's own failure, beside the form that caused it. */
function Failure({ state }: { state: FormResult }) {
  if (!state.error) return null;
  return (
    <p className="notice notice-bad" role="alert">
      <span aria-hidden="true">!</span> <span>{state.error}</span>
    </p>
  );
}

export function PersonSheet({
  person,
  csrfToken,
  canManage,
  onDone,
  schools,
  regions,
}: {
  person: PersonSheetData;
  csrfToken: string;
  /** `USER_MANAGE`. Without it this is a record to read, not one to change. */
  canManage: boolean;
  /** Called when an action has succeeded and the drawer should go. */
  onDone: () => void;
  schools: PickerOption[];
  regions: PickerOption[];
}) {
  const [edit, submitEdit, editing] = useActionState(
    editPersonAction.bind(null, person.ref),
    {},
  );
  const [placements, submitPlacements, placing] = useActionState(
    setPlacementsAction.bind(null, person.ref),
    {},
  );
  const [password, submitPassword, settingPassword] = useActionState(
    setPasswordAction.bind(null, person.ref),
    {},
  );
  const [archive, submitArchive, archiving] = useActionState(
    archivePersonAction.bind(null, person.ref),
    {},
  );

  const [schoolRefs, setSchoolRefs] = useState<string[]>([...person.schoolRefs]);
  const [regionRefs, setRegionRefs] = useState<string[]>([...person.regionRefs]);
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [passwordMismatch, setPasswordMismatch] = useState(false);

  // Each closes the drawer on success and announces it on the page behind —
  // see `useSettled`. The directory underneath has already been revalidated by
  // the action, so the row somebody reads after it closes is the new one.
  useSettled(edit, onDone);
  useSettled(placements, onDone);
  useSettled(password, onDone);
  useSettled(archive, onDone);

  return (
    <div className="person-sheet">
      <div className="person-sheet-main">
        <Card as="section" className="card-padded">
          <h3>Details and profile</h3>

          <Failure state={edit} />

          <form action={submitEdit}>
            <input type="hidden" name={CSRF_FIELD} value={csrfToken} />

            <CardSection title="Personal details">
              <div className="form-row">
                <Field id="person-first" label="First name">
                  <input
                    id="person-first"
                    name="first_name"
                    type="text"
                    required
                    maxLength={80}
                    defaultValue={person.firstName}
                    disabled={!canManage}
                  />
                </Field>
                <Field id="person-last" label="Last name">
                  <input
                    id="person-last"
                    name="last_name"
                    type="text"
                    required
                    maxLength={80}
                    defaultValue={person.lastName}
                    disabled={!canManage}
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field id="person-email" label="Email address">
                  <input
                    id="person-email"
                    name="email"
                    type="email"
                    autoComplete="off"
                    defaultValue={person.email ?? ""}
                    disabled={!canManage}
                  />
                  <Hint>
                    Their sign-in name. One per person per organization; clearing it
                    leaves an account nobody can sign in to.
                  </Hint>
                </Field>
                <Field id="person-phone" label="Phone">
                  <input
                    id="person-phone"
                    name="phone"
                    type="tel"
                    defaultValue={person.phone ?? ""}
                    disabled={!canManage}
                  />
                </Field>
              </div>
              <div className="form-row">
                <Field id="person-timezone" label="Timezone">
                  <input
                    id="person-timezone"
                    name="timezone"
                    type="text"
                    placeholder="America/New_York"
                    defaultValue={person.timezone ?? ""}
                    disabled={!canManage}
                  />
                  <Hint>
                    An IANA name. It is the clock their calendar is drawn on; a
                    session still records the zone it was booked in.
                  </Hint>
                </Field>
                <Field id="person-grade" label="Grade">
                  <input
                    id="person-grade"
                    name="grade"
                    type="text"
                    maxLength={32}
                    defaultValue={person.grade ?? ""}
                    disabled={!canManage}
                  />
                </Field>
              </div>
            </CardSection>

            {/* What this screen does not change, said rather than left to be
                discovered. Roles carry a regional administrator's scope with
                them, so granting one is a privilege decision with its own guard
                rather than a field on a details form. */}
            <CardSection title="Roles and links">
              <div className="form-row">
                <Fact label="Roles">
                  {person.roleNames.length > 0
                    ? person.roleNames.map((name) => <Tag key={name}>{name}</Tag>)
                    : null}
                </Fact>
                <Fact label="Account status">
                  <UserStatusBadge status={person.status.toUpperCase() as UserStatus} />
                </Fact>
              </div>
              <Fact label="Relationships" wide>
                {person.connections.length > 0
                  ? person.connections.map((link) => `${link.name} — ${link.kind}`).join(", ")
                  : null}
              </Fact>
              <div className="form-row">
                <Fact label="Groups">
                  {person.groups.length > 0 ? person.groups.join(", ") : null}
                </Fact>
                <Fact label="Last signed in">{person.lastLoginLabel}</Fact>
              </div>
              <Hint>
                Roles, relationships and groups are changed from the directory and
                from the group pages, not here. Schools and regions are the card
                below.
              </Hint>
            </CardSection>

            {canManage && (
              <div className="btn-row person-sheet-save">
                <Button variant="primary" type="submit" disabled={editing}>
                  {editing ? "Saving…" : "Save"}
                </Button>
              </div>
            )}
          </form>
        </Card>

        {(schools.length > 0 || regions.length > 0) && (
          <Card as="section" className="card-padded">
            <h3>Schools and regions</h3>
            <Failure state={placements} />
            {canManage ? (
              <form action={submitPlacements}>
                <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
                <LocationPickers
                  subject={person.roleNames.includes("Instructor") ? "instructor" : "person"}
                  schools={schools}
                  schoolRefs={schoolRefs}
                  onSchools={setSchoolRefs}
                  regions={regions}
                  regionRefs={regionRefs}
                  onRegions={setRegionRefs}
                />
                <div className="btn-row">
                  <Button variant="primary" type="submit" disabled={placing}>
                    {placing ? "Saving…" : "Save placements"}
                  </Button>
                </div>
              </form>
            ) : (
              <Fact label="Placed at">
                {schoolRefs.length > 0
                  ? schoolRefs
                      .map((ref) => schools.find((school) => school.ref === ref)?.label ?? ref)
                      .join(", ")
                  : regionRefs.length > 0
                    ? regionRefs
                        .map((ref) => regions.find((region) => region.ref === ref)?.label ?? ref)
                        .join(", ")
                    : null}
              </Fact>
            )}
          </Card>
        )}

        {person.canArchive && (
          <Card as="section" className="card-padded person-sheet-archive">
            <h3>{person.archived ? "Restore this account" : "Stop this account being used"}</h3>
            <Failure state={archive} />
            <p className="hint">
              {person.archived
                ? "They can sign in again, and appear in the directory and the pickers."
                : "They can no longer sign in, and disappear from the directory and from every picker. Nothing they did is removed — every session they are named on stays exactly as it is, and this can be undone."}
            </p>
            <form action={submitArchive}>
              <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
              <Button
                variant={person.archived ? "primary" : "danger"}
                type="submit"
                disabled={archiving}
              >
                {person.archived ? "Restore user" : "Archive user"}
              </Button>
            </form>
          </Card>
        )}
      </div>

      <div className="person-sheet-side">
        <Card as="section" className="card-padded">
          <h3>Reset password</h3>

          {person.canSetPassword ? (
            <>
              {passwordMismatch ? (
                <p className="notice notice-bad" role="alert">
                  <span aria-hidden="true">!</span>{" "}
                  <span>those two passwords are not the same</span>
                </p>
              ) : (
                <Failure state={password} />
              )}
              <p className="hint">
                {person.hasPassword
                  ? "Sets a new one immediately. Tell them in person — it is never emailed, and it is not recorded anywhere you can read it back."
                  : "They have never set one. Giving them a password here also makes the account usable."}
              </p>
              {/* Held in state, and refused here before the action runs. A
                  server action resets the form when it returns, including
                  when it returns the mismatch, which wiped both boxes at the
                  moment the warning appeared. */}
              <form
                action={submitPassword}
                onSubmit={(event) => {
                  if (nextPassword !== confirmPassword) {
                    event.preventDefault();
                    setPasswordMismatch(true);
                  }
                }}
              >
                <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
                <Field id="person-password" label="New password">
                  <input
                    id="person-password"
                    name="password"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={nextPassword}
                    onChange={(event) => {
                      setNextPassword(event.target.value);
                      setPasswordMismatch(false);
                    }}
                  />
                  <Hint>At least {MIN_PASSWORD_LENGTH} characters. Length is the whole rule.</Hint>
                </Field>
                <Field id="person-password-again" label="Confirm new password">
                  <input
                    id="person-password-again"
                    name="password_confirm"
                    type={showPassword ? "text" : "password"}
                    required
                    minLength={MIN_PASSWORD_LENGTH}
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(event) => {
                      setConfirmPassword(event.target.value);
                      setPasswordMismatch(false);
                    }}
                  />
                </Field>
                {/* A checkbox rather than an eye glyph on the field: it belongs
                    to both boxes, and an unlabelled icon inside one of them says
                    nothing about the other. */}
                <Choice
                  type="checkbox"
                  name="show_password"
                  label="Show password"
                  checked={showPassword}
                  onChange={(event) => setShowPassword(event.target.checked)}
                />
                <div className="btn-row">
                  <Button variant="primary" type="submit" disabled={settingPassword}>
                    {settingPassword ? "Setting…" : "Change password"}
                  </Button>
                </div>
              </form>
            </>
          ) : (
            <p className="hint">
              {/* Said rather than hidden: a missing panel reads as a missing
                  feature, and the reason is worth knowing. */}
              Only an administrator can set somebody else&rsquo;s password, and never
              another administrator&rsquo;s or their own.
            </p>
          )}
        </Card>
      </div>
    </div>
  );
}
