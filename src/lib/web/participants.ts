/**
 * The participants table on the two record screens, narrowed to who the viewer
 * may be told about.
 *
 * Both `/sessions/[ref]` and `/sessions/[ref]/edit` built this list from the
 * same eight lines of duplicated mapping, and neither asked who was reading.
 * The editing screen was the worse of the two: it is gated on
 * `availableActions(...).length > 0`, and a student holding `session.cancel_own`
 * over their own scheduled session clears that gate — so the register of every
 * classmate's attendance and minutes was a page they could open.
 *
 * The rows that are withheld are counted, not silently dropped. A register
 * showing one name beside a rate computed over three is a page that contradicts
 * itself, and the count is not identifying: somebody in a group of three knows
 * there are three of them.
 */

import type { ParticipantView } from "@/components/session/AttendanceCard";
import type {
  AttendanceStatus,
  ParticipantRole,
} from "@/generated/prisma/enums";
import type { Roster } from "@/lib/policies/roster";
import type { SessionLike } from "@/lib/policies/sessions";

/** A participant row as both record screens fetch it. */
export interface ParticipantRecord {
  readonly id: bigint;
  readonly userId: bigint;
  readonly role: ParticipantRole;
  readonly attendance: AttendanceStatus;
  readonly joinedAt: Date | null;
  readonly leftAt: Date | null;
  readonly attendedMinutes: number | null;
  readonly user: { readonly firstName: string; readonly lastName: string };
}

export interface ParticipantList {
  participants: ParticipantView[];
  /** How many rows this viewer was not shown. */
  hidden: number;
}

export function participantViews(
  roster: Roster,
  session: SessionLike,
  rows: readonly ParticipantRecord[],
): ParticipantList {
  const visible = rows.filter((row) => roster.mayName(session, row.userId));
  return {
    participants: visible.map((row) => ({
      id: String(row.id),
      name: `${row.user.firstName} ${row.user.lastName}`.trim() || "—",
      role: row.role,
      joinedAt: row.joinedAt?.toISOString() ?? null,
      leftAt: row.leftAt?.toISOString() ?? null,
      attendedMinutes: row.attendedMinutes,
      attendance: row.attendance,
    })),
    hidden: rows.length - visible.length,
  };
}
