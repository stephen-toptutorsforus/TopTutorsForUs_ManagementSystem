/**
 * The seeded accounts these tests sign in as, and where their cookies land.
 *
 * Three, because two tenants are what make an isolation bug visible: a suite
 * that only ever signs in as one organization's administrator cannot tell
 * tenant scoping from no scoping at all.
 */

import path from "node:path";

export const ACCOUNTS = {
  /** Northgate administrator — sees everything in their own tenant. */
  admin: "rowan.mercer@example.test",
  /** Northgate student — the narrowest role that still has a dashboard. */
  student: "teo.vasquez@example.test",
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
 * `/sessions/new` is deliberately absent: a student holds `session.book` in
 * code, but the seeded organization's `who_can_book` setting removes it, and
 * the floor rule means configuration can only take permissions away. That the
 * page answers 403 for them is the rule working, not a missing permission.
 */
export const SHARED_ROUTES = [
  "/",
  "/calendar",
  "/sessions",
  "/series",
  "/availability",
  "/help",
] as const;

/** Routes an administrator can open and a student cannot. */
export const ADMIN_ONLY_ROUTES = [
  "/sessions/new",
  "/people",
  "/groups",
  "/locations",
  "/audit",
] as const;

export const ALL_ADMIN_ROUTES = [...SHARED_ROUTES, ...ADMIN_ONLY_ROUTES];
