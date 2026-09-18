/**
 * The series screen, and the sidebar that now reaches it from two places.
 *
 * Nothing in `e2e/` had ever opened `/series` as anybody but an administrator,
 * which is the other half of why it went so long being structurally empty for
 * every student and guardian: the route answered 200, the smoke suite was
 * satisfied, and the page inside it could not have held a row.
 *
 * Structural on purpose, like the rest of this directory — a link, a row, a
 * heading — so design work does not invalidate it weekly. What it must not do
 * is recite how much the seed happens to make; "the parent's list is not
 * empty" is true at any roster size and "it is exactly one" is not.
 */

import { expect, test } from "@playwright/test";

import { statePath } from "./accounts";

/** The primary navigation, which is where the two availability entries live. */
const sidebar = (page: import("@playwright/test").Page) =>
  page.getByRole("navigation", { name: "Primary" });

test.describe("as a parent", () => {
  test.use({ storageState: statePath("parent") });

  test("shows a guardian the runs their child is on", async ({ page }) => {
    // Empty before this change, for everybody who is not an instructor: the
    // query asked who the *template's* default instructor was, and a parent is
    // never that. The seed's recurring group has one of Delphine's two wards
    // on it, so this row exists on a merely-seeded database.
    await page.goto("/series");
    await expect(page.getByRole("heading", { name: "Series", level: 1 })).toBeVisible();
    await expect(page.locator("tbody tr")).not.toHaveCount(0);
  });
});

test.describe("as an instructor", () => {
  test.use({ storageState: statePath("instructor") });

  test("reaches their own hours from the sidebar", async ({ page }) => {
    await page.goto("/");
    const link = sidebar(page).getByRole("link", { name: "My Availability" });
    await expect(link).toBeVisible();
    await link.click();
    await expect(page).toHaveURL(/\/availability$/);
    // The page says whose hours these are, which it did not before there were
    // two ways in with two different names.
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("My availability");
  });

  test("is not offered the roster view, or the audit trail", async ({ page }) => {
    await page.goto("/");
    await expect(
      sidebar(page).getByRole("link", { name: "Instructor Availability" }),
    ).toHaveCount(0);
    await expect(sidebar(page).getByRole("link", { name: "Audit trail" })).toHaveCount(0);
  });

  test("sees the series they are teaching", async ({ page }) => {
    await page.goto("/series");
    await expect(page.getByRole("heading", { name: "Series", level: 1 })).toBeVisible();
  });
});

test.describe("as an administrator", () => {
  test.use({ storageState: statePath("admin") });

  test("is offered the roster view, and exactly one availability entry", async ({ page }) => {
    // An administrator holds every permission in the catalogue, so a gate that
    // only said "who may" would list this one page twice under two names.
    await page.goto("/");
    await expect(
      sidebar(page).getByRole("link", { name: "Instructor Availability" }),
    ).toBeVisible();
    await expect(sidebar(page).locator('a[href="/availability"]')).toHaveCount(1);
  });

  test("finds the audit trail under Administration", async ({ page }) => {
    await page.goto("/");
    const group = sidebar(page)
      .locator(".nav-group")
      .filter({ has: page.locator("summary", { hasText: "Administration" }) });
    await expect(group.getByRole("link", { name: "Audit trail" })).toHaveCount(1);
  });

  test("names the instructor whose hours it is showing", async ({ page }) => {
    // The administrator is not on the instructor roster, so the page falls back
    // to the first of them — and used to announce a bare "Availability" while
    // showing one particular person's.
    await page.goto("/availability");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("availability");
    await expect(page.getByRole("heading", { level: 1 })).not.toHaveText("My availability");
  });
});
