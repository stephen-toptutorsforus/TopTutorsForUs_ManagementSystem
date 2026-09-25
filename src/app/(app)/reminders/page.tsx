/**
 * Who is reminded, and how, without sending anything.
 *
 * The matrix is the product's. There is no provider behind it: the inbox
 * holds the messages that would have left.
 */

import { Card, PageHeader } from "@/components/ui";
import { Permission } from "@/lib/policies/permissions";
import { guard } from "@/lib/web/interrupt";
import { requireContext } from "@/lib/web/session";

export const metadata = { title: "Reminders · TopTutorsForUs" };
export const dynamic = "force-dynamic";

const ROWS = [
  ["Student", "In app, email, and text", "In app and email", "In app and email"],
  ["Parent", "In app, email, and text", "In app and email", "In app and email"],
  ["Instructor", "In app and email", "In app", "In app"],
] as const;

export default async function RemindersPage() {
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.ORG_CONFIGURE));

  return (
    <>
      <PageHeader title="Reminders" />
      <Card>
        <p>
          Reminders are captured on this server. No email and no text message
          leaves the building. A student or parent is reminded 24 hours before a
          session and again 1 hour before. An instructor gets those reminders by
          email and in the inbox, and does not get a confirmation email.
        </p>
        <p>
          Moving or cancelling a session retires the reminder for the old time.
          A cancelled session does not get a reminder that it is coming up.
        </p>
        <table>
          <thead>
            <tr>
              <th scope="col">Who</th>
              <th scope="col">Reminder</th>
              <th scope="col">Confirmation</th>
              <th scope="col">Reschedule</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row[0]}>
                {row.map((cell, index) => (
                  <td key={index}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
