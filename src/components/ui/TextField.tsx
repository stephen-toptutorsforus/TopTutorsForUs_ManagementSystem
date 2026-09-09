"use client";

/**
 * The two fields every form asks for, each knowing when it is wrong.
 *
 * An email input was written out five times in the create-user modal alone —
 * once per role — and each copy carried its own id, its own label, its own
 * `maxLength={320}` and its own placeholder. They agreed by luck rather than by
 * construction, and none of them said anything when what was typed was not an
 * address: the form let it through, the step gate let it through, and the
 * service refused it at the end, three steps from the field that caused it.
 *
 * So the field owns the rule. It tests the same regex the service tests — one
 * definition in `lib/shapes.ts`, imported by both — and reports the failure
 * where the answer was given.
 *
 * **It waits until the field has been left.** Turning an input red while
 * somebody is halfway through typing an address is telling them off for not
 * having finished; `a` is not a wrong answer to "email", it is an unfinished
 * one. The message appears on blur, and once a field has been judged it keeps
 * judging on every keystroke, so the red goes away the moment it is fixed
 * rather than at the next blur.
 *
 * The message is a `role="alert"` and the input is `aria-invalid` with an
 * `aria-describedby` pointing at it, so it is announced rather than only drawn
 * in a colour.
 */

import { useState } from "react";

import { PHONE_PATTERN, isEmail, isPhone } from "@/lib/shapes";

import { Field, Hint } from "./Field";

/** What both fields share: everything but the rule they judge by. */
interface TextFieldProps {
  id: string;
  /** Defaults to `email` / `phone` — the names the action reads. */
  name?: string;
  label: React.ReactNode;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  /** Secondary text under the control, when the field needs explaining. */
  hint?: React.ReactNode;
  required?: boolean;
}

/**
 * The message a field shows, or null while it has nothing to say.
 *
 * Empty and required is a different failure from present and malformed, and
 * they are worth different sentences: one says finish, the other says look
 * again.
 */
function complaint(
  value: string,
  required: boolean,
  wellFormed: (value: string) => boolean,
  { missing, malformed }: { missing: string; malformed: string },
): string | null {
  const trimmed = value.trim();
  if (trimmed === "") return required ? missing : null;
  return wellFormed(trimmed) ? null : malformed;
}

function ValidatedField({
  id,
  name,
  label,
  value,
  onChange,
  placeholder,
  hint,
  required = false,
  type,
  maxLength,
  pattern,
  inputMode,
  problem,
}: TextFieldProps & {
  type: string;
  maxLength: number;
  pattern?: string;
  inputMode?: "email" | "tel";
  problem: string | null;
}) {
  const [judged, setJudged] = useState(false);
  const shown = judged ? problem : null;
  const errorId = `${id}-error`;

  return (
    <Field id={id} label={label}>
      <input
        id={id}
        name={name}
        type={type}
        required={required}
        maxLength={maxLength}
        pattern={pattern}
        inputMode={inputMode}
        placeholder={placeholder}
        value={value}
        className={shown === null ? undefined : "is-invalid"}
        aria-invalid={shown === null ? undefined : true}
        // Only while there is a message: an `aria-describedby` pointing at an
        // element that is not rendered is read as nothing, but it is still a
        // broken reference in the accessibility tree.
        aria-describedby={shown === null ? undefined : errorId}
        onChange={(event) => onChange(event.target.value)}
        onBlur={() => setJudged(true)}
      />
      {shown !== null && (
        <span className="field-error" id={errorId} role="alert">
          {shown}
        </span>
      )}
      {hint !== undefined && <Hint>{hint}</Hint>}
    </Field>
  );
}

/**
 * An email address.
 *
 * `required` is what the form needs, not what the schema needs: a student with
 * a parent has no address of their own, and that is a legitimate account. The
 * caller says which case this is.
 */
export function EmailField({ name = "email", required = true, ...props }: TextFieldProps) {
  return (
    <ValidatedField
      {...props}
      name={name}
      required={required}
      type="email"
      inputMode="email"
      // The column is 320, which is the longest address the standard allows.
      maxLength={320}
      problem={complaint(props.value, required, isEmail, {
        missing: "An email address is needed here.",
        malformed: "That does not look like an email address.",
      })}
    />
  );
}

/** A phone number. Never required — nobody is turned away for not having one. */
export function PhoneField({ name = "phone", ...props }: TextFieldProps) {
  return (
    <ValidatedField
      {...props}
      name={name}
      required={false}
      type="tel"
      inputMode="tel"
      maxLength={32}
      pattern={PHONE_PATTERN}
      problem={complaint(props.value, false, isPhone, {
        missing: "",
        malformed: "That does not look like a phone number.",
      })}
    />
  );
}
