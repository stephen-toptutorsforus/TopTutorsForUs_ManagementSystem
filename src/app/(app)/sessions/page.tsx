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

import { AnchorButton, Button, ButtonRow, Card, Choice, ChoiceGroup, EmptyState, Field, FilterControl, FilterSection, LinkButton, OptionSelect, PageHeader, PageToolbar, SearchField, SearchInput, StatusBadge, TableWrap, Tag, VisuallyHidden, When } from "@/components/ui";
import { Role } from "@/generated/prisma/enums";
import { prisma } from "@/lib/db";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import {
  durationLabel,
  percent,
  statusFilterOptions,
  studentList,
} from "@/lib/presentation";
import { ticked } from "@/lib/selection";
import { actualDurationMinutes, scheduledDurationMinutes } from "@/lib/services/sessionOps";
import { FilterMenu } from "@/components/FilterMenu";
import {
  AVAILABLE_COLUMNS,
  activeSessionFilters,
  columnsFor,
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
import { applySessionFilters, resetSessionFilters } from "@/app/actions/filters";
import { StateFields } from "@/components/ui/StateFields";
import { readScreenState } from "@/lib/web/filterState";
import { personOptions } from "@/lib/web/options";
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
          <Link href={`/sessions/${session.ref}?from=%2Fsessions`}>{session.title}</Link>
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
      return <>{studentList(row.studentNames, row.studentCount) || "—"}</>;
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
      return <StatusBadge status={session.status} endsAt={session.scheduledEnd} />;
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

/**
 * Nothing here reads `searchParams`.
 *
 * The screen's filter arrives from its cookie — see `lib/web/filterState.ts`.
 * A page that still took the address as an input would be a second source for
 * the same state, and the two would disagree the moment anybody typed one.
 */
export default async function SessionsPage() {
  const { principal, organization } = await requireContext();
  const zone = principal.timezone;
  // From the screen's cookie, not the address.
  const filters = parseFilters(await readScreenState("sessions"));

  // The filter is the screen's cookie, serialised exactly as the address used
  // to hold it — see `lib/web/filterState.ts`. `toQuery` still says what the
  // canonical form is; it is only stored somewhere else now.
  const query = toQuery(filters);

  // The export takes the filters as they stand, and an unfiltered grid now
  // serialises to nothing at all — `export.csv?` is not a URL to hand a browser.
  const exportHref = query ? `/sessions/export.csv?${query}` : "/sessions/export.csv";

  const results = await listSessions(prisma, principal, filters, { zone });

  const [instructors, students, programs, schools] = await Promise.all([
    personOptions(prisma, principal, Role.INSTRUCTOR),
    personOptions(prisma, principal, Role.STUDENT),
    prisma.program.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.school.findMany({
      where: { ...scoped(principal), archivedAt: null },
      select: { ref: true, name: true },
      orderBy: { name: "asc" },
    }),
  ]);

  // Billable, Payment and Invoice are only worth a column where the tenant
  // charges for something, and `booking.billable_enabled` ships off. They stay
  // in the catalogue so an older `columns=` still parses; what narrows here is
  // what is offered and what is drawn, in step, because a header with no
  // meaning behind it is the same defect as a filter the query ignores.
  const offered = columnsFor(organization);
  const columns = filters.columns.filter((key) => key in offered);
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
          // Keyed by the filter that is applied, so the search box and the
          // status menu are remounted when it changes. Their fields are
          // uncontrolled — `defaultValue`, `defaultChecked` — and a re-render
          // from a server action leaves the DOM values a person typed exactly
          // where they were, which is right until the *other* form changes
          // them. Applying from the drawer used to be a navigation, which
          // rebuilt both.
          <PageToolbar
            key={query}
            menu={
              <FilterControl
                active={activeSessionFilters(filters)}
                reset={resetSessionFilters}
                action={applySessionFilters}
              >
            <FilterSection legend="Sessions">
              <Field id="filter-q" label="Search titles">
                <SearchInput
                  id="filter-q"
                  name="q"
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
                  options={instructors}
                />
              </Field>
              <Field id="filter-student" label="Student">
                <OptionSelect
                  id="filter-student"
                  name="student"
                  defaultValue={filters.studentRef ?? ""}
                  placeholder="Anyone"
                  options={students}
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
              {schools.length > 0 && (
                <Field id="filter-school" label="School">
                  <OptionSelect
                    id="filter-school"
                    name="school"
                    defaultValue={filters.schoolRef ?? ""}
                    placeholder="Any school"
                    options={schools.map((school) => ({
                      value: school.ref,
                      label: school.name,
                    }))}
                  />
                </Field>
              )}
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
                {Object.entries(offered).map(([key, label]) => (
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
              </FilterControl>
            }
            form={{
              action: applySessionFilters,
              label: "Search and filter sessions",
              role: "search",
            }}
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
                />
              </>
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
                    <LinkButton size="small" href={`/sessions/${row.session.ref}?from=%2Fsessions`}>
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
            {/* Two submits rather than two links: a page number is state this
                screen holds, and holding it in the address is what changed.
                Each carries the whole filter, because the action stores what it
                is given — a form that submitted only a page would clear the
                filter on its way to page two. */}
            <ButtonRow as="form" action={applySessionFilters}>
              <StateFields state={new URLSearchParams(query)} omit={["page"]} />
              {hasPrevious(results) && (
                <Button
                  size="small"
                  type="submit"
                  name="page"
                  value={results.page - 1}
                  rel="prev"
                >
                  Previous
                </Button>
              )}
              <span className="count">
                Page {results.page} of {pageCount(results)}
              </span>
              {hasNext(results) && (
                <Button size="small" type="submit" name="page" value={results.page + 1} rel="next">
                  Next
                </Button>
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
