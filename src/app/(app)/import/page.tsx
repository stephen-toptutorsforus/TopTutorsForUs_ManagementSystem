/**
 * Loading another system's records into this tenant.
 *
 * Administrators only, and the gate is the same shape every other restricted
 * screen uses: the page refuses, and the service refuses again on its own
 * behalf. A control hidden in the UI is a courtesy; neither half here is the
 * whole answer.
 *
 * There is nothing to list, so there is no toolbar and no filter — this screen
 * is an act rather than a view. What it has instead is the sentence about what
 * an import does and does not do, said before anybody chooses a file rather
 * than after they have pressed the button.
 */

import { ImportForm } from "@/components/imports/ImportForm";
import { Card, PageHeader } from "@/components/ui";
import { Permission } from "@/lib/policies/permissions";
import { guard } from "@/lib/web/interrupt";
import { csrfToken, requireContext } from "@/lib/web/session";

export const metadata = { title: "Import · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function ImportPage() {
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.DATA_IMPORT));
  const token = await csrfToken();

  return (
    <>
      <PageHeader title="Import" />

      <Card>
        <h2>What this does</h2>
        <p>
          It reads people, sessions and series out of another system&rsquo;s export and adds
          them here. <strong>It only adds.</strong> Nothing already in this organization is
          deleted, and nothing is overwritten — a record that matches one already here is
          left exactly as it is and counted, so running the same import twice is safe.
        </p>
        <p className="hint">
          Some rows will not be written, and the report says how many and why. The commonest
          reason is that an instructor cannot be in two places at once: that is a rule the
          database itself holds, so it applies to an import exactly as it applies to a
          booking.
        </p>
        <p className="hint">
          Imported people arrive with no password and cannot sign in until they are invited.
        </p>
      </Card>

      <ImportForm csrfToken={token} />
    </>
  );
}
