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
 * **Every box starts ticked** — the resting state of a filter is everything
 * shown, so that is what it is drawn as rather than explained as. The rule and
 * its consequences are in `lib/selection.ts`.
 *
 * "Applies when it closes" is the behaviour worth keeping: ticking three boxes
 * should be one navigation, not three. The reference does it with a script and
 * falls back to an Apply button; here the submit is in the component and the
 * `<noscript>` button is still rendered, so the page works either way.
 *
 * It applies on close on all three screens that use it, because on all three it
 * is the only filter in its form — the rest live in the filter drawer, which
 * has an Apply of its own. There was a prop to turn this off, for a session
 * grid that once held five other filters beside it; that grid does not exist
 * any more.
 */

import { useEffect, useRef } from "react";

import { useMenuDismissal } from "@/components/menuDismissal";

import { Button } from "@/components/ui";
import type { FilterOption } from "@/lib/presentation";
import { narrows, ticked } from "@/lib/selection";

export function FilterMenu({
  name,
  options,
  selected,
  singular,
  plural,
  legend,
  showSelectAll = true,
}: {
  name: string;
  options: FilterOption[];
  selected: string[];
  singular: string;
  plural: string;
  legend: string;
  /** "Select all" needs a script to tick the boxes; hidden when it cannot. */
  showSelectAll?: boolean;
}) {
  const details = useRef<HTMLDetailsElement>(null);

  /** Tick everything this menu offers, then apply — the resting state. */
  const selectAll = () => {
    const node = details.current;
    const form = node?.closest("form");
    if (node === null || form === null || form === undefined) return;
    for (const box of node.querySelectorAll<HTMLInputElement>(
      `input[type="checkbox"][name="${CSS.escape(name)}"]`,
    )) {
      box.checked = true;
    }
    node.open = false;
    form.requestSubmit();
  };

  // Dismissed by a press outside it, like any menu. Choosing does not close it:
  // the items are checkboxes and closing is what applies them.
  useMenuDismissal(details);

  // Two spellings of the same state have to compare equal, or opening the menu
  // and closing it again would navigate: the arriving filter is empty while the
  // boxes it drew are all ticked. Both collapse to "".
  const values = options.map((option) => option.value);
  const signature = (chosen: readonly string[]) =>
    narrows(chosen.map((value) => value.toLowerCase()), values)
      ? [...chosen].map((value) => value.toLowerCase()).sort().join(",")
      : "";
  const applied = signature(selected);

  useEffect(() => {
    const node = details.current;
    if (node === null) return;

    const onToggle = () => {
      // Only on close, and only when something actually changed — reopening a
      // menu to look at it should not reload the page.
      if (node.open) return;
      const form = node.closest("form");
      if (form === null) return;
      if (signature(new FormData(form).getAll(name).map(String)) === applied) return;
      form.requestSubmit();
    };

    node.addEventListener("toggle", onToggle);
    return () => node.removeEventListener("toggle", onToggle);
    // `signature` is rebuilt each render; `applied` is the value it produces,
    // and it is what actually decides whether this fires.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, applied]);

  // `selected` may name something the menu does not offer — a link filtering by
  // a role the directory does not list, say. The count follows the selection so
  // the summary never reads "All" over a filtered page; the swatches follow the
  // options, because only they carry a colour to draw.
  //
  // "All" covers both spellings of the unfiltered screen: nothing selected, and
  // everything selected. They show the same page, so they read the same.
  const chosen = options.filter((option) => selected.includes(option.value));
  const summary =
    applied === ""
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
                defaultChecked={ticked(selected, option.value)}
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
        {showSelectAll && (
          // Ticks every box and applies, which is one gesture back to the
          // resting state after unticking a few. It was a link to the
          // unfiltered address; there is no such address any more, so it does
          // to the boxes what a person would do to them.
          //
          // There is no "Clear all" beside it: with every box ticked as the
          // resting state, clearing and selecting all reach the same screen.
          <p className="filtermenu-actions">
            <button type="button" className="filtermenu-link" onClick={selectAll}>
              Select all
            </button>
          </p>
        )}
        <p className="hint">
          Untick a {singular} to hide it — the filter applies when you close this menu.
        </p>
      </div>
    </details>
  );
}
