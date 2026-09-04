/**
 * 404.
 *
 * Also what a record in another tenant looks like. That is deliberate: a 403
 * would confirm the record exists, so "no such thing" and "not yours" are the
 * same answer by design.
 */

import Link from "next/link";

export default function NotFound() {
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <h1>Not found</h1>
        <p>There is nothing here, or nothing here that belongs to your organization.</p>
        <p>
          <Link className="btn btn-primary" href="/">
            Back to the dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
