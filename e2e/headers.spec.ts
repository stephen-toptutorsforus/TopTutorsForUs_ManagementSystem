/**
 * The security headers, asserted rather than assumed.
 *
 * This suite exists because the opposite was true for the life of the project.
 * `lib/timegrid.ts` and the stylesheet both cite `style-src 'self'` as the
 * reason a grid row resolves to a hand-written class instead of an inline
 * `top`, and there was no Content-Security-Policy on any response. The design
 * cost had been paid every day and the protection had never once been
 * collected, and nothing anywhere would have noticed.
 *
 * So: the policy is a header on a real response, and — the half that actually
 * matters — the application satisfies it. A policy nobody can load the page
 * under gets switched off the first time it is inconvenient.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

/** Every violation the browser reports, from before the first byte runs. */
async function watchViolations(page: Page): Promise<() => Promise<string[]>> {
  await page.addInitScript(() => {
    (window as unknown as { __csp: string[] }).__csp = [];
    document.addEventListener("securitypolicyviolation", (event) => {
      (window as unknown as { __csp: string[] }).__csp.push(
        `${event.violatedDirective} blocked ${event.blockedURI || "an inline"}`,
      );
    });
  });
  return () => page.evaluate(() => (window as unknown as { __csp: string[] }).__csp);
}

test.describe("the security headers", () => {
  test.use({ storageState: statePath("admin") });

  test("are on the response, with a per-request nonce", async ({ page }) => {
    const first = await page.goto("/calendar");
    const headers = first!.headers();

    const csp = headers["content-security-policy"];
    expect(csp, "there must be a policy at all").toBeTruthy();
    for (const directive of [
      "default-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
      // The one the codebase has been designed around since before it was sent.
      "style-src 'self'",
    ]) {
      expect(csp, `the policy should say ${directive}`).toContain(directive);
    }
    // Inline script is how a policy is usually quietly given up. It must not
    // appear, and the nonce is what makes that possible rather than painful.
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).toMatch(/script-src [^;]*'nonce-[a-f0-9]{32}'/);

    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    // Naming the framework and its version is a free hint about which
    // advisories to try, and buys nothing back.
    expect(headers["x-powered-by"]).toBeUndefined();

    // A nonce reused across responses is not a nonce. Fetched fresh rather than
    // re-read, because a second visit could be served from the router cache.
    const second = await page.goto("/people");
    const nonceOf = (value: string) => /'nonce-([a-f0-9]{32})'/.exec(value)?.[1];
    expect(nonceOf(second!.headers()["content-security-policy"]!)).not.toBe(nonceOf(csp!));
  });

  test("are satisfied by the pages themselves", async ({ page }) => {
    const violations = await watchViolations(page);

    for (const path of ["/", "/calendar", "/people", "/sessions", "/sessions/new"]) {
      await page.goto(path);
      await page.waitForLoadState("networkidle");
      expect(await violations(), `${path} violates the policy it is served with`).toEqual([]);
    }
  });

  test("do not stop the page hydrating", async ({ page }) => {
    // The check that the policy is survivable and not merely present: this
    // dialog does not exist until React has run, and React runs from a script
    // tag the policy has to have nonced correctly.
    const violations = await watchViolations(page);
    await page.goto("/calendar");

    await page.locator("[data-session-ref]:visible").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    expect(await violations()).toEqual([]);
  });
});

test("the sign-in page is covered too, before anybody has a session", async ({ page }) => {
  const violations = await watchViolations(page);
  const response = await page.goto("/sign-in");

  expect(response!.headers()["content-security-policy"]).toContain("default-src 'self'");
  await page.waitForLoadState("networkidle");
  expect(await violations()).toEqual([]);
});

test("with no script, the navigation's own stylesheet loads", async ({ page, viewport }) => {
  test.skip((viewport?.width ?? 0) > 720, "the drawer only exists below 720px");

  // It used to be an inline `<style>`, which `style-src 'self'` refuses — so
  // turning the policy on took the whole navigation away on a phone with
  // scripting off. A same-origin file is what the policy is for.
  const response = await page.request.get("/no-script.css");
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain(".sidebar");
});
