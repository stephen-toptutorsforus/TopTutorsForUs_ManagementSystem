/**
 * Where a block lands on the week grid, and which clock it is measured in.
 *
 * `build` had no unit test at all — `assignLanes` was exercised only through
 * the browser, and `minutesOf`, `label` and `focusRowFor` not at all. That gap
 * is why a real inconsistency sat here unnoticed: the grid *positions* every
 * block by the reader's zone and used to *print* the session's own zone inside
 * it, so a block could sit against a gutter reading 10 AM with "09:00" written
 * on it.
 *
 * Nothing in the product could produce that yet — no screen sets a personal
 * timezone and there is no organization settings screen, so the reader's zone
 * is always the tenant's — and no fixture anywhere makes the two differ, which
 * is the other half of why it was invisible. These cases make them differ on
 * purpose.
 *
 * The rule being pinned: a calendar shows your clock, a record shows its own.
 */

import { describe, expect, it } from "vitest";

import { DeliveryType, SessionStatus } from "@/generated/prisma/enums";
import type { SessionRow } from "@/lib/services/sessionQuery";
import { MINUTES_PER_DAY, SLOT_MINUTES, build, positionClass } from "@/lib/timegrid";
import type { CivilDate } from "@/lib/time";
import { resolveCivil } from "@/lib/time";

const NY = "America/New_York";
const CHICAGO = "America/Chicago";
const DAY = "2026-06-01" as CivilDate;

/**
 * One session, authored in `zone` at `time`, an hour long.
 *
 * `timezone` is the zone it was *booked* in, which is what the record screens
 * render and what the grid must stop rendering.
 */
function aRow(time: string, zone: string, hours = 1): SessionRow {
  const start = resolveCivil(DAY, time, zone).instant;
  const end = new Date(start.getTime() + hours * 60 * 60_000);
  return {
    session: {
      id: 1n,
      ref: "ses_test",
      title: "Fractions review",
      status: SessionStatus.SCHEDULED,
      deliveryType: DeliveryType.EXTERNAL_LINK,
      scheduledStart: start,
      scheduledEnd: end,
      timezone: zone,
      seriesId: null,
      seriesIndex: null,
    },
    instructorName: "Marguerite Okonjo",
    studentNames: ["Ada Fenwick"],
    studentCount: 1,
    locationName: null,
    subjectName: null,
    gradeName: null,
    attendanceRate: null,
    attendanceRecorded: false,
    seriesPosition: null,
  } as unknown as SessionRow;
}

const gridOf = (row: SessionRow, zone: string) =>
  build(new Map([[DAY, [row]]]), [DAY], zone);

describe("where a block lands", () => {
  it("covers the whole day at a fixed scale, whatever is on it", () => {
    // One week must never be drawn at a different scale from the next, so the
    // row count is midnight to midnight rather than the extent of the sessions.
    const grid = gridOf(aRow("09:00", NY), NY);
    expect(grid.slots).toHaveLength(MINUTES_PER_DAY / SLOT_MINUTES);
    expect(grid.slots[0]!.label).toBe("12 AM");
    expect(grid.slots[0]!.isHour).toBe(true);
    expect(grid.slots[1]!.isHour).toBe(false);
  });

  it("puts a nine o'clock session on the nine o'clock row", () => {
    // Rows are half hours and one-indexed: 9am is the nineteenth.
    const [placed] = gridOf(aRow("09:00", NY), NY).columns[0]!.placed;
    expect(placed!.startRow).toBe(19);
    expect(placed!.span).toBe(2);
  });

  it("measures a block in the reader's clock, not the one it was booked in", () => {
    // 09:00 Chicago is 10:00 in New York, so a New York reader's grid draws it
    // against their ten o'clock line. This is the placement half, and it has
    // always been right.
    const chicagoSession = aRow("09:00", CHICAGO);
    expect(gridOf(chicagoSession, CHICAGO).columns[0]!.placed[0]!.startRow).toBe(19);
    expect(gridOf(chicagoSession, NY).columns[0]!.placed[0]!.startRow).toBe(21);
  });

  it("keeps the gutter and the block on one clock", () => {
    // The half that was wrong. The label the reader sees beside the block comes
    // from the same axis the block was placed on, so the row a block starts in
    // and the hour written on that row cannot disagree.
    const grid = gridOf(aRow("09:00", CHICAGO), NY);
    const placed = grid.columns[0]!.placed[0]!;
    const gutter = grid.slots[placed.startRow - 1]!;
    expect(gutter.label).toBe("10 AM");
  });

  it("draws a session running past midnight to the end of its own day", () => {
    // Rather than wrapping into a column it does not belong to.
    const late = aRow("23:00", NY, 3);
    const placed = gridOf(late, NY).columns[0]!.placed[0]!;
    expect(placed.startRow).toBe(47);
    expect(placed.startRow + placed.span - 1).toBe(48);
  });

  it("names its position in classes, because inline positions are forbidden", () => {
    // `style-src 'self'` refuses a `style` attribute, which is why every row and
    // span resolves to a hand-written class — see the stylesheet.
    const placed = gridOf(aRow("09:00", NY), NY).columns[0]!.placed[0]!;
    expect(positionClass(placed)).toBe("r19 s2 lane-1-of-1");
  });
});
