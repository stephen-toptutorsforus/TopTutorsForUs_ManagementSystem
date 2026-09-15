/**
 * A slot to book into that no earlier run has taken.
 *
 * Any spec that actually *books* needs one. The suite runs its projects in
 * parallel against one shared database, and that database keeps every session
 * every earlier run wrote. Two bookings of the same instructor at the same time
 * clash on `instructor_busy`, and two of the same room on `location_busy` —
 * conflicts no override clears. Both are the product working correctly, and
 * both make a fixed date a test that passes once.
 *
 * A date computed from the clock is not enough on its own: any such scheme
 * repeats, and then a run far enough after another collides with it. So the
 * date only separates the *lanes* — one per spec, one per project, all inside
 * the seed's Monday-to-Friday declared hours — and the time is taken from the
 * availability grid, which since it learned about existing bookings offers only
 * cells that are actually free. That is self-avoiding by construction: the slot
 * one run takes is not offered to the next.
 */

import { expect, type Page } from "@playwright/test";

/** Which weekday a spec books on. One per spec that writes. */
export const LANE = { billable: 0, location: 1 } as const;

/**
 * A weekday in the tenant's booking window, for this project and lane.
 *
 * Anchored on a Monday so every run lands on a day the seed declares hours for,
 * with the four lanes filling Monday through Thursday. The week moves so that
 * runs spread out; it is the grid, not this, that guarantees a free time.
 */
export function bookableDate(
  earliest: string | null,
  projectName: string,
  lane: number,
): string {
  const day = new Date(`${earliest ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  const weeks = Math.floor(Date.now() / 60_000) % 20;
  // 0 is Sunday; advance to the next Monday, or stay if already on one.
  const toMonday = (8 - day.getUTCDay()) % 7;
  const lanes = lane * 2 + (projectName === "desktop" ? 0 : 1);
  day.setUTCDate(day.getUTCDate() + toMonday + weeks * 7 + lanes);
  return day.toISOString().slice(0, 10);
}

/**
 * Take a start time from the availability grid, and say which.
 *
 * Only free cells are buttons, and since the grid learned about existing
 * bookings a cell already taken is not one. So this cannot pick a time that
 * will then be refused — and two runs on the same date pick different times,
 * because the first one's booking removes its cell from the second one's grid.
 */
export async function pickFreeTime(page: Page): Promise<string> {
  const cell = page.locator('button[name="pick_time"]').first();
  await expect(cell).toBeVisible();
  const time = (await cell.getAttribute("value")) ?? "";
  await cell.click();
  return time;
}

/**
 * Preview, then confirm.
 *
 * The button says "Preview sessions" until there is a plan and "Update preview"
 * after — and picking a time from the grid makes one on its own, so a spec
 * cannot assume which it will find. Both are the same control, and confirming
 * only exists once a plan does, which is what makes what is written the thing
 * that was shown.
 */
export async function previewAndBook(page: Page): Promise<void> {
  await page.getByRole("button", { name: /^(Preview session|Update preview)/ }).click();
  const book = page.getByRole("button", { name: /^Book Session/ });
  await expect(book).toBeEnabled();
  await book.click();
  await expect(page).toHaveURL(/\/sessions\/ses/);
}
