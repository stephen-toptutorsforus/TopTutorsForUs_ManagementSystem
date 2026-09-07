/**
 * The navigation, at both widths.
 *
 * Below the breakpoint it is a drawer; above it, a column. The drawer opens on
 * `:target`, so these tests exercise the real mechanism — a fragment in the URL
 * — rather than a scripted one that would keep working if the CSS broke.
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

  test("opens, and closes by tapping beside it", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("link", { name: "Open navigation" }).click();
    await expect(sidebar(page)).toBeVisible();
    await expect(sidebar(page).getByRole("link", { name: "Groups" })).toBeVisible();

    // Beside the drawer, not in the middle — the drawer covers the left 300px.
    await page.locator(".drawer-backdrop").click({ position: { x: 360, y: 400 } });
    await expect(sidebar(page)).toBeHidden();
  });

  test("closes itself when you go somewhere", async ({ page }) => {
    await page.goto("/people");
    await page.getByRole("link", { name: "Open navigation" }).click();
    await expect(sidebar(page)).toBeVisible();

    await sidebar(page).getByRole("link", { name: "Groups" }).click();
    await expect(page).toHaveURL(/\/groups$/);
    await expect(sidebar(page), "the drawer should not still be open").toBeHidden();
  });
});

/**
 * The reason the drawer is `:target` and not a scripted panel.
 *
 * A control that needs JavaScript to open is, without it, a navigation nobody
 * can reach — on a phone, where the sidebar is the only way to any other page,
 * that is the whole application. Asserted rather than assumed, because nothing
 * else in the suite would notice it regressing.
 */
test.describe("with scripting off", () => {
  test.use({ javaScriptEnabled: false });
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 720, "drawer only exists below 720px");

  test("the drawer still opens and still navigates", async ({ page }) => {
    // Without scripting every link is a full page load, and against a dev
    // server the first of those to a given route pays for compiling it. Under
    // a parallel run that alone can outlast the default timeout — a property
    // of how the suite is served, not of the drawer.
    test.setTimeout(90_000);

    await page.goto("/people");
    await expect(sidebar(page)).toBeHidden();

    await page.getByRole("link", { name: "Open navigation" }).click();
    await expect(sidebar(page)).toBeVisible();

    // The drawer slides in. Clicking a link while it is still moving races the
    // transition against a full page load, so wait for it to come to rest.
    await sidebar(page).evaluate((el) =>
      Promise.all(el.getAnimations().map((animation) => animation.finished)),
    );

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
