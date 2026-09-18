/**
 * Money, on a product that charges for nothing.
 *
 * The booking form's Billable box used to be a hidden field forced on, then
 * became a control asked at the point everything else was asked. It is now
 * neither, because `booking.billable_enabled` ships `false`: a tenant that
 * charges for nothing should not be asked a financial question on every
 * booking, and a Payment column of "unpaid" and an Invoice column of "—" are
 * two more controls offering an answer nothing reads.
 *
 * This file checks the four places somebody would meet it — the booking form,
 * the column picker, the record, and the edit panel — because hiding it on one
 * screen and leaving it on the next is exactly how the field survived being
 * "removed" the first time. That the *write* refuses it regardless, whatever a
 * crafted post sends, is `tests/db/booking.test.ts`; this is the courtesy half.
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
  test("is not on the booking form at all", async ({ page }) => {
    await page.goto("/sessions/new");
    await expect(page.locator("#title")).toBeVisible();

    await expect(page.locator('input[name="billable"]')).toHaveCount(0);
    // Its hidden companion goes with it. `billable_asked` exists so that an
    // unticked box can be told from a first paint; with no box there is no
    // question, and a lone marker saying one was asked would be a lie the echo
    // then acts on.
    await expect(page.locator('input[name="billable_asked"]')).toHaveCount(0);
  });

  test("is not among the columns the session grid offers", async ({ page }) => {
    await page.goto("/sessions");
    await page.locator(".filteractions > summary").click();
    await page.getByRole("button", { name: "Edit filter" }).click();

    const columns = page.getByRole("group", { name: "Show these columns" });
    await expect(columns).toBeVisible();
    // Present, so this is a real reading of the list rather than a drawer that
    // failed to open.
    await expect(columns.getByLabel("Instructor")).toHaveCount(1);
    for (const label of ["Billable", "Payment", "Invoice"]) {
      await expect(columns.getByLabel(label), label).toHaveCount(0);
    }
  });

  test("books a session whose page and edit panel say nothing about money", async ({ page }) => {
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

    await previewAndBook(page);

    // The record the booking produced. The form no longer asks, so the page no
    // longer answers — and this also proves the booking still completes with
    // the field gone, which is the half a unit test cannot see.
    await expect(page.locator(".fact-label", { hasText: /^Billable$/ })).toHaveCount(0);
    await expect(page.locator(".fact-label", { hasText: /^Reference$/ })).toHaveCount(1);

    // And the editing screen, reached from this record rather than from the
    // first row of the grid: a session that has just been booked is one this
    // administrator can certainly edit, where the first row of a grid full of
    // cancelled and completed sessions offers no control at all — which is how
    // two earlier specs came to assert nothing while reporting a pass.
    await page.getByRole("link", { name: "Edit session" }).click();
    // The panels are `<details>`, and a closed one keeps its children in the
    // DOM — so a count taken here without opening it would pass whether the box
    // were there or not. Open it, prove it opened, then look.
    await page.getByText("Edit details", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Save changes" })).toBeVisible();
    await expect(page.locator('input[name="billable"]')).toHaveCount(0);
  });
});
