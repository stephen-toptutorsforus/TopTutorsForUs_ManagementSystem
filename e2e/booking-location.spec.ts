/**
 * Booking an in-person session into a managed room.
 *
 * The screen used to send only free text for "where". The schema, the conflict
 * check and a GiST exclusion constraint all key the room clash on a real
 * `locationId`, so a session booked here could be put into a room already in
 * use — a rule the database was ready to enforce and was never given the chance
 * to.
 *
 * Worth asking a browser rather than a unit test: the rule itself is already
 * held at both the service and the constraint level, and what was missing was
 * the wiring between the form and them. That is exactly what a unit test of
 * either end cannot see.
 */

import { expect, test, type Page } from "@playwright/test";

import { statePath } from "./accounts";
import { LANE, bookableDate } from "./slots";

test.use({ storageState: statePath("admin") });

/** Seeded for Northgate; the directory's location filter uses the same rows. */
const ROOM = "Study Room A";
/** One eligible instructor under the seed, which keeps the choice unambiguous. */
const STUDENT = "Teo Vasquez";

/** The booking form's own debounce, mirrored — see `booking.spec.ts`. */
async function settled(page: Page): Promise<void> {
  await page.waitForTimeout(260);
  await page.waitForLoadState("networkidle");
  await expect(page.locator(".availability")).not.toHaveAttribute("aria-busy", "true");
}

test.describe("where an in-person session is", () => {
  test("offers the tenant's own rooms", async ({ page }) => {
    await page.goto("/sessions/new");

    const select = page.locator("#location_ref");
    await expect(select).toBeAttached();
    // The tenant's rooms, and a way to say none of them. Scoped like every
    // other picker on this form, so another tenant's rooms cannot appear here.
    const options = await select.locator("option").allTextContents();
    expect(options).toContain(ROOM);
    expect(options[0]).toBe("No specific room");
  });

  test("writes the room, not just the words", async ({ page }) => {
    await page.goto("/sessions/new");

    // Well into the future, not tomorrow: this test books, the suite shares one database with
    // every earlier run, and an instructor or a room already taken at that hour
    // is a conflict no override clears. See `slots.ts`.
    const when = bookableDate(
      await page.locator("#start_date").getAttribute("min"),
      test.info().project.name,
      LANE.location,
    );

    // A session needs somebody on it. Adding the student first also narrows the
    // instructor list to whoever may teach them, which is the order the screen
    // asks its questions in.
    await page.locator("#student_picker").selectOption({ label: STUDENT });
    await settled(page);

    await page.locator("#title").fill("Room booking check");
    await page.locator("#delivery_type").selectOption("in_person");
    await page.locator("#location_ref").selectOption({ label: ROOM });
    await page.locator("#location_detail").fill("Second floor, past the library");
    await page.locator("#start_date").fill(when);
    await settled(page);

    // Whoever is left after the roster narrowed the list. This test is about
    // where, not who.
    const instructor = page.locator("#instructor_ref option").nth(1);
    await page.locator("#instructor_ref").selectOption(await instructor.getAttribute("value") ?? "");
    await settled(page);

    // Preview first: the confirm button only exists once there is a plan, which
    // is the guarantee that what is written is what was shown.
    await page.getByRole("button", { name: /^Preview session/ }).click();
    const book = page.getByRole("button", { name: /^Book Session/ });
    await expect(book).toBeEnabled();
    await book.click();
    await expect(page).toHaveURL(/\/sessions\/ses/);

    // The room by name, which can only come from a `locationId` the form
    // actually sent — the free text is shown in its own field beside it.
    const main = page.locator("main");
    await expect(main).toContainText(ROOM);
    await expect(main).toContainText("Second floor, past the library");
  });
});
