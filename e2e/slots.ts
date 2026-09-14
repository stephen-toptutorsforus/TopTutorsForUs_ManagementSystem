/**
 * A future slot no other test run is using, on a day somebody works.
 *
 * Any spec that actually *books* needs one, for two reasons.
 *
 * The suite runs its projects in parallel against one shared database, and that
 * database keeps what earlier runs wrote. Two projects booking the same
 * instructor at the same time clash on `instructor_busy`; two booking the same
 * room clash on `location_busy`. Both are conflicts no override clears, which
 * is correct behaviour and is what makes a fixed date a test that passes once.
 *
 * And a date outside declared hours is refused too — `outside_availability` is
 * overridable, but the confirm button still waits for somebody to override it,
 * so an arbitrary future date lands on a Saturday roughly two times in seven.
 *
 * So: whole weeks from a Monday, which keeps the weekday fixed while the date
 * moves. Deterministic within a run, different between runs, and inside
 * `booking.max_future_days` — 180 by default, which is why the spread stops at
 * twenty weeks.
 *
 * Within the week, Monday to Thursday are handed out: a `lane` per spec, and a
 * day within it per project. Two specs that both book need different days for
 * the same reason two projects do — the second one to run would otherwise find
 * the instructor busy, which is the first one's booking working correctly.
 */

/** Which weekday a spec books on. One per spec that writes. */
export const LANE = { billable: 0, location: 1 } as const;

/** How far ahead this run books, in days, for this project and lane. */
export function dayOffset(projectName: string, lane: number): number {
  const weeks = Math.floor(Date.now() / 60_000) % 20;
  return weeks * 7 + lane * 2 + (projectName === "desktop" ? 0 : 1);
}

/**
 * A bookable weekday, that far after the first Monday on or after `earliest`.
 *
 * Anchoring on a Monday is what keeps every run on a weekday: the seed declares
 * availability Monday to Friday, and the lanes fill Monday through Thursday.
 */
export function bookableDate(
  earliest: string | null,
  projectName: string,
  lane: number,
): string {
  const day = new Date(`${earliest ?? new Date().toISOString().slice(0, 10)}T00:00:00Z`);
  // 0 is Sunday; advance to the next Monday, or stay if already on one.
  const toMonday = (8 - day.getUTCDay()) % 7;
  day.setUTCDate(day.getUTCDate() + toMonday + dayOffset(projectName, lane));
  return day.toISOString().slice(0, 10);
}
