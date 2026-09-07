"use client";

/**
 * Nudge the time grid to the row it named.
 *
 * The whole day is rendered, so without this the pane opens at midnight and
 * every ordinary session is below the fold. It is a scroll position and not a
 * crop: with this component inert, the hours are all still there and reachable.
 *
 * Two things this has to get right, both of which it previously did not:
 *
 * `offsetTop` is measured from the offset parent, and the line's is
 * `.cal-timegrid` while the pane's is whatever is positioned above it in the
 * page. Subtracting one from the other subtracts two different origins and
 * produces a number that means nothing. Rectangles are in one space — the
 * viewport — so the difference between them is the distance actually wanted.
 *
 * And it has to run after layout. On the first pass the pane has not yet been
 * given its height, so it cannot scroll, and a `scrollTop` set against it is
 * silently clamped to zero and never revisited.
 */

import { useEffect } from "react";

export function ScrollToRow() {
  useEffect(() => {
    const pane = document.querySelector<HTMLElement>("[data-scroll-to-row]");
    if (pane === null) return;

    const row = Number(pane.dataset.scrollToRow ?? "1");
    const line = pane.querySelector<HTMLElement>(`.tg-line.r${row}`);
    if (line === null) return;

    const frame = requestAnimationFrame(() => {
      // The day headings are sticky, so scrolling the line to the top of the
      // pane would park it underneath them.
      const heading = pane.querySelector<HTMLElement>(".tg-dayhead, .tg-corner");
      const covered = heading?.getBoundingClientRect().height ?? 0;
      pane.scrollTop +=
        line.getBoundingClientRect().top - pane.getBoundingClientRect().top - covered;
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
