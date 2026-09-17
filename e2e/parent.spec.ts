/**
 * What a parent sees, which until now nobody had walked end to end.
 *
 * The seeded parent guarded nobody — every guardian link went to whichever
 * parent sorted first, and that is Sana Holm, who is also an instructor. So the
 * only account that could have exercised this was one whose calendar is full of
 * her own teaching, and the only pure parent had an empty screen. Both halves
 * of that are fixed in `prisma/seed.ts`.
 *
 * Delphine Arceneaux guards two of the four seeded students, and one of them is
 * in the recurring group with a student she does not guard. That pairing is the
 * whole point of her: "sees their own child" and "does not see the child beside
 * them" are different assertions, and a fixture where the guardian happens to
 * guard everybody passes the first while proving nothing about the second.
 *
 * Stated as absences against a tightly scoped container, and against the JSON as
 * well as the HTML — a name that is merely styled out of view is still a name
 * that was sent.
 */

import { type APIRequestContext, expect, test } from "@playwright/test";

import { SHARED_ROUTES, statePath } from "./accounts";

/** In the recurring group with Yusuf, and not Delphine's child. */
const NOT_HERS = "Wren Calloway";
/** Hers, and in that group. */
const HERS = "Yusuf Adeyemi";

/** Every session ref one identity can see, through the transport that says so plainly. */
async function refsVisibleTo(api: APIRequestContext): Promise<string[]> {
  const response = await api.get("/api/v1/sessions");
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { results?: { ref: string }[] };
  return (body.results ?? []).map((row) => row.ref);
}

test.describe("as a parent", () => {
  test.use({ storageState: statePath("parent") });

  test("opens the screens every signed-in person can open", async ({ page }) => {
    // A parent holds the same permissions as a student, so the shared routes
    // are the shared routes. Asserted rather than assumed, because the account
    // is new and an empty seed would make every other test here vacuous.
    for (const route of SHARED_ROUTES) {
      const response = await page.goto(route);
      expect(response?.status(), route).toBe(200);
    }
  });

  test("sees their own child's sessions on the calendar", async ({ page }) => {
    await page.goto("/calendar");
    await expect(page.locator("[data-session-ref]").first()).toBeVisible();
  });

  test("is never told the name of a child they do not guard", async ({ page }) => {
    // The group of two: Delphine guards one of its students. Before the roster
    // narrowing she was served both names here.
    //
    // The month view is asked only for the absence, because it names nobody in
    // a group either way — `attendeesLabel` draws two students as "2 students &
    // Dara" for the coordinator as well, which is exactly the property that
    // lets the chip be identical for both of them.
    await page.goto("/calendar");
    await expect(page.locator("[data-session-ref]").first()).toBeVisible();
    await expect(page.locator("main")).not.toContainText(NOT_HERS);

    // The list view is where names are actually written out, so it is where
    // "hers, and only hers" can be asserted as a presence and an absence
    // together.
    await page.goto("/calendar?view=list");
    await page.waitForURL(/\/calendar$/);
    await expect(page.locator("main")).toContainText(HERS);
    await expect(page.locator("main")).not.toContainText(NOT_HERS);
  });

  test("is not told them on the session list either", async ({ page }) => {
    await page.goto("/sessions");
    await expect(page.locator("main")).not.toContainText(NOT_HERS);
  });

  test("is not told them in the JSON, which is where styling cannot help", async ({
    request,
  }) => {
    // The half that matters. A name hidden by CSS has still been sent, and this
    // is the same decoration the HTML renders from.
    const response = await request.get("/api/v1/sessions");
    expect(response.status()).toBe(200);
    const body = await response.text();
    expect(body).toContain(HERS);
    expect(body).not.toContain(NOT_HERS);
  });

  test("is refused another family's session the way a stranger is", async ({
    page,
    request,
  }) => {
    // 404 and not 403: a 403 would confirm the record exists. The same rule
    // tenant isolation is expressed as, applied to a relationship.
    //
    // The session is found rather than named, because refs are minted fresh by
    // every seed — whichever one this tenant has that this parent is not
    // connected to.
    const mine = new Set(await refsVisibleTo(request));

    const staff = await page.context().browser()!.newContext({
      storageState: statePath("admin"),
    });
    const theirs = await refsVisibleTo(staff.request);
    await staff.close();

    const unconnected = theirs.find((ref) => !mine.has(ref));
    expect(unconnected, "the seed should hold a session this parent is not on").toBeDefined();

    const response = await request.get(`/api/v1/sessions/${unconnected}`);
    expect(response.status()).toBe(404);
  });
});
