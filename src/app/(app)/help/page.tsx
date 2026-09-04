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

import { EmptyState } from "@/components/ui";
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
      <div className="page-head">
        <div>
          <h1>Help Center</h1>
          <p className="subtitle">How this workspace behaves, and who to ask.</p>
        </div>
      </div>

      <div className="card-grid">
        <div className="card">
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
        </div>

        <div className="card">
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
        </div>
      </div>

      <div className="card">
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
          <dt>Keyboard</dt>
          <dd>
            Every control is reachable by <kbd>Tab</kbd>. <kbd>Esc</kbd> closes the status
            filter. The first <kbd>Tab</kbd> on any page offers a link that skips the
            navigation.
          </dd>
        </dl>
      </div>
    </>
  );
}
