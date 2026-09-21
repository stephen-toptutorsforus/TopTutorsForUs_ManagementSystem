/**
 * Pressing a session on the calendar.
 *
 * It used to leave the month and open the session's page. Now it opens a
 * dialog over the calendar, and the four things somebody wants next are on it:
 * close, cancel, edit this one, edit the series.
 *
 * The chips are still real links, so the last group here runs with scripting
 * off and asserts the old behaviour survives — that is the whole reason the
 * modal is a click handler on an anchor rather than a button.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const dialog = (page: Page) => page.getByRole("dialog");

/**
 * Open the modal for the first session on the calendar.
 *
 * Visible ones only, the same rule the helpers below follow. A month cell
 * renders every session it holds and hides the ones past its limit behind
 * "+N more", and below the breakpoint the days either side of the month are
 * hidden outright — so the first chip in the document is quite often one no
 * pointer can reach.
 */
async function peek(page: Page): Promise<void> {
  await page.goto("/calendar");
  const chip = page.locator("[data-session-ref]:visible").first();
  await expect(chip).toBeVisible();
  await chip.click();
  await expect(dialog(page)).toBeVisible();
}

/**
 * Open the modal for a session that actually offers the named control.
 *
 * The first chip on the calendar used to do, because every seeded session was
 * scheduled. Since `prisma/scenarios.ts` there are cancelled and completed ones
 * too, and those correctly offer neither editing nor cancelling — so a test
 * that reached for the first chip started failing on the feature working. What
 * it wants is a session in a state that admits the action, and finding one is
 * the honest way to say so.
 */
async function peekOffering(page: Page, control: string): Promise<void> {
  await page.goto("/calendar");
  const chips = page.locator("[data-session-ref]:visible");
  const count = await chips.count();
  for (let index = 0; index < Math.min(count, 30); index += 1) {
    await chips.nth(index).click();
    await expect(dialog(page)).toBeVisible();
    // By name rather than by role: "Cancel session" is a button that opens a
    // panel in the dialog, and the two Edit controls are still links.
    if (await dialog(page).getByRole(/^Cancel/.test(control) ? "button" : "link", { name: control }).isVisible()) return;
    await page.locator(".peek-actions").getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
  }
  throw new Error(`no session on the calendar offers "${control}"`);
}

/**
 * Open the modal for the first session whose status matches, if there is one.
 *
 * Find-or-skip rather than fixture-or-fail: the seed has no completed or
 * cancelled session and the suite runs against a shared database it must not
 * re-seed. The rule itself is pinned exhaustively in `tests/sessionPeek.test.ts`,
 * which needs no data at all; this is the browser's corroboration when the
 * database happens to hold a case.
 */
async function peekWithStatus(page: Page, status: string): Promise<boolean> {
  await page.goto("/calendar");
  // Visible ones only. A month cell renders every session it holds and hides
  // the ones past its limit behind "+N more", so an unfiltered list contains
  // chips no pointer can reach — and at mobile width there are more of them.
  const chips = page.locator("[data-session-ref]:visible");
  const count = await chips.count();
  for (let index = 0; index < Math.min(count, 30); index += 1) {
    await chips.nth(index).click();
    await expect(dialog(page)).toBeVisible();
    if ((await dialog(page).innerText()).includes(status)) return true;
    await page.locator(".peek-actions").getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
  }
  return false;
}

/** Open the modal for a session that belongs to a series, if the seed has one. */
async function peekSeries(page: Page): Promise<boolean> {
  await page.goto("/calendar");
  const chips = page.locator("[data-session-ref]:visible");
  const count = await chips.count();
  for (let index = 0; index < Math.min(count, 12); index += 1) {
    await chips.nth(index).click();
    await expect(dialog(page)).toBeVisible();
    if (await dialog(page).getByRole("link", { name: "Edit Series" }).isVisible()) return true;
    await page.locator(".peek-actions").getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
  }
  return false;
}

test.describe("the session modal", () => {
  test("opens over the calendar instead of leaving it", async ({ page }) => {
    await peek(page);
    // The point of the change: the month somebody was reading is still there.
    expect(new URL(page.url()).pathname).toBe("/calendar");
  });

  test("says what the session is", async ({ page }) => {
    await peek(page);
    const text = await dialog(page).innerText();
    for (const label of [
      "Date",
      "Duration",
      "Status",
      "Instructor",
      "Students",
      "Title",
      "Description",
    ]) {
      expect(text, `the modal should say ${label}`).toContain(label);
    }
  });

  test("closes from the button, and leaves the address alone", async ({ page }) => {
    await peek(page);
    await page.locator(".peek-actions").getByRole("button", { name: "Close" }).click();
    await expect(dialog(page)).toBeHidden();
    expect(new URL(page.url()).pathname).toBe("/calendar");
  });

  test("closes on Escape", async ({ page }) => {
    await peek(page);
    await page.keyboard.press("Escape");
    await expect(dialog(page)).toBeHidden();
  });

  test("goes to the session's own page to read it", async ({ page }) => {
    await peek(page);
    await dialog(page).getByRole("link", { name: "Session Details" }).click();
    await expect(page).toHaveURL(/\/sessions\/ses/);
    // And that page reads rather than writes. Counted as forms in the page's
    // own content rather than by naming the action panel: a heading can be
    // renamed, but a page with nothing to submit cannot quietly grow a way to
    // submit. Scoped to `main`, because the shell has a sign-out form on every
    // screen.
    await expect(page.locator("main form")).toHaveCount(0);
  });

  test("goes to the editing screen for this one session, saying where from", async ({ page }) => {
    await peekOffering(page, "Edit Session");
    await dialog(page).getByRole("link", { name: "Edit Session" }).click();
    // `from` rides along so that Back still means the calendar after a save.
    // The referrer alone cannot: a server action re-renders this page, and the
    // `Referer` on that POST is this page.
    await expect(page).toHaveURL(/\/sessions\/ses\w+\/edit\?from=%2Fcalendar$/);
    await expect(page.locator("h1")).toContainText("Edit");
  });

  test("cancels a session without leaving the calendar", async ({ page }) => {
    await peekOffering(page, "Cancel session");

    // A button now, not a link: the reason is asked here rather than on a
    // second screen. Pressing it opens the panel; it does not cancel anything.
    await dialog(page).getByRole("button", { name: "Cancel session" }).click();
    await expect(page).toHaveURL(/\/calendar$/);
    await expect(dialog(page).getByLabel("Reason")).toBeVisible();

    // And the way out of having opened it by accident.
    await dialog(page).getByRole("button", { name: "Keep it" }).click();
    await expect(dialog(page).getByLabel("Reason")).toHaveCount(0);
  });

  test("offers no cancel on a completed session", async ({ page }) => {
    const found = await peekWithStatus(page, "Completed");
    test.skip(!found, "no completed session on the calendar to check");

    // The regression this replaced: an administrator holds every cancel
    // permission there is, and the status is what refuses. Deciding once for
    // the page could not hear that.
    await expect(
      dialog(page).getByRole("button", { name: "Cancel session" }),
    ).toHaveCount(0);
  });

  test("offers nothing to change on a cancelled session", async ({ page }) => {
    const found = await peekWithStatus(page, "Cancelled");
    test.skip(!found, "no cancelled session on the calendar to check");

    await expect(dialog(page).getByRole("button", { name: "Cancel session" })).toHaveCount(0);
    await expect(dialog(page).getByRole("link", { name: "Edit Session" })).toHaveCount(0);
    // Still readable, though: a cancelled session is a record, not a hole.
    await expect(dialog(page).getByRole("link", { name: "Session Details" })).toBeVisible();
  });

  test("offers the series only where there is one, and preselects it", async ({ page }) => {
    const found = await peekSeries(page);
    test.skip(!found, "the seeded month has no repeating session in it");

    await dialog(page).getByRole("link", { name: "Edit Series" }).click();
    await expect(page).toHaveURL(/\/edit\?scope=all&do=edit&from=%2Fcalendar$/);
    // The scope arrives chosen — and still a choice, because guessing wrongly
    // rewrites work somebody has already done.
    await expect(page.locator('input[name="scope"][value="all"]').first()).toBeChecked();
    // Attached rather than visible: the panels start collapsed unless a button
    // asked for one, and a radio inside a closed `details` is still a choice
    // somebody can make.
    await expect(page.locator('input[name="scope"][value="this"]').first()).toBeAttached();
    await expect(page.locator('input[name="scope"][value="this"]').first()).not.toBeChecked();
  });
});

test.describe("with no script", () => {
  test.use({ javaScriptEnabled: false });

  test("a session on the calendar is still a link to its page", async ({ page }) => {
    await page.goto("/calendar");
    const chip = page.locator("[data-session-ref]:visible").first();
    await expect(chip).toBeVisible();
    await chip.click();
    await expect(page).toHaveURL(/\/sessions\/ses/);
  });
});
