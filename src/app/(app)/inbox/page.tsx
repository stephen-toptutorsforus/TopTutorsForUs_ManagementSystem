/**
 * Messages captured instead of sent.
 *
 * Opening the page also runs the credit clock: a student request that is
 * still short of a credit is warned inside 48 hours and cancelled inside 24.
 */

import { Card, EmptyState, PageHeader, TableWrap, When } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { sweepCredits } from "@/lib/services/localNotices";
import { guard } from "@/lib/web/interrupt";
import { requireContext } from "@/lib/web/session";

export const metadata = { title: "Inbox · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function InboxPage() {
  const { principal, organization } = await requireContext();
  await guard(async () => principal.require(Permission.AUDIT_VIEW));

  await sweepCredits(prisma, organization.id, new Date());

  const messages = await prisma.capturedMessage.findMany({
    where: { organizationId: organization.id },
    orderBy: { createdAt: "desc" },
    take: 200,
    include: { session: { select: { ref: true } } },
  });

  return (
    <>
      <PageHeader title="Inbox" />
      {messages.length === 0 ? (
        <Card>
          <EmptyState
            heading="No messages yet"
            message="Booking, moving, or cancelling a session captures them here. Nothing is sent."
            glyph="✉"
          />
        </Card>
      ) : (
        <TableWrap caption="Captured messages">
          <thead>
            <tr>
              <th scope="col">When</th>
              <th scope="col">Kind</th>
              <th scope="col">Channel</th>
              <th scope="col">Address</th>
              <th scope="col">Session</th>
              <th scope="col">Text</th>
              <th scope="col">State</th>
            </tr>
          </thead>
          <tbody>
            {messages.map((message) => (
              <tr key={String(message.id)}>
                <td>
                  <When instant={message.dueAt} zone={principal.timezone} />
                </td>
                <td>{message.kind.replaceAll("_", " ")}</td>
                <td>{message.channel.replaceAll("_", " ")}</td>
                <td>{message.address}</td>
                <td>{message.session?.ref ?? "—"}</td>
                <td>{message.body}</td>
                <td>{message.retiredAt ? "Retired" : "Open"}</td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </>
  );
}
