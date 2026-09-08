"use client";

/**
 * The sign-in form itself.
 *
 * A client component only so the failure can be shown without a full round trip
 * through a query parameter — the error must not end up in the URL, where it
 * would be shared, logged by a proxy, and kept in history alongside the address
 * it names.
 */

import Image from "next/image";
import { useActionState } from "react";

import { signIn } from "@/app/actions/auth";
import { Button, Card } from "@/components/ui";
import type { SignInState } from "@/lib/web/formState";
import { CSRF_FIELD } from "@/lib/names";

export function SignInForm({ csrfToken }: { csrfToken: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <div className="auth-shell">
      <Card className="auth-card">
        <p className="brand">
          <Image
            className="brand-logo"
            src="/img/logo.png"
            alt="TopTutorsForUs"
            width={1688}
            height={381}
            priority
          />
        </p>
        <h1>Sign in</h1>

        {state.error && (
          <p className="notice notice-bad" role="alert">
            <span aria-hidden="true">!</span> {state.error}
          </p>
        )}

        <form action={formAction} noValidate>
          <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
          <div className="field">
            <label htmlFor="email">Email address</label>
            <input
              id="email"
              name="email"
              type="email"
              autoComplete="username"
              required
              defaultValue={state.email ?? ""}
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "signin-error" : undefined}
            />
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "signin-error" : undefined}
            />
          </div>
          {state.error && (
            <p id="signin-error" className="visually-hidden">
              {state.error}
            </p>
          )}
          <Button variant="primary" className="btn-block" type="submit" disabled={pending}>
            {pending ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
    </div>
  );
}
