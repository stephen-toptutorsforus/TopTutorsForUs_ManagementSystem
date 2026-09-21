"use client";

/**
 * A wide panel over the page, for reading and editing one record.
 *
 * The filter drawer's sibling, and separate from it on purpose. That one is
 * 420px and holds one form whose only exits are Apply and Cancel; this one is
 * most of the screen and holds several forms that each submit on their own, so
 * it has no footer of its own and nothing about it decides when it closes.
 *
 * `sheet-` rather than `drawer-`, which the sidebar owns, and rather than
 * `filterdrawer-`, whose footer rules would apply here and should not. The
 * comment on `.filterdrawer` in the stylesheet records what a shared prefix
 * cost the last time.
 *
 * **It is a dialog, and behaves like one.** Escape closes it, focus moves into
 * it on opening and back to what opened it on closing, the page behind does not
 * scroll, and a click on the scrim dismisses it. That is the same list
 * `<dialog>` supplies for free — and it is written out here instead because a
 * sheet is not modal in the sense that matters: the page behind stays visible
 * and, with the record open beside it, still readable. What is borrowed is the
 * behaviour, not the element.
 */

import { useCallback, useEffect, useId, useRef } from "react";

export function Sheet({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  /** What had focus before this opened, so it can be given back. */
  const opener = useRef<HTMLElement | null>(null);

  const close = useCallback(() => onOpenChange(false), [onOpenChange]);

  useEffect(() => {
    if (!open) return;
    // Captured now rather than read in the cleanup: by the time that runs the
    // ref may point at a node React has already replaced.
    const panelNode = panel.current;
    opener.current = document.activeElement as HTMLElement | null;
    // The heading rather than the first field: a record drawer is read before
    // it is edited, and landing in "First name" skips everything above it.
    heading.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        close();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Only if focus is still inside the panel being torn down. Something else
      // may have deliberately taken it — a dialog opened from in here — and
      // pulling it back would fight that.
      if (panelNode?.contains(document.activeElement)) opener.current?.focus();
    };
  }, [open, close]);

  return (
    <div
      className="sheet"
      data-open={open ? "true" : "false"}
      role="dialog"
      aria-modal={open || undefined}
      aria-labelledby={titleId}
      // Out of the accessibility tree while closed. `visibility: hidden` already
      // does it; this says so without depending on the stylesheet having loaded.
      aria-hidden={open ? undefined : true}
    >
      <button
        type="button"
        className="sheet-scrim"
        tabIndex={-1}
        aria-hidden="true"
        onClick={close}
      />
      <div className="sheet-panel" ref={panel}>
        <div className="sheet-head">
          {/* The chevron is the way out and sits before the name, which is
              where the eye looks for it on a panel that slid in from the side. */}
          <button type="button" className="sheet-back" onClick={close} aria-label="Close">
            <span aria-hidden="true">‹</span>
          </button>
          <div className="sheet-title">
            <h2 id={titleId} ref={heading} tabIndex={-1}>
              {title}
            </h2>
            {subtitle && <p className="sheet-subtitle">{subtitle}</p>}
          </div>
        </div>
        {/* The one scrolling part, so the name stays put while a long record is
            read — which is the whole reason this is a sheet and not a page. */}
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}
