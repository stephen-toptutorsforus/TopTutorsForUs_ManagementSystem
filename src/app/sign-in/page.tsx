/**
 * Sign in.
 *
 * The failure message is deliberately identical for an unknown address and a
 * wrong password: distinguishing them tells an attacker which addresses hold
 * accounts.
 *
 * An already-signed-in visitor is sent to the dashboard — but the cookie has to
 * be *read*, not merely counted. Testing for its presence sent anyone holding an
 * expired or tampered token to "/", which could not authenticate it and sent
 * them back here: a loop with no way out, and the reason a stale session looked
 * like "I cannot sign in" rather than like "please sign in again".
 */

import { redirect } from "next/navigation";

import { readSession } from "@/lib/security";
import { csrfToken, sessionToken } from "@/lib/web/session";

import { SignInForm } from "./SignInForm";

export const metadata = { title: "Sign in · TopTutorsForUs" };

export default async function SignInPage() {
  const token = await sessionToken();
  if (token && readSession(token) !== null) redirect("/");

  return <SignInForm csrfToken={await csrfToken()} />;
}
