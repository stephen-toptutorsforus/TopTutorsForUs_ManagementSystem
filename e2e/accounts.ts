/**
 * The seeded accounts these tests sign in as, and where their cookies land.
 *
 * Two tenants, because that is what makes an isolation bug visible: a suite
 * that only ever signs in as one organization's administrator cannot tell
 * tenant scoping from no scoping at all. And one account per *distinct*
 * permission shape within the tenant, because a role that shares nobody's
 * gates is a role no test can speak for.
 */

import path from "node:path";

export const ACCOUNTS = {
  /** Northgate administrator — sees everything in their own tenant. */
  admin: "rowan.mercer@example.test",
  /** Northgate student — the narrowest role that still has a dashboard. */
  student: "teo.vasquez@example.test",
  /**
   * Northgate parent, and nothing else.
   *
   * Deliberately not Sana Holm, who also holds `INSTRUCTOR`: a test signing in
   * as her could not tell guardian visibility from instructor visibility, which
   * is the confound this file exists to avoid. Deliberately not the scenario
   * fixture's parent either — global setup mints every account before any spec
   * runs, so an account that needs `db:scenarios` would fail the whole suite on
   * a merely-seeded database rather than skipping one test.
   *
   * The seed gives her two of the four students, one of whom is in a group with
   * a student she does not guard. That pairing is the point of her.
   */
  parent: "delphine.arceneaux@example.test",
  /**
   * Northgate instructor, and nothing else.
   *
   * The only role holding `availability.edit_own` without `edit_any`, which is
   * what the sidebar now separates "My Availability" from "Instructor
   * Availability" by — so without an account here that gate had nothing to
   * test it. Deliberately not Sana Holm, who also holds `PARENT`, for the same
   * reason she is not the parent above.
   */
  instructor: "imani.okafor@example.test",
  /** Harbour Point administrator — everything they ask of Northgate is 404. */
  otherTenant: "bo.fischer@example.test",
} as const;

export type Account = keyof typeof ACCOUNTS;

export const AUTH_DIR = path.join(__dirname, ".auth");

export function statePath(account: Account): string {
  return path.join(AUTH_DIR, `${account}.json`);
}

/**
 * Routes every signed-in viewer can open, whatever their role.
 *
 * Booking is not in this list. A student may request a session; a parent may
 * not. Both hold `session.book` in code, and `who_can_book` is what removes it
 * from the parent.
 */
export const SHARED_ROUTES = [
  "/",
  "/calendar",
  "/sessions",
  "/series",
  "/availability",
  "/help",
] as const;

/** The booking screen. Students and staff, not parents. */
export const BOOKING_ROUTE = "/sessions/new";

/** Routes an administrator can open and a student cannot. */
export const ADMIN_ONLY_ROUTES = [
  "/people",
  "/groups",
  "/locations",
  "/audit",
  "/import",
  "/reminders",
  "/inbox",
] as const;

export const STUDENT_ROUTES = [...SHARED_ROUTES, BOOKING_ROUTE] as const;

export const ALL_ADMIN_ROUTES = [...SHARED_ROUTES, BOOKING_ROUTE, ...ADMIN_ONLY_ROUTES];
