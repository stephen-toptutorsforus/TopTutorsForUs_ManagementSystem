"use client";

/**
 * Making a `<details>` behave like the menu it is drawn as.
 *
 * A `<details>` closes only when its own summary is pressed, so a click on the
 * page behind it leaves the panel hanging open over the content it covers. Both
 * menus in this interface want the same dismissal, and it was written twice
 * before it was written here.
 *
 * What they do not share is what a *choice* means. The filter menu's items are
 * checkboxes, and closing it is what applies them, so a press inside it must
 * not close it early. The filter-actions menu's items are links and a button:
 * choosing one is the end of the interaction, so it closes.
 */

import { useEffect, type RefObject } from "react";

export function useMenuDismissal(
  menu: RefObject<HTMLDetailsElement | null>,
  { closeOnChoice = false }: { closeOnChoice?: boolean } = {},
): void {
  useEffect(() => {
    const node = menu.current;
    if (node === null) return;

    const onOutside = (event: PointerEvent) => {
      if (!node.open) return;
      const target = event.target;
      // A press on the summary is left to the element's own toggling; handling
      // it here as well would close and reopen in the same gesture.
      if (target instanceof Node && node.contains(target)) return;
      node.open = false;
    };

    const onChoice = (event: MouseEvent) => {
      if (!node.open) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      // Not a press on the summary, and not on a control that is refusing to
      // be pressed — a disabled item should leave the menu where it is so its
      // title can be read.
      if (target.closest("summary") !== null) return;
      const chosen = target.closest("a, button");
      if (chosen === null || (chosen instanceof HTMLButtonElement && chosen.disabled)) return;
      node.open = false;
    };

    document.addEventListener("pointerdown", onOutside);
    if (closeOnChoice) node.addEventListener("click", onChoice);
    return () => {
      document.removeEventListener("pointerdown", onOutside);
      node.removeEventListener("click", onChoice);
    };
  }, [closeOnChoice, menu]);
}
