/**
 * Request-scoped plumbing: the principal, the tenant, and CSRF.
 *
 * Ported from `app/web/deps.py`.
 *
 * `currentPrincipal` is the single door every authenticated route goes
 * through. It reads the signed cookie, resolves the actor from the database,
 * and throws `Unauthenticated` if anything about them has changed since the
 * cookie was issued — so a demotion, a disabled account, or an archived tenant
 * takes effect on the next request rather than in twelve hours.
 */

import { cookies, headers } from "next/headers";

import { STATUS_COOKIE } from "@/lib/calendar";
import type { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/db";
import { Forbidden, Unauthenticated } from "@/lib/errors";
import { type Principal, loadPrincipal } from "@/lib/policies/principal";
import { CSRF_FIELD, SESSION_COOKIE, checkCsrf, issueCsrf, readSession } from "@/lib/security";
import type { RequestMeta } from "@/lib/services/people";

export type OrganizationRecord = Prisma.OrganizationGetPayload<object>;

/** The signed session cookie's raw value, or "" when there is none. */
export async function sessionToken(): Promise<string> {
  return (await cookies()).get(SESSION_COOKIE)?.value ?? "";
}

/**
 * The actor, or `null` when nobody is signed in.
 *
 * Used by the layout, which has to render for a signed-out visitor as well.
 * Route handlers call `requirePrincipal` instead.
 */
export async function currentPrincipal(): Promise<Principal | null> {
  const userId = readSession(await sessionToken());
  if (userId === null) return null;
  try {
    return await loadPrincipal(prisma, userId);
  } catch {
    // A cookie whose signature still verifies but whose subject has been
    // archived, disabled, or stripped of roles reads as signed out. Throwing
    // here would make the shell itself un-renderable, and the visitor would see
    // an error page instead of a sign-in form.
    return null;
  }
}

export async function requirePrincipal(): Promise<Principal> {
  const userId = readSession(await sessionToken());
  if (userId === null) throw new Unauthenticated("please sign in");
  return loadPrincipal(prisma, userId);
}

export async function currentOrganization(
  principal: Principal,
): Promise<OrganizationRecord> {
  const organization = await prisma.organization.findUnique({
    where: { id: principal.organizationId },
  });
  // loadPrincipal already checked; this is the belt to its braces.
  if (organization === null) throw new Unauthenticated("this session is no longer valid");
  return organization;
}

/** The principal and their tenant together, which most routes want. */
export async function requireContext(): Promise<{
  principal: Principal;
  organization: OrganizationRecord;
}> {
  const principal = await requirePrincipal();
  return { principal, organization: await currentOrganization(principal) };
}

/** A CSRF token bound to the current session, for a form to carry. */
export async function csrfToken(): Promise<string> {
  return issueCsrf(await sessionToken());
}

/**
 * Reject a state-changing request without a valid, session-bound token.
 *
 * Applied to every form submission. `SameSite=Lax` on the cookie is the first
 * defence; this is the one that still works if a browser or a future
 * cross-origin flow relaxes that.
 */
export async function verifyCsrf(form: FormData): Promise<void> {
  const submitted = form.get(CSRF_FIELD);
  if (!checkCsrf(await sessionToken(), typeof submitted === "string" ? submitted : null)) {
    throw new Forbidden("this form has expired — reload the page and try again");
  }
}

/**
 * Non-identifying request context for the audit trail.
 *
 * The user agent is truncated and no other header is captured; nothing here
 * carries a token, a cookie, or a URL a session could be reached through.
 */
export async function requestMeta(): Promise<RequestMeta> {
  const incoming = await headers();
  // Behind a proxy the socket address is the proxy's, so the forwarded chain's
  // first entry is used when there is one. It is client-controlled and only
  // ever reaches the audit trail and the rate limiter, never a decision about
  // who somebody is.
  const forwarded = incoming.get("x-forwarded-for")?.split(",")[0]?.trim();
  return {
    ipAddress: forwarded || incoming.get("x-real-ip") || "",
    userAgent: (incoming.get("user-agent") ?? "").slice(0, 240),
  };
}

/** The key a rate limiter counts against. */
export async function clientKey(): Promise<string> {
  const meta = await requestMeta();
  return `ip:${meta.ipAddress || "unknown"}`;
}

/** The remembered calendar status filter, if the visitor has one. */
export async function statusCookie(): Promise<string | null> {
  return (await cookies()).get(STATUS_COOKIE)?.value ?? null;
}

export { CSRF_FIELD, SESSION_COOKIE };
