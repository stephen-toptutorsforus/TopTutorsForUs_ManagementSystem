"use client";

/**
 * Nudge the time grid to the row it named.
 *
 * The whole day is rendered, so without this the pane opens at midnight and
 * every ordinary session is below the fold. It is a scroll position and not a
 * crop: with this component inert, the hours are all still there and reachable.
 */

import { useEffect } from "react";

export function ScrollToRow() {
  useEffect(() => {
    const pane = document.querySelector<HTMLElement>("[data-scroll-to-row]");
    if (pane === null) return;

    const row = Number(pane.dataset.scrollToRow ?? "1");
    const line = pane.querySelector<HTMLElement>(`.tg-line.r${row}`);
    if (line === null) return;

    // Relative to the pane, not the document: the pane is what scrolls.
    pane.scrollTop = line.offsetTop - pane.offsetTop;
  }, []);

  return null;
}
