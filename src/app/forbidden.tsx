/**
 * 403.
 *
 * The refusal names the action, never the record — a message that said which
 * session or which person was being refused would confirm it exists, which is
 * the disclosure the policy layer exists to prevent.
 */

import Link from "next/link";

export default function Forbidden() {
  return (
    <div className="auth-shell">
      <div className="card auth-card">
        <h1>Not permitted</h1>
        <p>
          Your roles do not allow this. If that is wrong, an administrator at your
          organization can grant it — the Help Center lists what you currently hold.
        </p>
        <p>
          <Link className="btn btn-primary" href="/">
            Back to the dashboard
          </Link>{" "}
          <Link className="btn" href="/help">
            What am I allowed to do?
          </Link>
        </p>
      </div>
    </div>
  );
}
