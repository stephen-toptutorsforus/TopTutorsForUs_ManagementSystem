/**
 * What may be stored, and by whom.
 *
 * Next sets a `no-store` on a dynamically rendered page and sets nothing at all
 * on a route handler's response — and every route handler here answers with one
 * tenant's data, from a URL that names no tenant, authorised by a cookie that
 * is not in any cache key. The export went out as a CSV of who was taught and
 * when, with no `Cache-Control` header of any kind.
 *
 * These assert the header rather than the absence of a bug, because the bug
 * only appears where somebody has put a shared cache in front, and by then it
 * is somebody else's data on somebody else's screen.
 */

import { expect, test } from "@playwright/test";

import { statePath } from "./accounts";

/** Nothing about one tenant may be stored anywhere. */
const PRIVATE = ["/calendar", "/people", "/sessions/export.csv", "/api/v1/sessions"];

test.describe("caching", () => {
  test.use({ storageState: statePath("admin") });

  for (const path of PRIVATE) {
    test(`${path} refuses to be stored`, async ({ page }) => {
      const response = await page.request.get(path, { maxRedirects: 0 });
      expect(response.status()).toBe(200);

      const control = response.headers()["cache-control"];
      expect(control, `${path} must say how it may be cached`).toBeTruthy();
      expect(control).toContain("no-store");
      // `private` as well as `no-store`: one refuses the shared caches, the
      // other refuses the browser's disk, and the export is a file about
      // students that should not be left in a cache directory.
      expect(control).toContain("private");
    });
  }

  test("the redirect that carries a filter cookie is not cacheable", async ({ page }) => {
    // It answers with `Set-Cookie` holding one person's filter, under a URL
    // that says nothing about who they are. Cached, it hands that filter to
    // whoever asks next — and it carries a one-use CSP nonce besides.
    const response = await page.request.get("/calendar?view=week", { maxRedirects: 0 });

    expect(response.status()).toBe(307);
    expect(response.headers()["set-cookie"], "this is the response that sets it").toBeTruthy();
    expect(response.headers()["cache-control"]).toContain("no-store");
  });

  test("a health probe answers about now, not about a minute ago", async ({ page }) => {
    // Not secrecy — truth. A load balancer reading a cached "ok" is exactly the
    // failure the endpoint exists to catch.
    for (const path of ["/health", "/health/db"]) {
      const response = await page.request.get(path);
      expect(response.headers()["cache-control"], path).toContain("no-store");
    }
  });

  test("the brand images may be kept, because they are not about anybody", async ({ page }) => {
    // The other half of the rule: `no-store` everywhere is not a policy, it is
    // giving up. These are the same bytes for every tenant and every visitor.
    const response = await page.request.get("/img/logo.png");
    const control = response.headers()["cache-control"];

    expect(control).toContain("public");
    expect(control).not.toContain("no-store");
    expect(control, "and not the max-age=0 that revalidates on every page").toMatch(
      /max-age=[1-9]/,
    );
  });
});
