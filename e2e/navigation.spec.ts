/**
 * The navigation, at both widths.
 *
 * Below the breakpoint it is a drawer; above it, a column. The drawer opened on
 * `:target` and now opens from React state, so these press the button rather
 * than navigating to a fragment — and assert that pressing it leaves the
 * address alone, which is the reason for the change.
 *
 * With no script the drawer cannot open at all, and on a phone the sidebar is
 * the only route to any other page. The layout ships a `<noscript>` stylesheet
 * that lays the navigation out as a static block instead; the last group here
 * is what holds it to that.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const sidebar = (page: Page) => page.getByRole("navigation", { name: "Primary" });

test.describe("on a phone", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 720, "drawer only exists below 720px");

  test("the page opens on its content, not on the whole menu", async ({ page }) => {
    await page.goto("/people");
    await expect(page.locator(".topbar")).toBeVisible();
    await expect(sidebar(page)).toBeHidden();

    // The heading must be reachable without scrolling past a screenful of nav.
    const heading = await page.locator("h1").boundingBox();
    expect(heading, "the page should have a heading").not.toBeNull();
    expect(heading!.y, "the h1 should be near the top of the page").toBeLessThan(240);
  });

  test("the header names the page you are on", async ({ page }) => {
    await page.goto("/people");
    await expect(page.locator(".topbar-title")).toHaveText("People");

    // A route with no entry of its own takes its section's name.
    await page.goto("/sessions");
    const href = await page.locator('a[href^="/sessions/ses_"]').first().getAttribute("href");
    await page.goto(href!);
    await expect(page.locator(".topbar-title")).toHaveText("Sessions");
  });

  test("opens from a button, and says so while it is open", async ({ page }) => {
    await page.goto("/people");
    const button = page.getByRole("button", { name: "Open navigation" });
    await expect(button).toHaveAttribute("aria-expanded", "false");
    await expect(button).toHaveAttribute("aria-controls", "primary-nav");

    const before = page.url();
    await button.click();
    await expect(sidebar(page)).toBeVisible();
    await expect(button).toHaveAttribute("aria-expanded", "true");
    // Opening the menu is not a place you can be sent to.
    expect(page.url()).toBe(before);

    await page.getByRole("button", { name: "Close navigation" }).click();
    await expect(sidebar(page)).toBeHidden();
    await expect(button).toHaveAttribute("aria-expanded", "false");
    expect(page.url()).toBe(before);
  });

  test("closes on Escape", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(sidebar(page)).toBeVisible();

    await page.keyboard.press("Escape");
    await expect(sidebar(page)).toBeHidden();
  });

  test("opens, and closes by tapping beside it", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Groups" })).toBeVisible();

    // Beside the drawer, not in the middle — the drawer covers the left 300px.
    await page.locator(".drawer-backdrop").click({ position: { x: 360, y: 400 } });
    await expect(sidebar(page)).toBeHidden();
  });

  test("closes itself when you go somewhere", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("button", { name: "Open navigation" }).click();
    await expect(sidebar(page)).toBeVisible();

    await sidebar(page).getByRole("link", { name: "Groups" }).click();
    await expect(page).toHaveURL(/\/groups$/);
    await expect(sidebar(page), "the drawer should not still be open").toBeHidden();
  });
});

/**
 * What is left when the script does not run.
 *
 * The drawer needs React now, so it cannot be opened — and on a phone the
 * sidebar is the only way to any other page, which would make the whole
 * application unreachable. The layout's `<noscript>` stylesheet lays the
 * navigation out as a static block instead: no drawer, no button, every link
 * on the page from the start.
 *
 * Asserted rather than assumed, because nothing else in the suite would notice
 * it regressing, and because it is the one thing the move to React state could
 * have quietly taken away.
 */
test.describe("with scripting off", () => {
  test.use({ javaScriptEnabled: false });
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 720, "drawer only exists below 720px");

  test("the navigation is all on the page, and still navigates", async ({ page }) => {
    await page.goto("/people");

    // Not a drawer waiting to be opened: laid out, visible, and reachable.
    await expect(sidebar(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "Open navigation" })).toBeHidden();

    await sidebar(page).getByRole("link", { name: "Locations" }).click();
    await expect(page).toHaveURL(/\/locations$/);
    await expect(page.locator("h1")).toHaveText("Locations");
  });
});

test.describe("on a wide screen", () => {
  test.skip(({ viewport }) => (viewport?.width ?? 0) <= 720, "column only above 720px");

  test("the longest section label fits without being cut off", async ({ page }) => {
    await page.goto("/people");
    // "People & Organization" is the longest label in the sidebar, and it is
    // inside the section the page belongs to, so it renders in the open state.
    // That state used to add a border, and the border's own padding was what
    // pushed the label into an ellipsis — not the width of the sidebar, which
    // is why widening the sidebar was never going to fix it.
    const label = page
      .locator(".nav-group summary .nav-label")
      .filter({ hasText: "People & Organization" });
    const cut = await label.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(cut, "the label should not be truncated").toBe(false);
  });

  test("the sidebar is a column and the mobile header is absent", async ({ page }) => {
    await page.goto("/people");
    await expect(sidebar(page)).toBeVisible();
    await expect(page.locator(".topbar")).toBeHidden();
    await expect(page.locator(".drawer-close")).toBeHidden();
  });
});

test.describe("the navigation drawer's own controls", () => {
  test.use({ storageState: statePath("admin") });

  test("keeps its close button to the drawer it belongs to", async ({ page, viewport }) => {
    // A regression guard with a specific cause: the filter drawer was first
    // written with `.drawer-close`, which the navigation already owned and
    // hides above the breakpoint. Defined later in the stylesheet, it un-hid
    // the sidebar's close button on every desktop screen — a class collision no
    // markup snapshot would notice, because no markup changed.
    await page.goto("/people");

    const shown = await page
      .locator(".sidebar .drawer-close")
      .evaluate((el) => getComputedStyle(el).display);

    if ((viewport?.width ?? 0) > 720) {
      expect(shown, "the sidebar's close button belongs to the phone drawer").toBe("none");
    } else {
      expect(shown).not.toBe("none");
    }
  });
});
