"use client";

/**
 * The sign-in form itself.
 *
 * A client component only so the failure can be shown without a full round trip
 * through a query parameter — the error must not end up in the URL, where it
 * would be shared, logged by a proxy, and kept in history alongside the address
 * it names.
 */

import { useActionState } from "react";

import { signIn } from "@/app/actions/auth";
import { Button, Card, Field } from "@/components/ui";
import type { SignInState } from "@/lib/web/formState";
import { CSRF_FIELD } from "@/lib/names";

export function SignInForm({ csrfToken }: { csrfToken: string }) {
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, {});

  return (
    <div className="auth-shell">
      <Card className="auth-card">
        <p className="brand">
                    {/* A plain `img`, not `next/image`.
              `next/image` writes `style="color:transparent"` onto the tag to
              hide alt text while the file loads, and a style *attribute* is
              exactly what `style-src 'self'` forbids — so every page logged a
              violation for it. A policy that cries wolf on every load is one
              whose reports stop being read, and widening the policy to admit a
              framework's convenience would be paying for that convenience with
              the guarantee.
              Nothing is lost here: a fixed-size local wordmark gains no
              responsive `srcset` worth a second request, and `priority` had
              already turned the lazy loading off. It also takes this off the
              `/_next/image` path, and with it `sharp`. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="brand-logo"
            src="/img/logo.png"
            alt="TopTutorsForUs"
            width={1688}
            height={381}
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
          <Field id="email" label="Email address">
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
                    </Field>
          <Field id="password" label="Password">
            <input
              id="password"
              name="password"
              type="password"
              autoComplete="current-password"
              required
              aria-invalid={state.error ? true : undefined}
              aria-describedby={state.error ? "signin-error" : undefined}
            />
                    </Field>
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
