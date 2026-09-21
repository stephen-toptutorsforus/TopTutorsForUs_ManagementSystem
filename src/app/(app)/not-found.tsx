/**
 * 404, inside the shell.
 *
 * The root `not-found.tsx` answers for a signed-out visitor and for anything
 * outside this route group, and its bare centred card is right there — there is
 * no navigation to keep, because there is no session.
 *
 * Inside the application there is. A stale link to a cancelled session, a ref
 * somebody retyped a character of, a bookmark from before a record was
 * archived: all of them land here, and all of them are one click from the
 * calendar if the sidebar is still on the page. `not-found` is a per-segment
 * file type, so this renders inside `(app)/layout.tsx` and it is.
 *
 * The words are the root page's, deliberately. This is also what a record in
 * another tenant looks like — a 403 would confirm it exists — so "no such
 * thing" and "not yours" have to be the same answer, and saying it two
 * different ways would be the tell.
 */

import { Card, LinkButton } from "@/components/ui";

export const metadata = { title: "Not found · TopTutorsForUs" };

export default function NotFound() {
  return (
    <div className="refusal-page">
      <Card as="section" className="card-padded refusal">
        <span className="refusal-glyph" aria-hidden="true">
          ?
        </span>
        <h1>Not found</h1>
        <p>There is nothing here, or nothing here that belongs to your organization.</p>
        <p>
          <LinkButton variant="primary" href="/">
            Back to the dashboard
          </LinkButton>
        </p>
      </Card>
    </div>
  );
}
