"use client";

/**
 * A modal dialog, open when React says it is.
 *
 * **It requires a hydrated page.** That is a deliberate change. This was a
 * `:target` panel — opened by a link to its id, closed by a link back to `#` —
 * so that it worked with scripting off. What that cost, measured rather than
 * guessed:
 *
 * - opening and closing it added **two history entries**, so Back stepped
 *   through modal states instead of leaving the page;
 * - Back after closing **reopened it**, because the previous entry was the
 *   fragment that opened it;
 * - the address bar was left reading `/people#`, which is the URL saying
 *   something that is not state;
 * - and every dialog on a page was in the accessibility tree at all times —
 *   three of them on the directory.
 *
 * None of that was fixable while a fragment was the switch. What the fragment
 * bought was a form reachable without JavaScript; the stylesheet claimed a
 * script supplied focus handling and Escape, and no such script existed, so
 * what was actually shipped was a dialog that did not move focus into itself,
 * did not trap it, did not restore it, and could not be dismissed from the
 * keyboard.
 *
 * `<dialog>` with `showModal()` supplies all four, plus the inert background,
 * from the platform. What is written here is only what it does not: the
 * backdrop click, the scroll lock, and keeping the element's state in step with
 * the prop in both directions — Escape closes the dialog itself, so `onClose`
 * has to tell React, or the two disagree and the next `open` does nothing.
 */

import { useEffect, useId, useRef } from "react";

export function Modal({
  open,
  onOpenChange,
  title,
  subtitle,
  children,
  initialFocusRef,
  labelledBy,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  /**
   * Where focus lands. `showModal()` focuses the first focusable thing in the
   * dialog, which is the close button — fine for a confirmation, wrong for a
   * form whose first field is the point.
   */
  initialFocusRef?: React.RefObject<HTMLElement | null>;
  /** Overrides the generated id, for a caller that needs a stable one. */
  labelledBy?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  // Generated, not a fixed string: two dialogs are mounted on the directory at
  // once, and two elements with the same id is invalid markup that breaks both
  // of the labels pointing at it.
  const generated = useId();
  const titleId = labelledBy ?? generated;

  useEffect(() => {
    const node = dialog.current;
    if (node === null) return;

    if (open && !node.open) {
      // `showModal`, never `show`: only the modal form makes the rest of the
      // page inert and gives the backdrop pseudo-element.
      node.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && node.open) {
      node.close();
    }
  }, [initialFocusRef, open]);

  return (
    <dialog
      className="modal"
      ref={dialog}
      aria-labelledby={titleId}
      // Escape closes the element without asking React first, and so does the
      // close button below via `onOpenChange`. Both arrive here, so this is the
      // one place that has to agree with the prop.
      onClose={() => onOpenChange(false)}
      // The dialog element fills the viewport and the card is centred inside
      // it, so a click that lands on the dialog itself is a click beside the
      // card. A click inside the card has the card, or something in it, as its
      // target and does nothing.
      onClick={(event) => {
        if (event.target === dialog.current) onOpenChange(false);
      }}
    >
      <div className="modal-card">
        <div className="modal-head">
          <h2 id={titleId}>{title}</h2>
          <button
            type="button"
            className="modal-close"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <span aria-hidden="true">×</span>
          </button>
        </div>
        {subtitle !== undefined && <p className="subtitle">{subtitle}</p>}
        {children}
      </div>
    </dialog>
  );
}
