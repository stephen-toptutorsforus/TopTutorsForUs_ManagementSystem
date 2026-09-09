/**
 * Groups.
 *
 * Ported from `groups_list` in `app/web/views.py` and
 * `app/templates/structure/groups.html`.
 */

import Link from "next/link";

import { NewGroupForm } from "@/components/structure/Forms";
import { Badge, Card, EmptyState, Hint, LinkButton, PageHeader, TableWrap, VisuallyHidden } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

export const metadata = { title: "Groups · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.STRUCTURE_VIEW));

  const [groups, counts, programs] = await Promise.all([
    prisma.group.findMany({
      where: { ...scoped(principal), archivedAt: null },
      orderBy: { name: "asc" },
    }),
    prisma.groupMember.groupBy({
      by: ["groupId"],
      where: { organizationId: principal.organizationId, memberRole: "student" },
      _count: { _all: true },
    }),
    prisma.program.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const studentCount = new Map(counts.map((row) => [row.groupId, row._count._all]));
  const canManage = principal.has(Permission.STRUCTURE_MANAGE);

  return (
    <>
      <PageHeader
        title="Groups"
        subtitle="Named cohorts. Booking a group adds its current members to each session as it is created, so a later change never rewrites a session already booked."
      />

      {groups.length > 0 ? (
        <TableWrap caption="Groups in this organization">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col" className="numeric">Students</th>
              <th scope="col" className="numeric">Capacity</th>
              <th scope="col">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {groups.map((group) => {
              const members = studentCount.get(group.id) ?? 0;
              return (
                <tr key={String(group.id)}>
                  <td data-label="Name">
                    <Link href={`/groups/${group.ref}`}>{group.name}</Link>
                  </td>
                  <td data-label="Students" className="numeric">
                    {members}
                  </td>
                  <td data-label="Capacity" className="numeric">
                    {group.capacity ? (
                      <>
                        {group.capacity}
                        {members >= group.capacity && (
                          <Badge tone="warn" glyph="!">
                            Full
                          </Badge>
                        )}
                      </>
                    ) : (
                      <Hint>No limit</Hint>
                    )}
                  </td>
                  <td data-label="Actions">
                    <LinkButton size="small" href={`/groups/${group.ref}`}>
                      Open
                    </LinkButton>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <EmptyState
            heading="No groups yet"
            message="Create one below, then add students to it."
            glyph="◍"
          />
        </Card>
      )}

      {canManage && (
        <NewGroupForm
          csrfToken={await csrfToken()}
          programs={programs.map((program) => ({ ref: program.ref, label: program.name }))}
        />
      )}
    </>
  );
}
