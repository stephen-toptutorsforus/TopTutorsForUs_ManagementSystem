/**
 * The filter button, its menu, and the drawer it opens.
 *
 * Against a build, not the dev server — which matters more here than anywhere
 * else in this suite. All of what these assert is client behaviour now, and a
 * dev server whose HMR socket has dropped serves the previous bundle quite
 * happily: the menu's dismissal appeared broken for a while purely because of
 * that.
 *
 * The drawer used to open from the address — `?...#edit-filter` — and half of
 * these tests navigated straight to that fragment. It is React state now, so
 * they go through the control a person would use, and several of them assert
 * that doing so leaves the address exactly as it was.
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

/**
 * Open the drawer the way a person does: the filter button, then Edit filter.
 *
 * There is no address that opens it any more, which is the point of the change
 * — so there is no shortcut for these tests either.
 */
const openDrawer = async (page: Page, url: string) => {
  await ready(page, url);
  await page.locator(".filteractions > summary").click();
  await page.getByRole("button", { name: "Edit filter" }).click();
  await expect.poll(() => drawerShown(page)).toBe("visible");
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
      await page.getByRole("button", { name: /Reset filter/ }).click();

      await expect.poll(() => page.locator(".filteractions-count").count()).toBe(0);
      await expect(page.locator("#q")).toHaveValue("");
      // The address never said what was filtered, and it does not say it was
      // cleared either.
      expect(new URL(page.url()).search).toBe("");
    });

    test(`${screen.path} opens its drawer without touching the address`, async ({
      page,
    }) => {
      await ready(page, screen.filtered);
      const before = page.url();

      await page.locator(".filteractions > summary").click();
      await page.getByRole("button", { name: "Edit filter" }).click();

      await expect.poll(() => drawerShown(page)).toBe("visible");
      await expect(page.locator(".filterdrawer")).toHaveAttribute("role", "dialog");
      await expect(page.getByRole("heading", { name: "Edit filter" })).toBeVisible();
      await expect(page.locator("h1")).toHaveCount(1);
      // The filter is still in the query string; opening the panel added
      // nothing — no `#edit-filter`, no bare `#`.
      expect(page.url()).toBe(before);

      // And closing it leaves the address alone too.
      await page.getByRole("button", { name: "Close filter panel" }).click();
      await expect.poll(() => drawerShown(page)).toBe("hidden");
      expect(page.url()).toBe(before);
    });

    test(`${screen.path} does not repeat an id or nest a form`, async ({ page }) => {
      // Each drawer restates the search box its toolbar shows, so each one is
      // a chance to collide with it.
      await openDrawer(page, screen.path);

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
    await page.getByRole("button", { name: "Edit filter" }).click();

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
    await openDrawer(page, "/people?q=holm&role=instructor&status=active");

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
    await openDrawer(page, "/people?role=student");
    await page.locator("#filter-q").fill("vasquez");
    // Every box starts ticked, so narrowing to Active means unticking the rest
    // rather than ticking one.
    for (const value of ["invited", "pending_invite", "bounced", "disabled"]) {
      await page.locator(`.filterdrawer input[name="status"][value="${value}"]`).uncheck();
    }
    await page.getByRole("button", { name: "Apply" }).click();
    await page.waitForLoadState("networkidle");

    // The address is untouched; the filter is what changed.
    expect(new URL(page.url()).search).toBe("");
    // And the toolbar agrees with the drawer, because they are one filter.
    await expect(page.locator("#q")).toHaveValue("vasquez");
    await expect(page.locator(".filteractions-count")).toHaveText("3");
  });

  test("cancels without changing anything", async ({ page }) => {
    await openDrawer(page, "/people?role=student");
    const before = page.url();
    expect(new URL(before).search, "the link's query is spent on arrival").toBe("");
    await page.locator("#filter-q").fill("discarded");
    await page.getByRole("button", { name: "Cancel" }).click();

    await expect.poll(() => drawerShown(page)).toBe("hidden");
    expect(page.url()).toBe(before);
    await expect(page.locator("#q")).toHaveValue("");

    // Reopening shows the filter the page is actually under, not the edit that
    // was thrown away: the panel is remounted on each opening.
    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();
    await expect.poll(() => drawerShown(page)).toBe("visible");
    await expect(page.locator("#filter-q")).toHaveValue("");
  });

  test("clears everything from inside itself", async ({ page }) => {
    await openDrawer(page, "/people?q=holm&role=instructor");
    await page.locator(".filterdrawer").getByRole("button", { name: "Reset filter" }).click();

    await page.waitForLoadState("networkidle");
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
  });

  test("does not nest a form, and does not repeat an id", async ({ page }) => {
    // The drawer restates the search box the toolbar shows. Two `id="q"` would
    // be invalid and would break both labels.
    await openDrawer(page, "/people");

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
    await openDrawer(page, "/people");
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
    // The drawer is a rendering concern; who may see the directory is not —
    // and a fragment never reached the server anyway, so this is the plain
    // address now.
    const response = await page.goto("/people");
    expect(response?.status()).toBe(403);
  });
});

test.describe("the calendar's stored filter", () => {
  test.use({ storageState: statePath("admin") });

  test("stays cleared once it is reset", async ({ page }) => {
    // A bare `/calendar` shows the stored filter — that is the whole mechanism
    // now, and it is what made resetting delicate when the address was also
    // trying to say something.
    await page.goto("/calendar?status=scheduled");
    await page.waitForURL(/\/calendar$/);
    await expect(page.locator(".filteractions-count")).toHaveText("1");

    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: /Reset filter/ }).click();
    await expect.poll(() => page.locator(".filteractions-count").count()).toBe(0);

    // And it stays cleared on the next plain visit, rather than the stored
    // value coming back.
    await page.goto("/calendar");
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
  });
});

test.describe("what the stored filter ends up being", () => {
  test.use({ storageState: statePath("admin") });

  test("starts with every box ticked, on every screen that filters", async ({
    page,
    context,
  }) => {
    // The resting state of a filter is everything shown, and that is drawn
    // rather than explained. It used to be an empty set of boxes under a hint.
    await context.clearCookies({ name: "toptutorsforus_calendar_status" });

    await openDrawer(page, "/calendar");
    for (const box of await page.locator('.filterdrawer input[name="status"]').all()) {
      await expect(box).toBeChecked();
    }

    await openDrawer(page, "/sessions");
    for (const box of await page.locator('.filterdrawer input[name="status"]').all()) {
      await expect(box).toBeChecked();
    }

    await openDrawer(page, "/people");
    for (const name of ["role", "status"]) {
      for (const box of await page.locator(`.filterdrawer input[name="${name}"]`).all()) {
        await expect(box).toBeChecked();
      }
    }

    // And a full set of ticks is not a filter: nothing is counted, and nothing
    // is written down.
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
    expect(new URL(page.url()).search).toBe("");
  });

  test("ticking the last empty box says nothing, rather than everything", async ({
    page,
    context,
  }) => {
    // Arriving under one status and ticking the rest is the resting state
    // reached the long way round. It has to write what the resting state
    // writes: nothing.
    await context.clearCookies({ name: "toptutorsforus_calendar_status" });
    await openDrawer(page, "/calendar?status=missed");
    for (const value of [
      "scheduled",
      "rescheduled",
      "cancelled",
      "completed",
      "requested",
      "rejected",
    ]) {
      await page.locator(`.filterdrawer input[name="status"][value="${value}"]`).check();
    }
    await page.locator(".filterdrawer").getByRole("button", { name: "Apply" }).click();

    await page.waitForURL(/\/calendar$/);
    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator(".filteractions-count")).toHaveCount(0);
  });

  test("applies three statuses and says so on the button, not in the bar", async ({
    page,
  }) => {
    await openDrawer(page, "/calendar");
    for (const value of ["rescheduled", "cancelled", "requested", "rejected"]) {
      await page.locator(`.filterdrawer input[name="status"][value="${value}"]`).uncheck();
    }
    await page.locator(".filterdrawer").getByRole("button", { name: "Apply" }).click();
    await page.waitForLoadState("networkidle");

    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    for (const value of ["scheduled", "completed", "missed"]) {
      await expect(
        page.locator(`.page-toolbar input[name="status"][value="${value}"]`),
      ).toBeChecked();
    }
    await expect(
      page.locator('.page-toolbar input[name="status"][value="cancelled"]'),
    ).not.toBeChecked();
  });

  test("keeps the range it was on while a status is applied", async ({ page }) => {
    // The range and the filter are one stored state, so changing one must not
    // reset the other.
    await page.goto("/calendar");
    await page.locator(".page-toolbar-fields .filtermenu > summary").click();
    for (const value of [
      "scheduled",
      "rescheduled",
      "cancelled",
      "completed",
      "requested",
      "rejected",
    ]) {
      await page.locator(`.page-toolbar input[name="status"][value="${value}"]`).uncheck();
    }
    await page.locator("h1").click();
    await page.waitForLoadState("networkidle");

    expect(new URL(page.url()).search).toBe("");
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    const month = await page.locator(".cal-heading").textContent();

    // Paging away is a real choice, and the filter comes with it. Polled
    // rather than read once: a server action re-renders the page under us, and
    // "no network in flight" is not the same moment as "React has painted".
    await page.getByRole("button", { name: /Next month/ }).click();
    await expect.poll(() => page.locator(".cal-heading").textContent()).not.toBe(month);
    await expect(page.locator(".filteractions-count")).toHaveText("1");
    expect(new URL(page.url()).search).toBe("");
  });

  test("reads an address written the old way, so a bookmark still works", async ({
    page,
  }) => {
    // The parameters are spent on arrival — see `e2e/address.spec.ts` — but the
    // filter they asked for is the one applied.
    await page.goto("/calendar?status=scheduled&status=missed");
    await page.waitForURL(/\/calendar$/);

    await expect(page.locator(".filteractions-count")).toHaveText("1");
    await expect(
      page.locator('.page-toolbar input[name="status"][value="scheduled"]'),
    ).toBeChecked();
    await expect(
      page.locator('.page-toolbar input[name="status"][value="cancelled"]'),
    ).not.toBeChecked();
    expect(new URL(page.url()).search).toBe("");
  });
});
