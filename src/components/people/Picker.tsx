"use client";

import { Hint, VisuallyHidden } from "@/components/ui";
/**
 * A search box that turns matches into chips.
 *
 * Ported from the `data-ref-picker` controls in `app/templates/people.html`.
 *
 * A search box rather than a dropdown, and the browser's own `datalist` for the
 * suggestions — so typing still finds a name with the script unavailable, and
 * the plain text that is typed is submitted and resolved by name on the server.
 * With the script, a match becomes a chip and the ref is submitted instead.
 *
 * `excludes` is how "schools or regions, not both" is enforced on screen: the
 * two pickers hold each other's state, and choosing in one empties the other.
 * The service enforces it again, because a rule that lives only on the screen
 * is not a rule.
 */

import { useId, useState } from "react";

export interface PickerOption {
  ref: string;
  label: string;
}

export function Picker({
  label,
  name,
  placeholder,
  options,
  chosen,
  onChange,
  hint,
  required,
}: {
  label: string;
  /** The base field name: `instructor` submits `instructor_refs`. */
  name: string;
  placeholder: string;
  options: PickerOption[];
  chosen: string[];
  onChange: (refs: string[]) => void;
  hint?: React.ReactNode;
  required?: boolean;
}) {
  const inputId = useId();
  const listId = useId();
  const [typed, setTyped] = useState("");

  const byLabel = new Map(options.map((option) => [option.label, option]));
  const chosenLabels = new Map(options.map((option) => [option.ref, option.label]));

  const add = (value: string) => {
    const match = byLabel.get(value);
    if (match && !chosen.includes(match.ref)) onChange([...chosen, match.ref]);
    setTyped("");
  };

  return (
    <div className="field">
      <label htmlFor={inputId}>{label}</label>
      <div className="search-field">
        <span className="search-icon" aria-hidden="true">
          ⌕
        </span>
        <input
          id={inputId}
          // Only submitted when nothing has been chipped: with a chip present
          // the refs are authoritative, and sending a half-typed name as well
          // would resolve a second person nobody picked.
          name={chosen.length === 0 ? `${name}_names` : undefined}
          type="search"
          list={listId}
          autoComplete="off"
          placeholder={placeholder}
          value={typed}
          onChange={(event) => {
            setTyped(event.target.value);
            if (byLabel.has(event.target.value)) add(event.target.value);
          }}
        />
      </div>
      <datalist id={listId}>
        {options
          .filter((option) => !chosen.includes(option.ref))
          .map((option) => (
            <option value={option.label} key={option.ref} />
          ))}
      </datalist>
      <ul className="chips">
        {chosen.map((ref) => (
          <li className="chip" key={ref}>
            <span>{chosenLabels.get(ref) ?? ref}</span>
            <button
              type="button"
              className="chip-remove"
              aria-label={`Remove ${chosenLabels.get(ref) ?? ref}`}
              onClick={() => onChange(chosen.filter((other) => other !== ref))}
            >
              ×
            </button>
            <input type="hidden" name={`${name}_refs`} value={ref} />
          </li>
        ))}
      </ul>
      {hint && <Hint>{hint}</Hint>}
      {required && chosen.length === 0 && (
        <VisuallyHidden>At least one is required.</VisuallyHidden>
      )}
    </div>
  );
}
