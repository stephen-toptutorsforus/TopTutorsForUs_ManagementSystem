/**
 * The booking screen's instructor list, as the roster changes under it.
 *
 * Worth asking a browser rather than a unit test, because the property being
 * checked is a timing one: the refresh submits the form, and the hidden
 * `student_refs` inputs for a newly added student only exist once React has
 * committed. A handler that submitted immediately would send the previous
 * roster and the list would lag one student behind — which looks like nothing
 * at all in isolation, and like a wrong answer here.
 *
 * The seed is what makes these deterministic. Northgate has three instructors
 * and four students, and the seed assigns each student to one instructor in
 * turn, so Teo Vasquez has exactly one eligible instructor and the "Wednesday
 * Maths Pod" — three students, three different instructors — has none.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";

test.use({ storageState: statePath("admin") });

const STUDENT = "Teo Vasquez";
const GROUP = "Wednesday Maths Pod";

/** The address, with nothing after the path. */
const bare = (page: Page) => {
  const url = new URL(page.url());
  return url.pathname + url.search + url.hash;
};

/**
 * The form's own debounce, mirrored. Without waiting past it, `networkidle`
 * reports the quiet *before* the request rather than after it, and every
 * assertion below reads the previous answer — which is how this file first
 * claimed that removing a student did not restore the list.
 */
const REFRESH_DELAY_MS = 200;

/** Instructor options, minus the "Choose an instructor" placeholder. */
async function offered(page: Page): Promise<string[]> {
  const labels = await page.locator("#instructor_ref option").allTextContents();
  return labels.filter((label) => label !== "Choose an instructor");
}

/** How many instructors are offered — a retrying assertion, not a snapshot. */
async function expectOffered(page: Page, count: number): Promise<void> {
  await expect(page.locator("#instructor_ref option")).toHaveCount(count + 1);
}

/** Wait until the block has been asked and answered. */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(REFRESH_DELAY_MS + 60);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".availability")).not.toHaveAttribute("aria-busy", "true");
}

async function addStudent(page: Page, name: string): Promise<void> {
  await page.locator("#student_picker").selectOption({ label: name });
  await settled(page);
}

test.beforeEach(async ({ page }) => {
  await page.goto("/sessions/new");
  await expect(page.locator("h1")).toHaveText("Session Booking");
});

test.describe("the instructor list follows the roster", () => {
  test("narrows when a student is added and comes back when they are removed", async ({
    page,
  }) => {
    await expectOffered(page, 3);
    const everyone = await offered(page);
    await expect(page.locator("#instructor-hint")).toContainText("Every instructor here");

    // The seed assigns each student to one instructor in turn, so exactly one
    // of the three may teach this one.
    await addStudent(page, STUDENT);
    await expectOffered(page, 1);

    const eligible = await offered(page);
    for (const person of eligible) expect(everyone).toContain(person);
    await expect(page.locator("#instructor-hint")).toContainText("may teach this student");

    // And back again. A filter that narrows but never widens would pass every
    // assertion above.
    await page.getByRole("button", { name: `Remove ${STUDENT}` }).click();
    await settled(page);
    await expectOffered(page, 3);
    expect(await offered(page)).toEqual(everyone);
  });

  test("the availability grid is drawn from the same narrowed list", async ({ page }) => {
    // The defect this rules out: a dropdown that filters while the grid beside
    // it still offers a Select button for somebody the preview would refuse.
    const today = await page.locator("#start_date").getAttribute("min");
    await page.locator("#start_date").fill(today!);
    await settled(page);
    await expect(page.locator(".daygrid")).toBeVisible();
    const before = await page.locator(".daygrid tbody tr").count();

    expect(before).toBe(3);
    await addStudent(page, STUDENT);

    await expect(page.locator(".daygrid tbody tr")).toHaveCount(1);
    expect(await page.locator(".daygrid tbody tr").count()).toBe(
      (await offered(page)).length,
    );
  });

  test("a group with no instructor in common says so, and says it is not a clash", async ({
    page,
  }) => {
    // The distinction the copy exists for: nobody *may* teach them, which is
    // not the same as nobody being free, and sends you somewhere else to fix it.
    await page.locator("#group_ref").selectOption({ label: GROUP });
    await settled(page);

    const notice = page.locator(".availability .notice-warn");
    await expect(notice).toContainText("No instructors are eligible for the selected students");
    await expect(notice).toHaveAttribute("role", "status");
    await expect(page.locator(".daygrid")).toHaveCount(0);
    await expectOffered(page, 0);

    await page.locator("#group_ref").selectOption({ label: "No group" });
    await settled(page);
    await expectOffered(page, 3);
  });

  test("clears an instructor the new roster does not allow, and says why", async ({
    page,
  }) => {
    // Find out who is eligible for this student, then deliberately choose
    // somebody else before adding them.
    await addStudent(page, STUDENT);
    await expectOffered(page, 1);
    const eligible = await offered(page);
    await page.getByRole("button", { name: `Remove ${STUDENT}` }).click();
    await settled(page);
    await expectOffered(page, 3);

    const ineligible = (await offered(page)).find((who) => !eligible.includes(who))!;
    expect(ineligible, "the seed should leave at least one").toBeTruthy();
    await page.locator("#instructor_ref").selectOption({ label: ineligible });
    await settled(page);
    await expect(page.locator("#instructor_ref")).not.toHaveValue("");

    await addStudent(page, STUDENT);

    await expect(page.locator("#instructor_ref")).toHaveValue("");
    await expect(page.locator(".booking .notice-warn").first()).toContainText(
      "cannot teach the student now on this session",
    );
  });
});

test.describe("what a refresh must not disturb", () => {
  test("keeps everything already typed or chosen", async ({ page }) => {
    const today = await page.locator("#start_date").getAttribute("min");
    await page.locator("#title").fill("Algebra practice");
    await page.locator("#description").fill("Quadratics before the test.");
    await page.locator("#start_date").fill(today!);
    await page.locator("#start_time").fill("17:30");
    await page.locator("#duration_minutes").selectOption("90");
    await settled(page);

    await addStudent(page, STUDENT);

    await expect(page.locator("#title")).toHaveValue("Algebra practice");
    await expect(page.locator("#description")).toHaveValue("Quadratics before the test.");
    await expect(page.locator("#start_date")).toHaveValue(today!);
    await expect(page.locator("#start_time")).toHaveValue("17:30");
    await expect(page.locator("#duration_minutes")).toHaveValue("90");
    await expect(page.locator(".chip")).toHaveCount(1);
  });

  test("leaves the newest selection standing after a burst of changes", async ({ page }) => {
    // Three changes inside the debounce window. The chip list is client state
    // that the server only echoes, so no reply can put a removed student back.
    // Teo and Pilar are the seed's two students who share an instructor, so the
    // final answer is a real one rather than an empty state — an answer computed
    // from a stale roster would be a different number, not merely a later one.
    await page.locator("#student_picker").selectOption({ label: STUDENT });
    await page.locator("#student_picker").selectOption({ label: "Wren Calloway" });
    await page.locator("#student_picker").selectOption({ label: "Pilar Esteban" });
    await settled(page);

    await expect(page.locator(".chip")).toHaveCount(3);
    await page.getByRole("button", { name: "Remove Wren Calloway" }).click();
    await settled(page);

    await expect(page.locator(".chip")).toHaveCount(2);
    await expect(page.locator(".chips")).not.toContainText("Wren Calloway");
    await expectOffered(page, 1);
    await expect(page.locator("#instructor-hint")).toContainText(
      "1 of your instructors may teach these students",
    );
  });

  test("never changes the address", async ({ page }) => {
    expect(bare(page)).toBe("/sessions/new");

    await addStudent(page, STUDENT);
    expect(bare(page), "adding a student must not write to the address").toBe(
      "/sessions/new",
    );

    await page.locator("#group_ref").selectOption({ label: GROUP });
    await settled(page);
    expect(bare(page)).toBe("/sessions/new");

    await page.getByRole("button", { name: `Remove ${STUDENT}` }).click();
    await settled(page);
    expect(bare(page)).toBe("/sessions/new");
  });

  test("announces the update politely rather than moving focus", async ({ page }) => {
    const region = page.locator(".availability");
    await expect(region).toHaveAttribute("aria-live", "polite");

    await page.locator("#title").focus();
    await page.locator("#student_picker").selectOption({ label: STUDENT });
    await settled(page);

    // The block is replaced under a live region; nothing steals the caret.
    await expect(page.locator(".chip")).toHaveCount(1);
    await expect(region).toHaveAttribute("aria-busy", "false");
  });
});

test.describe("the backend is the one that refuses", () => {
  test("will not preview a booking with an instructor the student may not have", async ({
    page,
  }) => {
    // The dropdown no longer offers them, so this drives the field directly —
    // which is the point: hiding a name is a courtesy, and the refusal has to
    // come from the server whether or not the screen cooperated.
    const today = await page.locator("#start_date").getAttribute("min");
    await addStudent(page, STUDENT);
    await expectOffered(page, 1);
    const eligible = await offered(page);

    await page.getByRole("button", { name: `Remove ${STUDENT}` }).click();
    await settled(page);
    await expectOffered(page, 3);
    const ineligible = (await offered(page)).find((who) => !eligible.includes(who))!;
    await page.locator("#instructor_ref").selectOption({ label: ineligible });

    await page.locator("#title").fill("Algebra practice");
    await page.locator("#start_date").fill(today!);
    await settled(page);
    await expect(page.locator(".cal-suggest, .daygrid")).toBeVisible();

    // Injected and submitted in one task, so no debounced refresh can land
    // between the two and clear the instructor the screen would not have let
    // us keep. That is the point of the test: the refusal has to come from the
    // server even when the screen has been bypassed.
    await page.evaluate((name) => {
      const form = document.querySelector<HTMLFormElement>("form.booking")!;
      const picker = document.querySelector<HTMLSelectElement>("#student_picker");
      const option = [...(picker?.options ?? [])].find((o) => o.textContent?.trim() === name);
      const field = document.createElement("input");
      field.type = "hidden";
      field.name = "student_refs";
      field.value = option?.value ?? "";
      form.appendChild(field);
      const preview = form.querySelector<HTMLButtonElement>(
        'button[name="action"][value="preview"]',
      );
      form.requestSubmit(preview!);
    }, STUDENT);
    await page.waitForLoadState("networkidle");

    await expect(page.locator(".booking .notice-bad").first()).toContainText(
      "The selected instructor is not eligible for one or more students",
    );
    expect(bare(page)).toBe("/sessions/new");
  });
});
