/**
 * What the address does while an overlay is open, and what an overlay does.
 *
 * These exist because of what the fragment mechanism cost, measured on a build
 * before it was replaced: opening and closing the create-user panel added two
 * history entries, pressing Back reopened it, Cancel left the address reading
 * `/people#`, and every dialog on the directory was in the accessibility tree
 * at all times. Each of those is a test here.
 *
 * The last group is the tripwire: nothing in the application may generate a
 * link to one of the four retired fragments. `#main` is not one of them — it is
 * a real anchor to a real element, and the skip link is what fragments are for.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

const OBSOLETE = ["#create-user", "#assign-people", "#edit-filter", "#primary-nav"];

const createUser = (page: Page) => page.getByRole("dialog", { name: "Create User" });
const assign = (page: Page) =>
  page.getByRole("dialog", { name: /Assign a student to an instructor/ });

test.describe("the address while an overlay is open", () => {
  test.use({ storageState: statePath("admin") });

  test("Create User opens and closes on /people, and stays there", async ({ page }) => {
    await page.goto("/people");
    const entries = await page.evaluate(() => history.length);

    await page.getByRole("button", { name: "Create User", exact: true }).click();
    await expect(createUser(page)).toBeVisible();
    await expect(page).toHaveURL(/\/people$/);
    expect(new URL(page.url()).hash).toBe("");

    await page.getByRole("button", { name: "Close" }).click();
    await expect(createUser(page)).toBeHidden();
    await expect(page).toHaveURL(/\/people$/);

    // The whole point: no history was written, so Back leaves the page rather
    // than walking back through the panel.
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("Assign opens from a row and leaves the address alone", async ({ page }) => {
    await page.goto("/people?role=student");
    const before = page.url();

    const trigger = page.getByRole("button", { name: /^Assign/ }).first();
    test.skip((await trigger.count()) === 0, "the seed has nobody to assign");
    await trigger.click();

    await expect(assign(page)).toBeVisible();
    expect(page.url()).toBe(before);

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(assign(page)).toBeHidden();
    expect(page.url()).toBe(before);
  });

  test("the row it was opened from is the student it starts on", async ({ page }) => {
    // It used to open with two empty selects: the row you pressed was lost
    // between the click and the panel.
    await page.goto("/people?role=student");
    const trigger = page.getByRole("button", { name: /^Assign/ }).first();
    test.skip((await trigger.count()) === 0, "the seed has no student to assign");

    // The row's person is in the accessible name — "Assign Dara Nwosu" — since
    // the visible word is only ever "Assign".
    const named = ((await trigger.getAttribute("aria-label")) ?? "")
      .replace("Assign", "")
      .trim();
    await trigger.click();
    await expect(assign(page)).toBeVisible();

    const chosen = await page
      .locator("#assign-student option:checked")
      .first()
      .textContent();
    expect(chosen ?? "").toContain(named.split(" ")[0] ?? "");
  });

  test("the mobile menu does not become an address", async ({ page, viewport }) => {
    test.skip((viewport?.width ?? 0) > 720, "the drawer only exists below 720px");
    await page.goto("/people");
    const before = page.url();
    const entries = await page.evaluate(() => history.length);

    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(page.getByRole("navigation", { name: "Primary" })).toBeVisible();
    expect(page.url()).toBe(before);

    await page.keyboard.press("Escape");
    expect(page.url()).toBe(before);
    expect(await page.evaluate(() => history.length)).toBe(entries);
  });

  test("applying a filter changes the page and not the address", async ({ page }) => {
    // Applied filters used to be the one thing allowed to write to the bar.
    // Nothing is, now — see `e2e/address.spec.ts` for the whole property.
    await page.goto("/people");
    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();
    await page.locator("#filter-q").fill("mercer");
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForLoadState("networkidle");

    const applied = new URL(page.url());
    expect(applied.pathname).toBe("/people");
    expect(applied.search).toBe("");
    expect(applied.hash).toBe("");
    await expect(page.locator("#q")).toHaveValue("mercer");
  });

  test("the skip link still goes to the main landmark", async ({ page }) => {
    await page.goto("/people");
    const skip = page.getByRole("link", { name: "Skip to main content" });
    await expect(skip).toHaveAttribute("href", "#main");

    await skip.focus();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/#main$/);
    await expect(page.locator("main#main")).toBeVisible();
  });
});

test.describe("the dialog itself", () => {
  test.use({ storageState: statePath("admin") });

  const openCreate = async (page: Page) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Create User", exact: true }).click();
    await expect(createUser(page)).toBeVisible();
  };

  test("only one dialog is in the accessibility tree at a time", async ({ page }) => {
    // Three were, when they were `:target` panels sitting in the markup.
    await page.goto("/people");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    await page.getByRole("button", { name: "Create User", exact: true }).click();
    await expect(page.getByRole("dialog")).toHaveCount(1);
  });

  test("Escape closes it", async ({ page }) => {
    await openCreate(page);
    await page.keyboard.press("Escape");
    await expect(createUser(page)).toBeHidden();
  });

  test("a click beside it closes it, and one inside it does not", async ({ page }) => {
    await openCreate(page);

    // Inside the card: the heading is as inside as it gets.
    await page.getByRole("heading", { name: "Create User" }).click();
    await expect(createUser(page)).toBeVisible();

    // Beside it. The dialog fills the viewport and centres the card, so the
    // very top-left corner is the dialog's own padding.
    await page.locator("dialog.modal[open]").click({ position: { x: 4, y: 4 } });
    await expect(createUser(page)).toBeHidden();
  });

  test("focus goes in, is kept in, and comes back", async ({ page }) => {
    await page.goto("/people");
    const opener = page.getByRole("button", { name: "Create User" });
    await opener.click();
    await expect(createUser(page)).toBeVisible();

    // In: the first field of the form, not the close button.
    await expect(page.locator("#first_name")).toBeFocused();

    // Kept in: tabbing from the last control in the dialog cannot reach the
    // page behind it. Ten tabs is more than the wizard's first step holds.
    for (let press = 0; press < 10; press += 1) await page.keyboard.press("Tab");
    const inside = await page.evaluate(
      () => document.activeElement?.closest("dialog.modal") !== null,
    );
    expect(inside, "focus should not escape the dialog").toBe(true);

    // Back: the button that opened it.
    await page.keyboard.press("Escape");
    await expect(createUser(page)).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("the page behind it does not scroll", async ({ page }) => {
    // `.main` is the scroller above the breakpoint and `body` is below it, so
    // both are asked. `showModal()` stops the page being clicked, not scrolled.
    const scrolling = () =>
      page.evaluate(() => ({
        main: getComputedStyle(document.querySelector("main")!).overflowY,
        body: getComputedStyle(document.body).overflowY,
      }));

    await page.goto("/people");
    const before = await scrolling();

    await page.getByRole("button", { name: "Create User", exact: true }).click();
    await expect(createUser(page)).toBeVisible();
    const locked = await scrolling();
    expect(locked.main).toBe("hidden");
    expect(locked.body).toBe("hidden");

    await page.keyboard.press("Escape");
    await expect(createUser(page)).toBeHidden();
    expect(await scrolling()).toEqual(before);
  });

  test("closing and reopening starts the wizard again", async ({ page }) => {
    await openCreate(page);
    await page.locator("#first_name").fill("Discarded");
    await page.locator("#last_name").fill("Person");
    await page.getByRole("button", { name: "Next" }).click();
    await expect(page.locator(".step.is-current")).toHaveText(/Details/);

    await page.keyboard.press("Escape");
    await expect(createUser(page)).toBeHidden();

    await page.getByRole("button", { name: "Create User", exact: true }).click();
    await expect(createUser(page)).toBeVisible();
    await expect(page.locator(".step.is-current")).toHaveText(/Who/);
    await expect(page.locator("#first_name")).toHaveValue("");
  });

  test("stays open, and keeps what was typed, when the server refuses", async ({
    page,
  }) => {
    // An address that already belongs to somebody in this tenant. The service
    // refuses it, and the panel has to still be there to say so.
    await page.goto("/people");
    const taken = await page
      .locator("table td a[href^='mailto:'], table td")
      .filter({ hasText: "@" })
      .first()
      .textContent();
    test.skip(!taken?.includes("@"), "the seed has no addressed person to collide with");

    await page.getByRole("button", { name: "Create User", exact: true }).click();
    await page.locator("#first_name").fill("Wren");
    await page.locator("#last_name").fill("Adeyemi");
    await page.locator("#new-role").selectOption("admin");
    await page.getByRole("button", { name: "Next" }).click();
    await page.locator("#admin-email").fill(taken!.trim());
    await page.getByRole("button", { name: "Next" }).click();
    await page.getByRole("button", { name: "Create user", exact: true }).click();

    await expect(page.getByRole("alert")).toBeVisible();
    await expect(createUser(page)).toBeVisible();
    // And nothing was thrown away: Back reaches the details as they were.
    await page.getByRole("button", { name: "Back" }).click();
    await expect(page.locator("#admin-email")).toHaveValue(taken!.trim());
  });
});

test.describe("no page generates a retired fragment", () => {
  test.use({ storageState: statePath("admin") });

  for (const path of ["/people", "/sessions", "/calendar", "/groups", "/locations"]) {
    test(`${path} links to none of them`, async ({ page }) => {
      await page.goto(path);

      const hrefs = await page.evaluate(() =>
        [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href") ?? ""),
      );

      for (const fragment of OBSOLETE) {
        expect(
          hrefs.filter((href) => href.endsWith(fragment)),
          `${path} still links to ${fragment}`,
        ).toEqual([]);
      }
      // And no anchor that goes nowhere, which is what closing one used to be.
      expect(hrefs.filter((href) => href === "#")).toEqual([]);

      // The skip link is not one of these. It is a real anchor to a real
      // element, and it stays.
      expect(hrefs).toContain("#main");
    });
  }
});
