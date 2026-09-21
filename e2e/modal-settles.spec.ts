/**
 * A dialog that has done its job goes away, and the page says what happened.
 *
 * Every modal here used to stay open with a green line inside it once its
 * action had succeeded. The only control that then closed it was the one that
 * means "abandon this", so the reading of a form still sitting there was that
 * nothing had happened — and people pressed Create a second time.
 *
 * Two halves, and both matter: the dialog closes, *and* the result is said
 * somewhere the page can be read. A dialog that closed silently would be the
 * same ambiguity from the other side.
 */

import { expect, test } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

/** A cast nobody else has created — the directory is shared with every run. */
function invented() {
  const tag = `${Date.now().toString(36)}${Math.floor(Math.random() * 1e4)}`;
  return { first: "Marisol", last: `Ferreira${tag}`, email: `marisol.${tag}@example.test` };
}

test.describe("creating a person", () => {
  test("closes the dialog and says so on the page", async ({ page }) => {
    const who = invented();
    await page.goto("/people");

    await page.getByRole("button", { name: "Create User" }).click();
    const dialogue = page.getByRole("dialog");
    await expect(dialogue).toBeVisible();

    await dialogue.getByLabel("First name").fill(who.first);
    await dialogue.getByLabel("Last name").fill(who.last);
    await dialogue.getByLabel("Role").selectOption("instructor");
    await dialogue.getByRole("button", { name: "Next" }).click();

    await dialogue.getByLabel("Email", { exact: false }).first().fill(who.email);
    await dialogue.getByRole("button", { name: "Next" }).click();
    await dialogue.getByRole("button", { name: "Create user" }).click();

    // The dialog is gone rather than sitting there behind its own success.
    await expect(dialogue).toBeHidden({ timeout: 15_000 });

    // And the page says what happened, where a page is read.
    const flash = page.locator(".flash-region");
    await expect(flash).toContainText(who.last);

    // The row is there too — the action revalidates the directory, so the
    // notice is not the only evidence.
    await expect(page.locator("tbody")).toContainText(who.last);
  });

  test("keeps the dialog open when the action refuses", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Create User" }).click();
    const dialogue = page.getByRole("dialog");

    await dialogue.getByLabel("First name").fill("Ada");
    await dialogue.getByLabel("Last name").fill("Fenwick");
    await dialogue.getByLabel("Role").selectOption("instructor");
    await dialogue.getByRole("button", { name: "Next" }).click();

    // An address the seed has already used: the tenant-unique index refuses it.
    await dialogue
      .getByLabel("Email", { exact: false })
      .first()
      .fill("imani.okafor@example.test");
    await dialogue.getByRole("button", { name: "Next" }).click();
    await dialogue.getByRole("button", { name: "Create user" }).click();

    // Still open, because the field that needs correcting is in it. A message
    // on the page behind a dismissed dialog would be a message beside nothing.
    await expect(dialogue).toBeVisible();
    await expect(dialogue.locator(".notice-bad")).toBeVisible();
    await expect(page.locator(".flash-region")).toBeEmpty();
  });
});
