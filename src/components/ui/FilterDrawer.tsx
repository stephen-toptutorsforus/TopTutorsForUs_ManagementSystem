"use client";

/**
 * The panel the filter button opens, and the groups inside it.
 *
 * **Open when React says it is.** It was a `:target` panel, opened by a link to
 * its id and closed by a link back to `#`. That put a fragment on the address
 * of a screen whose whole point is that its address is its filter, added two
 * history entries per visit to the panel, and left the bar reading `/people#`
 * after Cancel. `FilterControl` owns the state now; this renders it.
 *
 * **It is still a whole form, not a fragment of the toolbar's.** It carries
 * every filter the page has, including the search text the toolbar also shows.
 * Two forms cannot be nested and one cannot reach into the other, so the choice
 * is between a partial drawer that silently drops the search text on Apply and
 * a complete one that restates it. It restates it — under different ids, since
 * two `id="q"` on one page is invalid and breaks both labels.
 *
 * **Apply posts to a server action.** It was a GET whose whole purpose was to
 * put the filter in the address; the filter lives in a cookie now — see
 * `lib/web/filterState.ts` — and the address of a page no longer changes
 * because of anything done on it.
 */

import { useEffect, useRef } from "react";

import { Button } from "./Button";

/** The panel's element id, so the trigger can point `aria-controls` at it. */
export const FILTER_DRAWER_ID = "edit-filter";

/**
 * The panel itself.
 *
 * A `<form>` and not a `<dialog>`, unlike the modals: this slides in from the
 * edge and does not centre over the page, and `showModal()` brings a top-layer
 * element whose position is the browser's business. What it would have supplied
 * — Escape, the inert background, focus handling — is written here instead,
 * which is a fair trade for keeping the panel where the stylesheet puts it.
 */
export function FilterDrawer({
  open,
  onOpenChange,
  id = FILTER_DRAWER_ID,
  title = "Edit filter",
  action,
  reset,
  resetFields,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  id?: string;
  title?: React.ReactNode;
  /** What the filter submits to. */
  action: (form: FormData) => void | Promise<void>;
  /** The screen's reset action, for the button in the footer. */
  reset: (form: FormData) => void | Promise<void>;
  /** State the reset has to keep — the calendar's range. */
  resetFields?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = `${id}-title`;
  const panel = useRef<HTMLFormElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);

  // Escape closes it, as it would a dialog. On the window rather than the
  // panel, because focus may be anywhere inside a form of twenty controls.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onOpenChange(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenChange, open]);

  // Focus moves to the heading when it opens, so the next Tab is the first
  // field rather than something behind the panel.
  useEffect(() => {
    if (open) heading.current?.focus();
  }, [open]);

  return (
    <div
      className="filterdrawer"
      id={id}
      data-open={open ? "true" : "false"}
      role="dialog"
      aria-modal={open || undefined}
      aria-labelledby={titleId}
      // Hidden from assistive technology while closed. `visibility: hidden`
      // already takes it out, but this says so without depending on the
      // stylesheet having loaded.
      aria-hidden={open ? undefined : true}
    >
      {/* A button, not a link to `#`: it dismisses, it does not navigate.
          Inert to assistive technology, which reaches the same result through
          the close button and Escape. */}
      <button
        type="button"
        className="filterdrawer-scrim"
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => onOpenChange(false)}
      />
      {/* Closed by applying, as it was when Apply was a navigation that
          replaced the whole page. A server action re-renders underneath the
          panel instead, so the panel has to be told. The submit is untouched:
          this only moves the React state that draws it. */}
      <form
        className="filterdrawer-panel"
        action={action}
        ref={panel}
        onSubmit={() => onOpenChange(false)}
      >
        <div className="filterdrawer-head">
          <h2 id={titleId} ref={heading} tabIndex={-1}>
            {title}
          </h2>
          <button
            type="button"
            className="filterdrawer-close"
            aria-label="Close filter panel"
            onClick={() => onOpenChange(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>

        <div className="filterdrawer-body">{children}</div>

        <div className="filterdrawer-foot">
          {/* Its own form, so it clears rather than applying what is on screen.
              A form cannot be nested, so it sits beside the panel's and is
              bound to it from outside by `form=` on the button below. */}
          <Button type="submit" form={`${id}-reset`}>
            Reset filter
          </Button>
          <span className="filterdrawer-gap" />
          {/* Cancel closes and submits nothing, so nothing typed in here
              reaches the address. What was typed is discarded with it: the
              panel is remounted on each opening, so reopening shows the filter
              the URL is actually under. */}
          <Button type="button" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button variant="primary" type="submit">
            Apply
          </Button>
        </div>
      </form>
      {/* Outside the panel's form and reached by `form=` on its button, which
          is how HTML lets one control belong to a form it does not sit in. */}
      <form id={`${id}-reset`} action={reset} hidden>
        {resetFields}
      </form>
    </div>
  );
}

/** One headed group of fields inside the drawer. */
export function FilterSection({
  legend,
  children,
}: {
  legend: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <fieldset className="filterdrawer-section">
      <legend>{legend}</legend>
      <div className="filterdrawer-section-body">{children}</div>
    </fieldset>
  );
}
