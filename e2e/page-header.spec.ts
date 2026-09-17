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
    // An older link, spent on arrival: what it asked for is applied, and the
    // address is bare. See `e2e/address.spec.ts`.
    await page.goto("/calendar?view=week&date=2026-09-16&q=maths&status=scheduled&status=missed");
    await page.waitForURL(/\/calendar$/);

    await expect(page.locator("#q")).toHaveValue("maths");
    // Scoped to the toolbar: the filter drawer restates the same statuses, so
    // an unscoped selector finds each twice — which is the point, they are one
    // filter shown in two places.
    const toolbar = page.locator(".page-toolbar");
    await expect(toolbar.locator('input[name="status"][value="scheduled"]')).toBeChecked();
    await expect(toolbar.locator('input[name="status"][value="missed"]')).toBeChecked();
    await expect(toolbar.locator('input[name="status"][value="completed"]')).not.toBeChecked();
    // The view and the date ride as hidden fields, so searching keeps them.
    // Scoped to the filter form: the reset button beside it is a form of its
    // own and carries the range too, for the same reason.
    await expect(
      page.locator('.page-toolbar-filters input[name="view"]'),
    ).toHaveValue("week");
    await expect(
      page.locator('.page-toolbar-filters input[name="date"]'),
    ).toHaveValue("2026-09-16");
    // Both secondary controls made the move.
    await expect(page.getByRole("navigation", { name: "Change date range" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Week", exact: true })).toHaveAttribute(
      "aria-current",
      "true",
    );
  });

  test("searching the calendar carries the view and the date with it", async ({ page }) => {
    // The range rides in the form as hidden fields, which is what keeps a
    // search from dropping somebody back on this month. It used to ride in the
    // address, which did the same job in public.
    await page.goto("/calendar?view=week&date=2026-09-16");
    await page.waitForURL(/\/calendar$/);
    const heading = await page.locator(".cal-heading").textContent();

    await page.locator("#q").fill("algebra");
    await page.locator("#q").press("Enter");
    await page.waitForLoadState("networkidle");

    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator("#q")).toHaveValue("algebra");
    await expect(page.locator(".cal-timegrid")).toBeVisible();
    expect(await page.locator(".cal-heading").textContent()).toBe(heading);
  });

  test("the directory keeps more than one role", async ({ page }) => {
    await page.goto("/people?q=a&role=instructor&role=parent");
    await page.waitForURL(/\/people$/);

    await expect(page.locator("#q")).toHaveValue("a");
    // Scoped to the toolbar: the filter drawer restates the same roles, so an
    // unscoped selector now finds each checkbox twice — which is itself the
    // point, the two are one filter.
    const toolbar = page.locator(".page-toolbar");
    await expect(toolbar.locator('input[name="role"][value="instructor"]')).toBeChecked();
    await expect(toolbar.locator('input[name="role"][value="parent"]')).toBeChecked();
    await expect(toolbar.locator('input[name="role"][value="admin"]')).not.toBeChecked();
    // "Select all" ticks every box and applies, which is the resting state
    // reached in one gesture. It was a link to the unfiltered address; there is
    // no such address any more. Inside the closed disclosure, so it is not in
    // the accessibility tree until it is opened — which is the disclosure
    // working, not a missing control.
    await toolbar.locator(".filtermenu > summary").click();
    await toolbar.getByRole("button", { name: "Select all" }).click();
    await page.waitForLoadState("networkidle");

    // Every role ticked is no filter at all, and the search text survives it.
    await expect(page.locator("#q")).toHaveValue("a");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    expect(new URL(page.url()).search).toBe("");
  });

  test("the directory's actions are not inside its search form", async ({ page }) => {
    await page.goto("/people");

    const outside = await page.evaluate(() => {
      const create = [...document.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("Create User"),
      );
      return create !== undefined && create.closest("form") === null;
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
    await expect(page.locator(".page-toolbar")).toBeVisible();

    // The rest lives in the filter drawer now, where the advanced filters used
    // to be a disclosure under the toolbar.
    const drawer = page.locator(".filterdrawer");
    await expect(drawer.locator("#filter-from")).toHaveValue("2026-09-01");
    await expect(drawer.locator("#filter-to")).toHaveValue("2026-09-30");
    await expect(drawer.locator('input[name="status"][value="scheduled"]')).toBeChecked();
    await expect(drawer.locator('input[name="columns"][value="title"]')).toBeChecked();
    await expect(drawer.locator('input[name="columns"][value="status"]')).toBeChecked();
    await expect(drawer.locator('input[name="columns"][value="instructor"]')).not.toBeChecked();
    // Five filters are set: the search, the status, the two dates, the columns.
    await expect(page.locator(".filteractions-count")).toHaveText("5");
    // The export takes the filters as they stand.
    await expect(page.getByRole("link", { name: /Export CSV/ })).toHaveAttribute(
      "href",
      /q=maths/,
    );
  });

  test("the advanced filters submit even though they are behind a drawer", async ({
    page,
  }) => {
    await page.goto("/sessions");
    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();
    await page.locator("#filter-from").fill("2026-09-01");
    await page.locator(".filterdrawer").getByRole("button", { name: "Apply" }).click();
    await page.waitForLoadState("networkidle");

    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    // Reopening shows what was applied, read back from where it is stored.
    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();
    await expect(page.locator(".filterdrawer #filter-from")).toHaveValue("2026-09-01");
  });

  test("the calendar narrows by instructor, and remembers who", async ({ page }) => {
    // The troubleshooting question the SOP asks staff — "whose session is
    // missing" — which this screen could not be asked until now. `instructor`
    // was parsed here from the day the calendar was written and thrown away
    // twice over: never written to the cookie, never applied to the query.
    await page.goto("/calendar");
    const chips = page.locator("[data-session-ref]");
    const everyone = await chips.count();
    expect(everyone).toBeGreaterThan(0);

    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();
    const select = page.locator(".filterdrawer #filter-instructor");
    const chosen = (await select.locator("option").nth(1).getAttribute("value")) ?? "";
    expect(chosen).not.toBe("");
    await select.selectOption(chosen);
    await page.locator(".filterdrawer").getByRole("button", { name: "Apply" }).click();
    await page.waitForLoadState("networkidle");

    // Narrowed, said so, and without putting anybody's ref in the address.
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    expect(await chips.count()).toBeLessThan(everyone);

    // Read back from where it is stored, which is what tells a filter that
    // narrows from one that only looked like it did.
    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();
    await expect(page.locator(".filterdrawer #filter-instructor")).toHaveValue(chosen);
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

    const summary = page.locator(".filteractions > summary");
    await expect(summary).toBeVisible();
    // Named, counted, and big enough to hit.
    await expect(summary).toHaveAttribute("aria-label", "Filters, 1 set");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    const box = (await summary.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.width).toBeGreaterThanOrEqual(44);
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
