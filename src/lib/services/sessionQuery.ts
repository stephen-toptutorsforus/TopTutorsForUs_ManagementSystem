/**
 * Reading sessions: the grid, the calendar, and the series list.
 *
 * Ported from `app/services/session_query.py`.
 *
 * Every query starts from `scoped()`, so the tenant filter is part of the
 * statement rather than something applied afterwards and occasionally
 * forgotten. Visibility narrows further for people who may only see their own
 * sessions: that narrowing happens **in SQL**, not by filtering a full result
 * set afterwards, because a page of results filtered after the fact still
 * discloses the total count and still costs the database the full scan.
 *
 * Filters are parsed from query parameters and echoed back, which is what lets
 * the grid's state live in the URL — shareable, bookmarkable, and survivable
 * across a back button.
 */

import type { Prisma } from "@/generated/prisma/client";
import { AttendanceStatus, ParticipantRole, SessionStatus } from "@/generated/prisma/enums";
import { narrowsByStatus } from "@/lib/calendar";
import type { Db } from "@/lib/db";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { scoped } from "@/lib/policies/scoping";
import { readableQuery } from "@/lib/urlState";
import { Moment } from "@/lib/rendering";
import { PRESENT_STATES, actualDurationMinutes, scheduledDurationMinutes } from "@/lib/services/sessionOps";
import { type CivilDate, addDays, civilDate, resolveCivil } from "@/lib/time";

export const PAGE_SIZE = 25;

/**
 * Far past any real result set, and small enough that `page * PAGE_SIZE` stays
 * an ordinary number. A page beyond the last one renders empty, which is the
 * right answer for a number somebody typed.
 */
export const MAX_PAGE = 1_000_000;

/**
 * The columns the grid can show. Anything not here cannot be requested, so a
 * crafted `columns=` parameter cannot surface a field the product does not
 * intend to display.
 */
export const AVAILABLE_COLUMNS: Record<string, string> = {
  title: "Title",
  instructor: "Instructor",
  students: "Students",
  location: "Location",
  billable: "Billable",
  payment: "Payment",
  invoice: "Invoice",
  status: "Status",
  attendance: "Attendance",
  scheduled_start: "Scheduled start",
  scheduled_duration: "Scheduled duration",
  actual_duration: "Actual duration",
  subject: "Subject",
  grade: "Grade",
};

export const DEFAULT_COLUMNS: readonly string[] = [
  "title",
  "instructor",
  "students",
  "status",
  "scheduled_start",
  "scheduled_duration",
  "attendance",
];

/** The grid's state. Round-trips through the query string. */
export interface SessionFilters {
  search: string;
  statuses: readonly SessionStatus[];
  dateFrom: CivilDate | null;
  dateTo: CivilDate | null;
  instructorRef: string | null;
  programRef: string | null;
  page: number;
  columns: readonly string[];
}

export const EMPTY_FILTERS: SessionFilters = {
  search: "",
  statuses: [],
  dateFrom: null,
  dateTo: null,
  instructorRef: null,
  programRef: null,
  page: 1,
  columns: DEFAULT_COLUMNS,
};

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value: string | null | undefined): CivilDate | null {
  if (!value || !CIVIL_DATE.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10) === value ? value : null;
}

/** Read filters from query parameters, ignoring anything unrecognised. */
export function parseFilters(params: URLSearchParams): SessionFilters {
  const known = Object.values(SessionStatus) as string[];
  const statuses: SessionStatus[] = [];
  // One comma-joined parameter or several — the checkbox forms submit one per
  // status and the links write them joined, and both have to read the same.
  for (const raw of params.getAll("status").flatMap((chunk) => chunk.split(","))) {
    const match = known.find((status) => status === raw || status.toLowerCase() === raw);
    // An unknown status is dropped, not an error.
    if (match !== undefined) statuses.push(match as SessionStatus);
  }

  // Columns arrive either as repeated checkbox values (the form, which works
  // without JavaScript) or as one comma-separated value (a shared link).
  const rawColumns = params.getAll("columns").flatMap((chunk) => chunk.split(","));
  const requested = [...new Set(rawColumns)].filter((column) => column in AVAILABLE_COLUMNS);

  // Bounded at both ends. Without an upper bound a twenty-digit page number
  // becomes an OFFSET past the range of a bigint, and Postgres refuses the
  // query rather than returning an empty page — a 500 that any signed-in person
  // could produce from the address bar.
  const requestedPage = Number.parseInt(params.get("page") ?? "1", 10);
  const page = Number.isFinite(requestedPage)
    ? Math.min(MAX_PAGE, Math.max(1, requestedPage))
    : 1;

  return {
    search: (params.get("q") ?? "").trim().slice(0, 100),
    statuses,
    dateFrom: parseDate(params.get("from")),
    dateTo: parseDate(params.get("to")),
    instructorRef: (params.get("instructor") ?? "").trim() || null,
    programRef: (params.get("program") ?? "").trim() || null,
    page,
    columns: requested.length > 0 ? requested : DEFAULT_COLUMNS,
  };
}

/**
 * How many filters are set.
 *
 * Drawn on the filter button, so a narrowed grid says so even when the toolbar
 * has scrolled away. Each parameter counts once however many values it holds:
 * three ticked statuses are one decision about status, and the chosen columns
 * are one decision about the shape of the table rather than five filters.
 *
 * `page` is not a filter. It is where you are in the answer, not part of the
 * question — which is the distinction a shared header must never try to make
 * for itself.
 */
export function activeSessionFilters(filters: SessionFilters): number {
  return [
    filters.search !== "",
    // A full set of ticks is the resting state of the menu, not a decision, so
    // it does not light the badge — see `lib/selection.ts`.
    narrowsByStatus(filters.statuses),
    filters.dateFrom !== null,
    filters.dateTo !== null,
    filters.instructorRef !== null,
    filters.programRef !== null,
    !sameColumns(filters.columns, DEFAULT_COLUMNS),
  ].filter(Boolean).length;
}

/** Serialise back to a query string so links preserve the filters. */
export function toQuery(
  filters: SessionFilters,
  overrides: Record<string, string | number | readonly string[] | null> = {},
): string {
  const params = new URLSearchParams();
  const merged: Record<string, string | number | readonly string[] | null> = {
    q: filters.search,
    // Joined, not repeated: `status=scheduled,missed` says what
    // `status=scheduled&status=missed` says in half the address. `columns` has
    // always been written this way; this is the rest catching up.
    //
    // A complete set is written as nothing, for the same reason the default
    // columns are: it is what the address already means when it says nothing.
    status: narrowsByStatus(filters.statuses)
      ? filters.statuses.map((status) => status.toLowerCase()).join(",")
      : "",
    from: filters.dateFrom ?? "",
    to: filters.dateTo ?? "",
    instructor: filters.instructorRef ?? "",
    program: filters.programRef ?? "",
    page: filters.page,
    columns:
      sameColumns(filters.columns, DEFAULT_COLUMNS) ? "" : filters.columns.join(","),
    ...overrides,
  };

  for (const [key, value] of Object.entries(merged)) {
    if (Array.isArray(value)) {
      for (const item of value) params.append(key, String(item));
    } else if (value !== "" && value !== null && value !== 1) {
      params.append(key, String(value));
    }
  }
  return readableQuery(params);
}

/**
 * Whether two column lists hold the same columns.
 *
 * As a set, not as a sequence. Nothing in the interface reorders columns — the
 * drawer offers a tick per column and nothing else — so the order a list
 * arrives in is an accident of the markup rather than a choice somebody made.
 * It compared as a sequence, and the drawer renders its boxes in
 * `AVAILABLE_COLUMNS` order while `DEFAULT_COLUMNS` ends in a different one, so
 * opening the drawer and pressing Apply wrote out a full column list and lit
 * the filter count: a filter nobody had set, on every visit to the panel.
 */
function sameColumns(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const held = new Set(b);
  return a.every((column) => held.has(column));
}

export type OccurrenceRow = Prisma.SessionOccurrenceGetPayload<object>;

/**
 * One grid row, already resolved for display.
 *
 * A view model rather than the row itself, so a component cannot reach through
 * a relationship and emit an unscoped query per row.
 */
export interface SessionRow {
  session: OccurrenceRow;
  instructorName: string | null;
  studentNames: string[];
  locationName: string | null;
  subjectName: string | null;
  gradeName: string | null;
  attendanceRate: number | null;
  /**
   * Whether anybody has judged a student on this session yet.
   *
   * Not `attendanceRate !== null`, which is a different question and answers
   * this one wrongly twice: a session whose students are all *excused* has had
   * its attendance recorded and no rate, because an authorised absence leaves
   * the denominator, and a session with no students has neither. This asks only
   * whether a mark exists.
   *
   * Free: `decorate` already reads every participant's `attendance` to work out
   * the rate, so this is the same rows counted a second way rather than a
   * second query.
   */
  attendanceRecorded: boolean;
  seriesPosition: string | null;
}

export interface SessionPage {
  rows: SessionRow[];
  total: number;
  page: number;
  pageSize: number;
}

export function pageCount(page: SessionPage): number {
  return Math.max(1, Math.ceil(page.total / page.pageSize));
}

export function hasPrevious(page: SessionPage): boolean {
  return page.page > 1;
}

export function hasNext(page: SessionPage): boolean {
  return page.page < pageCount(page);
}

export function firstIndex(page: SessionPage): number {
  return page.total === 0 ? 0 : (page.page - 1) * page.pageSize + 1;
}

export function lastIndex(page: SessionPage): number {
  return Math.min(page.page * page.pageSize, page.total);
}

/**
 * The base `where` clause: tenant-scoped, then narrowed by what this person
 * sees.
 *
 * Someone with `SESSION_VIEW_ANY` sees the tenant. Everyone else sees only
 * sessions they are on, plus — for a guardian — those of the children they are
 * linked to. Expressed as nested relation filters so the narrowing happens in
 * the database.
 */
export function visibleSessions(principal: Principal): Prisma.SessionOccurrenceWhereInput {
  const base: Prisma.SessionOccurrenceWhereInput = {
    ...scoped(principal),
    archivedAt: null,
  };
  if (principal.has(P.SESSION_VIEW_ANY)) return base;

  return {
    ...base,
    OR: [
      { instructorId: principal.userId },
      {
        participants: {
          some: {
            organizationId: principal.organizationId,
            OR: [
              { userId: principal.userId },
              {
                user: {
                  guardedBy: {
                    some: {
                      guardianId: principal.userId,
                      organizationId: principal.organizationId,
                    },
                  },
                },
              },
            ],
          },
        },
      },
    ],
  };
}

/**
 * Narrow by the grid's filters.
 *
 * Date bounds are civil dates in the viewer's zone converted to instants, so
 * "sessions on the 6th" means the 6th where the viewer is, not in UTC.
 */
export function applyFilters(
  where: Prisma.SessionOccurrenceWhereInput,
  filters: SessionFilters,
  zone: string,
): Prisma.SessionOccurrenceWhereInput {
  const narrowed: Prisma.SessionOccurrenceWhereInput = { ...where };

  if (filters.search) {
    narrowed.title = { contains: filters.search, mode: "insensitive" };
  }
  if (filters.statuses.length > 0) {
    narrowed.status = { in: [...filters.statuses] };
  }
  if (filters.dateFrom) {
    narrowed.scheduledEnd = {
      gt: resolveCivil(filters.dateFrom, "00:00", zone).instant,
    };
  }
  if (filters.dateTo) {
    narrowed.scheduledStart = {
      lt: resolveCivil(addDays(filters.dateTo, 1), "00:00", zone).instant,
    };
  }
  return narrowed;
}

/** A page of grid rows, with the names each row needs already resolved. */
export async function listSessions(
  db: Db,
  principal: Principal,
  filters: SessionFilters,
  options: { zone: string; limit?: number },
): Promise<SessionPage> {
  let where = applyFilters(visibleSessions(principal), filters, options.zone);

  if (filters.instructorRef) {
    const instructor = await db.user.findFirst({
      where: { ...scoped(principal), ref: filters.instructorRef },
      select: { id: true },
    });
    // A ref that resolves to nothing must narrow to nothing rather than being
    // ignored, or a mistyped link quietly widens the page to everybody.
    where = { ...where, instructorId: instructor ? instructor.id : -1n };
  }
  if (filters.programRef) {
    const program = await db.program.findFirst({
      where: { ...scoped(principal), ref: filters.programRef },
      select: { id: true },
    });
    where = { ...where, programId: program ? program.id : -1n };
  }

  const pageSize = options.limit ?? PAGE_SIZE;
  const [total, occurrences] = await Promise.all([
    db.sessionOccurrence.count({ where }),
    db.sessionOccurrence.findMany({
      where,
      orderBy: [{ scheduledStart: "desc" }, { id: "desc" }],
      take: pageSize,
      skip: (filters.page - 1) * pageSize,
    }),
  ]);

  return {
    rows: await decorate(db, occurrences),
    total,
    page: filters.page,
    pageSize,
  };
}

/**
 * Resolve names and attendance for a batch of sessions in a fixed number of
 * queries.
 *
 * A handful of lookups for the whole page rather than a handful per row: the
 * grid is the most-loaded screen in the product and N+1 here is felt
 * immediately.
 */
export async function decorate(
  db: Db,
  occurrences: readonly OccurrenceRow[],
): Promise<SessionRow[]> {
  if (occurrences.length === 0) return [];

  const ids = occurrences.map((occurrence) => occurrence.id);

  const participantRows = await db.sessionParticipant.findMany({
    where: { sessionId: { in: ids } },
    select: {
      sessionId: true,
      role: true,
      attendance: true,
      user: { select: { firstName: true, lastName: true } },
    },
  });

  const students = new Map<bigint, string[]>();
  const attendance = new Map<bigint, AttendanceStatus[]>();
  for (const row of participantRows) {
    if (row.role !== ParticipantRole.STUDENT) continue;
    const name = `${row.user.firstName} ${row.user.lastName}`.trim();
    if (!students.has(row.sessionId)) students.set(row.sessionId, []);
    if (!attendance.has(row.sessionId)) attendance.set(row.sessionId, []);
    students.get(row.sessionId)!.push(name);
    attendance.get(row.sessionId)!.push(row.attendance);
  }

  const idsOf = (pick: (o: OccurrenceRow) => bigint | null) =>
    [...new Set(occurrences.map(pick).filter((id): id is bigint => id !== null))];

  const [instructors, locations, subjects, grades, seriesTotals] = await Promise.all([
    peopleNames(db, idsOf((o) => o.instructorId)),
    namedRows(db.location, idsOf((o) => o.locationId)),
    namedRows(db.subject, idsOf((o) => o.subjectId)),
    namedRows(db.grade, idsOf((o) => o.gradeId)),
    seriesOccurrenceTotals(db, idsOf((o) => o.seriesId)),
  ]);

  return occurrences.map((occurrence) => ({
    session: occurrence,
    instructorName:
      occurrence.instructorId === null
        ? null
        : (instructors.get(occurrence.instructorId) ?? null),
    studentNames: students.get(occurrence.id) ?? [],
    locationName:
      occurrence.locationId === null ? null : (locations.get(occurrence.locationId) ?? null),
    subjectName:
      occurrence.subjectId === null ? null : (subjects.get(occurrence.subjectId) ?? null),
    gradeName: occurrence.gradeId === null ? null : (grades.get(occurrence.gradeId) ?? null),
    attendanceRate: rateOf(attendance.get(occurrence.id) ?? []),
    attendanceRecorded: (attendance.get(occurrence.id) ?? []).some(
      (status) => status !== AttendanceStatus.UNMARKED,
    ),
    seriesPosition:
      occurrence.seriesId !== null &&
      occurrence.seriesIndex !== null &&
      seriesTotals.has(occurrence.seriesId)
        ? `${occurrence.seriesIndex} of ${seriesTotals.get(occurrence.seriesId)}`
        : null,
  }));
}

function rateOf(marks: readonly AttendanceStatus[]): number | null {
  const counted = marks.filter(
    (mark) => mark !== AttendanceStatus.EXCUSED && mark !== AttendanceStatus.UNMARKED,
  );
  if (counted.length === 0) return null;
  return counted.filter((mark) => PRESENT_STATES.includes(mark)).length / counted.length;
}

async function peopleNames(db: Db, ids: bigint[]): Promise<Map<bigint, string>> {
  if (ids.length === 0) return new Map();
  const rows = await db.user.findMany({
    where: { id: { in: ids } },
    select: { id: true, firstName: true, lastName: true },
  });
  return new Map(rows.map((row) => [row.id, `${row.firstName} ${row.lastName}`.trim()]));
}

/** Any delegate whose model carries `id` and `name`. */
type NamedDelegate = {
  findMany(args: {
    where: { id: { in: bigint[] } };
    select: { id: true; name: true };
  }): Promise<{ id: bigint; name: string }[]>;
};

async function namedRows(
  delegate: NamedDelegate,
  ids: bigint[],
): Promise<Map<bigint, string>> {
  if (ids.length === 0) return new Map();
  const rows = await delegate.findMany({
    where: { id: { in: ids } },
    select: { id: true, name: true },
  });
  return new Map(rows.map((row) => [row.id, row.name]));
}

async function seriesOccurrenceTotals(
  db: Db,
  seriesIds: bigint[],
): Promise<Map<bigint, number>> {
  if (seriesIds.length === 0) return new Map();
  const rows = await db.sessionOccurrence.groupBy({
    by: ["seriesId"],
    where: { seriesId: { in: seriesIds }, archivedAt: null },
    _count: { _all: true },
  });
  return new Map(
    rows
      .filter((row): row is typeof row & { seriesId: bigint } => row.seriesId !== null)
      .map((row) => [row.seriesId, row._count._all]),
  );
}

// --- Calendar --------------------------------------------------------------

/**
 * Sessions between two civil dates, bucketed by civil date in `zone`.
 *
 * `first` and `last` are inclusive calendar dates as the viewer sees them.
 * Bucketing by the UTC date instead would put a 20:00 New York session on the
 * following day all year round, which is the most common calendar bug there is
 * in a scheduling product.
 *
 * The same filters the grid uses are applied here, so the search box and the
 * status filter behave identically on both screens rather than being two
 * implementations that drift.
 */
export async function calendarRange(
  db: Db,
  principal: Principal,
  options: {
    first: CivilDate;
    last: CivilDate;
    zone: string;
    filters?: SessionFilters | null;
  },
): Promise<Map<CivilDate, SessionRow[]>> {
  const { first, last, zone, filters = null } = options;
  const windowStart = resolveCivil(first, "00:00", zone).instant;
  const windowEnd = resolveCivil(addDays(last, 1), "00:00", zone).instant;

  const where: Prisma.SessionOccurrenceWhereInput = {
    ...visibleSessions(principal),
    scheduledStart: { gte: windowStart, lt: windowEnd },
  };
  if (filters !== null) {
    if (filters.search) where.title = { contains: filters.search, mode: "insensitive" };
    if (filters.statuses.length > 0) where.status = { in: [...filters.statuses] };
  }

  const occurrences = await db.sessionOccurrence.findMany({
    where,
    orderBy: { scheduledStart: "asc" },
  });

  const buckets = new Map<CivilDate, SessionRow[]>();
  for (const row of await decorate(db, occurrences)) {
    const day = civilDate(row.session.scheduledStart, zone);
    if (!buckets.has(day)) buckets.set(day, []);
    buckets.get(day)!.push(row);
  }
  return buckets;
}

// --- Series ----------------------------------------------------------------

export type SeriesRecord = Prisma.SessionSeriesGetPayload<object>;

/** A series with the occurrence counts the list is expected to show. */
export interface SeriesRow {
  series: SeriesRecord;
  instructorName: string | null;
  firstDate: Date | null;
  lastDate: Date | null;
  total: number;
  scheduled: number;
  completed: number;
  missed: number;
  cancelled: number;
  late: number;
}

/**
 * The series list.
 *
 * Takes no zone: the dates it returns are instants, and the caller formats them
 * in whatever zone the viewer reads. The reference's signature takes one and
 * does not use it either; leaving it out here rather than carrying an
 * unused parameter forward.
 */
export async function listSeries(db: Db, principal: Principal): Promise<SeriesRow[]> {
  if (!principal.hasAny(P.SESSION_VIEW_ANY, P.SESSION_VIEW_OWN)) {
    principal.require(P.SESSION_VIEW_ANY);
  }

  const where: Prisma.SessionSeriesWhereInput = { ...scoped(principal), archivedAt: null };
  if (!principal.has(P.SESSION_VIEW_ANY)) {
    where.defaultInstructorId = principal.userId;
  }

  const allSeries = await db.sessionSeries.findMany({ where, orderBy: { id: "desc" } });
  if (allSeries.length === 0) return [];

  const ids = allSeries.map((series) => series.id);

  const counts = await db.sessionOccurrence.groupBy({
    by: ["seriesId", "status"],
    where: { seriesId: { in: ids }, archivedAt: null },
    _count: { _all: true },
    _min: { scheduledStart: true },
    _max: { scheduledStart: true },
  });

  // Sessions with at least one late participant, counted once each. Prisma has
  // no COUNT(DISTINCT) in groupBy, so the distinct ids are gathered and tallied
  // here — the set is one series' worth of sessions, not a scan.
  const lateSessions = await db.sessionOccurrence.findMany({
    where: {
      seriesId: { in: ids },
      participants: { some: { attendance: AttendanceStatus.LATE } },
    },
    select: { id: true, seriesId: true },
  });
  const lateCounts = new Map<bigint, number>();
  for (const row of lateSessions) {
    if (row.seriesId === null) continue;
    lateCounts.set(row.seriesId, (lateCounts.get(row.seriesId) ?? 0) + 1);
  }

  interface Tally {
    total: number;
    first: Date | null;
    last: Date | null;
    byStatus: Map<SessionStatus, number>;
  }
  const tally = new Map<bigint, Tally>();
  for (const row of counts) {
    if (row.seriesId === null) continue;
    if (!tally.has(row.seriesId)) {
      tally.set(row.seriesId, { total: 0, first: null, last: null, byStatus: new Map() });
    }
    const node = tally.get(row.seriesId)!;
    node.total += row._count._all;
    node.byStatus.set(row.status, row._count._all);
    const earliest = row._min.scheduledStart;
    const latest = row._max.scheduledStart;
    if (earliest && (node.first === null || earliest < node.first)) node.first = earliest;
    if (latest && (node.last === null || latest > node.last)) node.last = latest;
  }

  const instructors = await peopleNames(
    db,
    [
      ...new Set(
        allSeries
          .map((series) => series.defaultInstructorId)
          .filter((id): id is bigint => id !== null),
      ),
    ],
  );

  return allSeries.map((series) => {
    const node = tally.get(series.id);
    const byStatus = node?.byStatus ?? new Map<SessionStatus, number>();
    return {
      series,
      instructorName:
        series.defaultInstructorId === null
          ? null
          : (instructors.get(series.defaultInstructorId) ?? null),
      firstDate: node?.first ?? null,
      lastDate: node?.last ?? null,
      total: node?.total ?? 0,
      scheduled: byStatus.get(SessionStatus.SCHEDULED) ?? 0,
      completed: byStatus.get(SessionStatus.COMPLETED) ?? 0,
      missed: byStatus.get(SessionStatus.MISSED) ?? 0,
      cancelled: byStatus.get(SessionStatus.CANCELLED) ?? 0,
      late: lateCounts.get(series.id) ?? 0,
    };
  });
}

// --- Export ----------------------------------------------------------------

/**
 * Render a page of rows as CSV.
 *
 * The caller checks `EXPORT_SESSIONS` first — export is a separate permission
 * because reading a screenful and taking the whole list away are different
 * acts, and only the second is worth auditing.
 */
export function toCsv(
  rows: readonly SessionRow[],
  columns: readonly string[],
  zone: string,
): string {
  const lines: string[] = [];
  lines.push(csvRow([...columns.map((column) => AVAILABLE_COLUMNS[column] ?? ""), "Reference"]));

  for (const row of rows) {
    const occurrence = row.session;
    const values = columns.map((column) => {
      switch (column) {
        case "title":
          return occurrence.title;
        case "instructor":
          return row.instructorName ?? "";
        case "students":
          return row.studentNames.join("; ");
        case "location":
          return row.locationName ?? "";
        case "billable":
          return occurrence.billable ? "yes" : "no";
        case "payment":
          return occurrence.paymentState;
        case "invoice":
          return occurrence.invoiceRef ?? "";
        case "status":
          return occurrence.status.toLowerCase();
        case "attendance":
          return row.attendanceRate === null
            ? ""
            : `${Math.round(row.attendanceRate * 100)}%`;
        case "scheduled_start":
          return new Moment(occurrence.scheduledStart, zone).full;
        case "scheduled_duration":
          return String(scheduledDurationMinutes(occurrence));
        case "actual_duration": {
          const actual = actualDurationMinutes(occurrence);
          return actual === null ? "" : String(actual);
        }
        case "subject":
          return row.subjectName ?? "";
        case "grade":
          return row.gradeName ?? "";
        default:
          return "";
      }
    });
    // The public ref, never the database id.
    lines.push(csvRow([...values, occurrence.ref]));
  }

  return `${lines.join("\n")}\n`;
}

/**
 * RFC 4180 quoting, written out rather than pulled in.
 *
 * A title containing a comma, a quote, or a newline is ordinary — "Algebra,
 * revision" is a name somebody will type — and an export that splits into the
 * wrong columns on one of them is worse than no export.
 */
function csvRow(values: readonly string[]): string {
  return values
    .map((value) => {
      const text = value ?? "";
      return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    })
    .join(",");
}
