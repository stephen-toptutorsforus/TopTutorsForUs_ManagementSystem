"use client";

/**
 * An error inside the application, with the application still around it.
 *
 * The boundary sits under `(app)/layout.tsx`, so the sidebar has already
 * rendered and stays usable: whatever broke, it broke on one page, and the
 * other twenty are still a click away. Without this file the whole thing was
 * replaced by Next's bare "Application error" — no shell, no navigation, and
 * nothing to do but reload.
 *
 * A client component, because an error boundary has to be. That is the only
 * reason: nothing here needs the browser except the retry.
 */

import { ErrorCard, useRetry } from "@/components/ErrorCard";
import { Card } from "@/components/ui";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const { retry, pending } = useRetry(reset);
  return (
    <Card as="section" className="card-padded refusal">
      <ErrorCard digest={error.digest} onRetry={retry} pending={pending} />
    </Card>
  );
}
