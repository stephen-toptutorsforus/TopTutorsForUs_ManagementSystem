"use client";

/**
 * A search box that turns matches into chips.
 *
 * The suggestions are drawn here, the same width as the field. A `datalist`
 * is a browser popup the page cannot size, and on this control it read as a
 * tooltip beside a box it did not match. The typed text is still submitted
 * when nothing has been chipped, and the server resolves that name. With the
 * script, a match becomes a chip and the ref is submitted instead.
 *
 * Choosing in one of a pair empties the other — schools or regions, not both.
 * That lives in `LocationPickers`, and the service enforces it again, because
 * a rule that lives only on the screen is not a rule.
 */

import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { Field, Hint, VisuallyHidden } from "@/components/ui";

/** The nearest ancestor that scrolls, so a menu can be brought into that box. */
function scrollParent(element: HTMLElement): HTMLElement | null {
  let node = element.parentElement;
  while (node && node !== document.body) {
    const overflow = getComputedStyle(node).overflowY;
    if (overflow === "auto" || overflow === "scroll") return node;
    node = node.parentElement;
  }
  return null;
}

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
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const fieldRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const optionRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const byLabel = new Map(options.map((option) => [option.label, option]));
  const chosenLabels = new Map(options.map((option) => [option.ref, option.label]));
  const query = typed.trim().toLowerCase();
  const matches = options.filter(
    (option) =>
      !chosen.includes(option.ref) &&
      (query.length === 0 || option.label.toLowerCase().includes(query)),
  );
  const highlighted = matches.length === 0 ? -1 : Math.min(activeIndex, matches.length - 1);
  const menuOpen = open && matches.length > 0;

  const add = (value: string) => {
    const match = byLabel.get(value);
    if (match && !chosen.includes(match.ref)) onChange([...chosen, match.ref]);
    setTyped("");
    setActiveIndex(0);
  };

  useLayoutEffect(() => {
    if (!menuOpen) return;
    const field = fieldRef.current;
    const menu = listRef.current;
    if (!field || !menu) return;
    // The dialog and the person sheet clip what sticks out of them. Scroll
    // that box so the menu, which opens under the field, is actually on screen.
    const parent = scrollParent(field);
    if (!parent) return;
    const menuBox = menu.getBoundingClientRect();
    const parentBox = parent.getBoundingClientRect();
    if (menuBox.bottom > parentBox.bottom - 8) {
      parent.scrollTop += menuBox.bottom - parentBox.bottom + 8;
    }
  }, [menuOpen, matches.length]);

  useEffect(() => {
    const list = listRef.current;
    const option = optionRefs.current[highlighted];
    if (!menuOpen || !list || !option) return;
    const listBox = list.getBoundingClientRect();
    const optionBox = option.getBoundingClientRect();
    if (optionBox.top < listBox.top) list.scrollTop -= listBox.top - optionBox.top;
    else if (optionBox.bottom > listBox.bottom) list.scrollTop += optionBox.bottom - listBox.bottom;
  }, [menuOpen, highlighted]);

  return (
    <Field id={inputId} label={<>{label}</>}>
      <div ref={fieldRef} className={menuOpen ? "search-field is-open" : "search-field"}>
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
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={menuOpen}
          aria-controls={listId}
          aria-activedescendant={menuOpen && highlighted >= 0 ? `${listId}-${highlighted}` : undefined}
          autoComplete="off"
          placeholder={placeholder}
          value={typed}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onChange={(event) => {
            setTyped(event.target.value);
            setOpen(true);
            setActiveIndex(0);
            if (byLabel.has(event.target.value)) add(event.target.value);
          }}
          onKeyDown={(event) => {
            if (event.key === "Escape") {
              setOpen(false);
              return;
            }
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) =>
                menuOpen ? Math.min(index + 1, Math.max(matches.length - 1, 0)) : 0,
              );
              return;
            }
            if (event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              setActiveIndex((index) => Math.max(index - 1, 0));
              return;
            }
            const chosenMatch = highlighted >= 0 ? matches[highlighted] : undefined;
            if (event.key === "Enter" && chosenMatch) {
              event.preventDefault();
              add(chosenMatch.label);
            }
          }}
        />
        <ul
          ref={listRef}
          id={listId}
          className="picker-menu"
          role="listbox"
          hidden={!menuOpen}
        >
          {matches.map((option, index) => (
            <li key={option.ref} role="presentation">
              <button
                type="button"
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === highlighted}
                className={index === highlighted ? "picker-option is-active" : "picker-option"}
                ref={(node) => {
                  optionRefs.current[index] = node;
                }}
                // Mouse down, not click: a click arrives after the field has
                // blurred and the menu has already closed.
                onMouseDown={(event) => {
                  event.preventDefault();
                  add(option.label);
                }}
              >
                {option.label}
              </button>
            </li>
          ))}
        </ul>
      </div>
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
    </Field>
  );
}
