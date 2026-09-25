/**
 * The people directory.
 *
 * Ported from `people_list` in `app/web/views.py` and
 * `app/templates/people.html`.
 *
 * The row shows more than the `user` row holds — who somebody is connected to,
 * which groups they are in, when they last signed in — and the query gathers
 * all of it in a fixed number of statements regardless of how many people are
 * listed.
 */

import Link from "next/link";

import { FilterMenu } from "@/components/FilterMenu";
import {
  AssignButton,
  CreateUserButton,
  PersonNameButton,
} from "@/components/people/OverlayTriggers";
import { PeopleOverlays } from "@/components/people/PeopleOverlays";
import { Button, ButtonRow, Card, Choice, ChoiceGroup, EmptyState, Field, FilterControl, FilterSection, Hint, LinkButton, OptionSelect, PageHeader, PageToolbar, SearchField, SearchInput, TableWrap, Tag, UserStatusBadge, VisuallyHidden, When } from "@/components/ui";
import { GuardianRelationship, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { Moment } from "@/lib/rendering";
import { personSheetOf } from "@/lib/web/personSheet";
import { peopleAtSchools, schoolScope } from "@/lib/policies/schoolScope";
import { scoped } from "@/lib/policies/scoping";
import { USER_STATUS_FILTER_ORDER, roleFilterOptions } from "@/lib/presentation";
import { ticked } from "@/lib/selection";
import {
  PAGE_LIMIT,
  activeDirectoryFilters,
  countPeople,
  directoryQuery,
  listPeople,
  parseDirectoryFilters,
  peopleFirstIndex,
  peopleHasNext,
  peopleHasPrevious,
  peopleLastIndex,
  peoplePageCount,
} from "@/lib/services/peopleQuery";
import { applyDirectoryFilters, resetDirectoryFilters } from "@/app/actions/filters";
import { StateFields } from "@/components/ui/StateFields";
import { readScreenState } from "@/lib/web/filterState";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";


export const metadata = { title: "User Management · TopTutorsForUs" };
export const dynamic = "force-dynamic";

/**
 * The five roles the create form offers. Payer is deliberately not among them:
 * it is granted by assigning somebody to pay, not by creating an account whose
 * only purpose is to pay.
 */
const CREATABLE_ROLES: Role[] = [
  Role.STUDENT,
  Role.PARENT,
  Role.INSTRUCTOR,
  Role.ADMIN,
  Role.SCHOOL_ADMIN,
  Role.PRINCIPAL,
  Role.REGIONAL_ADMIN,
];

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

/**
 * Nothing here reads `searchParams`.
 *
 * The screen's filter arrives from its cookie — see `lib/web/filterState.ts`.
 * A page that still took the address as an input would be a second source for
 * the same state, and the two would disagree the moment anybody typed one.
 */
export default async function PeoplePage() {
  const { principal, organization } = await requireContext();
  await guard(async () => principal.require(Permission.USER_VIEW));

  // The filter comes from the screen's cookie, not from the address — see
  // `lib/web/filterState.ts`. The parser is the same one the query string went
  // through, because the cookie holds the same canonical serialisation.
  const state = await readScreenState("people");
  const filters = parseDirectoryFilters(state);
  const { search, roles: chosenRoles } = filters;

  const [rows, total] = await Promise.all([
    listPeople(prisma, principal, filters),
    countPeople(prisma, principal, filters),
  ]);
  const peoplePage = {
    rows,
    total,
    page: filters.page,
    pageSize: PAGE_LIMIT,
  };
  const personIds = rows.map((row) => row.user.id);
  const [schoolRows, regionRows] = personIds.length
    ? await Promise.all([
        prisma.userSchool.findMany({
          where: { organizationId: principal.organizationId, userId: { in: personIds } },
          select: { userId: true, school: { select: { ref: true } } },
        }),
        prisma.userRegion.findMany({
          where: { organizationId: principal.organizationId, userId: { in: personIds } },
          select: { userId: true, region: { select: { ref: true } } },
        }),
      ])
    : [[], []];
  const schoolsByUser = new Map<bigint, string[]>();
  for (const row of schoolRows) {
    const held = schoolsByUser.get(row.userId) ?? [];
    held.push(row.school.ref);
    schoolsByUser.set(row.userId, held);
  }
  const regionsByUser = new Map<bigint, string[]>();
  for (const row of regionRows) {
    const held = regionsByUser.get(row.userId) ?? [];
    held.push(row.region.ref);
    regionsByUser.set(row.userId, held);
  }
  const canManage = principal.has(Permission.USER_MANAGE);
  const roleOptions = roleFilterOptions();
  const activeFilters = activeDirectoryFilters(filters);
  const bound = schoolScope(principal);
  const peopleWhere = {
    ...scoped(principal),
    archivedAt: null,
    ...(bound ? peopleAtSchools(bound) : {}),
  };

  const people = async (role: Role) =>
    prisma.user.findMany({
      where: { ...peopleWhere, roles: { some: { role } } },
      select: { ref: true, firstName: true, lastName: true, email: true },
      orderBy: { lastName: "asc" },
    });

  // The places are read for everyone who can see the directory, because the
  // filter drawer offers them and the drawer is not a management control. The
  // people lists behind the create and assign modals still are.
  const inOrder = {
    where: { ...scoped(principal), archivedAt: null },
    orderBy: { name: "asc" },
    select: { ref: true, name: true },
  } as const;
  const [regions, districts, schools] = await Promise.all([
    prisma.region.findMany(inOrder),
    prisma.district.findMany(inOrder),
    prisma.school.findMany({
      ...inOrder,
      where: {
        ...inOrder.where,
        ...(bound ? { id: { in: [...bound] } } : {}),
      },
    }),
  ]);

  // Only the ones this tenant has. Built here rather than in the drawer because
  // it is a fact about the organization's data, which the component has no
  // business knowing.
  const places = [
    { name: "region", label: "Region", anything: "Any region", chosen: filters.regionRef, rows: regions },
    { name: "district", label: "District", anything: "Any district", chosen: filters.districtRef, rows: districts },
    { name: "school", label: "School", anything: "Any school", chosen: filters.schoolRef, rows: schools },
  ]
    .filter((place) => place.rows.length > 0)
    .map((place) => ({
      ...place,
      options: place.rows.map((row) => ({ value: row.ref, label: row.name })),
    }));

  const [instructors, students, parents] = canManage
    ? await Promise.all([people(Role.INSTRUCTOR), people(Role.STUDENT), people(Role.PARENT)])
    : [[], [], []];

  const named = (person: { ref: string; firstName: string; lastName: string }) => ({
    ref: person.ref,
    label: `${person.firstName} ${person.lastName}`.trim() || person.ref,
  });
  const namedWithEmail = (person: {
    ref: string;
    firstName: string;
    lastName: string;
    email: string | null;
  }) => {
    const name = `${person.firstName} ${person.lastName}`.trim() || person.ref;
    return { ref: person.ref, label: person.email ? `${name} (${person.email})` : name };
  };

  return (
    // The dialogs and the buttons that open them are the only client state on
    // this page. Everything inside is server-rendered and passes through
    // untouched — the provider is a wrapper, not a boundary the table crosses.
    <PeopleOverlays
      enabled={canManage}
      canManage={canManage}
      csrfToken={await csrfToken()}
      create={{
        creatableRoles: (principal.isAdmin
          ? CREATABLE_ROLES
          : CREATABLE_ROLES.filter(
              (role) =>
                role !== Role.ADMIN &&
                role !== Role.SCHOOL_ADMIN &&
                role !== Role.PRINCIPAL &&
                role !== Role.REGIONAL_ADMIN,
            )
        ).map((role) => ({
          value: role.toLowerCase(),
          label: titleCase(role),
        })),
        guardianRelationships: Object.values(GuardianRelationship).map((kind) => ({
          value: kind.toLowerCase(),
          label: titleCase(kind),
        })),
        instructors: instructors.map(named),
        students: students.map(named),
        parents: parents.map(namedWithEmail),
        schools: schools.map((school) => ({ ref: school.ref, label: school.name })),
        regions: regions.map((region) => ({ ref: region.ref, label: region.name })),
      }}
      assign={{ instructors: instructors.map(named), students: students.map(named) }}
    >
      <PageHeader
        title="User Management"
        toolbar={
          // Keyed by the filter that is applied, so the search box and the
          // status menu are remounted when it changes. Their fields are
          // uncontrolled — `defaultValue`, `defaultChecked` — and a re-render
          // from a server action leaves the DOM values a person typed exactly
          // where they were, which is right until the *other* form changes
          // them. Applying from the drawer used to be a navigation, which
          // rebuilt both.
          <PageToolbar
            key={state.toString()}
            menu={
              <FilterControl
                active={activeFilters}
                reset={resetDirectoryFilters}
                action={applyDirectoryFilters}
              >
            {/* Where somebody is placed. Three separate filters rather than one
                cascading picker: a person can hold a school in one district and
                a district in another, and a picker that narrowed the next list
                would hide exactly those people.

                A tenant with no places at all gets no section, and one with no
                districts gets no district field — an empty select is a control
                that looks broken rather than one that says there is nothing to
                choose. */}
            {places.length > 0 && (
              <FilterSection legend="Location">
                {places.map((place) => (
                  <Field key={place.name} id={`filter-${place.name}`} label={place.label}>
                    <OptionSelect
                      id={`filter-${place.name}`}
                      name={place.name}
                      defaultValue={place.chosen ?? ""}
                      placeholder={place.anything}
                      options={place.options}
                    />
                  </Field>
                ))}
              </FilterSection>
            )}

            <FilterSection legend="Account">
              {/* One field over name and address, because that is what the
                  query does — `listPeople` searches both in one pass. Two
                  boxes here would be two parameters mapping to one search. */}
              <Field id="filter-q" label="Name or email">
                <SearchInput
                  id="filter-q"
                  name="q"
                  defaultValue={search}
                  placeholder="Name or email"
                />
              </Field>

              <ChoiceGroup legend="Role" hint={<p className="hint">Untick a role to hide it.</p>}>
                {roleOptions.map((option) => (
                  <Choice
                    key={option.value}
                    type="checkbox"
                    name="role"
                    value={option.value}
                    defaultChecked={ticked(chosenRoles, option.value)}
                    label={option.label}
                  />
                ))}
              </ChoiceGroup>

              <ChoiceGroup
                legend="User status"
                hint={<p className="hint">Untick a status to hide it.</p>}
              >
                {USER_STATUS_FILTER_ORDER.map((status) => (
                  <Choice
                    key={status}
                    type="checkbox"
                    name="status"
                    value={status.toLowerCase()}
                    defaultChecked={ticked(filters.statuses, status)}
                    label={titleCase(status)}
                  />
                ))}
              </ChoiceGroup>
            </FilterSection>
              </FilterControl>
            }
            form={{
              action: applyDirectoryFilters,
              label: "Search and filter people",
              role: "search",
            }}
            filters={
              <>
                <SearchField
                  label="Search by name or email"
                  placeholder="Name or email"
                  defaultValue={search}
                  submitOnClear
                />
                {/* The search box owns `q` and the role menu owns `role`.
                    Everything else was set in the drawer. The clear control
                    submits this form, and a form that submitted only those
                    two would drop the school, the status and the region on
                    its way to showing everybody again. */}
                <StateFields state={state} omit={["q", "role", "page"]} />
                <FilterMenu
                  name="role"
                  options={roleOptions}
                  selected={chosenRoles.map((role) => role.toLowerCase())}
                  singular="role"
                  plural="roles"
                  legend="Show these roles"
                />
              </>
            }
            actions={
              canManage ? (
                <>
                  <CreateUserButton />
                  {/* The directory does not grow a second importer. Upload
                      opens the screen that already reads a people file. */}
                  <LinkButton href="/import">
                    <span aria-hidden="true">↥</span> Upload Users
                  </LinkButton>
                </>
              ) : undefined
            }
          />
        }

      />

      {rows.length > 0 ? (
        <>
          <TableWrap caption={<>People at {organization.name}
                {(search || chosenRoles.length > 0) && ", filtered"}</>} className="people-table">
            <thead>
              <tr>
                {/* The avatar column is decorative — the name beside it is the
                    label, and a heading here would be read out for every row. */}
                <th scope="col">
                  <VisuallyHidden>Avatar</VisuallyHidden>
                </th>
                <th scope="col">Name</th>
                <th scope="col">Email/Username</th>
                <th scope="col">Roles</th>
                <th scope="col">Relationships</th>
                <th scope="col">Groups</th>
                <th scope="col" className="numeric">Credits</th>
                <th scope="col">Status</th>
                <th scope="col">Actions</th>
                <th scope="col">Last Used</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const person = row.user;
                const displayName =
                  `${person.firstName} ${person.lastName}`.trim() || person.ref;
                const isInstructor = row.roleNames.includes("Instructor");
                return (
                  <tr key={String(person.id)}>
                    <td data-label="" className="people-avatar">
                      <span className="avatar" aria-hidden="true">
                        {row.initials}
                      </span>
                    </td>
                    <td data-label="Name" className="people-name">
                      {/* The name opens the record, which is where it is read
                          and changed. A button rather than a link: it opens a
                          panel over this page, and the directory's own address
                          — which is where its filter is *not* — stays put. */}
                      <PersonNameButton
                        person={personSheetOf(person, {
                          roleNames: row.roleNames,
                          connections: row.connections.map((link) => ({
                            kind: link.kind,
                            name: link.name,
                          })),
                          groups: [...row.groups],
                          // The same clock the row's own cell uses: their
                          // timezone if they have one, the tenant's otherwise.
                          lastLoginLabel: row.lastLoginAt
                            ? new Moment(
                                row.lastLoginAt,
                                person.timezone || organization.timezone,
                              ).full
                            : null,
                          // Decided here, by the rules the service enforces, so
                          // a control is never drawn for a write that will be
                          // refused. The service checks again regardless.
                          canSetPassword:
                            principal.isAdmin &&
                            person.ref !== principal.userRef &&
                            !row.roleNames.includes("Admin"),
                          canArchive:
                            canManage &&
                            person.ref !== principal.userRef &&
                            (principal.isAdmin || !row.roleNames.includes("Admin")),
                          // Derived region rows behind a school are hidden so
                          // submitting the drawer cannot trip "not both".
                          schoolRefs: schoolsByUser.get(person.id) ?? [],
                          regionRefs: (schoolsByUser.get(person.id) ?? []).length
                            ? []
                            : (regionsByUser.get(person.id) ?? []),
                        })}
                      >
                        {displayName}
                      </PersonNameButton>
                    </td>
                    <td data-label="Email/Username">
                      {person.email ? (
                        <a href={`mailto:${person.email}`}>{person.email}</a>
                      ) : (
                        // A student whose guardian has not set one yet. Saying
                        // so beats an empty cell, which would read as a
                        // missing value.
                        <Hint>Awaiting parent setup</Hint>
                      )}
                    </td>
                    <td data-label="Roles">
                      {row.roleNames.length > 0 ? (
                        row.roleNames.map((name) => (
                          <Tag key={name}>
                            {name}
                          </Tag>
                        ))
                      ) : (
                        <Hint>No roles</Hint>
                      )}
                    </td>
                    <td data-label="Relationships">
                      {row.connections.length > 0 ? (
                        <ul className="stacked">
                          {row.connections.map((link, index) => (
                            <li key={`${link.kind}-${link.name}-${index}`}>
                              <Hint>{link.kind}</Hint> {link.name}
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <Hint>—</Hint>
                      )}
                    </td>
                    <td data-label="Groups">
                      {row.groups.length > 0 ? (
                        row.groups.map((name) => (
                          <Tag key={name}>
                            {name}
                          </Tag>
                        ))
                      ) : (
                        <Hint>—</Hint>
                      )}
                    </td>
                    <td data-label="Credits" className="numeric">
                      {row.credits === null ? (
                        // Not zero: a zero here would read as a balance of
                        // nothing, which is a different claim from "there is
                        // no ledger yet".
                        <Hint title="Credits arrive with billing">
                          —
                        </Hint>
                      ) : (
                        row.credits
                      )}
                    </td>
                    <td data-label="Status">
                      <UserStatusBadge status={person.status} />
                    </td>
                    <td data-label="Actions">
                      {isInstructor ? (
                        <Link href={`/sessions?instructor=${person.ref}`}>Sessions</Link>
                      ) : canManage ? (
                        <AssignButton
                          target={{ ref: person.ref, label: displayName }}
                        />
                      ) : (
                        <Hint>—</Hint>
                      )}
                    </td>
                    <td data-label="Last Used">
                      {row.lastLoginAt ? (
                        <When
                          instant={row.lastLoginAt}
                          zone={person.timezone || organization.timezone}
                        />
                      ) : (
                        <Hint>Never signed in</Hint>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </TableWrap>

        </>
      ) : total === 0 ? (
        <Card>
          <EmptyState
            heading="Nobody matches"
            message="Try a different name or clear the role filter."
            glyph="◍"
          />
        </Card>
      ) : null}

      {total > 0 && (
        <nav className="pagination" aria-label="Pagination">
          <p className="count">
            Showing {peopleFirstIndex(peoplePage)}–{peopleLastIndex(peoplePage)} of {total}
          </p>
          <ButtonRow as="form" action={applyDirectoryFilters}>
            <StateFields state={new URLSearchParams(directoryQuery(filters))} omit={["page"]} />
            {peopleHasPrevious(peoplePage) && (
              <Button
                size="small"
                type="submit"
                name="page"
                value={filters.page - 1}
                rel="prev"
              >
                Previous
              </Button>
            )}
            <span className="count">
              Page {filters.page} of {peoplePageCount(peoplePage)}
            </span>
            {peopleHasNext(peoplePage) && (
              <Button size="small" type="submit" name="page" value={filters.page + 1} rel="next">
                Next
              </Button>
            )}
          </ButtonRow>
        </nav>
      )}
    </PeopleOverlays>
  );
}
