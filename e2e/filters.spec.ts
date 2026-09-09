/**
 * The filter button, its menu, and the drawer it opens.
 *
 * Against a build, not the dev server — which matters more here than anywhere
 * else in this suite. Half of what these assert is client behaviour, and a dev
 * server whose HMR socket has dropped serves the previous bundle quite happily:
 * the menu's dismissal appeared broken for a while purely because of that.
 *
 * The `:target` half is deliberately checked without any interaction too, by
 * navigating straight to the fragment — that is what a person with scripting
 * off gets, and it is the whole reason the drawer is not a `<dialog>`.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

const menuOpen = (page: Page) =>
  page.locator(".filteractions").evaluate((d) => (d as HTMLDetailsElement).open);
const drawerShown = (page: Page) =>
  page.locator(".filterdrawer").evaluate((d) => getComputedStyle(d).visibility);

/** Give hydration a moment: these are client behaviours, not markup. */
const ready = async (page: Page, url: string) => {
  await page.goto(url, { waitUntil: "load" });
  await page.locator("h1").waitFor();
  await expect(page.locator(".filteractions > summary")).toBeVisible();
};

test.describe("the filter menu", () => {
  test.use({ storageState: statePath("admin") });

  test("names itself, and says how many filters are set", async ({ page }) => {
    await ready(page, "/people");
    // Nothing set: a name and no count, rather than a zero.
    await expect(page.locator(".filteractions > summary")).toHaveAttribute(
      "aria-label",
      "Filters",
    );
    await expect(page.locator(".filteractions-count")).toHaveCount(0);

    await ready(page, "/people?role=student&status=active");
    await expect(page.locator(".filteractions > summary")).toHaveAttribute(
      "aria-label",
      "Filters, 2 set",
    );
    await expect(page.locator(".filteractions-count")).toHaveText("2");
  });

  test("opens, and closes again when something outside it is pressed", async ({ page }) => {
    await ready(page, "/people");

    await page.locator(".filteractions > summary").click();
    expect(await menuOpen(page)).toBe(true);

    await page.locator("h1").click();
    await expect.poll(() => menuOpen(page)).toBe(false);
  });

  test("closes when a choice is made, instead of sitting behind the drawer", async ({
    page,
  }) => {
    await ready(page, "/people");

    await page.locator(".filteractions > summary").click();
    await page.getByRole("link", { name: "Edit filter" }).click();

    await expect.poll(() => drawerShown(page)).toBe("visible");
    await expect.poll(() => menuOpen(page)).toBe(false);
  });

  test("stays open on a control that is refusing to be pressed", async ({ page }) => {
    // Saved filters are not built. The disabled item explains itself in a
    // title, which is unreadable if pressing it shuts the menu.
    await ready(page, "/people");
    await page.locator(".filteractions > summary").click();

    const save = page.getByRole("button", { name: "Save filter" });
    await expect(save).toBeDisabled();
    await save.click({ force: true }).catch(() => {});

    expect(await menuOpen(page)).toBe(true);
  });

  test("resets to the unfiltered page", async ({ page }) => {
    await ready(page, "/people?q=holm&role=instructor&status=active");
    await page.locator(".filteractions > summary").click();
    await page.getByRole("link", { name: "Reset filter" }).click();

    await page.waitForURL(/\/people$/);
    await expect(page.locator("#q")).toHaveValue("");
  });
});

test.describe("the filter drawer", () => {
  test.use({ storageState: statePath("admin") });

  test("opens from the address alone, with no script involved", async ({ page }) => {
    // A `<dialog>` would need a script to open. This is what makes it not one.
    await page.goto("/people#edit-filter");
    await expect(page.locator(".filterdrawer")).toHaveAttribute("role", "dialog");
    await expect.poll(() => drawerShown(page)).toBe("visible");
    await expect(page.getByRole("heading", { name: "Edit filter" })).toBeVisible();
  });

  test("is closed until it is asked for", async ({ page }) => {
    await page.goto("/people");
    expect(await drawerShown(page)).toBe("hidden");
  });

  test("shows the filter the page is already under", async ({ page }) => {
    await page.goto("/people?q=holm&role=instructor&status=active#edit-filter");

    await expect(page.locator("#filter-q")).toHaveValue("holm");
    await expect(
      page.locator('.filterdrawer input[name="role"][value="instructor"]'),
    ).toBeChecked();
    await expect(
      page.locator('.filterdrawer input[name="status"][value="active"]'),
    ).toBeChecked();
    await expect(page.locator('.filterdrawer input[name="role"][value="admin"]')).not.toBeChecked();
  });

  test("applies everything it holds, including the search the toolbar shows", async ({
    page,
  }) => {
    // The drawer is a whole form rather than a fragment of the toolbar's, so
    // Apply must not drop the text the toolbar was showing.
    await page.goto("/people?role=student#edit-filter");
    await page.locator("#filter-q").fill("vasquez");
    await page.locator('.filterdrawer input[name="status"][value="active"]').check();
    await page.getByRole("button", { name: "Apply" }).click();

    await page.waitForURL(/q=vasquez/);
    expect(page.url()).toContain("role=student");
    expect(page.url()).toContain("status=active");
    // And the toolbar agrees with the drawer, because they are one filter.
    await expect(page.locator("#q")).toHaveValue("vasquez");
  });

  test("cancels without changing anything", async ({ page }) => {
    await page.goto("/people?role=student#edit-filter");
    await page.locator("#filter-q").fill("discarded");
    await page.getByRole("link", { name: "Cancel" }).click();

    await expect.poll(() => drawerShown(page)).toBe("hidden");
    expect(page.url()).toContain("role=student");
    expect(page.url()).not.toContain("discarded");
    await expect(page.locator("#q")).toHaveValue("");
  });

  test("clears everything from inside itself", async ({ page }) => {
    await page.goto("/people?q=holm&role=instructor#edit-filter");
    await page.getByRole("link", { name: "Clear all" }).click();

    await page.waitForURL(/\/people$/);
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
  });

  test("does not nest a form, and does not repeat an id", async ({ page }) => {
    // The drawer restates the search box the toolbar shows. Two `id="q"` would
    // be invalid and would break both labels.
    await page.goto("/people#edit-filter");

    const trouble = await page.evaluate(() => {
      const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
      const seen = new Set<string>();
      const repeated = ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false)));
      return { repeated, nested: document.querySelectorAll("form form").length };
    });

    expect(trouble.repeated, "repeated ids").toEqual([]);
    expect(trouble.nested, "a form inside a form").toBe(0);
  });

  test("still has exactly one h1 with the drawer open", async ({ page }) => {
    await page.goto("/people#edit-filter");
    await expect(page.locator("h1")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 2, name: "Edit filter" })).toBeVisible();
  });
});

test.describe("the search box", () => {
  test.use({ storageState: statePath("admin") });

  for (const path of ["/people", "/sessions", "/calendar"]) {
    test(`${path} draws the magnifier inside the field`, async ({ page }) => {
      await page.goto(path);
      const icon = page.locator(".page-toolbar-search-icon svg");
      await expect(icon).toBeVisible();

      const room = await page.evaluate(() => {
        const input = document.querySelector<HTMLElement>(".page-toolbar-search input")!;
        const mark = document.querySelector<HTMLElement>(".page-toolbar-search-icon")!;
        return {
          padding: Number.parseFloat(getComputedStyle(input).paddingLeft),
          iconRight: mark.getBoundingClientRect().right,
          inputLeft: input.getBoundingClientRect().left,
        };
      });

      // Inside the field, with the text padded clear of it rather than under it.
      expect(room.iconRight).toBeGreaterThan(room.inputLeft);
      expect(room.padding).toBeGreaterThan(room.iconRight - room.inputLeft);
    });
  }
});

test.describe("as a student", () => {
  test.use({ storageState: statePath("student") });

  test("cannot reach the directory at all, drawer or no drawer", async ({ page }) => {
    // The drawer is a rendering concern; who may see the directory is not.
    const response = await page.goto("/people#edit-filter");
    expect(response?.status()).toBe(403);
  });
});
