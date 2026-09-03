/**
 * Shared display components.
 *
 * Ported from `app/templates/partials/macros.html`. Every badge renders a
 * glyph, a colour, and a word together. That is what makes the state readable
 * in greyscale, at low contrast, and to someone who does not distinguish the
 * hues — the requirement that colour never carries meaning alone.
 */

import type { AttendanceStatus, DeliveryType, SessionStatus } from "@/generated/prisma/enums";
import { attendanceMeta, deliveryMeta, statusMeta } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";

export function StatusBadge({ status }: { status: SessionStatus }) {
  const meta = statusMeta(status);
  return (
    <span className={`badge badge-${meta.tone}`}>
      <span className="glyph" aria-hidden="true">
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

export function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  const meta = attendanceMeta(status);
  return (
    <span className={`badge badge-${meta.tone}`}>
      <span className="glyph" aria-hidden="true">
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

export function DeliveryBadge({ delivery }: { delivery: DeliveryType }) {
  const meta = deliveryMeta(delivery);
  return (
    <span className="badge badge-muted">
      <span className="glyph" aria-hidden="true">
        {meta.icon}
      </span>
      {meta.label}
    </span>
  );
}

/**
 * A time is never printed without its zone, and always carries a
 * machine-readable `dateTime` for assistive technology.
 */
export function When({ instant, zone }: { instant: Date | null; zone: string }) {
  if (!instant) return <>—</>;
  const moment = new Moment(instant, zone);
  return <time dateTime={moment.iso}>{moment.full}</time>;
}

export function WhenTime({ instant, zone }: { instant: Date | null; zone: string }) {
  if (!instant) return <>—</>;
  const moment = new Moment(instant, zone);
  return (
    <time dateTime={moment.iso}>
      {moment.time} {moment.zoneLabel}
    </time>
  );
}

export function EmptyState({
  heading,
  message,
  glyph = "◌",
}: {
  heading: string;
  message: string;
  glyph?: string;
}) {
  return (
    <div className="empty">
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      <h3>{heading}</h3>
      <p>{message}</p>
    </div>
  );
}

/**
 * Which occurrences an edit reaches.
 *
 * Always shown, never inferred: guessing wrongly here silently rewrites work
 * somebody has already done.
 */
export function ScopeChoice({
  name = "scope",
  series = false,
  legend = "Apply this change to",
}: {
  name?: string;
  series?: boolean;
  legend?: string;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="choice-row">
        <label className="choice">
          <input type="radio" name={name} value="this" defaultChecked />
          <span>Only this session</span>
        </label>
        {series && (
          <>
            <label className="choice">
              <input type="radio" name={name} value="this_and_future" />
              <span>This and all later sessions</span>
            </label>
            <label className="choice">
              <input type="radio" name={name} value="all" />
              <span>The whole series</span>
            </label>
          </>
        )}
      </div>
      {series && (
        <p className="hint">
          Sessions that have already run, been cancelled, or been edited on their own are
          never changed by a series-wide edit.
        </p>
      )}
    </fieldset>
  );
}

/** A short, non-identifying announcement. Lands in the page's live region. */
export function Notice({
  tone = "good",
  children,
}: {
  tone?: "good" | "warn" | "bad";
  children: React.ReactNode;
}) {
  const glyph = tone === "good" ? "✓" : "!";
  return (
    <p className={`notice notice-${tone}`} role={tone === "bad" ? "alert" : undefined}>
      <span aria-hidden="true">{glyph}</span> <span>{children}</span>
    </p>
  );
}
