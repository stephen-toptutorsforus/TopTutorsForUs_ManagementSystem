/**
 * What this person can do, and who to ask when it is not enough.
 *
 * Ported from `help_center` in `app/web/views.py` and
 * `app/templates/help.html`.
 *
 * The support details come from the tenant's own record rather than being
 * hard-coded, so an organization that has not set them sees an honest blank
 * instead of somebody else's contact address.
 */

import { Card, CardGrid, EmptyState, PageHeader } from "@/components/ui";
import { requireContext } from "@/lib/web/session";

export const metadata = { title: "Help Center · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function HelpPage() {
  const { principal, organization } = await requireContext();

  const permissions = [...principal.permissions].sort();
  const roles = [...principal.roles]
    .map((role) =>
      role
        .toLowerCase()
        .replace(/_/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase()),
    )
    .sort();

  return (
    <>
      <PageHeader title="Help Center"  />

      <CardGrid>
        <Card>
          <h2>Your access</h2>
          <dl className="definition">
            <dt>Organization</dt>
            <dd>{organization.name}</dd>
            <dt>Your roles</dt>
            <dd>{roles.join(", ")}</dd>
            <dt>Times shown in</dt>
            <dd>{principal.timezone}</dd>
          </dl>
          <p className="hint">
            Menu items you cannot see are ones your roles do not grant. Every action is
            re-checked on the server, so a hidden control is a courtesy rather than the
            access control itself.
          </p>
          <details>
            <summary>What you are permitted to do ({permissions.length})</summary>
            <ul>
              {permissions.map((permission) => (
                <li key={permission}>
                  <code>{permission}</code>
                </li>
              ))}
            </ul>
          </details>
        </Card>

        <Card>
          <h2>Getting help</h2>
          {organization.supportEmail || organization.supportPhone ? (
            <dl className="definition">
              {organization.supportEmail && (
                <>
                  <dt>Email</dt>
                  <dd>
                    <a href={`mailto:${organization.supportEmail}`}>
                      {organization.supportEmail}
                    </a>
                  </dd>
                </>
              )}
              {organization.supportPhone && (
                <>
                  <dt>Phone</dt>
                  <dd>{organization.supportPhone}</dd>
                </>
              )}
            </dl>
          ) : (
            <EmptyState
              heading="No support contact set"
              message="An administrator can add one to this organization's record."
              glyph="?"
            />
          )}
        </Card>
      </CardGrid>

      <Card>
        <h2>Things worth knowing</h2>
        <dl className="definition">
          <dt>Times and zones</dt>
          <dd>
            Every time on screen carries its zone. A repeating session keeps its
            wall-clock time across daylight-saving changes, so a 4pm class stays at 4pm
            even in the week the clocks move.
          </dd>
          <dt>Editing a repeating session</dt>
          <dd>
            You always choose the scope. Editing only one session detaches it, and later
            changes to the whole series will skip it. Sessions that have already run, been
            cancelled, or been rejected are never rewritten by a series edit.
          </dd>
          <dt>Conflicts</dt>
          <dd>
            A clash with an instructor&rsquo;s other booking, or with a room, cannot be
            booked over by anyone. Anything else is a warning an administrator may
            override, and the override is recorded.
          </dd>
          <dt>Attendance</dt>
          <dd>
            Marking everyone present only fills places nobody has judged yet. An excused
            absence does not count against an attendance rate.
          </dd>
          <dt>Session status</dt>
          <dd>
            A session keeps the status somebody last gave it, so one whose time has
            passed with nothing recorded still says it was going to happen. The
            calendar draws those as <strong>Incomplete</strong> — a muted{" "}
            <span aria-hidden="true">&ndash;</span> — meaning the time has passed and
            nobody said what happened. It is not a status you can set or filter on:
            editing the session offers <strong>Mark completed</strong> and{" "}
            <strong>Mark missed</strong>, and once one of those is recorded it becomes
            a status like any other.
          </dd>
          <dt>Account status</dt>
          <dd>
            <strong>Active</strong> — setup is complete and the person can sign in.
            <strong> Invited</strong> — the invitation went out and registration is
            unfinished. <strong>Pending invite</strong> — the account exists and the
            invitation is waiting to be sent. <strong>Bounced</strong> — the invitation
            could not be delivered, so the address needs correcting.
            <strong> Disabled</strong> — access was turned off and the person cannot
            sign in. A new account starts <em>invited</em> and has no password until its
            owner sets one.
          </dd>
          <dt>Keyboard</dt>
          <dd>
            Every control is reachable by <kbd>Tab</kbd>. <kbd>Esc</kbd> closes the status
            filter. The first <kbd>Tab</kbd> on any page offers a link that skips the
            navigation.
          </dd>
        </dl>
      </Card>
    </>
  );
}
