/**
 * The create-user modal: what each role is asked, and what it is told.
 *
 * Against a build rather than the dev server, because almost all of this is
 * client behaviour — which branch of step two renders, when a field decides it
 * has been answered wrongly, and whether the step gate lets somebody past.
 *
 * The dialog opens from React state, so every test here presses the button a
 * person presses. It used to open from `/people#create-user`, and these tests
 * navigated straight to that; `e2e/overlays.spec.ts` is what now asserts that
 * no such address is produced.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.describe("creating a user", () => {
  test.use({ storageState: statePath("admin") });

  /** Open the dialog and put it on step two, having answered step one. */
  const details = async (page: Page, role: string) => {
    await open(page);
    await page.locator("#first_name").fill("Wren");
    await page.locator("#last_name").fill("Adeyemi");
    await page.locator("#new-role").selectOption(role);
    await page.getByRole("button", { name: "Next" }).click();
  };

  const label = (page: Page, id: string) => page.locator(`label[for="${id}"]`);

  /** The directory, then the button that opens the wizard. */
  const open = async (page: Page) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Create User" }).click();
    await expect(page.getByRole("dialog", { name: "Create User" })).toBeVisible();
  };

  test("opens on a real role rather than an instruction", async ({ page }) => {
    await open(page);

    const select = page.locator("#new-role");
    // No empty first option: a row that is not a choice is not a choice.
    await expect(select.locator('option[value=""]')).toHaveCount(0);
    await expect(select).toHaveValue("student");
  });

  test("asks a student with a parent for neither an address nor a phone", async ({
    page,
  }) => {
    await details(page, "student");
    await page.locator('input[name="requires_guardian"][value="yes"]').check();

    // The parent will set the student's address and password, so asking the
    // student for one here would be asking for something nobody will use.
    await expect(page.locator("#student-email")).toHaveCount(0);
    // And the phone would be the parent's number filed under the student's
    // name — the parent already has their own.
    await expect(page.locator("#student-phone")).toHaveCount(0);
    await expect(page.locator("#guardian_ref")).toBeVisible();
  });

  test("asks a student without a parent for their own address, by that name", async ({
    page,
  }) => {
    await details(page, "student");
    await page.locator('input[name="requires_guardian"][value="no"]').check();

    await expect(label(page, "student-email")).toHaveText("Student email address");
    await expect(page.locator("#student-phone")).toBeVisible();
  });

  test("calls it Email for everybody else", async ({ page }) => {
    // Walked with Back rather than reopened: the modal opens from a fragment,
    // so navigating to it again while it is already open changes nothing —
    // which is the disclosure working, and would leave this test filling a
    // field that step two is covering.
    await open(page);
    await page.locator("#first_name").fill("Wren");
    await page.locator("#last_name").fill("Adeyemi");

    for (const [role, id] of [
      ["parent", "parent-email"],
      ["instructor", "instructor-email"],
      ["admin", "admin-email"],
      ["regional_admin", "regional-email"],
    ] as const) {
      await page.locator("#new-role").selectOption(role);
      await page.getByRole("button", { name: "Next" }).click();
      await expect(label(page, id)).toHaveText("Email");
      await page.getByRole("button", { name: "Back" }).click();
    }
  });

  test("says so where the address was typed, not three steps later", async ({ page }) => {
    await details(page, "parent");
    const email = page.locator("#parent-email");
    const next = page.getByRole("button", { name: "Next" });

    // Nothing while it is being typed in: `bob@` is unfinished, not wrong.
    await email.fill("bob@");
    await expect(page.locator(".field-error")).toHaveCount(0);

    // Judged once it has been left.
    await email.blur();
    await expect(page.locator(".field-error")).toHaveText(
      "That does not look like an email address.",
    );
    await expect(email).toHaveAttribute("aria-invalid", "true");
    // And the form will not carry it forward to a step where the complaint
    // would be about a field that is no longer on screen.
    await expect(next).toBeDisabled();

    // Fixed on the keystroke that fixes it, not at the next blur.
    await email.fill("bob@example.test");
    await expect(page.locator(".field-error")).toHaveCount(0);
    await expect(next).toBeEnabled();
  });

  test("will not go on without an address at all", async ({ page }) => {
    await details(page, "admin");
    const email = page.locator("#admin-email");

    await email.click();
    await email.blur();

    await expect(page.locator(".field-error")).toHaveText("An email address is needed here.");
    await expect(page.getByRole("button", { name: "Next" })).toBeDisabled();
  });

  test("confirms only what it actually asked", async ({ page }) => {
    // The state outlives the fields: a phone number typed for a student
    // without a parent is still in state after answering Yes, and it is not
    // submitted. The confirmation used to list it anyway.
    await details(page, "student");
    await page.locator('input[name="requires_guardian"][value="no"]').check();
    await page.locator("#student-email").fill("wren@example.test");
    await page.locator("#student-phone").fill("555 0134");
    await page.locator('input[name="requires_guardian"][value="yes"]').check();

    const parents = page.locator("#guardian_ref option");
    test.skip((await parents.count()) < 2, "the seed has no parent to choose");
    await page.locator("#guardian_ref").selectOption({ index: 1 });
    await page.getByRole("button", { name: "Next" }).click();

    const confirmation = page.locator(".confirm-list");
    await expect(confirmation).toBeVisible();
    await expect(confirmation).not.toContainText("555 0134");
    await expect(confirmation).not.toContainText("wren@example.test");
  });
});
