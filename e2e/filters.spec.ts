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

/**
 * Every screen that carries filter state. The button, the menu and the drawer
 * are one component used three times, so what is asserted here is asserted for
 * all of them rather than for the directory it was first built on.
 */
const FILTERED = [
  { path: "/people", filtered: "/people?role=student&status=active", set: 2 },
  { path: "/sessions", filtered: "/sessions?q=maths&status=scheduled", set: 2 },
  { path: "/calendar", filtered: "/calendar?q=maths&status=scheduled", set: 2 },
] as const;

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

  for (const screen of FILTERED) {
    test(`${screen.path} names it, and says how many filters are set`, async ({ page }) => {
      await ready(page, screen.path);
      // Nothing set: a name and no count, rather than a zero.
      await expect(page.locator(".filteractions > summary")).toHaveAttribute(
        "aria-label",
        "Filters",
      );
      await expect(page.locator(".filteractions-count")).toHaveCount(0);

      await ready(page, screen.filtered);
      await expect(page.locator(".filteractions > summary")).toHaveAttribute(
        "aria-label",
        `Filters, ${screen.set} set`,
      );
      await expect(page.locator(".filteractions-count")).toHaveText(String(screen.set));
    });

    test(`${screen.path} resets to the unfiltered page`, async ({ page }) => {
      // The effect rather than the exact address: the calendar's reset keeps
      // the date it was showing, because the range is not part of the filter.
      await ready(page, screen.filtered);
      await page.locator(".filteractions > summary").click();
      await page.getByRole("link", { name: "Reset filter" }).click();

      await expect.poll(() => page.locator(".filteractions-count").count()).toBe(0);
      await expect(page.locator("#q")).toHaveValue("");
      expect(page.url()).not.toContain("status=");
      expect(page.url()).not.toContain("q=");
    });

    test(`${screen.path} opens its drawer from the address alone`, async ({ page }) => {
      // No script involved: this is what a `<dialog>` could not do.
      await page.goto(`${screen.path}#edit-filter`);
      await expect(page.locator(".filterdrawer")).toHaveAttribute("role", "dialog");
      await expect.poll(() => drawerShown(page)).toBe("visible");
      await expect(page.getByRole("heading", { name: "Edit filter" })).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
    });

    test(`${screen.path} does not repeat an id or nest a form`, async ({ page }) => {
      // Each drawer restates the search box its toolbar shows, so each one is
      // a chance to collide with it.
      await page.goto(`${screen.path}#edit-filter`);

      const trouble = await page.evaluate(() => {
        const ids = [...document.querySelectorAll("[id]")].map((el) => el.id);
        const seen = new Set<string>();
        return {
          repeated: ids.filter((id) => (seen.has(id) ? true : (seen.add(id), false))),
          nested: document.querySelectorAll("form form").length,
        };
      });

      expect(trouble.repeated, "repeated ids").toEqual([]);
      expect(trouble.nested, "a form inside a form").toBe(0);
    });
  }

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

});

test.describe("the filter drawer", () => {
  test.use({ storageState: statePath("admin") });

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

test.describe("the calendar's remembered filter", () => {
  test.use({ storageState: statePath("admin") });

  test("does not undo the reset it was just cleared by", async ({ page, context }) => {
    // A bare `/calendar` restores the last status filter — that is what the
    // cookie is for. Reset must therefore not navigate to a bare `/calendar`,
    // or the filter would come straight back.
    await context.clearCookies({ name: "toptutorsforus_calendar_status" });
    await page.goto("/calendar?status=scheduled");
    await expect(page.locator(".filteractions-count")).toHaveText("1");

    await page.locator(".filteractions > summary").click();
    await page.getByRole("link", { name: "Reset filter" }).click();

    await expect.poll(() => page.locator(".filteractions-count").count()).toBe(0);
    expect(page.url()).not.toContain("status=");

    // And it stays cleared on the next bare visit, because resetting forgets
    // the filter rather than navigating around it. The cookie is written from the browser
    // after paint, so wait for that rather than for a moment that is long
    // enough on an idle machine — this raced under a parallel run.
    await expect
      .poll(async () =>
        (await context.cookies()).some((c) => c.name === "toptutorsforus_calendar_status" && c.value !== ""),
      )
      .toBe(false);

    await page.goto("/calendar");
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
  });
});

test.describe("what the address ends up saying", () => {
  test.use({ storageState: statePath("admin") });

  test("holds one status parameter, not one per status", async ({ page, context }) => {
    await context.clearCookies({ name: "toptutorsforus_calendar_status" });
    await page.goto("/calendar#edit-filter");
    for (const value of ["scheduled", "completed", "missed"]) {
      await page.locator(`.filterdrawer input[name="status"][value="${value}"]`).check();
    }
    await page.locator(".filterdrawer").getByRole("button", { name: "Apply" }).click();
    await page.waitForURL(/status=/);

    // The form submits a parameter per ticked box; the address holds them
    // joined, with a real comma rather than `%2C`.
    expect(new URL(page.url()).search).toBe("?status=scheduled,completed,missed");
  });

  test("says nothing about the range while the range is the default", async ({
    page,
    context,
  }) => {
    // Today is what an absent date means, so writing it says nothing — and it
    // was on every address the filter form produced.
    await context.clearCookies({ name: "toptutorsforus_calendar_status" });
    await page.goto("/calendar");
    await page.locator(".page-toolbar-fields .filtermenu > summary").click();
    await page.locator('.page-toolbar input[name="status"][value="missed"]').check();
    await page.locator("h1").click();
    await page.waitForURL(/status=/);

    expect(new URL(page.url()).search).toBe("?status=missed");

    // Paging away is a real choice, and it is written.
    await page.getByRole("link", { name: /Next month/ }).click();
    await page.waitForURL(/date=/);
    expect(page.url()).toContain("status=missed");
  });

  test("reads an address written the old way, so a bookmark still works", async ({
    page,
    context,
  }) => {
    await context.clearCookies({ name: "toptutorsforus_calendar_status" });
    await page.goto("/calendar?status=scheduled&status=missed");

    await expect(page.locator(".filteractions-count")).toHaveText("1");
    await expect(
      page.locator('.page-toolbar input[name="status"][value="scheduled"]'),
    ).toBeChecked();
    // Settled into the one spelling, and it stays there.
    expect(new URL(page.url()).search).toBe("?status=scheduled,missed");
  });
});
