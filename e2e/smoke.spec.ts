/**
 * Every route answers, and refuses the right people.
 *
 * These assertions were previously made by hand with `curl` after each change.
 * Written down, they stop being something somebody remembers to check.
 *
 * What they assert is deliberately structural — a heading, a landmark, a status
 * code — so that the design work these tests are guarding does not invalidate
 * them on every commit.
 */

import { expect, test, type Page } from "@playwright/test";

import { ADMIN_ONLY_ROUTES, ALL_ADMIN_ROUTES, SHARED_ROUTES, statePath } from "./accounts";

/**
 * The shell is the proof a page rendered rather than merely returned 200.
 *
 * Which shell depends on the width. Above the breakpoint the sidebar is a
 * column and always on screen; below it the sidebar is a drawer that starts
 * closed, and the header is what stands in for it. Asserting the sidebar at
 * both widths would mean asserting the drawer is open on arrival, which is the
 * behaviour this redesign exists to remove.
 */
async function expectShell(page: Page): Promise<void> {
  const narrow = (page.viewportSize()?.width ?? 0) <= 720;
  await expect(
    narrow ? page.locator(".topbar") : page.getByRole("navigation", { name: "Primary" }),
  ).toBeVisible();
  await expect(page.locator("h1")).toBeVisible();
}

test.describe("an administrator", () => {
  test.use({ storageState: statePath("admin") });

  for (const route of ALL_ADMIN_ROUTES) {
    test(`opens ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should answer 200`).toBe(200);
      await expectShell(page);
    });
  }
});

test.describe("a student", () => {
  test.use({ storageState: statePath("student") });

  for (const route of SHARED_ROUTES) {
    test(`opens ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should answer 200`).toBe(200);
      await expectShell(page);
    });
  }

  for (const route of ADMIN_ONLY_ROUTES) {
    test(`is refused ${route}`, async ({ page }) => {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should answer 403`).toBe(403);
      // Refused, and still inside the product. Without `(app)/forbidden.tsx`
      // this was Next's built-in page: the right status on a bare document with
      // no navigation, which reads as a broken application rather than a closed
      // door — and the navigation is the way out, because it is already the
      // list of pages this person may open.
      await expectShell(page);
    });
  }

  test("says no the same way wherever it happens", async ({ page }) => {
    await page.goto(ADMIN_ONLY_ROUTES[0]!);

    const main = page.locator("main");
    await expect(main.getByRole("heading", { level: 1 })).toHaveText("No access");
    await expect(main.getByRole("link", { name: /dashboard/i })).toBeVisible();
    // One refusal, not one per route. Naming the page would need a
    // route-to-words map kept in step with the routes — the thing that got a
    // screen wrong when the Back button had one, and was deleted for it.
    await expect(main).not.toContainText(ADMIN_ONLY_ROUTES[0]!);
  });

  test("is offered nothing it cannot open", async ({ page }) => {
    await page.goto("/");
    const nav = page.getByRole("navigation", { name: "Primary" });
    for (const route of ADMIN_ONLY_ROUTES) {
      await expect(
        nav.locator(`a[href="${route}"]`),
        `the sidebar should not link to ${route}`,
      ).toHaveCount(0);
    }
  });
});

test.describe("another tenant", () => {
  test.use({ storageState: statePath("admin") });

  test("gets 404 for a session it cannot see, on both transports", async ({ page, browser }) => {
    // Find a real session the way a person would, rather than reaching into the
    // database for an id the UI would never show.
    await page.goto("/sessions");
    // `ses_` is the session ref prefix. Without it this also matches the Book
    // button and the CSV export link, which every tenant is allowed to open —
    // and the test would then prove nothing while still passing.
    const href = await page
      .locator('a[href^="/sessions/ses_"]')
      .first()
      .getAttribute("href");
    expect(href, "the seed should leave at least one session to open").toBeTruthy();

    const outsider = await browser.newContext({ storageState: statePath("otherTenant") });
    try {
      // 404 and not 403: a 403 would confirm the record exists.
      const html = await outsider.request.get(href!);
      expect(html.status(), "another tenant's session should be 404 in HTML").toBe(404);

      const ref = href!.split("/").pop();
      const json = await outsider.request.get(`/api/v1/sessions/${ref}`);
      expect(json.status(), "and 404 over the API too").toBe(404);
    } finally {
      await outsider.close();
    }
  });

  test("keeps the navigation on a record that is not there", async ({ page }) => {
    // A stale link, a mistyped ref, a record since archived — all of them land
    // here, and all of them are one click from the calendar so long as the
    // shell is still on the page. That is what `(app)/not-found.tsx` is for:
    // the root one answers for a signed-out visitor, where there is no
    // navigation to keep.
    const response = await page.goto("/sessions/ses_nosuchrecord");
    expect(response?.status(), "a made-up ref should answer 404").toBe(404);

    await expectShell(page);
    await expect(page.locator("main").getByRole("heading", { level: 1 })).toHaveText(
      "Not found",
    );
  });
});

test.describe("a signed-out visitor", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is sent to the sign-in form, not shown an empty shell", async ({ page }) => {
    await page.goto("/people");
    await expect(page).toHaveURL(/\/sign-in/);
    await expect(page.getByLabel(/email/i)).toBeVisible();
  });
});
