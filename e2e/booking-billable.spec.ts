/**
 * Whether a new session is billable, asked rather than decided.
 *
 * The form used to send `billable=on` from a hidden field, so every session
 * booked here was billable and could only be changed afterwards — a
 * financially significant field nobody could answer at the point they were
 * answering everything else.
 *
 * The box now starts from the tenant's `booking.billable_default`, which ships
 * `true`, so a tenant that configures nothing books exactly as it did before.
 * These check both halves: that the default is honoured, and that unticking it
 * actually reaches the record rather than being overwritten by a form reset.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";
import { LANE, bookableDate, pickFreeTime, previewAndBook } from "./slots";

test.use({ storageState: statePath("admin") });

/** One eligible instructor under the seed, which keeps the choice unambiguous. */
const STUDENT = "Teo Vasquez";

/** The booking form's own debounce, mirrored — see `booking.spec.ts`. */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(260);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".availability")).not.toHaveAttribute("aria-busy", "true");
}

test.describe("billable", () => {
  test("is a control, and starts at the tenant's default", async ({ page }) => {
    await page.goto("/sessions/new");

    const box = page.locator('input[name="billable"]');
    await expect(box).toBeVisible();
    // The shipped default, and what the hidden field used to force.
    await expect(box).toBeChecked();
  });

  test("survives the refresh that follows every change", async ({ page }) => {
    await page.goto("/sessions/new");

    await page.locator('input[name="billable"]').uncheck();
    // Any change refreshes the block, and `useActionState` resets the form when
    // the reply lands. A checkbox restored to a stale attribute would tick
    // itself again here — which is precisely how the "Number of sessions" field
    // used to lose what had been typed into it.
    await page.locator("#student_picker").selectOption({ label: STUDENT });
    await settled(page);

    await expect(page.locator('input[name="billable"]')).not.toBeChecked();
  });

  test("books a session that is not billable when it is unticked", async ({ page }) => {
    await page.goto("/sessions/new");

    // Not simply tomorrow: this test books, the suite shares one database with
    // every earlier run, and an instructor or a room already taken at that hour
    // is a conflict no override clears. See `slots.ts`.
    const when = bookableDate(
      await page.locator("#start_date").getAttribute("min"),
      test.info().project.name,
      LANE.billable,
    );

    await page.locator("#student_picker").selectOption({ label: STUDENT });
    await settled(page);

    await page.locator("#title").fill("Free session check");
    await page.locator("#start_date").fill(when);
    await settled(page);

    const instructor = page.locator("#instructor_ref option").nth(1);
    await page
      .locator("#instructor_ref")
      .selectOption((await instructor.getAttribute("value")) ?? "");
    await settled(page);

    // A time the grid says is free, rather than the form's default. Since the
    // grid learned about existing bookings it cannot offer one already taken,
    // which is what stops this test colliding with every earlier run of it.
    await pickFreeTime(page);
    await settled(page);

    // Last, so the refresh that follows picking a time cannot reset it — the
    // very thing the case above this one is about.
    await page.locator('input[name="billable"]').uncheck();

    await previewAndBook(page);

    // The record, not the form: the field's own value, found through the label
    // beside it rather than by looking for "No" anywhere on the page.
    const field = page.locator(".field", { has: page.locator(".fact-label", { hasText: /^Billable$/ }) });
    await expect(field.locator(".fact-value")).toHaveText("No");
  });
});
