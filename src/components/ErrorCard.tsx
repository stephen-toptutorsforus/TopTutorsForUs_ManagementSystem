"use client";

/**
 * What an error boundary shows, in one place.
 *
 * Three files render it — `(app)/error.tsx` inside the shell, `error.tsx` for
 * the signed-out pages, and `global-error.tsx` when even the root layout failed
 * — and they differ only in what they wrap it in and in what "try again" means
 * for them. The words are the same in all three on purpose: three copies of an
 * apology drift, and the one somebody sees is whichever was updated last.
 *
 * **It shows the digest and nothing else from the error.** That is deliberate
 * twice over. Next replaces a server error's message with a generic string in
 * production and hands over `digest`, a hash that ties the page to the line in
 * the server log — so the message is not available there anyway. And a *client*
 * error's message is real text, which on this product can quote a record: the
 * standing rule is that no student's information reaches a screen, a log or a
 * screenshot, and an error page is a screen like any other.
 *
 * The component itself takes no hooks. `useRetry` beside it does, and the
 * boundaries call it — which keeps this renderable, and therefore testable,
 * without an app router mounted.
 *
 * There is no reporting call here. Sending errors to a service is later-phase
 * work, and a seam that looks implemented is worse than an empty one.
 */

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { Button, LinkButton } from "@/components/ui";

/**
 * Retrying, in the way that actually retries.
 *
 * `reset()` on its own re-renders the boundary's children — enough for a
 * component that failed in the browser, and **nothing** for the case that
 * matters here. Every page in this application is a server component, and its
 * failed result is already in the router cache: re-rendering replays it and the
 * same error comes straight back. That is measured, not assumed. The button did
 * exactly that until `router.refresh()` was put in front of it, on a route
 * rigged to fail once — it stayed on the error page instead of showing the page
 * that would then have succeeded.
 *
 * So: `refresh()` to ask the server again, `reset()` to clear the boundary,
 * both inside one transition so the error is not cleared before its replacement
 * has arrived. `pending` disables the button meanwhile, because a second press
 * during the round trip starts a second round trip.
 */
export function useRetry(reset: () => void): { retry: () => void; pending: boolean } {
  const router = useRouter();
  const [pending, start] = useTransition();
  return {
    retry: () =>
      start(() => {
        router.refresh();
        reset();
      }),
    pending,
  };
}

export function ErrorCard({
  digest,
  onRetry,
  pending = false,
}: {
  /** Next's own hash for this error. Absent for some client-side failures. */
  digest?: string;
  /** What "try again" does. `useRetry` for a page, a reload for `global-error`. */
  onRetry: () => void;
  /** A retry already in flight. Disables the button rather than queueing another. */
  pending?: boolean;
}) {
  return (
    <>
      <h1>Something went wrong</h1>
      <p>
        This page could not be loaded. Trying again often works — the problem is
        usually a moment rather than a state.
      </p>
      <p className="error-actions">
        {/* First, and a real button: the failure may be nothing more than a
            dropped connection, and the cheapest fix should be the nearest one.
            Leaving is the fallback, not the offer. */}
        <Button variant="primary" type="button" onClick={onRetry} disabled={pending}>
          {pending ? "Trying…" : "Try again"}
        </Button>
        <LinkButton href="/">Back to the dashboard</LinkButton>
      </p>
      {digest && (
        <p className="digest">
          {/* Not an apology to read, an identifier to quote. Marked up as code
              because that is what it is, and because it is the one part of this
              page worth selecting. */}
          Reference: <code>{digest}</code>
        </p>
      )}
    </>
  );
}
