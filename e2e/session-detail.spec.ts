/**
 * One session's own page: getting to it, and getting back.
 *
 * Six screens link here, so "back" is read from the referrer rather than
 * fixed — these are what hold it to naming the screen somebody actually came
 * from. The pure refusals (a foreign host, a missing referrer) are in
 * `tests/backLink.test.ts`; what a browser can add is that the header really
 * carries the link and that following it lands where it says.
 *
 * The rest is the page's shape. It is drawn the way the booking screen is —
 * one card divided into labelled sections — and it says what the session *is*
 * before what is known about it, both of which went missing when the header's
 * subtitle slot was removed.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const backLink = (page: Page) => page.locator(".page-header-actions a").first();

/** Open the first session linked from a screen, the way somebody would. */
async function openSessionFrom(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // `^=` on the ref prefix: `/sessions/export.csv` is also under `/sessions/`
  // and downloading it is not opening a session.
  const link = page.locator('a[href^="/sessions/ses"]').first();
  await expect(link).toBeAttached();
  await link.click();
  await expect(page).toHaveURL(/\/sessions\/ses/);
  await expect(page.locator("h1")).toBeVisible();
}

test.describe("getting back", () => {
  test("names the screen you came from, and returns to it", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    await expect(backLink(page)).toHaveText("Back to calendar");

    await backLink(page).click();
    await expect(page).toHaveURL(/\/calendar$/);
  });

  test("says sessions when that is where you came from", async ({ page }) => {
    // The same page, a different way in — which is the whole reason the link
    // is not a fixed one.
    await openSessionFrom(page, "/sessions");
    await expect(backLink(page)).toHaveText("Back to sessions");

    await backLink(page).click();
    await expect(page).toHaveURL(/\/sessions$/);
  });

  test("offers the session list when nothing said where you came from", async ({
    page,
  }) => {
    // Typed in, or opened in a new tab. Reached from the calendar first, so a
    // pass cannot be the referrer quietly agreeing with the fallback: a direct
    // navigation sends no `Referer`, and the answer must be the list either
    // way.
    await page.goto("/calendar");
    const href = await page
      .locator('a[href^="/sessions/ses"]')
      .first()
      .getAttribute("href");
    await page.goto(href!);

    await expect(backLink(page)).toHaveText("Back to sessions");
    await expect(backLink(page)).toHaveAttribute("href", "/sessions");
  });

  test("never offers to go back to the page it is on", async ({ page }) => {
    await page.goto("/sessions");
    const href = await page
      .locator('a[href^="/sessions/ses"]')
      .first()
      .getAttribute("href");
    const here = new URL(href!, page.url()).toString();

    // A reload, or a redirect that landed here from here.
    await page.goto(here, { referer: here });
    await expect(backLink(page)).toHaveAttribute("href", "/sessions");
  });
});

test.describe("what the page says", () => {
  test("says what the session is before what is known about it", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    const status = page.locator(".record-status");
    await expect(status).toBeVisible();
    // A word, not only a colour — the badge rule the whole palette follows.
    await expect(status).toContainText(/Scheduled|Completed|Cancelled|Missed|In progress/i);
  });

  test("is one card in labelled sections, like the booking screen", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    const heads = page.locator(".card-subhead");
    await expect(heads.nth(0)).toHaveText("Schedule");
    await expect(heads.nth(1)).toHaveText("Delivery");
    // The same class the booking form's own groups use, which is the point:
    // one rhythm rather than two that nearly match.
    expect(await page.locator(".card-section").count()).toBeGreaterThan(1);
  });

  test("keeps exactly one h1, and it is the session", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    await expect(page.locator("h1")).toHaveCount(1);
  });
});
