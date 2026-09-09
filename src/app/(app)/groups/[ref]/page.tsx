/**
 * One group, and who is in it.
 *
 * Ported from `group_detail` in `app/web/views.py` and
 * `app/templates/structure/group_detail.html`.
 *
 * Membership is a present-tense fact: removing somebody here cannot rewrite a
 * session already booked, because each session owns its own participant rows.
 */

import { notFound } from "next/navigation";

import {
  AddMemberForms,
  ArchiveGroupForm,
  RemoveMemberForm,
} from "@/components/structure/Forms";
import { Badge, Card, EmptyState, LinkButton, PageHeader, TableWrap, VisuallyHidden } from "@/components/ui";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

export const dynamic = "force-dynamic";

export default async function GroupDetailPage({
  params,
}: {
  params: Promise<{ ref: string }>;
}) {
  const { ref } = await params;
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.STRUCTURE_VIEW));

  const group = await prisma.group.findFirst({
    where: { ...scoped(principal), ref, archivedAt: null },
  });
  if (group === null) notFound();

  const members = await prisma.groupMember.findMany({
    where: { groupId: group.id },
    include: { user: { select: { id: true, firstName: true, lastName: true, ref: true } } },
    orderBy: [{ memberRole: "asc" }, { user: { lastName: "asc" } }],
  });

  const taken = new Set(members.map((member) => member.userId));
  const eligible = async (role: Role) =>
    (
      await prisma.user.findMany({
        where: { ...scoped(principal), archivedAt: null, roles: { some: { role } } },
        select: { id: true, ref: true, firstName: true, lastName: true },
        orderBy: { lastName: "asc" },
      })
    )
      .filter((person) => !taken.has(person.id))
      .map((person) => ({
        ref: person.ref,
        label: `${person.firstName} ${person.lastName}`.trim() || person.ref,
      }));

  const [students, instructors] = await Promise.all([
    eligible(Role.STUDENT),
    eligible(Role.INSTRUCTOR),
  ]);

  const studentCount = members.filter((member) => member.memberRole === "student").length;
  const canManage = principal.has(Permission.STRUCTURE_MANAGE);
  const token = await csrfToken();

  return (
    <>
      <PageHeader
        title={group.name}
        actions={<LinkButton href="/groups">Back to groups</LinkButton>}
      />

      <Card>
        <h2>Members</h2>
        {members.length > 0 ? (
          <TableWrap caption={<>People in {group.name}</>}>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col">In the group as</th>
                <th scope="col">
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {members.map((member) => {
                const name =
                  `${member.user.firstName} ${member.user.lastName}`.trim() ||
                  member.user.ref;
                return (
                  <tr key={String(member.id)}>
                    <td data-label="Name">{name}</td>
                    <td data-label="In the group as">
                      {member.memberRole.charAt(0).toUpperCase() +
                        member.memberRole.slice(1)}
                    </td>
                    <td data-label="Actions">
                      {canManage && (
                        <RemoveMemberForm
                          groupRef={group.ref}
                          csrfToken={token}
                          memberId={String(member.id)}
                          name={name}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            heading="Nobody in this group yet"
            message="Add a student or an instructor below."
            glyph="◍"
          />
        )}
      </Card>

      {canManage && (
        <>
          <AddMemberForms
            groupRef={group.ref}
            csrfToken={token}
            students={students}
            instructors={instructors}
          />
          <Card>
            <h2>Retire this group</h2>
            <p className="hint">
              Archiving hides it from the pickers. Sessions already booked with it keep
              it, so this term&rsquo;s reports still resolve last term&rsquo;s cohort.
            </p>
            <ArchiveGroupForm
              groupRef={group.ref}
              csrfToken={token}
              name={group.name}
            />
          </Card>
        </>
      )}
    </>
  );
}
