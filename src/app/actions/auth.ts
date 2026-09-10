"use server";

/**
 * Sign in and sign out.
 *
 * Ported from `app/web/auth.py`. The failure message is identical whether the
 * address is unknown, the password is wrong, or the account is disabled — and
 * `verifyPassword` runs a dummy hash for a missing account so the three take
 * comparable time. Distinguishing them, by wording or by timing, turns the form
 * into an account-enumeration oracle.
 */

import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { FILTER_COOKIES } from "@/lib/web/filterState";
import { prisma } from "@/lib/db";
import { UserStatus } from "@/generated/prisma/enums";
import {
  SESSION_COOKIE,
  hashPassword,
  isSecureEnvironment,
  issueSession,
  loginLimiter,
  verifyPassword,
} from "@/lib/security";
import { SIGN_IN_FAILED, type SignInState } from "@/lib/web/formState";
import { clientKey, verifyCsrf } from "@/lib/web/session";

export async function signIn(
  _previous: SignInState,
  form: FormData,
): Promise<SignInState> {
  await verifyCsrf(form);

  const email = String(form.get("email") ?? "");
  const password = String(form.get("password") ?? "");

  const key = await clientKey();
  if (!loginLimiter.check(key)) {
    return { error: "Too many sign-in attempts — wait a few minutes and try again.", email };
  }

  // Email is unique per organization, so an address may exist in more than one
  // tenant. Each candidate is checked; the first whose password matches wins.
  const candidates = await prisma.user.findMany({
    where: {
      email: { equals: email.trim().toLowerCase(), mode: "insensitive" },
      archivedAt: null,
      status: UserStatus.ACTIVE,
    },
  });

  let matched: (typeof candidates)[number] | null = null;
  for (const candidate of candidates) {
    const { valid, needsRehash } = await verifyPassword(candidate.passwordHash, password);
    if (!valid) continue;
    matched = candidate;
    if (needsRehash) {
      await prisma.user.update({
        where: { id: candidate.id },
        data: { passwordHash: await hashPassword(password) },
      });
    }
    break;
  }

  if (matched === null) {
    if (candidates.length === 0) {
      // Keep the timing of an unknown address comparable to a known one.
      await verifyPassword(null, password);
    }
    // Deliberately no address in the log line.
    console.info("sign-in rejected");
    return { error: SIGN_IN_FAILED, email };
  }

  await prisma.user.update({
    where: { id: matched.id },
    data: { lastLoginAt: new Date() },
  });

  const token = issueSession(matched.id);
  loginLimiter.reset(key);
  console.info(`sign-in accepted org=${matched.organizationId}`);

  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: isSecureEnvironment(),
    // A session cookie; the signature carries the real expiry.
    path: "/",
  });

  redirect("/");
}

export async function signOut(form: FormData): Promise<void> {
  await verifyCsrf(form);

  const jar = await cookies();
  jar.delete(SESSION_COOKIE);
  // The remembered calendar filter is a working preference, not a credential,
  // but it belongs to whoever was signed in. On a shared machine the next
  // person would otherwise open the calendar and find it filtered by someone
  // else's choice, with nothing on screen to explain why.
  // Somebody else signing in on this machine should not inherit a filter.
  for (const name of FILTER_COOKIES) jar.delete(name);

  redirect("/sign-in");
}
