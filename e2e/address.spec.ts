/**
 * What the address bar is left saying.
 *
 * The filter state belongs in the URL; a parameter restating a default does
 * not. Three screens carry filter state and each redirects to the tidiest
 * spelling of its own — which is exactly the kind of thing that works in a unit
 * test and then bounces for ever against a real router, so it is worth asking a
 * browser.
 *
 * `waitForURL` rather than `toHaveURL`: a redirect loop should fail here as a
 * timeout on the address never settling, not as a passing assertion that
 * happened to read the bar between two hops.
 */

import { expect, test } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const noisy = [
  // The month view and a complete status set are both the default restated.
  ["/calendar?view=month", "/calendar"],
  ["/calendar?view=month&date=2026-09-03", "/calendar?date=2026-09-03"],
  // Nothing but `view`, `date`, `q` and `status` was ever read off a calendar
  // URL, so these were being ignored before they were dropped.
  ["/calendar?instructor=abc&page=4", "/calendar"],
  // What a GET form leaves behind when every field is empty.
  ["/people?q=", "/people"],
  ["/people?q=&role=instructor", "/people?role=instructor"],
  ["/sessions?q=&from=&to=&instructor=&program=", "/sessions"],
  ["/sessions?q=&page=1", "/sessions"],
] as const;

for (const [from, expected] of noisy) {
  test(`tidies ${from} to ${expected}`, async ({ page, baseURL }) => {
    await page.goto(from);
    await page.waitForURL(new URL(expected, baseURL).toString());
    await expect(page.locator("h1")).toBeVisible();
  });
}

const already = ["/calendar", "/calendar?view=week", "/people?role=instructor", "/sessions?page=3"];

for (const url of already) {
  test(`leaves ${url} alone`, async ({ page, baseURL }) => {
    // A tidy address must be its own tidiest form, or the redirect and the
    // parser trade the request between them until the browser gives up.
    const response = await page.goto(url);
    expect(response?.request().redirectedFrom(), `${url} redirected`).toBeNull();
    await expect(page).toHaveURL(new URL(url, baseURL).toString());
  });
}
