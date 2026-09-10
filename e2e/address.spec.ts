/**
 * What the address bar is left saying: nothing.
 *
 * This file used to assert the opposite — that each screen redirected to the
 * tidiest spelling of its own filter, because the filter *was* the address.
 * That is over: nothing done on a page may change the address of that page.
 *
 * So the property under test is inverted, and it is worth asking a browser
 * rather than a unit test for the same reason it was before. A stored filter
 * that quietly wrote itself back into the bar, or a form that fell back to a
 * GET when its action failed to bind, would both look fine in isolation.
 *
 * The one exception is an arrival: an older link still carrying a query is
 * honoured once and then the address is bare. That is the middleware, and it
 * happens before anything renders.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const SCREENS = ["/people", "/sessions", "/calendar"] as const;

/** The address, with nothing after the path. */
const bare = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search + url.hash;
};

test.describe("nothing on a page changes its address", () => {
  for (const path of SCREENS) {
    test(`${path} stays itself while it is filtered`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toBeVisible();
      expect(bare(page)).toBe(path);

      // Type a search and apply it. The rows change; the address does not.
      await page.locator("#q").fill("a");
      await page.keyboard.press("Enter");
      await page.waitForLoadState("networkidle");
      expect(bare(page), "searching must not write to the address").toBe(path);

      // Open the drawer, change something, apply.
      await page.locator(".filteractions > summary").click();
      await page.getByRole("button", { name: "Edit filter" }).click();
      await page.locator("#filter-q").fill("b");
      await page.getByRole("button", { name: "Apply" }).click();
      await page.waitForLoadState("networkidle");
      expect(bare(page), "applying must not write to the address").toBe(path);

      // And the filter really is set — otherwise this test would pass on a
      // page where nothing works at all.
      await expect(page.locator("#q")).toHaveValue("b");

      // Reset, still nothing.
      await page.locator(".filteractions > summary").click();
      await page.getByRole("button", { name: /Reset filter/ }).click();
      await page.waitForLoadState("networkidle");
      expect(bare(page)).toBe(path);
      await expect(page.locator("#q")).toHaveValue("");
    });
  }

  test("/calendar keeps its address while the range moves", async ({ page }) => {
    await page.goto("/calendar");
    const heading = () => page.locator(".cal-heading").textContent();
    const first = await heading();

    await page.getByRole("button", { name: /Next month/ }).click();
    await page.waitForLoadState("networkidle");
    expect(bare(page)).toBe("/calendar");
    expect(await heading(), "the range should have moved").not.toBe(first);

    await page.getByRole("button", { name: "Week", exact: true }).click();
    await page.waitForLoadState("networkidle");
    expect(bare(page)).toBe("/calendar");
    await expect(page.locator(".cal-timegrid")).toBeVisible();
  });

  test("a filter survives leaving the screen and coming back", async ({ page }) => {
    // The address cannot carry it, so something else has to — and a filter that
    // vanished on the way to another page would be worse than one in the bar.
    await page.goto("/people");
    await page.locator("#q").fill("mercer");
    await page.keyboard.press("Enter");
    await page.waitForLoadState("networkidle");
    const filtered = await page.locator("tbody tr").count();

    await page.goto("/calendar");
    await page.goto("/people");
    await expect(page.locator("#q")).toHaveValue("mercer");
    expect(await page.locator("tbody tr").count()).toBe(filtered);
  });
});

test.describe("an older link, honoured once", () => {
  const legacy = [
    ["/people?role=instructor", "/people"],
    ["/people?q=mercer&role=admin", "/people"],
    ["/sessions?status=scheduled", "/sessions"],
    ["/calendar?view=week", "/calendar"],
    // Parameters no screen ever read are dropped rather than stored.
    ["/calendar?utm_source=email", "/calendar"],
  ] as const;

  for (const [from, to] of legacy) {
    test(`${from} arrives at ${to}`, async ({ page }) => {
      await page.goto(from);
      // `waitForURL` rather than reading the bar once: a redirect that looped
      // should fail as a timeout, not as an assertion that caught a hop.
      await page.waitForURL((url) => url.pathname + url.search === to);
      await expect(page.locator("h1")).toBeVisible();
      expect(bare(page)).toBe(to);
    });
  }

  test("the filter the link asked for is the one applied", async ({ page }) => {
    await page.goto("/people?role=instructor");
    await page.waitForURL(/\/people$/);

    // Set, counted, and drawn — not merely stored.
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    await expect(
      page.locator('.page-toolbar input[name="role"][value="instructor"]'),
    ).toBeChecked();
    await expect(page.locator('.page-toolbar input[name="role"][value="admin"]')).not.toBeChecked();
  });

  test("and it stays applied on the next plain visit", async ({ page }) => {
    await page.goto("/sessions?status=scheduled");
    await page.waitForURL(/\/sessions$/);
    await expect(page.locator(".filteractions-count")).toHaveText("1");

    await page.goto("/sessions");
    expect(bare(page)).toBe("/sessions");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
  });

  test("a link with nothing in it clears rather than being ignored", async ({ page }) => {
    await page.goto("/people?role=instructor");
    await page.waitForURL(/\/people$/);
    await expect(page.locator(".filteractions-count")).toHaveText("1");

    // Every field empty is what a GET form used to submit for an unfiltered
    // screen, and it means the same thing here.
    await page.goto("/people?q=&role=");
    await page.waitForURL(/\/people$/);
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
  });
});
