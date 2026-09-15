"use client";

/**
 * An error outside the application shell — the sign-in form, chiefly.
 *
 * The same words in the same card the sign-in page and the root 404 use, which
 * is the right frame here: there is no session, so there is no navigation to
 * keep, and a centred card is the whole page.
 *
 * It does not catch anything under `(app)`; that group has its own boundary,
 * closer to the failure and inside the shell. This one exists so that a break
 * on the way *in* is still a page somebody can act on.
 */

import { ErrorCard, useRetry } from "@/components/ErrorCard";
import { Card } from "@/components/ui";

export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { retry, pending } = useRetry(reset);
  return (
    <div className="auth-shell">
      <Card className="auth-card refusal">
        <ErrorCard digest={error.digest} onRetry={retry} pending={pending} />
      </Card>
    </div>
  );
}
