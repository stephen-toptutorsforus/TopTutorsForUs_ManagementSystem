/**
 * One person's record, opened from their name.
 *
 * The directory could show somebody and never let you change them: correcting
 * an address meant a database client. This is the screen that fixes it, and the
 * two things worth a browser for are that it opens over the directory rather
 * than navigating away from it — the filter someone is reading under is a
 * cookie, not an address, but the scroll position and the page are not — and
 * that the password panel is drawn from the same answer the service enforces.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

const sheet = (page: Page) => page.locator(".sheet[data-open='true']");

/**
 * Open one named person's record.
 *
 * By the name in the cell rather than through the search box, which is a form
 * this test would then be asserting the submission of as well. The directory is
 * capped at 200 and the seed is nowhere near it, so everybody is on the page.
 */
async function openPerson(page: Page, name: string): Promise<void> {
  await page.goto("/people");
  await page.locator("td.people-name button", { hasText: name }).first().click();
  await expect(sheet(page)).toBeVisible();
  await expect(sheet(page).getByRole("heading", { name })).toBeVisible();
}

test.describe("as an administrator", () => {
  test.use({ storageState: statePath("admin") });

  test("opens over the directory instead of leaving it", async ({ page }) => {
    await openPerson(page, "Teo Vasquez");

    // The address is still the directory's. Every screen's filter lives in a
    // cookie keyed to the screen, so navigating away and back is not free.
    await expect(page).toHaveURL(/\/people$/);

    // Escape is the way out, as it is for every other panel here.
    await page.keyboard.press("Escape");
    await expect(sheet(page)).toBeHidden();
  });

  test("saves a correction, closes, and says so", async ({ page }) => {
    await openPerson(page, "Teo Vasquez");

    const phone = `555-01${Date.now().toString().slice(-2)}`;
    await sheet(page).getByLabel("Phone").fill(phone);
    await sheet(page).getByRole("button", { name: "Save" }).click();

    // The rule every dialog here follows: done means gone, and the page says
    // what happened where a page is read.
    await expect(sheet(page)).toBeHidden({ timeout: 15_000 });
    await expect(page.locator(".flash-region")).toContainText("Teo Vasquez");

    // And it stuck — the action revalidates the directory underneath.
    await openPerson(page, "Teo Vasquez");
    await expect(sheet(page).getByLabel("Phone")).toHaveValue(phone);
  });

  test("keeps the drawer open when the save is refused", async ({ page }) => {
    await openPerson(page, "Teo Vasquez");

    // An address the seed already gave somebody else in this tenant.
    await sheet(page).getByLabel("Email address").fill("imani.okafor@example.test");
    await sheet(page).getByRole("button", { name: "Save" }).click();

    await expect(sheet(page).locator(".notice-bad")).toBeVisible();
    await expect(sheet(page)).toBeVisible();
    await expect(page.locator(".flash-region")).toBeEmpty();
  });

  test("offers a password reset, and refuses it against another administrator", async ({
    page,
  }) => {
    await openPerson(page, "Teo Vasquez");
    // Exact, because "Confirm new password" contains this one.
    await expect(sheet(page).getByLabel("New password", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");

    // Not against another administrator: otherwise the weakest administrator
    // account is the effective strength of every one of them. Drawn from the
    // same answer the service enforces, rather than from a broad permission.
    await openPerson(page, "Rowan Mercer");
    await expect(sheet(page).getByLabel("New password", { exact: true })).toHaveCount(0);
    await expect(sheet(page)).toContainText("Only an administrator can set");
  });

  test("does not offer to archive the account you are signed in as", async ({ page }) => {
    await openPerson(page, "Rowan Mercer");
    await expect(sheet(page).getByRole("button", { name: "Archive user" })).toHaveCount(0);
  });
});

test.describe("as an instructor", () => {
  test.use({ storageState: statePath("instructor") });

  test("reads a record and cannot change any of it", async ({ page }) => {
    // An instructor holds `user.view` and not `user.manage` — they need the
    // directory to find a student and have no business editing one. So the
    // drawer opens, and every way of writing through it is absent or inert.
    await openPerson(page, "Teo Vasquez");

    await expect(sheet(page).getByLabel("First name")).toBeDisabled();
    await expect(sheet(page).getByLabel("Phone")).toBeDisabled();
    await expect(sheet(page).getByRole("button", { name: "Save" })).toHaveCount(0);
    await expect(sheet(page).getByRole("button", { name: "Archive user" })).toHaveCount(0);
    await expect(sheet(page).getByLabel("New password", { exact: true })).toHaveCount(0);
  });
});
