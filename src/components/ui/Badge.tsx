/**
 * A state, said three ways at once.
 *
 * Ported from the badge macros in `app/templates/partials/macros.html`. Every
 * badge carries a glyph, a colour and a word, so the state is readable in
 * greyscale, at low contrast, and by someone who does not distinguish the hues.
 * Colour never carries the meaning alone — which is why the glyph is not
 * optional here, and why the domain badges below cannot be reduced to a
 * coloured dot without changing this file first.
 */

import type { AttendanceStatus, DeliveryType, SessionStatus } from "@/generated/prisma/enums";
import { attendanceMeta, deliveryMeta, statusMeta } from "@/lib/presentation";

export type Tone = "good" | "warn" | "bad" | "info" | "muted" | "live" | "pending" | "moved";

export function Badge({
  tone = "muted",
  glyph,
  children,
}: {
  tone?: Tone | string;
  glyph: string;
  children: React.ReactNode;
}) {
  return (
    <span className={`badge badge-${tone}`}>
      <span className="glyph" aria-hidden="true">
        {glyph}
      </span>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: SessionStatus }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} glyph={meta.icon}>
      {meta.label}
    </Badge>
  );
}

export function AttendanceBadge({ status }: { status: AttendanceStatus }) {
  const meta = attendanceMeta(status);
  return (
    <Badge tone={meta.tone} glyph={meta.icon}>
      {meta.label}
    </Badge>
  );
}

export function DeliveryBadge({ delivery }: { delivery: DeliveryType }) {
  const meta = deliveryMeta(delivery);
  // Always muted: how a session is delivered is a fact about it, not a state to
  // be alarmed by, and colouring it would compete with the status beside it.
  return (
    <Badge tone="muted" glyph={meta.icon}>
      {meta.label}
    </Badge>
  );
}

/** A label with no state in it — a role, a group name, a subject. */
export function Tag({
  className,
  children,
  ...rest
}: React.HTMLAttributes<HTMLSpanElement>) {
  return (
    <span className={className ? `tag ${className}` : "tag"} {...rest}>
      {children}
    </span>
  );
}
