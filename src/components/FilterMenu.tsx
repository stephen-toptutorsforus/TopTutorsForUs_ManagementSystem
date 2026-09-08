"use client";

/**
 * A disclosure holding checkboxes, applied when it closes.
 *
 * Ported from the `filter_menu` macro in `app/templates/partials/macros.html`.
 *
 * The calendar filters by status and the directory filters by role. They are
 * the same control, so they are one component over one shape rather than two
 * blocks of markup that drift apart the first time either is touched.
 *
 * "Applies when it closes" is the behaviour worth keeping: ticking three boxes
 * should be one navigation, not three. The reference does it with a script and
 * falls back to an Apply button; here the submit is in the component and the
 * `<noscript>` button is still rendered, so the page works either way.
 */

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui";
import type { FilterOption } from "@/lib/presentation";

export function FilterMenu({
  name,
  options,
  selected,
  singular,
  plural,
  legend,
  allLink,
  noneLink,
}: {
  name: string;
  options: FilterOption[];
  selected: string[];
  singular: string;
  plural: string;
  legend: string;
  allLink?: string;
  noneLink?: string;
}) {
  const details = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const node = details.current;
    if (node === null) return;

    const onToggle = () => {
      // Only on close, and only when something actually changed — reopening a
      // menu to look at it should not reload the page.
      if (node.open) return;
      const form = node.closest("form");
      if (form === null) return;
      const now = new FormData(form).getAll(name).map(String).sort().join(",");
      if (now === [...selected].sort().join(",")) return;
      form.requestSubmit();
    };

    node.addEventListener("toggle", onToggle);
    return () => node.removeEventListener("toggle", onToggle);
  }, [name, selected]);

  useEffect(() => {
    const node = details.current;
    if (node === null) return;

    // A `<details>` closes only when its own summary is pressed, so a click on
    // the page behind it leaves the panel hanging open over the content it
    // covers. Dismissing on an outside press makes it behave like the menu it
    // is drawn as. Closing is the same event as applying, so the press that
    // dismisses the menu also commits the ticks — one navigation, as before.
    const onOutside = (event: PointerEvent) => {
      if (!node.open) return;
      const target = event.target;
      // A press on the summary is left to the element's own toggling; handling
      // it here as well would close and reopen in the same gesture.
      if (target instanceof Node && node.contains(target)) return;
      node.open = false;
    };

    document.addEventListener("pointerdown", onOutside);
    return () => document.removeEventListener("pointerdown", onOutside);
  }, []);

  // `selected` may name something the menu does not offer — a link filtering by
  // a role the directory does not list, say. The count follows the selection so
  // the summary never reads "All" over a filtered page; the swatches follow the
  // options, because only they carry a colour to draw.
  const chosen = options.filter((option) => selected.includes(option.value));
  const summary =
    selected.length === 0
      ? `All ${plural}`
      : selected.length === 1
        ? `1 ${singular}`
        : `${selected.length} ${plural}`;

  return (
    <details className="filtermenu" data-apply-on-close ref={details}>
      <summary>
        <span className="filtermenu-count">{summary}</span>
        <span className="filtermenu-swatches" aria-hidden="true">
          {(chosen.length > 0 ? chosen : options).map(
            (option) =>
              option.tone &&
              option.icon && (
                <span
                  className={`filtermenu-swatch badge-${option.tone}`}
                  key={option.value}
                >
                  {option.icon}
                </span>
              ),
          )}
        </span>
      </summary>
      <div className="filtermenu-panel">
        <fieldset>
          <legend className="visually-hidden">{legend}</legend>
          {options.map((option) => (
            <label className="filtermenu-option" key={option.value}>
              <input
                type="checkbox"
                name={name}
                value={option.value}
                defaultChecked={selected.includes(option.value)}
              />
              <span className="filtermenu-label">{option.label}</span>
              {option.tone && option.icon && (
                <span
                  className={`filtermenu-swatch badge-${option.tone}`}
                  aria-hidden="true"
                >
                  {option.icon}
                </span>
              )}
            </label>
          ))}
        </fieldset>
        {/* With scripting off nothing applies the ticks — no toggle listener,
            and the surrounding form has no submit button of its own. Rendered
            in a `<noscript>` so it exists exactly when it is needed. */}
        <noscript>
          <p className="filtermenu-actions">
            <Button size="small" type="submit">
              Apply
            </Button>
          </p>
        </noscript>
        {allLink !== undefined && noneLink !== undefined && (
          // Plain links, not scripted buttons, so they work like the rest.
          <p className="filtermenu-actions">
            <a href={allLink}>Select all</a>
            <span aria-hidden="true">|</span>
            <a href={noneLink}>Clear all</a>
          </p>
        )}
        <p className="hint">
          Tick as many as you like — the filter applies when you close this menu. With
          none ticked, every {singular} is shown.
        </p>
      </div>
    </details>
  );
}
