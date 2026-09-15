/**
 * 403, inside the shell.
 *
 * `guard()` in `lib/web/interrupt.ts` calls `forbidden()` when a signed-in
 * person asks for a page their permissions do not cover. Without this file that
 * reached the browser as Next's own built-in page: the right status, and a bare
 * document with no navigation on it — which reads as a broken application
 * rather than a closed door.
 *
 * It lives under `(app)` rather than at the root because `forbidden` is a
 * per-segment file type, so this renders inside `(app)/layout.tsx` and keeps
 * the sidebar. That matters more here than on any other refusal: the way out is
 * the navigation, and it is already the list of pages this person *may* open.
 *
 * **It does not name the page**, and not for secrecy: a route is not a secret,
 * and the browser's tab still shows the refused page's own title, because
 * metadata is resolved from the matched route rather than from this file. It is
 * that naming it would buy nothing — the address is on screen — at the price of
 * a route-to-words map somebody has to keep in step with the routes. That map
 * existed once, for the Back button, and got a screen wrong the moment a route
 * was added. The refusal is the same shape wherever it happens, for the same
 * reason the button just says "Back".
 *
 * The distinction the error vocabulary draws is untouched: this is "you may
 * not", about a page that exists for somebody, and anything belonging to
 * another tenant is a 404 instead — because *that* would be a disclosure.
 */

import { Card, LinkButton } from "@/components/ui";

export default function Forbidden() {
  return (
    <Card as="section" className="card-padded refusal">
      <h1>No access</h1>
      <p>
        Your account does not have permission for this page. If you think it
        should, ask an administrator at your organization to change your role.
      </p>
      <p>
        <LinkButton variant="primary" href="/">
          Back to the dashboard
        </LinkButton>
      </p>
    </Card>
  );
}
