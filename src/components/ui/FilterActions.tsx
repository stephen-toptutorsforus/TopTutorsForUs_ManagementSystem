"use client";

/**
 * The filter button before the search box, and the menu it opens.
 *
 * A client component for one reason: a `<details>` closes only when its own
 * summary is pressed, so without a listener the menu sits open behind the
 * drawer it has just opened. Everything it contains still works with scripting
 * off — the items are links, the panel is `:target`, and only the dismissal is
 * lost.
 */

import { useRef } from "react";

import { ShareFilterButton } from "@/components/ShareFilterButton";
import { useMenuDismissal } from "@/components/menuDismissal";

import { VisuallyHidden } from "./Field";
import { FILTER_DRAWER_ID } from "./FilterDrawer";
import { ChevronIcon, FunnelIcon, ResetIcon, SaveIcon } from "./icons";

/**
 * The button before the search box, and what it opens.
 *
 * `reset` is a link to the unfiltered page, so clearing is a navigation like
 * every other filter change rather than a script that empties the fields.
 *
 * `share` and `save` are deliberately different from each other. Sharing a
 * filter is copying this page's address, which is a real thing this application
 * can do — the address *is* the filter, and the canonical-URL work is what made
 * that true. Saving a named filter is not built: it wants a table, a tenant
 * scope and a permission of its own, and the brief lists it under the session
 * grid's requirements. It is rendered disabled, saying so, rather than left out
 * or made to look implemented.
 */
export function FilterActions({
  active = 0,
  resetHref,
  drawerId = FILTER_DRAWER_ID,
  label = "Filters",
}: {
  /** How many filters are set. The page counts them. */
  active?: number;
  /** Where "Reset filter" goes: the page with nothing set. */
  resetHref: string;
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
        <a className="filteractions-item" href={`#${drawerId}`}>
          <span className="glyph" aria-hidden="true">
            <FunnelIcon />
          </span>
          Edit filter
        </a>
        <a className="filteractions-item" href={resetHref}>
          <span className="glyph" aria-hidden="true">
            <ResetIcon />
          </span>
          Reset filter
          {active === 0 && <VisuallyHidden> — nothing is filtered</VisuallyHidden>}
        </a>

        <hr />

        {/* The one item that needs a script, and the only one with a
            fallback: with scripting off the address bar already holds the
            filter, so the note says to copy it from there. */}
        <noscript>
          <p className="filteractions-note">
            This filter is the page&rsquo;s address — copy it from the address bar to
            share it.
          </p>
        </noscript>
        <ShareFilterButton />

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
