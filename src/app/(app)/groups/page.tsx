/**
 * Groups.
 *
 * Ported from `groups_list` in `app/web/views.py` and
 * `app/templates/structure/groups.html`.
 */

import Link from "next/link";

import { EmptyState } from "@/components/ui";
import { NewGroupForm } from "@/components/structure/Forms";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { csrfToken, requireContext } from "@/lib/web/session";

export const metadata = { title: "Groups · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const { principal } = await requireContext();
  principal.require(Permission.STRUCTURE_VIEW);

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
      <div className="page-head">
        <div>
          <h1>Groups</h1>
          <p className="subtitle">
            Named cohorts. Booking a group adds its current members to each session as it
            is created, so a later change never rewrites a session already booked.
          </p>
        </div>
      </div>

      {groups.length > 0 ? (
        <div className="table-wrap">
          <table>
            <caption className="visually-hidden">Groups in this organization</caption>
            <thead>
              <tr>
                <th scope="col">Name</th>
                <th scope="col" className="numeric">Students</th>
                <th scope="col" className="numeric">Capacity</th>
                <th scope="col">
                  <span className="visually-hidden">Actions</span>
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
                            <span className="badge badge-warn">
                              <span className="glyph" aria-hidden="true">
                                !
                              </span>
                              Full
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="hint">No limit</span>
                      )}
                    </td>
                    <td data-label="Actions">
                      <Link className="btn btn-small" href={`/groups/${group.ref}`}>
                        Open
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="card">
          <EmptyState
            heading="No groups yet"
            message="Create one below, then add students to it."
            glyph="◍"
          />
        </div>
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
