/**
 * The migrated headers, in a browser.
 *
 * The unit tests pin what the shared components render. These pin what survived
 * moving four hand-built headers onto them: every query parameter, every
 * permission check, one `<h1>`, and no form inside a form. A refactor of shared
 * markup across five routes is exactly the kind that breaks quietly, and none
 * of these would notice a colour changing.
 */

import { expect, test, type Page } from "@playwright/test";

import { ACCOUNTS, statePath } from "./accounts";

const MIGRATED = [
  "/",
  "/calendar",
  "/people",
  "/sessions",
  "/sessions/new",
  "/availability",
  "/series",
  "/groups",
  "/locations",
  "/audit",
  "/help",
] as const;

/** How deep the `<form>` elements nest. More than one is unparseable HTML. */
const formNesting = (page: Page) =>
  page.evaluate(
    () =>
      Math.max(
        0,
        ...[...document.querySelectorAll("form")].map((form) => {
          let depth = 1;
          for (let up = form.parentElement; up; up = up.parentElement) {
            if (up.tagName === "FORM") depth += 1;
          }
          return depth;
        }),
      ),
  );

test.describe("as an administrator", () => {
  test.use({ storageState: statePath("admin") });

  for (const path of MIGRATED) {
    test(`${path} has one h1 and no nested form`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator("h1")).toHaveCount(1);
      expect(await formNesting(page), "a form inside a form").toBeLessThan(2);
    });
  }

  test("the calendar keeps view, date, search and every status", async ({ page }) => {
    const url = "/calendar?view=week&date=2026-09-16&q=maths&status=scheduled&status=missed";
    await page.goto(url);

    // Still the address it was given: the header did not swallow a parameter.
    await expect(page).toHaveURL(new RegExp("view=week"));
    await expect(page.locator("#q")).toHaveValue("maths");
    await expect(page.locator('input[name="status"][value="scheduled"]')).toBeChecked();
    await expect(page.locator('input[name="status"][value="missed"]')).toBeChecked();
    await expect(page.locator('input[name="status"][value="completed"]')).not.toBeChecked();
    // The view and the date ride as hidden fields, so searching keeps them.
    await expect(page.locator('.page-toolbar input[name="view"]')).toHaveValue("week");
    await expect(page.locator('.page-toolbar input[name="date"]')).toHaveValue("2026-09-16");
    // Both secondary controls made the move.
    await expect(page.getByRole("navigation", { name: "Change date range" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Week", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("searching the calendar carries the view and the date with it", async ({ page }) => {
    await page.goto("/calendar?view=week&date=2026-09-16");
    await page.locator("#q").fill("algebra");
    await page.locator("#q").press("Enter");

    await page.waitForURL(/q=algebra/);
    expect(page.url()).toContain("view=week");
    expect(page.url()).toContain("date=2026-09-16");
  });

  test("the directory keeps more than one role", async ({ page }) => {
    await page.goto("/people?q=a&role=instructor&role=parent");

    await expect(page.locator("#q")).toHaveValue("a");
    await expect(page.locator('input[name="role"][value="instructor"]')).toBeChecked();
    await expect(page.locator('input[name="role"][value="parent"]')).toBeChecked();
    await expect(page.locator('input[name="role"][value="admin"]')).not.toBeChecked();
    // Select all and clear all still lead somewhere, and somewhere different.
    // Inside the closed disclosure, so they are not in the accessibility tree
    // until it is opened — which is the disclosure working, not a missing link.
    await page.locator('.filtermenu[data-apply-on-close] > summary').click();
    const all = page.getByRole("link", { name: "Select all" });
    const none = page.getByRole("link", { name: "Clear all" });
    await expect(all).toHaveAttribute("href", /role=/);
    await expect(await none.getAttribute("href")).not.toEqual(await all.getAttribute("href"));
  });

  test("the directory's actions are not inside its search form", async ({ page }) => {
    await page.goto("/people");

    const outside = await page.evaluate(() => {
      const create = document.querySelector('a[href="#create-user"]');
      return create !== null && create.closest("form") === null;
    });
    expect(outside, "Create User must not be inside the GET form").toBe(true);
    await expect(page.getByRole("button", { name: /Upload Users/ })).toBeDisabled();
  });

  test("the session grid keeps every filter and the chosen columns", async ({ page }) => {
    const url =
      "/sessions?q=maths&status=scheduled&from=2026-09-01&to=2026-09-30" +
      "&instructor=&program=&columns=title%2Cstatus&page=1";
    await page.goto(url);

    await expect(page.locator("#q")).toHaveValue("maths");
    await expect(page.locator("#from")).toHaveValue("2026-09-01");
    await expect(page.locator("#to")).toHaveValue("2026-09-30");
    await expect(page.locator('input[name="status"][value="scheduled"]')).toBeChecked();
    await expect(page.locator('input[name="columns"][value="title"]')).toBeChecked();
    await expect(page.locator('input[name="columns"][value="status"]')).toBeChecked();
    await expect(page.locator('input[name="columns"][value="instructor"]')).not.toBeChecked();
    // Three advanced filters are set — the two dates and the column choice.
    await expect(page.locator(".page-toolbar-count")).toHaveText("3");
    await expect(page.locator(".page-toolbar-more")).toHaveAttribute("open", "");
    // The export takes the filters as they stand.
    await expect(page.getByRole("link", { name: /Export CSV/ })).toHaveAttribute(
      "href",
      /q=maths/,
    );
  });

  test("the advanced filters submit even though they are behind a disclosure", async ({
    page,
  }) => {
    await page.goto("/sessions");
    await page.locator(".page-toolbar-more > summary").click();
    await page.locator("#from").fill("2026-09-01");
    await page.getByRole("button", { name: "Apply filters" }).click();

    await page.waitForURL(/from=2026-09-01/);
    await expect(page.locator("#from")).toHaveValue("2026-09-01");
  });

  test("booking gets a header and no list filters", async ({ page }) => {
    await page.goto("/sessions/new");

    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Session Booking");
    await expect(page.locator(".page-toolbar")).toHaveCount(0);
    // The form's own controls stay in the form, where they submit.
    await expect(page.getByRole("button", { name: /Preview/ }).first()).toBeVisible();
  });
});

test.describe("as a student", () => {
  test.use({ storageState: statePath("student") });

  test("is offered no action it is not allowed, and no empty box either", async ({ page }) => {
    await page.goto("/sessions");

    await expect(page.getByRole("link", { name: /New session/ })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /Export CSV/ })).toHaveCount(0);
    await expect(page.locator(".page-header-actions")).toHaveCount(0);
    // The filters are still theirs to use.
    await expect(page.locator("#q")).toBeVisible();
  });

  test("sees no Book Session on the calendar, and the rest of the header", async ({ page }) => {
    await page.goto("/calendar");

    await expect(page.getByRole("link", { name: /Book Session/ })).toHaveCount(0);
    await expect(page.locator(".page-toolbar-actions")).toHaveCount(0);
    await expect(page.locator("#q")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Change date range" })).toBeVisible();
  });
});

test.describe("on a phone", () => {
  test.use({ storageState: statePath("admin") });
  test.skip(({ viewport }) => (viewport?.width ?? 0) > 720, "the stacked header is below 720px");

  test("keeps search visible and the filters one press away", async ({ page }) => {
    await page.goto("/sessions?from=2026-09-01");

    // Search is how records are found here, so it does not go behind anything.
    await expect(page.locator("#q")).toBeVisible();

    const summary = page.locator(".page-toolbar-more > summary");
    await expect(summary).toBeVisible();
    // Named, counted, and big enough to hit.
    await expect(summary).toHaveText(/More filters/);
    await expect(summary).toContainText("1");
    expect((await summary.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  });

  test("every migrated header fits the screen", async ({ page }) => {
    for (const path of MIGRATED) {
      await page.goto(path);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - window.innerWidth,
      );
      expect(overflow, `${path} overflows`).toBeLessThanOrEqual(1);
    }
  });

  test("the application's own header is still there and separate", async ({ page }) => {
    await page.goto("/calendar");

    // TopBar is the banner; the page header is a section header inside main.
    await expect(page.locator("header.topbar")).toBeVisible();
    await expect(page.locator("main header.page-header")).toBeVisible();
    expect(ACCOUNTS.admin).toContain("@example.test");
  });
});
