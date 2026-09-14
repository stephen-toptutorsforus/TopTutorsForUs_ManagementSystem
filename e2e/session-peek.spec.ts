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

/** Open the modal for the first session on the calendar. */
async function peek(page: Page): Promise<void> {
  await page.goto("/calendar");
  const chip = page.locator("[data-session-ref]").first();
  await expect(chip).toBeAttached();
  await chip.click();
  await expect(dialog(page)).toBeVisible();
}

/** Open the modal for a session that belongs to a series, if the seed has one. */
async function peekSeries(page: Page): Promise<boolean> {
  await page.goto("/calendar");
  const chips = page.locator("[data-session-ref]");
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

  test("goes to the editing screen for this one session", async ({ page }) => {
    await peek(page);
    await dialog(page).getByRole("link", { name: "Edit Session" }).click();
    await expect(page).toHaveURL(/\/sessions\/ses\w+\/edit$/);
    await expect(page.locator("h1")).toContainText("Edit");
  });

  test("opens the cancel panel when that is what was pressed", async ({ page }) => {
    await peek(page);
    await dialog(page).getByRole("link", { name: "Cancel session" }).click();
    await expect(page).toHaveURL(/\/edit\?do=cancel$/);

    // Open already, rather than a panel somebody has to find again.
    const cancel = page.locator("details", { has: page.getByText("Cancel", { exact: true }) });
    await expect(cancel.first()).toHaveAttribute("open", "");
  });

  test("offers the series only where there is one, and preselects it", async ({ page }) => {
    const found = await peekSeries(page);
    test.skip(!found, "the seeded month has no repeating session in it");

    await dialog(page).getByRole("link", { name: "Edit Series" }).click();
    await expect(page).toHaveURL(/\/edit\?scope=all$/);
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
    const chip = page.locator("[data-session-ref]").first();
    await expect(chip).toBeAttached();
    await chip.click();
    await expect(page).toHaveURL(/\/sessions\/ses/);
  });
});
