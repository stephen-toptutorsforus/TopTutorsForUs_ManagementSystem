/**
 * An instructor's declared availability.
 *
 * Ported from `availability_view` in `app/web/views.py` and
 * `app/templates/availability.html`.
 *
 * Windows are stated as wall-clock time in a named zone, so they hold across
 * daylight-saving changes rather than drifting by an hour twice a year.
 */

import { AddWindowForm } from "@/components/availability/AddWindowForm";
import { Button, Card, EmptyState, Field, PageHead, TableWrap, VisuallyHidden } from "@/components/ui";
import { prisma } from "@/lib/db";
import { matrix } from "@/lib/availability";
import { Permission } from "@/lib/policies/permissions";
import { scoped } from "@/lib/policies/scoping";
import { WEEKDAY_LABELS } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import { civilDate, timeFromDb } from "@/lib/time";
import { csrfToken, requireContext } from "@/lib/web/session";
import { guard } from "@/lib/web/interrupt";

export const metadata = { title: "Availability · TopTutorsForUs" };
export const dynamic = "force-dynamic";

const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

function dayLabel(day: string): string {
  const parsed = new Date(`${day}T00:00:00Z`);
  const dow = DOW_SHORT[(parsed.getUTCDay() + 6) % 7];
  return `${dow} ${parsed.getUTCDate()} ${MONTHS_SHORT[parsed.getUTCMonth()]}`;
}

export default async function AvailabilityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { principal, organization } = await requireContext();
  if (!principal.has(Permission.AVAILABILITY_VIEW_ANY)) {
    await guard(async () => principal.require(Permission.AVAILABILITY_VIEW_OWN));
  }

  const roster = await prisma.user.findMany({
    where: {
      ...scoped(principal),
      archivedAt: null,
      roles: { some: { role: "INSTRUCTOR" } },
    },
    select: { id: true, ref: true, firstName: true, lastName: true },
    orderBy: { lastName: "asc" },
  });

  const asked = String((await searchParams).instructor ?? "");
  let instructor =
    asked && principal.has(Permission.AVAILABILITY_VIEW_ANY)
      ? await prisma.user.findFirst({
          where: { ...scoped(principal), ref: asked, archivedAt: null },
          select: { id: true, ref: true, firstName: true, lastName: true },
        })
      : null;

  if (instructor === null) {
    instructor =
      (await prisma.user.findUnique({
        where: { id: principal.userId },
        select: { id: true, ref: true, firstName: true, lastName: true },
      })) ?? null;
    // An administrator is not an instructor, so defaulting to "me" opened a
    // page about somebody with no availability to declare — while the picker,
    // finding no option matching them, displayed its first instructor instead.
    // The screen named one person and the form targeted another.
    if (roster.length > 0 && !roster.some((person) => person.id === instructor?.id)) {
      instructor = roster[0]!;
    }
  }
  if (instructor === null) throw new Error("no principal to show availability for");

  const zone = principal.timezone;
  const days = await matrix(prisma, organization, instructor.id, civilDate(new Date(), zone), 14);
  const rules = await prisma.availabilityRule.findMany({
    where: { ...scoped(principal), instructorId: instructor.id },
    orderBy: [{ weekday: "asc" }, { startTime: "asc" }],
  });

  const displayName = `${instructor.firstName} ${instructor.lastName}`.trim() || instructor.ref;
  // Nothing to edit when the tenant has no instructors yet: the form would have
  // no valid target, and the action refuses one.
  const canEdit =
    roster.length > 0 &&
    (principal.has(Permission.AVAILABILITY_EDIT_ANY) ||
      instructor.id === principal.userId);

  return (
    <>
      <PageHead title="Availability" subtitle={<>{displayName} · windows are stated as wall-clock time in {zone}, so they hold
            across daylight-saving changes.</>} />

      {roster.length > 1 && (
        <Card as="form" method="get" action="/availability">
          <div className="filters">
            <Field id="instructor" label="Show availability for" className="grow">
              <select id="instructor" name="instructor" defaultValue={instructor.ref}>
                {roster.map((person) => (
                  <option value={person.ref} key={person.ref}>
                    {`${person.firstName} ${person.lastName}`.trim() || person.ref}
                  </option>
                ))}
              </select>
                        </Field>
            <Button type="submit">
              Show
            </Button>
          </div>
        </Card>
      )}

      <Card>
        <h2>Next two weeks</h2>
        <div className="matrix">
          {days.map((day) => (
            <div
              className={`matrix-day ${day.windows.length === 0 ? "is-closed" : ""}`}
              key={day.day}
            >
              <p className="dow">{dayLabel(day.day)}</p>
              {day.windows.length > 0 ? (
                day.windows.map((window) => (
                  <p className="slot" key={window.start.toISOString()}>
                    {new Moment(window.start, zone).time}–{new Moment(window.end, zone).time}
                  </p>
                ))
              ) : (
                <p className="slot">
                  <span aria-hidden="true">—</span>{" "}
                  <VisuallyHidden>Unavailable:</VisuallyHidden>{" "}
                  {day.closedReason ?? "unavailable"}
                </p>
              )}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2>Weekly pattern</h2>
        {rules.length > 0 ? (
          <TableWrap caption="Recurring availability windows">
            <thead>
              <tr>
                <th scope="col">Weekday</th>
                <th scope="col">From</th>
                <th scope="col">To</th>
                <th scope="col">Timezone</th>
              </tr>
            </thead>
            <tbody>
              {rules.map((rule) => (
                <tr key={String(rule.id)}>
                  <td data-label="Weekday">
                    {WEEKDAY_LABELS[rule.weekday] ?? rule.weekday}
                  </td>
                  <td data-label="From">{timeFromDb(rule.startTime)}</td>
                  <td data-label="To">{timeFromDb(rule.endTime)}</td>
                  <td data-label="Timezone">{rule.timezone || organization.timezone}</td>
                </tr>
              ))}
            </tbody>
          </TableWrap>
        ) : (
          <EmptyState
            heading="No availability declared"
            message="Add a weekly window below so this instructor can be booked."
            glyph="◷"
          />
        )}

        {canEdit && (
          <AddWindowForm instructorRef={instructor.ref} csrfToken={await csrfToken()} />
        )}
      </Card>
    </>
  );
}
