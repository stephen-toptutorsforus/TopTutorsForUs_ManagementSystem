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
import { redirect } from "next/navigation";

import { FilterMenu } from "@/components/FilterMenu";
import { AssignModal } from "@/components/people/AssignModal";
import { CreateUserModal } from "@/components/people/CreateUserModal";
import { AnchorButton, Badge, Button, Card, EmptyState, Field, Hint, PageHead, TableWrap, Tag, VisuallyHidden, When } from "@/components/ui";
import { GuardianRelationship, Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { ROLE_FILTER_ORDER, roleFilterOptions } from "@/lib/presentation";
import {
  PAGE_LIMIT,
  directoryLink,
  directoryQuery,
  listPeople,
  parseRoles,
} from "@/lib/services/peopleQuery";
import { canonicalUrl } from "@/lib/urlState";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

import { toSearchParams } from "../sessions/page";

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
  Role.REGIONAL_ADMIN,
];

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, organization } = await requireContext();
  await guard(async () => principal.require(Permission.USER_VIEW));

  const params = toSearchParams(await searchParams);
  const search = (params.get("q") ?? "").trim();
  const chosenRoles = parseRoles(params.getAll("role"));

  const tidy = canonicalUrl("/people", params, directoryQuery(search, chosenRoles));
  if (tidy !== null) redirect(tidy);

  const rows = await listPeople(prisma, principal, { search, roles: chosenRoles });
  const canManage = principal.has(Permission.USER_MANAGE);
  const roleOptions = roleFilterOptions();

  const people = async (role: Role) =>
    prisma.user.findMany({
      where: { ...scoped(principal), archivedAt: null, roles: { some: { role } } },
      select: { ref: true, firstName: true, lastName: true, email: true },
      orderBy: { lastName: "asc" },
    });

  const [instructors, students, parents, schools, regions] = canManage
    ? await Promise.all([
        people(Role.INSTRUCTOR),
        people(Role.STUDENT),
        people(Role.PARENT),
        prisma.school.findMany({
          where: { ...scoped(principal), archivedAt: null },
          select: { ref: true, name: true },
          orderBy: { name: "asc" },
        }),
        prisma.region.findMany({
          where: { ...scoped(principal), archivedAt: null },
          select: { ref: true, name: true },
          orderBy: { name: "asc" },
        }),
      ])
    : [[], [], [], [], []];

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
    <>
      <PageHead title="User Management" subtitle={<>Everyone at {organization.name}.</>} />

      {/* One line: what narrows the list on the left, what adds to it on the
          right. The actions are not inside the search form — a button in a GET
          form would submit the search. */}
      <Card className="people-toolbar">
        <form className="people-filters" method="get" action="/people" role="search">
          <Field id="q" label="Search by name or email">
            {/* No submit button beside it. The form has exactly one field that
                blocks implicit submission, so Enter still searches — and with
                scripting off that is also what applies the role ticks. */}
            <input id="q" name="q" type="search" defaultValue={search} placeholder="Search" />
                    </Field>
          <FilterMenu
            name="role"
            options={roleOptions}
            selected={chosenRoles.map((role) => role.toLowerCase())}
            singular="role"
            plural="roles"
            legend="Show these roles"
            allLink={directoryLink(search, ROLE_FILTER_ORDER)}
            noneLink={directoryLink(search, [])}
          />
        </form>

        {canManage && (
          <div className="people-actions">
            <AnchorButton variant="primary" href="#create-user">
              <span aria-hidden="true">＋</span> Create User
            </AnchorButton>
            {/* Bulk import is not built. A disabled control says the feature
                exists and is unavailable; a working-looking button that did
                nothing, or a missing one, would each say something untrue. */}
            <Button className="is-disabled"
              type="button"
              disabled
              title="Bulk import is not built yet — create users one at a time below"
            >
              <span aria-hidden="true">↥</span> Upload Users
            </Button>
          </div>
        )}
      </Card>

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
                const active = person.status === "ACTIVE";
                return (
                  <tr key={String(person.id)}>
                    <td data-label="" className="people-avatar">
                      <span className="avatar" aria-hidden="true">
                        {row.initials}
                      </span>
                    </td>
                    <td data-label="Name" className="people-name">
                      {displayName}
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
                      <Badge tone={active ? "good" : "muted"} glyph={active ? "✓" : "○"}>
                        {titleCase(person.status)}
                      </Badge>
                    </td>
                    <td data-label="Actions">
                      {isInstructor ? (
                        <Link href={`/sessions?instructor=${person.ref}`}>Sessions</Link>
                      ) : canManage ? (
                        <a href="#assign-people">Assign</a>
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

          {rows.length === PAGE_LIMIT && (
            <p className="hint">
              Showing the first {rows.length} people. Narrow the search to see the rest.
            </p>
          )}
        </>
      ) : (
        <Card>
          <EmptyState
            heading="Nobody matches"
            message="Try a different name or clear the role filter."
            glyph="◍"
          />
        </Card>
      )}

      {canManage && (
        <>
          {/* Two modals, opened by the fragment in the URL and closed by
              clearing it. `:target` rather than <dialog>, because a <dialog>
              without a script is a form nobody can reach — this way the panels
              open, submit and close with JavaScript unavailable. */}
          <CreateUserModal
            csrfToken={await csrfToken()}
            creatableRoles={CREATABLE_ROLES.map((role) => ({
              value: role.toLowerCase(),
              label: titleCase(role),
            }))}
            guardianRelationships={Object.values(GuardianRelationship).map((kind) => ({
              value: kind.toLowerCase(),
              label: titleCase(kind),
            }))}
            instructors={instructors.map(named)}
            students={students.map(named)}
            parents={parents.map(namedWithEmail)}
            schools={schools.map((school) => ({ ref: school.ref, label: school.name }))}
            regions={regions.map((region) => ({ ref: region.ref, label: region.name }))}
          />
          <AssignModal
            csrfToken={await csrfToken()}
            instructors={instructors.map(named)}
            students={students.map(named)}
          />
        </>
      )}
    </>
  );
}
