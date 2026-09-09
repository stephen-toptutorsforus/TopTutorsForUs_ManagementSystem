/**
 * Reading the people directory.
 *
 * Ported from `app/services/people_query.py`.
 *
 * The directory shows more about each person than the `user` row holds — who
 * they are connected to, which groups they are in, when they last signed in.
 * Gathering that per row would be a query per person per column; this module
 * gathers it in a fixed number of queries regardless of how many people are
 * listed, and hands the page finished rows.
 *
 * Nothing here writes. Nothing here widens what the caller may see: every query
 * is scoped to the caller's organization, so a relationship reaching outside it
 * resolves to nothing rather than to somebody else's tenant.
 */

import type { Prisma } from "@/generated/prisma/client";
import { Role, UserStatus } from "@/generated/prisma/enums";
import type { Principal } from "@/lib/policies/principal";
import { scoped } from "@/lib/policies/scoping";
import { readableQuery } from "@/lib/urlState";
import type { Db } from "@/lib/services/people";

/**
 * How many people one page of the directory holds. A ceiling rather than paging
 * for now, but an explicit one — a silent truncation would read as "this is
 * everybody".
 */
export const PAGE_LIMIT = 200;

/** One link to another person, named for what it is from this row's side. */
export interface Connection {
  readonly kind: string;
  readonly name: string;
}

export type DirectoryUser = Prisma.UserGetPayload<{ include: { roles: true } }>;

export interface PersonRow {
  readonly user: DirectoryUser;
  readonly connections: readonly Connection[];
  readonly groups: readonly string[];
  readonly lastLoginAt: Date | null;
  /**
   * Credits are Phase 4. The column exists because the directory is where they
   * will be read, but there is no ledger yet and this stays null rather than
   * showing a zero that would look like a balance.
   */
  readonly credits: number | null;
  readonly roleNames: readonly string[];
  readonly initials: string;
}

function titleCase(value: string): string {
  return value
    .replace(/_/g, " ")
    .split(" ")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function displayName(user: { firstName: string; lastName: string; ref: string }): string {
  return `${user.firstName} ${user.lastName}`.trim() || user.ref;
}

function initialsOf(user: { firstName: string; lastName: string }): string {
  const first = (user.firstName || "?").slice(0, 1);
  const last = (user.lastName || "").slice(0, 1);
  return (first + last).toUpperCase();
}

/**
 * Roles read from query parameters, ignoring anything unrecognised.
 *
 * Any role in the enum is accepted, not only the four the filter menu offers.
 * The menu is a curated list — `payer` and `regional_admin` are left out of it
 * — but a link that names one of them still filters by it, exactly as the
 * calendar accepts a status its own menu does not show. Narrowing the parser to
 * the menu would quietly turn a working link into an unfiltered page.
 */
export function parseRoles(values: readonly string[]): Role[] {
  const known = Object.values(Role) as string[];
  const seen: Role[] = [];
  // One comma-joined parameter or several: the checkbox forms submit one per
  // role, the links write them joined, and a bookmark may hold either.
  for (const value of values.flatMap((chunk) => chunk.split(",")).slice(0, known.length)) {
    const match = known.find((role) => role === value || role.toLowerCase() === value);
    if (match === undefined) continue; // an unknown role is dropped, not an error
    if (!seen.includes(match as Role)) seen.push(match as Role);
  }
  return seen;
}

/**
 * Statuses read from query parameters, ignoring anything unrecognised.
 *
 * The same rule as `parseRoles`: every status in the enum is accepted, whatever
 * the filter drawer chooses to offer, so a link naming one it does not show
 * still filters by it.
 */
export function parseStatuses(values: readonly string[]): UserStatus[] {
  const known = Object.values(UserStatus) as string[];
  const seen: UserStatus[] = [];
  for (const value of values.flatMap((chunk) => chunk.split(",")).slice(0, known.length)) {
    const match = known.find((status) => status === value || status.toLowerCase() === value);
    if (match === undefined) continue;
    if (!seen.includes(match as UserStatus)) seen.push(match as UserStatus);
  }
  return seen;
}

/**
 * Everything the directory can be narrowed by.
 *
 * The toolbar reaches the first two and the filter drawer reaches all of them.
 * They are one set of parameters either way, so a filter set in the drawer and
 * one typed into the search box produce the same address and the same page.
 */
export interface DirectoryFilters {
  search: string;
  roles: Role[];
  statuses: UserStatus[];
  /** A `ref`, not an id: refs are what the address bar is allowed to carry. */
  regionRef: string | null;
  districtRef: string | null;
  schoolRef: string | null;
}

/** A trimmed, bounded `ref` from the query, or null. */
function parseRef(raw: string | null): string | null {
  const value = (raw ?? "").trim().slice(0, 24);
  return value === "" ? null : value;
}

export function parseDirectoryFilters(params: URLSearchParams): DirectoryFilters {
  return {
    search: (params.get("q") ?? "").trim().slice(0, 100),
    roles: parseRoles(params.getAll("role")),
    statuses: parseStatuses(params.getAll("status")),
    regionRef: parseRef(params.get("region")),
    districtRef: parseRef(params.get("district")),
    schoolRef: parseRef(params.get("school")),
  };
}

/**
 * The directory's whole state, and the only spelling of it.
 *
 * An empty search is not written down: the filter form submits its empty
 * fields, so searching for nothing used to leave `?q=` in the address bar. See
 * `lib/urlState.ts` for the rule this follows and why the page redirects to it.
 *
 * Each list is one comma-joined parameter rather than one parameter per value:
 * `role=instructor,parent` says what `role=instructor&role=parent` says in less
 * room, and both are read.
 *
 * A complete set of roles *is* written down, unlike the calendar's statuses.
 * The menu offers four of the six roles, so ticking all four still excludes
 * somebody who only holds `payer` or `regional_admin`: it looks complete and is
 * a real filter. Only a set covering every role in the enum narrows nothing,
 * because `listPeople` narrows only when the list is non-empty. Statuses follow
 * the same rule against their own enum.
 *
 * A region, a district and a school can all be set at once. They are not
 * collapsed into "the narrowest one wins": somebody may hold a school in one
 * district and a district in another, and quietly dropping a filter the person
 * set is worse than returning nothing.
 */
export function directoryQuery(filters: DirectoryFilters): string {
  const params = new URLSearchParams();
  if (filters.search) params.append("q", filters.search);

  const everyRole = (Object.values(Role) as Role[]).every((role) =>
    filters.roles.includes(role),
  );
  if (filters.roles.length > 0 && !everyRole) {
    params.append("role", filters.roles.map((role) => role.toLowerCase()).join(","));
  }

  const everyStatus = (Object.values(UserStatus) as UserStatus[]).every((status) =>
    filters.statuses.includes(status),
  );
  if (filters.statuses.length > 0 && !everyStatus) {
    params.append("status", filters.statuses.map((status) => status.toLowerCase()).join(","));
  }

  if (filters.regionRef) params.append("region", filters.regionRef);
  if (filters.districtRef) params.append("district", filters.districtRef);
  if (filters.schoolRef) params.append("school", filters.schoolRef);
  return readableQuery(params);
}

/** A directory URL carrying a whole filter. */
export function directoryLink(filters: DirectoryFilters): string {
  const query = directoryQuery(filters);
  return query ? `/people?${query}` : "/people";
}

/** The unfiltered directory — what "Reset filter" goes to. */
export const NO_DIRECTORY_FILTERS: DirectoryFilters = {
  search: "",
  roles: [],
  statuses: [],
  regionRef: null,
  districtRef: null,
  schoolRef: null,
};

/**
 * How many of them are set.
 *
 * Drawn on the filter button, so somebody who has scrolled past the toolbar can
 * still see that the list is narrowed. Each parameter counts once however many
 * values it holds: three ticked roles are one decision about roles.
 */
export function activeDirectoryFilters(filters: DirectoryFilters): number {
  return [
    filters.search !== "",
    filters.roles.length > 0,
    filters.statuses.length > 0,
    filters.regionRef !== null,
    filters.districtRef !== null,
    filters.schoolRef !== null,
  ].filter(Boolean).length;
}

export type ListPeopleOptions = Partial<DirectoryFilters>;

/** The directory, one finished row per person. */
export async function listPeople(
  db: Db,
  principal: Principal,
  options: ListPeopleOptions = {},
): Promise<PersonRow[]> {
  const search = (options.search ?? "").trim();
  const roles = options.roles ?? [];
  const statuses = options.statuses ?? [];

  const where: Prisma.UserWhereInput = { ...scoped(principal), archivedAt: null };

  if (search) {
    // Name or address: somebody looking up a person has whichever of the two
    // they were given. Prisma has no `concat`, so the two-word case is written
    // out rather than approximated — searching "ana reyes" must still find her.
    const parts = search.split(/\s+/).filter(Boolean);
    where.OR = [
      { email: { contains: search, mode: "insensitive" } },
      { firstName: { contains: search, mode: "insensitive" } },
      { lastName: { contains: search, mode: "insensitive" } },
      ...(parts.length > 1
        ? [
            {
              AND: [
                { firstName: { contains: parts[0]!, mode: "insensitive" as const } },
                {
                  lastName: {
                    contains: parts[parts.length - 1]!,
                    mode: "insensitive" as const,
                  },
                },
              ],
            },
          ]
        : []),
    ];
  }

  if (roles.length > 0) {
    // Any of them, not all: ticking Instructor and Parent asks for the people
    // who are either, which is what a person reading a list of checkboxes
    // expects. Somebody holding both appears once.
    where.roles = { some: { role: { in: [...roles] } } };
  }

  if (statuses.length > 0) where.status = { in: [...statuses] };

  // Where somebody is placed. Each is a join row rather than a column, because
  // a person can be attached to more than one school; `some` asks whether any
  // of their rows matches. The nested `ref` is still tenant-scoped — the outer
  // `where` is, and a ref from another tenant simply matches nothing.
  if (options.regionRef) {
    where.regions = { some: { region: { ref: options.regionRef } } };
  }
  if (options.districtRef) {
    where.districts = { some: { district: { ref: options.districtRef } } };
  }
  if (options.schoolRef) {
    where.schools = { some: { school: { ref: options.schoolRef } } };
  }

  const people = await db.user.findMany({
    where,
    include: { roles: true },
    orderBy: { lastName: "asc" },
    take: PAGE_LIMIT,
  });
  if (people.length === 0) return [];

  const ids = people.map((person) => person.id);
  const organizationId = principal.organizationId;

  const [guardians, instructors, memberships] = await Promise.all([
    db.guardianStudent.findMany({
      where: {
        organizationId,
        OR: [{ guardianId: { in: ids } }, { studentId: { in: ids } }],
      },
      select: { guardianId: true, studentId: true },
    }),
    db.instructorStudent.findMany({
      where: {
        organizationId,
        archivedAt: null,
        OR: [{ instructorId: { in: ids } }, { studentId: { in: ids } }],
      },
      select: { instructorId: true, studentId: true },
    }),
    db.groupMember.findMany({
      where: {
        organizationId,
        userId: { in: ids },
        group: { archivedAt: null },
      },
      select: { userId: true, group: { select: { name: true } } },
      orderBy: { group: { name: "asc" } },
    }),
  ]);

  // A link can point at somebody who is not on this page — a filtered view, or
  // a name past the limit — so the names are fetched by id rather than assumed
  // to be in hand. Still tenant-scoped: a link out of the organization finds
  // nothing instead of finding somebody else's record.
  const onPage = new Set(ids);
  const referenced = new Set<bigint>();
  for (const link of guardians) {
    if (!onPage.has(link.guardianId)) referenced.add(link.guardianId);
    if (!onPage.has(link.studentId)) referenced.add(link.studentId);
  }
  for (const link of instructors) {
    if (!onPage.has(link.instructorId)) referenced.add(link.instructorId);
    if (!onPage.has(link.studentId)) referenced.add(link.studentId);
  }

  const names = new Map<bigint, string>(
    people.map((person) => [person.id, displayName(person)]),
  );
  if (referenced.size > 0) {
    const others = await db.user.findMany({
      where: { ...scoped(principal), id: { in: [...referenced] } },
      select: { id: true, firstName: true, lastName: true, ref: true },
    });
    for (const other of others) names.set(other.id, displayName(other));
  }

  const connections = new Map<bigint, Connection[]>(ids.map((id) => [id, []]));
  for (const { guardianId, studentId } of guardians) {
    if (connections.has(guardianId) && names.has(studentId)) {
      connections.get(guardianId)!.push({ kind: "Guardian of", name: names.get(studentId)! });
    }
    if (connections.has(studentId) && names.has(guardianId)) {
      connections.get(studentId)!.push({ kind: "Guardian", name: names.get(guardianId)! });
    }
  }
  for (const { instructorId, studentId } of instructors) {
    if (connections.has(instructorId) && names.has(studentId)) {
      connections.get(instructorId)!.push({ kind: "Teaches", name: names.get(studentId)! });
    }
    if (connections.has(studentId) && names.has(instructorId)) {
      connections
        .get(studentId)!
        .push({ kind: "Instructor", name: names.get(instructorId)! });
    }
  }

  const groups = new Map<bigint, string[]>(ids.map((id) => [id, []]));
  for (const membership of memberships) {
    groups.get(membership.userId)?.push(membership.group.name);
  }

  return people.map((person) => ({
    user: person,
    connections: connections.get(person.id) ?? [],
    groups: groups.get(person.id) ?? [],
    lastLoginAt: person.lastLoginAt,
    credits: null,
    roleNames: person.roles.map((grant) => titleCase(grant.role.toLowerCase())),
    initials: initialsOf(person),
  }));
}
