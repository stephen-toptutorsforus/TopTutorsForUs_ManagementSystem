/**
 * 403.
 *
 * The refusal names the action, never the record — a message that said which
 * session or which person was being refused would confirm it exists, which is
 * the disclosure the policy layer exists to prevent.
 */

import { Card, LinkButton } from "@/components/ui";
export default function Forbidden() {
  return (
    <div className="auth-shell">
      <Card className="auth-card">
        <h1>Not permitted</h1>
        <p>
          Your roles do not allow this. If that is wrong, an administrator at your
          organization can grant it — the Help Center lists what you currently hold.
        </p>
        <p>
          <LinkButton variant="primary" href="/">
            Back to the dashboard
          </LinkButton>{" "}
          <LinkButton href="/help">
            What am I allowed to do?
          </LinkButton>
        </p>
      </Card>
    </div>
  );
}
