"use client";

/**
 * Open the availability table at the time that is already chosen.
 *
 * The week plan's columns are the whole day — midnight to midnight, ninety-six
 * quarters — because pressing one of its cells *sets* a start time, so an axis
 * anchored to the current one would slide out from under somebody on every
 * press. The price of a fixed axis is that the table opens at 00:00, and a run
 * at four in the afternoon starts sixteen hours off the left-hand edge: the
 * answer is on screen and nobody can see it without dragging a scrollbar the
 * width of the card.
 *
 * So the *scroll position* is anchored even though the axis is not. It is a
 * position and not a crop — with this component inert, every hour is still
 * there and still reachable, which is the same bargain `ScrollToRow` makes for
 * the calendar's time grid.
 *
 * Two things it has to get right, both of which that component records learning
 * the hard way:
 *
 * `offsetLeft` is measured from the offset parent, and a cell's is the table
 * while the pane's is whatever is positioned above it. Subtracting one from the
 * other subtracts two different origins. Rectangles are in one space — the
 * viewport — so the difference between them is the distance actually wanted.
 *
 * And it has to run after layout, on a frame: on the first pass the pane has no
 * width yet, so it cannot scroll, and a `scrollLeft` set against it is silently
 * clamped to zero and never revisited.
 *
 * It runs once per mount, deliberately. Re-centring on every press would move
 * the table under the pointer that just pressed it, which is the behaviour the
 * fixed axis exists to avoid.
 */

import { useEffect } from "react";

export function ScrollToChosen() {
  useEffect(() => {
    const panes = document.querySelectorAll<HTMLElement>("[data-scroll-to-chosen]");

    const frame = requestAnimationFrame(() => {
      for (const pane of panes) {
        // The first pressed quarter in this table. Every row of the week plan
        // has one, and they are usually the same column; the first is the one
        // to bring into view when they are not.
        const chosen = pane.querySelector<HTMLElement>(".is-chosen");
        if (chosen === null) continue;

        const paneBox = pane.getBoundingClientRect();
        const cellBox = chosen.getBoundingClientRect();
        // A third of the way in rather than hard against the left edge, so the
        // hour before the chosen time is visible too — which is what somebody
        // adjusting a start time looks at next.
        const margin = paneBox.width / 3;
        pane.scrollLeft += cellBox.left - paneBox.left - margin;
      }
    });

    return () => cancelAnimationFrame(frame);
  }, []);

  return null;
}
