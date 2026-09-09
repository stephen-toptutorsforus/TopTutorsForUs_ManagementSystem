/**
 * The session grid.
 *
 * Ported from `sessions_grid` in `app/web/views.py` and
 * `app/templates/sessions/grid.html`.
 *
 * Filters are a GET form, so the state lands in the URL and can be shared,
 * bookmarked, and returned to with the back button.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { AnchorButton, ButtonRow, Card, Choice, ChoiceGroup, EmptyState, Field, FilterActions, FilterDrawer, FilterSection, LinkButton, OptionSelect, PageHeader, PageToolbar, SearchField, StatusBadge, TableWrap, Tag, VisuallyHidden, When } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { durationLabel, percent, statusFilterOptions } from "@/lib/presentation";
import { ticked } from "@/lib/selection";
import { actualDurationMinutes, scheduledDurationMinutes } from "@/lib/services/sessionOps";
import { FilterMenu } from "@/components/FilterMenu";
import {
  AVAILABLE_COLUMNS,
  activeSessionFilters,
  firstIndex,
  hasNext,
  hasPrevious,
  lastIndex,
  listSessions,
  pageCount,
  parseFilters,
  toQuery,
  type SessionRow,
} from "@/lib/services/sessionQuery";
import { canonicalUrl } from "@/lib/urlState";
import { requireContext } from "@/lib/web/session";

export const metadata = { title: "Sessions · TopTutorsForUs" };
export const dynamic = "force-dynamic";

type Search = Record<string, string | string[] | undefined>;

/** Next hands search params as an object; the parser wants the real thing. */
export function toSearchParams(search: Search): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search)) {
    if (value === undefined) continue;
    for (const item of Array.isArray(value) ? value : [value]) params.append(key, item);
  }
  return params;
}

/** One grid cell, chosen by column key. */
function Cell({ column, row, zone }: { column: string; row: SessionRow; zone: string }) {
  const session = row.session;
  switch (column) {
    case "title":
      return (
        <>
          <Link href={`/sessions/${session.ref}`}>{session.title}</Link>
          {row.seriesPosition && <Tag>{row.seriesPosition}</Tag>}
          {session.detachedFromSeries && (
            <Tag title="Edited on its own; series edits skip it">
              detached
            </Tag>
          )}
        </>
      );
    case "instructor":
      return <>{row.instructorName ?? "—"}</>;
    case "students":
      return <>{row.studentNames.join(", ") || "—"}</>;
    case "location":
      return <>{row.locationName ?? "—"}</>;
    case "billable":
      return <>{session.billable ? "Yes" : "No"}</>;
    case "payment": {
      const words = session.paymentState.replace(/_/g, " ");
      return <>{words.charAt(0).toUpperCase() + words.slice(1)}</>;
    }
    case "invoice":
      return <>{session.invoiceRef ?? "—"}</>;
    case "status":
      return <StatusBadge status={session.status} />;
    case "attendance":
      return <>{percent(row.attendanceRate)}</>;
    case "scheduled_start":
      return <When instant={session.scheduledStart} zone={session.timezone || zone} />;
    case "scheduled_duration":
      return <>{durationLabel(scheduledDurationMinutes(session))}</>;
    case "actual_duration":
      return <>{durationLabel(actualDurationMinutes(session))}</>;
    case "subject":
      return <>{row.subjectName ?? "—"}</>;
    case "grade":
      return <>{row.gradeName ?? "—"}</>;
    default:
      return null;
  }
}

export default async function SessionsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { principal } = await requireContext();
  const zone = principal.timezone;
  const params = toSearchParams(await searchParams);
  const filters = parseFilters(params);

  // The filter form submits its empty fields, so filtering on nothing used to
  // leave `?q=&from=&to=&instructor=&program=` behind. `toQuery` has always
  // known which of those are defaults; this makes the address bar agree with
  // it. See `lib/urlState.ts`.
  const query = toQuery(filters);
  const tidy = canonicalUrl("/sessions", params, query);
  if (tidy !== null) redirect(tidy);

  // The export takes the filters as they stand, and an unfiltered grid now
  // serialises to nothing at all — `export.csv?` is not a URL to hand a browser.
  const exportHref = query ? `/sessions/export.csv?${query}` : "/sessions/export.csv";

  // "Select all" in the status menu: this grid with the status narrowing
  // dropped and everything else kept, back on the first page because the row
  // count changes under it.
  const allStatuses = (() => {
    const rest = toQuery(filters, { status: "", page: 1 });
    return rest ? `/sessions?${rest}` : "/sessions";
  })();
  const results = await listSessions(prisma, principal, filters, { zone });

  const [instructors, programs] = await Promise.all([
    prisma.user.findMany({
      where: { ...scoped(principal), archivedAt: null, roles: { some: { role: "INSTRUCTOR" } } },
      select: { ref: true, firstName: true, lastName: true },
      orderBy: { lastName: "asc" },
    }),
    prisma.program.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  const columns = filters.columns;
  const canExport = principal.has(Permission.EXPORT_SESSIONS);
  const canBook = principal.has(Permission.SESSION_BOOK);


  return (
    <>
      <PageHeader
        title="Sessions"
        actions={
          // Asked before the row is built, not inside it: a `ButtonRow` holding
          // two refused permissions is still an element, so the header would
          // wrap it and a student would get an empty box where the actions go.
          canExport || canBook ? (
            <ButtonRow>
              {canExport && (
                // A GET, so the current filters travel with it verbatim.
                <AnchorButton href={exportHref}>
                  <span aria-hidden="true">⤓</span> Export CSV
                </AnchorButton>
              )}
              {canBook && (
                <LinkButton variant="primary" href="/sessions/new">
                  <span aria-hidden="true">＋</span> New session
                </LinkButton>
              )}
            </ButtonRow>
          ) : undefined
        }
        toolbar={
          <PageToolbar
            menu={
              <FilterActions
                active={activeSessionFilters(filters)}
                resetHref="/sessions"
              />
            }
            form={{ action: "/sessions", label: "Search and filter sessions", role: "search" }}
            filters={
              <>
                <SearchField
                  label="Search session titles"
                  placeholder="Session title"
                  defaultValue={filters.search}
                />

                {/* The same control the calendar and the directory use, in the
                    same place, applying the same way. It kept its own Apply
                    while the toolbar also held five other filters; the drawer
                    holds those now, so this is one filter again and closing it
                    is what applies it. Clearing is "Reset filter" in the menu,
                    which every screen has. */}
                <FilterMenu
                  name="status"
                  options={statusFilterOptions()}
                  selected={filters.statuses.map((status) => status.toLowerCase())}
                  singular="status"
                  plural="statuses"
                  legend="Show these statuses"
                  allLink={allStatuses}
                />
              </>
            }
          />
        }
        drawer={
          <FilterDrawer action="/sessions" resetHref="/sessions">
            <FilterSection legend="Sessions">
              <Field id="filter-q" label="Search titles">
                <input
                  id="filter-q"
                  name="q"
                  type="search"
                  defaultValue={filters.search}
                  placeholder="Session title"
                />
              </Field>
              <ChoiceGroup
                legend="Status"
                hint={<p className="hint">Untick a status to hide it.</p>}
              >
                {statusFilterOptions().map((option) => (
                  <Choice
                    key={option.value}
                    type="checkbox"
                    name="status"
                    value={option.value}
                    defaultChecked={ticked(
                      filters.statuses.map((status) => status.toLowerCase()),
                      option.value,
                    )}
                    label={option.label}
                  />
                ))}
              </ChoiceGroup>
            </FilterSection>

            <FilterSection legend="When">
              <Field id="filter-from" label="From">
                <input
                  id="filter-from"
                  name="from"
                  type="date"
                  defaultValue={filters.dateFrom ?? ""}
                />
              </Field>
              <Field id="filter-to" label="To">
                <input
                  id="filter-to"
                  name="to"
                  type="date"
                  defaultValue={filters.dateTo ?? ""}
                />
              </Field>
            </FilterSection>

            <FilterSection legend="Who and what">
              <Field id="filter-instructor" label="Instructor">
                <OptionSelect
                  id="filter-instructor"
                  name="instructor"
                  defaultValue={filters.instructorRef ?? ""}
                  placeholder="Anyone"
                  options={instructors.map((person) => ({
                    value: person.ref,
                    label: `${person.firstName} ${person.lastName}`.trim(),
                  }))}
                />
              </Field>
              <Field id="filter-program" label="Program">
                <OptionSelect
                  id="filter-program"
                  name="program"
                  defaultValue={filters.programRef ?? ""}
                  placeholder="Any program"
                  options={programs.map((program) => ({
                    value: program.ref,
                    label: program.name,
                  }))}
                />
              </Field>
            </FilterSection>

            {/* Not a filter — a choice about the shape of the table. It rides
                with the rest because it rides in the same query string, and
                because the place somebody looks for it is here. */}
            <FilterSection legend="Columns">
              <ChoiceGroup
                legend="Show these columns"
                legendClassName="visually-hidden"
                hint={
                  <p className="hint">
                    Untick a column to hide it. The choice travels with the link, so a
                    filtered view can be shared as it is.
                  </p>
                }
              >
                {Object.entries(AVAILABLE_COLUMNS).map(([key, label]) => (
                  <Choice
                    key={key}
                    type="checkbox"
                    name="columns"
                    value={key}
                    defaultChecked={columns.includes(key)}
                    label={label}
                  />
                ))}
              </ChoiceGroup>
            </FilterSection>
          </FilterDrawer>
        }
      />

      {results.rows.length > 0 ? (
        <>
          <TableWrap caption={<>Sessions {firstIndex(results)} to {lastIndex(results)} of {results.total}</>}>
            <thead>
              <tr>
                {columns.map((key) => (
                  <th scope="col" key={key}>
                    {AVAILABLE_COLUMNS[key]}
                  </th>
                ))}
                <th scope="col">
                  <VisuallyHidden>Actions</VisuallyHidden>
                </th>
              </tr>
            </thead>
            <tbody>
              {results.rows.map((row) => (
                <tr key={String(row.session.id)}>
                  {columns.map((key) => (
                    <td data-label={AVAILABLE_COLUMNS[key]} key={key}>
                      <Cell column={key} row={row} zone={zone} />
                    </td>
                  ))}
                  <td data-label="Actions">
                    <LinkButton size="small" href={`/sessions/${row.session.ref}`}>
                      Open
                    </LinkButton>
                  </td>
                </tr>
              ))}
            </tbody>
          </TableWrap>

          <nav className="pagination" aria-label="Pagination">
            <p className="count">
              Showing {firstIndex(results)}–{lastIndex(results)} of {results.total}
            </p>
            <ButtonRow>
              {hasPrevious(results) && (
                <LinkButton size="small"
                  href={`/sessions?${toQuery(filters, { page: results.page - 1 })}`}
                  rel="prev"
                >
                  Previous
                </LinkButton>
              )}
              <span className="count">
                Page {results.page} of {pageCount(results)}
              </span>
              {hasNext(results) && (
                <LinkButton size="small"
                  href={`/sessions?${toQuery(filters, { page: results.page + 1 })}`}
                  rel="next"
                >
                  Next
                </LinkButton>
              )}
            </ButtonRow>
          </nav>
        </>
      ) : (
        <Card>
          <EmptyState
            heading="No sessions match these filters"
            message="Try widening the date range or clearing the status filter."
            glyph="≡"
          />
        </Card>
      )}
    </>
  );
}
