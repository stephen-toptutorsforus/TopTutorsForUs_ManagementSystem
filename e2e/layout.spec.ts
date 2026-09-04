/**
 * Nothing is stranded off-screen.
 *
 * The defect this exists for: a table given a fixed `min-width` for its desktop
 * layout keeps that width when the narrow-screen rules turn its rows into
 * cards, so each card is far wider than the phone showing it and every value
 * sits past the right edge with only its label in view. It is invisible to
 * every other suite here, because the page returns 200 and the markup is
 * correct — only the geometry is wrong.
 *
 * Two assertions, because there are two ways to be off-screen: the page itself
 * wider than the viewport, and a scrolling pane whose content is wider than the
 * pane. The second is the one that catches the table.
 */

import { expect, test, type Page } from "@playwright/test";

import { ALL_ADMIN_ROUTES, statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

/** The page as a whole must never scroll sideways. */
async function expectNoPageOverflow(page: Page, route: string): Promise<void> {
  const { content, viewport } = await page.evaluate(() => ({
    content: document.documentElement.scrollWidth,
    viewport: window.innerWidth,
  }));
  expect(content, `${route} should not scroll the page sideways`).toBeLessThanOrEqual(
    viewport + 1,
  );
}

/**
 * In card mode a table must fit the width it is given.
 *
 * Only below the breakpoint: on a wide screen a table wider than its wrapper is
 * the intended design — the wrapper scrolls so the page does not.
 */
async function expectTablesFitInCardMode(page: Page, route: string): Promise<void> {
  const overflowing = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>(".table-wrap")]
      .filter((wrap) => wrap.scrollWidth > wrap.clientWidth + 1)
      .map((wrap) => ({
        table: wrap.querySelector("table")?.className || "(unnamed table)",
        content: wrap.scrollWidth,
        available: wrap.clientWidth,
      })),
  );
  expect(overflowing, `${route}: a table is wider than the card it became`).toEqual([]);
}

for (const route of ALL_ADMIN_ROUTES) {
  test(`${route} fits its viewport`, async ({ page, viewport }) => {
    await page.goto(route);
    await expect(page.locator("h1")).toBeVisible();

    await expectNoPageOverflow(page, route);
    if ((viewport?.width ?? 0) <= 720) {
      await expectTablesFitInCardMode(page, route);
    }
  });
}
