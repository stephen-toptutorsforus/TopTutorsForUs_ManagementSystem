/**
 * Regions, districts and schools — the place hierarchy a tenant books against.
 *
 * Seeded in Phase 1 so the directory could filter by them. This is the screen
 * that creates them. People are placed here or on their record; sessions are
 * not stamped with a school.
 */

import {
  ArchiveDistrictForm,
  ArchiveRegionForm,
  ArchiveSchoolForm,
  AttachSchoolPersonForm,
  DetachSchoolPersonForm,
  NewDistrictForm,
  NewRegionForm,
  NewSchoolForm,
} from "@/components/structure/Forms";
import { Card, EmptyState, Hint, PageHeader, TableWrap, VisuallyHidden } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

export const metadata = { title: "Schools · TopTutorsForUs" };
export const dynamic = "force-dynamic";

export default async function SchoolsPage() {
  const { principal } = await requireContext();
  await guard(async () => principal.require(Permission.STRUCTURE_VIEW));

  const inOrder = {
    where: { ...scoped(principal), archivedAt: null },
    orderBy: { name: "asc" as const },
  };

  const [regions, districts, schools, placed, roster] = await Promise.all([
    prisma.region.findMany(inOrder),
    prisma.district.findMany(inOrder),
    prisma.school.findMany(inOrder),
    prisma.userSchool.findMany({
      where: { organizationId: principal.organizationId },
      select: {
        schoolId: true,
        user: { select: { ref: true, firstName: true, lastName: true, archivedAt: true } },
      },
      orderBy: { user: { lastName: "asc" } },
    }),
    prisma.user.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
    }),
  ]);

  const peopleAt = new Map<bigint, { ref: string; name: string }[]>();
  for (const row of placed) {
    if (row.user.archivedAt !== null) continue;
    const list = peopleAt.get(row.schoolId) ?? [];
    list.push({
      ref: row.user.ref,
      name: `${row.user.firstName} ${row.user.lastName}`.trim() || row.user.ref,
    });
    peopleAt.set(row.schoolId, list);
  }
  const rosterChoices = roster.map((person) => ({
    ref: person.ref,
    label: `${person.firstName} ${person.lastName}`.trim() || person.ref,
  }));
  const regionName = new Map(regions.map((region) => [region.id, region.name]));
  const districtById = new Map(districts.map((district) => [district.id, district]));

  const canManage = principal.has(Permission.STRUCTURE_MANAGE);
  const token = await csrfToken();

  return (
    <>
      <PageHeader title="Schools" />

      {schools.length > 0 ? (
        <TableWrap caption="Schools in this organization">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">District</th>
              <th scope="col">Region</th>
              <th scope="col" className="numeric">
                People
              </th>
              <th scope="col">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {schools.map((school) => {
              const district = school.districtId ? districtById.get(school.districtId) : undefined;
              const region = district?.regionId ? regionName.get(district.regionId) : undefined;
              return (
                <tr key={String(school.id)}>
                  <td data-label="Name">{school.name}</td>
                  <td data-label="District">{district?.name ?? "—"}</td>
                  <td data-label="Region">{region ?? "—"}</td>
                  <td data-label="People" className="numeric">
                    {peopleAt.get(school.id)?.length ?? 0}
                  </td>
                  <td data-label="Actions">
                    {canManage && (
                      <ArchiveSchoolForm
                        schoolRef={school.ref}
                        csrfToken={token}
                        name={school.name}
                      />
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </TableWrap>
      ) : (
        <Card>
          <EmptyState
            heading="No schools yet"
            message="Add a school so people can be placed and sessions filtered by it."
            glyph="▣"
          />
        </Card>
      )}

      {canManage &&
        schools.map((school) => {
          const held = peopleAt.get(school.id) ?? [];
          const heldRefs = new Set(held.map((person) => person.ref));
          return (
            <Card key={school.ref}>
              <h2>{school.name}</h2>
              {held.length > 0 ? (
                <TableWrap caption={`People at ${school.name}`}>
                  <thead>
                    <tr>
                      <th scope="col">Name</th>
                      <th scope="col">
                        <VisuallyHidden>Actions</VisuallyHidden>
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {held.map((person) => (
                      <tr key={person.ref}>
                        <td data-label="Name">{person.name}</td>
                        <td data-label="Actions">
                          <DetachSchoolPersonForm
                            schoolRef={school.ref}
                            csrfToken={token}
                            userRef={person.ref}
                            name={person.name}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </TableWrap>
              ) : (
                <Hint>Nobody is placed here yet.</Hint>
              )}
              <AttachSchoolPersonForm
                schoolRef={school.ref}
                csrfToken={token}
                people={rosterChoices.filter((person) => !heldRefs.has(person.ref))}
              />
            </Card>
          );
        })}

      {districts.length > 0 && (
        <TableWrap caption="Districts in this organization">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">Region</th>
              <th scope="col">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {districts.map((district) => (
              <tr key={String(district.id)}>
                <td data-label="Name">{district.name}</td>
                <td data-label="Region">
                  {district.regionId ? (regionName.get(district.regionId) ?? "—") : "—"}
                </td>
                <td data-label="Actions">
                  {canManage && (
                    <ArchiveDistrictForm
                      districtRef={district.ref}
                      csrfToken={token}
                      name={district.name}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {regions.length > 0 && (
        <TableWrap caption="Regions in this organization">
          <thead>
            <tr>
              <th scope="col">Name</th>
              <th scope="col">
                <VisuallyHidden>Actions</VisuallyHidden>
              </th>
            </tr>
          </thead>
          <tbody>
            {regions.map((region) => (
              <tr key={String(region.id)}>
                <td data-label="Name">{region.name}</td>
                <td data-label="Actions">
                  {canManage && (
                    <ArchiveRegionForm
                      regionRef={region.ref}
                      csrfToken={token}
                      name={region.name}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}

      {canManage && (
        <>
          <Hint>
            A school sits in a district, a district in a region. Create the region
            first when you need the full tree; a school can also stand alone.
          </Hint>
          <NewRegionForm csrfToken={token} />
          <NewDistrictForm
            csrfToken={token}
            regions={regions.map((region) => ({ ref: region.ref, label: region.name }))}
          />
          <NewSchoolForm
            csrfToken={token}
            districts={districts.map((district) => ({ ref: district.ref, label: district.name }))}
          />
        </>
      )}
    </>
  );
}
