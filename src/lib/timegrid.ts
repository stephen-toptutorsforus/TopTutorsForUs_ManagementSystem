/**
 * Laying sessions out on a time grid: dates across, time down.
 *
 * Ported from `app/web/timegrid.py`.
 *
 * The week and day views draw a column per date and a row per half hour, with
 * each session placed at its own start and drawn at its own length. That needs
 * geometry, and the geometry is computed here rather than in the component for
 * two reasons.
 *
 * The first is that it is arithmetic with edge cases — sessions that overlap,
 * that run past midnight, that start before or after the frame everyone else
 * sits in — and arithmetic tangled into markup cannot be tested.
 *
 * The second is the Content-Security-Policy. `style-src 'self'` means no inline
 * `style` attribute and no inline `<style>` block, so a position cannot be
 * written onto an element as a percentage. Everything therefore resolves to a
 * small, countable set of class names — a row, a span, and a lane — which the
 * stylesheet declares once. That is why spans are capped and lanes are capped:
 * an unbounded number would need an unbounded stylesheet.
 */

import type { SessionRow } from "@/lib/services/sessionQuery";
import { type CivilDate, toZone } from "@/lib/time";

export const SLOT_MINUTES = 30;
export const MINUTES_PER_DAY = 24 * 60;

/**
 * The grid draws the whole day, midnight to midnight, and scrolls. Cropping it
 * to working hours meant the hours outside them could not be reached at all —
 * and a session booked at seven in the morning is not an error to be hidden.
 *
 * It opens near the working day instead, since starting at midnight would put
 * every ordinary session below the fold. That is `focusRow`, which is a scroll
 * position and not a limit: everything above and below it is still there.
 */
export const FOCUS_HOUR = 7;

/**
 * Both caps exist because each distinct value needs its own class in the
 * stylesheet. Eight hours is longer than any session this platform will book —
 * the duration bounds top out well below it — and a fifth simultaneous session
 * in one column is past the point where a column is the right way to show them.
 */
export const MAX_SPAN_SLOTS = 16;
export const MAX_LANES = 4;

/** One half-hour row of the grid. */
export interface TimeSlot {
  row: number;
  label: string;
  isHour: boolean;
}

/**
 * One session, positioned. `startRow` and `span` are grid rows; `lane` splits
 * the column between sessions that overlap.
 */
export interface PlacedSession {
  row: SessionRow;
  startRow: number;
  span: number;
  lane: number;
  lanes: number;
}

export function positionClass(placed: PlacedSession): string {
  return `r${placed.startRow} s${placed.span} lane-${placed.lane}-of-${placed.lanes}`;
}

export interface GridColumn {
  day: CivilDate;
  placed: PlacedSession[];
}

export interface TimeGrid {
  slots: TimeSlot[];
  columns: GridColumn[];
  /**
   * The row to bring into view when the page opens. A scroll position, not a
   * crop — the hours above it are rendered and reachable.
   */
  focusRow: number;
}

export function gridRows(grid: TimeGrid): number {
  return grid.slots.length;
}

export function gridIsEmpty(grid: TimeGrid): boolean {
  return !grid.columns.some((column) => column.placed.length > 0);
}

function minutesOf(instant: Date, zone: string): number {
  const local = toZone(instant, zone);
  return local.hour * 60 + local.minute;
}

function label(minute: number): string {
  const hour = Math.floor(minute / 60) % 24;
  const mins = minute % 60;
  const display = hour % 12 || 12;
  const suffix = hour < 12 ? "AM" : "PM";
  return mins === 0
    ? `${display} ${suffix}`
    : `${display}:${String(mins).padStart(2, "0")} ${suffix}`;
}

/**
 * Which row to open on: the earliest session, or the working day if there is
 * none. Never later than the working day, so an evening-only week still opens
 * somewhere recognisable rather than scrolled to the evening.
 */
function focusRowFor(spans: readonly (readonly [number, number])[]): number {
  const earliest = spans.length === 0 ? FOCUS_HOUR * 60 : Math.min(...spans.map((s) => s[0]));
  const minute = Math.min(earliest, FOCUS_HOUR * 60);
  return Math.max(1, Math.floor(minute / SLOT_MINUTES) + 1);
}

/**
 * Split overlapping sessions across lanes, returning `[lane, lanes]` each.
 *
 * Sessions are grouped into clusters of mutual overlap, and every session in a
 * cluster is told the cluster's width — so two sessions that clash are each
 * drawn at half width and sit side by side, rather than one hiding the other. A
 * session alone in its cluster keeps the full column.
 */
export function assignLanes(
  spans: readonly (readonly [number, number])[],
): [number, number][] {
  const order = spans
    .map((_, index) => index)
    .sort((a, b) => spans[a]![0] - spans[b]![0] || spans[a]![1] - spans[b]![1]);

  const result: [number, number][] = spans.map(() => [1, 1]);
  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let laneOf = new Map<number, number>();

  const close = () => {
    const width = Math.min(Math.max(laneEnds.length, 1), MAX_LANES);
    for (const member of cluster) {
      result[member] = [Math.min(laneOf.get(member) ?? 1, width), width];
    }
    cluster = [];
    laneEnds = [];
    laneOf = new Map();
  };

  for (const index of order) {
    const [start, end] = spans[index]!;
    if (cluster.length > 0 && start >= Math.max(...laneEnds)) close();

    let placed = false;
    for (const [lane, laneEnd] of laneEnds.entries()) {
      if (laneEnd <= start) {
        laneEnds[lane] = end;
        laneOf.set(index, lane + 1);
        placed = true;
        break;
      }
    }
    if (!placed) {
      laneEnds.push(end);
      laneOf.set(index, laneEnds.length);
    }
    cluster.push(index);
  }
  close();
  return result;
}

/**
 * Place every session in `days` onto one shared time axis.
 *
 * One axis for the whole grid, not one per column: columns whose rows meant
 * different times would make the week unreadable at a glance, which is the only
 * thing this view is for.
 */
export function build(
  buckets: Map<CivilDate, SessionRow[]>,
  days: readonly CivilDate[],
  zone: string,
): TimeGrid {
  const perDay: { day: CivilDate; rows: SessionRow[]; spans: [number, number][] }[] = [];
  const everything: [number, number][] = [];

  for (const day of days) {
    const rows = buckets.get(day) ?? [];
    const spans: [number, number][] = rows.map((row) => {
      const start = minutesOf(row.session.scheduledStart, zone);
      let end = minutesOf(row.session.scheduledEnd, zone);
      // A session running past midnight is drawn to the end of its own day
      // rather than wrapping into a column it does not belong to.
      if (end <= start) end = MINUTES_PER_DAY;
      return [start, end];
    });
    perDay.push({ day, rows, spans });
    everything.push(...spans);
  }

  // Midnight to midnight, always the same number of rows, so one week is never
  // drawn at a different scale from the next.
  const slots: TimeSlot[] = [];
  for (let minute = 0; minute < MINUTES_PER_DAY; minute += SLOT_MINUTES) {
    slots.push({
      row: slots.length + 1,
      label: label(minute),
      isHour: minute % 60 === 0,
    });
  }
  const totalRows = slots.length;

  const columns: GridColumn[] = perDay.map(({ day, rows, spans }) => {
    const lanes = assignLanes(spans);
    const placed = rows.map((row, index) => {
      const [start, end] = spans[index]!;
      const [lane, width] = lanes[index]!;
      // Clamped so nothing is drawn outside the frame it was measured in.
      const startRow = Math.min(Math.max(Math.floor(start / SLOT_MINUTES) + 1, 1), totalRows);
      const span = Math.min(
        Math.max(1, Math.ceil((end - start) / SLOT_MINUTES)),
        MAX_SPAN_SLOTS,
        totalRows - startRow + 1,
      );
      return { row, startRow, span, lane, lanes: width };
    });
    return { day, placed };
  });

  return { slots, columns, focusRow: focusRowFor(everything) };
}
