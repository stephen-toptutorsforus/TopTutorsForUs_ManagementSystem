"use client";

/**
 * The last resort: the root layout itself failed.
 *
 * Every other boundary renders *inside* a layout. This one replaces the root
 * one, which is why it carries its own `<html>` and `<body>` — and why it
 * imports the stylesheet, because the import in the root layout is precisely
 * what did not run. Without both, this page is unstyled text on white.
 *
 * `lang` is repeated here for the same reason: the attribute lives on the root
 * layout's `<html>`, and that element does not exist by the time this renders.
 *
 * In practice this is nearly unreachable — the root layout does no data work,
 * so there is little in it to fail. It exists because "nearly" is not "never",
 * and the alternative at that point is Next's built-in page.
 */

import { ErrorCard } from "@/components/ErrorCard";

import "./toptutorsforus.css";

export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  /** Next passes one; this page does not use it — see the note by the card. */
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body>
        <div className="auth-shell">
          {/* The card's own classes rather than the `Card` component: this
              renders when the application has failed to assemble itself, and
              the fewer of its own modules the page depends on, the more likely
              it is to appear at all. */}
          <div className="card auth-card refusal">
            {/* A reload rather than the router refresh the other two use:
                this renders because the root layout failed, and asking the
                router to refresh a tree that never assembled is not a
                recovery. Reloading is. */}
            <ErrorCard digest={error.digest} onRetry={() => window.location.reload()} />
          </div>
        </div>
      </body>
    </html>
  );
}
