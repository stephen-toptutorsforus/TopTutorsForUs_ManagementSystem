/**
 * Locations.
 *
 * Ported from `locations_list` in `app/web/views.py` and
 * `app/templates/structure/locations.html`.
 */

import { ArchiveLocationForm, NewLocationForm } from "@/components/structure/Forms";
import { Card, EmptyState, PageHeader, TableWrap, VisuallyHidden } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

export const metadata = { title: "Locations · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function LocationsPage() {
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.STRUCTURE_VIEW));

  const [locations, schools] = await Promise.all([
    prisma.location.findMany({
      where: { ...scoped(principal), archivedAt: null },
      orderBy: { name: "asc" },
    }),
    prisma.school.findMany({
      where: { ...scoped(principal), archivedAt: null },
      orderBy: { name: "asc" },
    }),
  ]);

  const schoolNames = new Map(schools.map((school) => [school.id, school.name]));
  const canManage = principal.has(Permission.STRUCTURE_MANAGE);
  const token = await csrfToken();

  return (
    <>
      <PageHeader
        title="Locations"
      />

      {locations.length > 0 ? (
        <TableWrap caption="Locations in this organization">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Address</th>
              <th scope="col">School</th>
              <th scope="col" className="numeric">Capacity</th>
              <th scope="col">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {locations.map((location) => (
              <tr key={String(location.id)}>
                <td data-label="Name">{location.name}</td>
                <td data-label="Address">{location.address ?? "—"}</td>
                <td data-label="School">
                  {location.schoolId ? (schoolNames.get(location.schoolId) ?? "—") : "—"}
                </td>
                <td data-label="Capacity" className="numeric">
                  {location.capacity ?? "—"}
                </td>
                <td data-label="Actions">
                  {canManage && (
                    <ArchiveLocationForm
                      locationRef={location.ref}
                      csrfToken={token}
                      name={location.name}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <EmptyState
            heading="No locations yet"
            message="Add a room so in-person sessions can be booked."
            glyph="⌂"
          />
        </Card>
      )}

      {canManage && (
        <NewLocationForm
          csrfToken={token}
          schools={schools.map((school) => ({ ref: school.ref, label: school.name }))}
        />
      )}
    </>
  );
}
