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

/**
 * Open the first session linked from a screen, the way somebody would.
 *
 * On the calendar that is now two steps: a chip opens the modal, and "Session
 * Details" is the way from there to the page. Everywhere else the link still
 * goes straight there. Following whichever appears keeps this helper honest
 * about the journey rather than shortcutting to the address.
 */
async function openSessionFrom(page: Page, path: string): Promise<void> {
  await page.goto(path);
  // `^=` on the ref prefix: `/sessions/export.csv` is also under `/sessions/`
  // and downloading it is not opening a session. `:visible` because a month
  // cell renders every session it holds and hides the ones past its limit,
  // and below the breakpoint the neighbouring months go too — so the first
  // match in the document is often one no pointer can reach.
  const link = page.locator('a[href^="/sessions/ses"]:visible').first();
  await expect(link).toBeVisible();
  await link.click();

  const dialog = page.getByRole("dialog");
  if (await dialog.isVisible().catch(() => false)) {
    await dialog.getByRole("link", { name: "Session Details" }).click();
  }
  await expect(page).toHaveURL(/\/sessions\/ses/);
  await expect(page.locator("h1")).toBeVisible();
}

test.describe("getting back", () => {
  test("returns to the screen you came from", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    await expect(backLink(page)).toHaveText("Back");

    await backLink(page).click();
    await expect(page).toHaveURL(/\/calendar$/);
  });

  test("goes somewhere else when that is where you came from", async ({ page }) => {
    // The same page and the same word, a different way in — which is the whole
    // reason the destination is not a fixed one.
    await openSessionFrom(page, "/sessions");
    await expect(backLink(page)).toHaveText("Back");

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

    await expect(backLink(page)).toHaveText("Back");
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
  test("groups the same fields the booking screen collects", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    const heads = page.locator(".card-subhead");
    await expect(heads.nth(0)).toHaveText("Session details");
    await expect(heads.nth(1)).toHaveText("Date and repeat");
    await expect(heads.nth(2)).toHaveText("Instructor");
    await expect(heads.nth(3)).toHaveText("Students and groups");

    // Every field the booking form asks for, read back under the same label.
    // Named rather than counted, because the point is that the two screens say
    // the same words for the same things.
    const labels = await page.locator(".fact-label").allInnerTexts();
    for (const wanted of [
      "Type",
      "Status",
      "Title",
      "Description",
      "Session date",
      "Session length",
      "Start time",
      "Instructor",
      "Students",
      "Group",
    ]) {
      expect(labels, `missing the ${wanted} field`).toContain(wanted);
    }
  });

  test("says a value in a box that is not an editable one", async ({ page }) => {
    // A read-only field drawn as an input is a control people click into and
    // cannot type in. Nothing in this card is a form control.
    await openSessionFrom(page, "/calendar");
    const card = page.locator(".card-padded").first();
    await expect(card.locator("input, select, textarea")).toHaveCount(0);
    await expect(card.locator(".fact-value").first()).toBeVisible();
  });

  test("does not say status, type or the series twice", async ({ page }) => {
    // Each has its own field now. Saying one of them again beside the title is
    // how somebody starts wondering whether the two disagree.
    await openSessionFrom(page, "/calendar");
    await expect(page.locator(".record-status .badge")).toHaveCount(0);
  });

  test("names the instructor, which the attendance table alone did not", async ({
    page,
  }) => {
    await openSessionFrom(page, "/calendar");
    const instructor = page
      .locator(".fact")
      .filter({ has: page.locator(".fact-label", { hasText: /^Instructor$/ }) })
      .locator(".fact-value");
    await expect(instructor).toBeVisible();
    await expect(instructor).not.toHaveText("—");
  });

  test("keeps its h1 without drawing it", async ({ page }) => {
    // The title is the first field of the card below, so the heading is not
    // painted — but it is still the page's only `h1`, which is what a screen
    // reader's heading list is built from. Deleting it to save a line of
    // pixels would cost that.
    await openSessionFrom(page, "/calendar");
    const heading = page.locator("h1");
    await expect(heading).toHaveCount(1);
    await expect(heading).not.toBeInViewport();
    await expect(heading).not.toBeEmpty();
  });

  test("puts the way out at the front of the header", async ({ page }) => {
    await openSessionFrom(page, "/calendar");
    const header = await page.locator(".page-header-main").boundingBox();
    const link = await backLink(page).boundingBox();
    // Within a few pixels of the header's own left edge, rather than pushed to
    // the far side by a title that is no longer drawn.
    expect(link!.x - header!.x).toBeLessThan(8);
  });
});
