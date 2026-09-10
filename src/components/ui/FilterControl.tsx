"use client";

/**
 * The filter button, its menu, and the panel the menu opens.
 *
 * One component because they are one control: the button was in the toolbar's
 * `menu` slot and the panel was in the header's `drawer` slot, and the only
 * thing joining them was a fragment id that both had to spell the same way.
 * Three pages had to remember to pass both. Now a page passes its fields and
 * this holds the state between them.
 *
 * It sits in the toolbar's `menu` slot, which is outside the toolbar's own
 * `<form>`. **The panel is portalled to `<body>` rather than rendered there**,
 * for two reasons that both showed up as failures rather than as opinions: a
 * panel parked off the right-hand edge inside the toolbar made the whole page
 * scroll sideways, and every `.page-toolbar` selector in the suite started
 * matching twice, because the drawer restates the fields the toolbar shows.
 * A panel covering the page belongs at the top of the document, which is where
 * it now is.
 *
 * The portal is mounted from an effect. `createPortal` has nothing to portal
 * into while rendering on the server, and the panel needs a hydrated page to
 * open at all, so there is nothing to render early for.
 *
 * **Each opening is a fresh panel.** `openings` keys the drawer, so the fields
 * are remounted with the defaults the page rendered them with — which are read
 * from the URL. That is what makes Cancel discard: there is nothing to keep,
 * because the panel that held the edits no longer exists. Applying is a
 * navigation, which brings a new page and new defaults anyway.
 */

import { useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";

import { FilterActions } from "./FilterActions";
import { FilterDrawer } from "./FilterDrawer";

export function FilterControl({
  active = 0,
  resetHref,
  action,
  title,
  label,
  children,
}: {
  /** How many filters are set. The page counts them. */
  active?: number;
  /** Where "Reset filter" goes: the page with nothing set. */
  resetHref: string;
  /** Where the drawer's form submits — the page's own path. */
  action: string;
  title?: React.ReactNode;
  label?: string;
  /** The page's own filter fields. */
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [openings, setOpenings] = useState(0);
  const hydrated = useHydrated();

  const drawer = (
    <FilterDrawer
      key={openings}
      open={open}
      onOpenChange={setOpen}
      action={action}
      resetHref={resetHref}
      title={title}
    >
      {children}
    </FilterDrawer>
  );

  return (
    <>
      <FilterActions
        active={active}
        resetHref={resetHref}
        label={label}
        onEditFilter={() => {
          setOpenings((count) => count + 1);
          setOpen(true);
        }}
      />
      {hydrated && createPortal(drawer, document.body)}
    </>
  );
}

/**
 * False while rendering on the server and during the first client render, true
 * afterwards.
 *
 * `useSyncExternalStore` rather than a `useState` set from an effect: the two
 * say the same thing, but setting state in an effect asks for a second render
 * pass that React would rather you did not, and this is the shape the API was
 * added for. Nothing is subscribed to — the value only ever goes from the
 * server snapshot to the client one, which is exactly hydration.
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}
