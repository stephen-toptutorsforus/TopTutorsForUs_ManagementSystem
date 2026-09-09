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

import { AnchorButton, Button, ButtonRow, Card, EmptyState, Field, LinkButton, MoreFilters, PageHeader, PageToolbar, StatusBadge, TableWrap, Tag, VisuallyHidden, When } from "@/components/ui";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { durationLabel, percent, statusFilterOptions } from "@/lib/presentation";
import { actualDurationMinutes, scheduledDurationMinutes } from "@/lib/services/sessionOps";
import { FilterMenu } from "@/components/FilterMenu";
import {
  AVAILABLE_COLUMNS,
  DEFAULT_COLUMNS,
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

  // What "More filters" says it is holding. The page counts it, not the
  // component: knowing that a date range is a filter and a page number is not
  // is exactly the kind of thing a shared header should never have an opinion
  // about. Columns count as one however many are ticked — it is a single
  // choice about the shape of the table, not five filters.
  const advancedActive =
    [filters.dateFrom, filters.dateTo, filters.instructorRef, filters.programRef].filter(
      (value) => value !== null && value !== "",
    ).length + (columns.join(",") === DEFAULT_COLUMNS.join(",") ? 0 : 1);

  return (
    <>
      <PageHeader
        title="Sessions"
        subtitle={<>All times in {zone}</>}
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
            form={{ action: "/sessions", label: "Search and filter sessions", role: "search" }}
            filters={
              <>
                <Field
                  id="q"
                  label="Search titles"
                  className="page-toolbar-search"
                  labelClassName="visually-hidden"
                >
                  <input
                    id="q"
                    name="q"
                    type="search"
                    defaultValue={filters.search}
                    placeholder="Session title"
                  />
                </Field>

                {/* The same control the calendar and the directory use, and the
                    same repeated `status=` parameters the checkbox row it
                    replaces submitted. `applyOnClose` is off because this form
                    has five other filters and an Apply of its own. */}
                <FilterMenu
                  name="status"
                  options={statusFilterOptions()}
                  selected={filters.statuses.map((status) => status.toLowerCase())}
                  singular="status"
                  plural="statuses"
                  legend="Show these statuses"
                  applyOnClose={false}
                />

                <ButtonRow>
                  <Button variant="primary" type="submit">
                    Apply filters
                  </Button>
                  <LinkButton href="/sessions">
                    Clear
                  </LinkButton>
                </ButtonRow>
              </>
            }
            advancedFilters={
              <MoreFilters active={advancedActive}>
                <div className="page-toolbar-grid">
                  <Field id="from" label="From">
                    <input
                      id="from"
                      name="from"
                      type="date"
                      defaultValue={filters.dateFrom ?? ""}
                    />
                  </Field>
                  <Field id="to" label="To">
                    <input id="to" name="to" type="date" defaultValue={filters.dateTo ?? ""} />
                  </Field>
                  <Field id="instructor" label="Instructor">
                    <select
                      id="instructor"
                      name="instructor"
                      defaultValue={filters.instructorRef ?? ""}
                    >
                      <option value="">Anyone</option>
                      {instructors.map((person) => (
                        <option key={person.ref} value={person.ref}>
                          {`${person.firstName} ${person.lastName}`.trim()}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field id="program" label="Program">
                    <select
                      id="program"
                      name="program"
                      defaultValue={filters.programRef ?? ""}
                    >
                      <option value="">Any program</option>
                      {programs.map((program) => (
                        <option key={program.ref} value={program.ref}>
                          {program.name}
                        </option>
                      ))}
                    </select>
                  </Field>
                </div>

                <fieldset>
                  <legend>Columns</legend>
                  <div className="choice-row">
                    {Object.entries(AVAILABLE_COLUMNS).map(([key, label]) => (
                      <label className="choice" key={key}>
                        <input
                          type="checkbox"
                          name="columns"
                          value={key}
                          defaultChecked={columns.includes(key)}
                        />
                        <span>{label}</span>
                      </label>
                    ))}
                  </div>
                </fieldset>

                <p className="hint">
                  Untick a column to hide it. Everything here applies when you press Apply
                  filters, and travels with the link so a filtered view can be shared
                  as-is.
                </p>
              </MoreFilters>
            }
          />
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
