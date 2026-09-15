/**
 * The week grid, which is the hardest thing here to fit on a phone.
 *
 * Seven columns and a full day of hours. These pin the two properties that make
 * it usable at 390px — one whole day at a time, and the hours staying put while
 * the days move — and the one that was quietly broken at every width.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const geometry = (page: Page) =>
  page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".cal-timegrid-scroll")!;
    const heads = [...document.querySelectorAll<HTMLElement>(".tg-dayhead")];
    return {
      paneWidth: Math.round(pane.clientWidth),
      dayWidth: Math.round(heads[0]!.getBoundingClientRect().width),
      days: heads.length,
    };
  });

test.describe("the week grid on a phone", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 720, "day-at-a-time layout is below 720px");

  test("shows one whole day at a time", async ({ page }) => {
    await page.goto("/calendar?view=week");
    await page.locator(".cal-timegrid").waitFor();

    const { paneWidth, dayWidth, days } = await geometry(page);
    expect(days).toBe(7);
    // A day fills the pane apart from the hour gutter, so exactly one is shown
    // rather than the two halves a 640px grid used to give a 390px screen.
    expect(dayWidth).toBeGreaterThan(paneWidth * 0.8);
    expect(dayWidth).toBeLessThan(paneWidth);
    expect(paneWidth - dayWidth, "the gutter is the only other column").toBeLessThan(60);
  });

  /**
   * The snapping itself is the browser's, and a synthetic scroll does not
   * trigger it — `scrollTo` moves the pane and leaves it wherever it was put,
   * whatever the snap rules say. So this asserts the contract that makes
   * snapping possible rather than pretending to observe the result: mandatory
   * snapping on the pane, and every day header a snap point clear of the
   * gutter. Whether Chromium then honours it on a real swipe is Chromium's.
   */
  test("is set up to snap day by day", async ({ page }) => {
    await page.goto("/calendar?view=week");
    await page.locator(".cal-timegrid").waitFor();

    const contract = await page.evaluate(() => {
      const pane = getComputedStyle(document.querySelector(".cal-timegrid-scroll")!);
      const heads = [...document.querySelectorAll(".tg-dayhead")].map((h) => {
        const cs = getComputedStyle(h);
        return { align: cs.scrollSnapAlign, margin: cs.scrollMarginLeft };
      });
      return {
        snapType: pane.scrollSnapType,
        aligns: [...new Set(heads.map((h) => h.align))],
        margins: [...new Set(heads.map((h) => h.margin))],
      };
    });

    expect(contract.snapType).toBe("x mandatory");
    expect(contract.aligns).toEqual(["start"]);
    expect(contract.margins).toEqual(["44px"]);
  });

  test("keeps the hours in view while the days slide past", async ({ page }) => {
    await page.goto("/calendar?view=week");
    await page.locator(".cal-timegrid").waitFor();

    const leftEdges = [];
    for (const x of [0, 700, 1500]) {
      await page.evaluate((left) => {
        document.querySelector(".cal-timegrid-scroll")!.scrollTo({ left, behavior: "instant" });
      }, x);
      leftEdges.push(
        await page.evaluate(() => {
          const pane = document.querySelector<HTMLElement>(".cal-timegrid-scroll")!;
          const label = document.querySelector<HTMLElement>(".tg-time")!;
          return Math.round(label.getBoundingClientRect().left - pane.getBoundingClientRect().left);
        }),
      );
    }
    // Pinned: the same position no matter how far across the week we are.
    expect(new Set(leftEdges).size, `hour labels moved: ${leftEdges}`).toBe(1);
  });
});

/**
 * At both widths. The grid renders midnight to midnight deliberately — cropping
 * it to office hours would put a 07:00 or a 22:00 session somewhere unreachable
 * — so where it *opens* is the whole of what makes that bearable.
 */
test("the grid opens on the working day, not at midnight", async ({ page }) => {
  await page.goto("/calendar?view=week");
  await page.locator(".cal-timegrid").waitFor();

  const opened = await page.evaluate(() => {
    const pane = document.querySelector<HTMLElement>(".cal-timegrid-scroll")!;
    const top = pane.getBoundingClientRect().top;
    // Whole hours only. Every half hour is labelled now, so the first label
    // below the fold is "6:30 AM" — the pane still opens exactly on seven, and
    // asking about hours is asking the question this test is actually about.
    const first = [...document.querySelectorAll<HTMLElement>(".tg-time.is-hour")].find(
      (label) => label.getBoundingClientRect().top >= top + 10,
    );
    return { scrollTop: Math.round(pane.scrollTop), firstHour: first?.textContent?.trim() };
  });

  expect(opened.scrollTop, "the pane should have scrolled away from midnight").toBeGreaterThan(100);
  expect(opened.firstHour).toBe("7 AM");
});
