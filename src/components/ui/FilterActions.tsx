"use client";

/**
 * The filter button before the search box, and the menu it opens.
 *
 * A `<details>` still, because a disclosure is what this is and the element
 * brings the keyboard behaviour with it. What is written here is the dismissal
 * the element does not do — a `<details>` closes only when its own summary is
 * pressed, so without a listener the menu sits open behind the panel it has
 * just opened.
 *
 * Neither item is a link any more. "Edit filter" opens the panel, which is
 * React state; "Reset filter" clears the screen's stored filter, which is a
 * server action. Both used to be addresses, and neither was ever a place.
 *
 * "Share filter" went with them. It copied this page's address, which was the
 * filter — that is no longer true, and a button that copied a link showing the
 * recipient their own unfiltered screen would be worse than no button.
 */

import { useRef } from "react";

import { useMenuDismissal } from "@/components/menuDismissal";

import { FILTER_DRAWER_ID } from "./FilterDrawer";
import { ChevronIcon, FunnelIcon, ResetIcon, SaveIcon } from "./icons";

/**
 * The button before the search box, and what it opens.
 *
 * Saving a named filter is not built: it wants a table, a tenant scope and a
 * permission of its own, and the brief lists it under the session grid's
 * requirements. It is rendered disabled, saying so, rather than left out or
 * made to look implemented.
 */
export function FilterActions({
  active = 0,
  reset,
  resetFields,
  onEditFilter,
  drawerId = FILTER_DRAWER_ID,
  label = "Filters",
}: {
  /** How many filters are set. The page counts them. */
  active?: number;
  /** Clears the screen's stored filter. */
  reset: (form: FormData) => void | Promise<void>;
  /** State the reset keeps — the calendar's range, and nothing else so far. */
  resetFields?: React.ReactNode;
  /** Opens the panel. Owned by `FilterControl`, which renders both. */
  onEditFilter: () => void;
  /** The panel's element id, for `aria-controls`. */
  drawerId?: string;
  label?: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  // Dismissed by a press outside it and by choosing something in it: these
  // items are links and a button, so a choice is the end of the interaction.
  // Without it the menu would still be sitting open behind the drawer it just
  // opened.
  useMenuDismissal(menu, { closeOnChoice: true });

  return (
    <details className="filteractions" ref={menu}>
      <summary aria-label={active > 0 ? `${label}, ${active} set` : label}>
        <span className="glyph" aria-hidden="true">
          <ChevronIcon />
        </span>
        {active > 0 && (
          <span className="filteractions-count" aria-hidden="true">
            {active}
          </span>
        )}
      </summary>

      <div className="filteractions-menu">
        <button type="button" className="filteractions-item" aria-controls={drawerId} onClick={onEditFilter}>
          <span className="glyph" aria-hidden="true">
            <FunnelIcon />
          </span>
          Edit filter
        </button>
        {/* A form of its own, because it clears rather than applying what is
            on screen, and because it works with no script. */}
        <form action={reset}>
          {resetFields}
          <button
            type="submit"
            className="filteractions-item"
            aria-label={active === 0 ? "Reset filter — nothing is filtered" : undefined}
          >
            <span className="glyph" aria-hidden="true">
              <ResetIcon />
            </span>
            Reset filter
          </button>
        </form>

        <hr />

        {/* Not built. A disabled control says the feature exists and is
            unavailable; a working-looking one that did nothing, or a missing
            one, would each say something untrue. The same choice as Upload
            Users on the directory. */}
        <button
          type="button"
          className="filteractions-item is-disabled"
          disabled
          title="Saved filters are not built yet — the address bar holds this filter, and Share filter copies it"
        >
          <span className="glyph" aria-hidden="true">
            <SaveIcon />
          </span>
          Save filter
        </button>
      </div>
    </details>
  );
}
