/**
 * Who a viewer may be told is on a session.
 *
 * `canView` answers whether somebody may open a session at all. This answers
 * the question that comes immediately after it and had no owner: given that
 * they may read it, whose *names* may they read. A group lesson is the case
 * where the two differ — a student is entitled to their own session and not to
 * a register of who else is in the room.
 *
 * It lived nowhere, so it happened nowhere: `decorate` took no principal and
 * returned every student's name to whoever asked, and the two record pages
 * built their participant lists straight from the rows. A student holding
 * nothing but `session.view_own` was served their classmates' names on the
 * calendar, the dashboard, the grid, both record screens and the JSON API.
 *
 * **Names narrow; aggregates do not.** `attendanceRate` is computed over the
 * whole participant set and stays that way — a rate recomputed over the rows a
 * student is allowed to see would be a different, wrong number presented as the
 * session's. The *count* is not identifying either: somebody sitting in a group
 * of three already knows there are three of them, and withholding it would draw
 * a group lesson as a one-to-one. So the shape is "your own name, and how many
 * others", never "your own name, and no sign there were others".
 */

import { ParticipantRole } from "@/generated/prisma/enums";
import type { Db } from "@/lib/db";
import { Permission as P } from "@/lib/policies/permissions";
import type { Principal } from "@/lib/policies/principal";
import { type SessionLike, owns } from "@/lib/policies/sessions";

/** Just enough of a participant row to be named or counted. */
export interface NameableParticipant {
  readonly userId: bigint;
  readonly role: ParticipantRole;
  readonly user: { readonly firstName: string; readonly lastName: string };
}

/** The students a viewer may see named, and how many there are in total. */
export interface RosterNames {
  readonly names: string[];
  /** Every student on the session, named or not. */
  readonly total: number;
}

export interface Roster {
  /** Whether this viewer sees the whole register for this session. */
  maySeeAll(session: SessionLike): boolean;
  /** Whether one particular person may be named to this viewer. */
  mayName(session: SessionLike, userId: bigint): boolean;
  namesFor(session: SessionLike, participants: readonly NameableParticipant[]): RosterNames;
}

class ViewerRoster implements Roster {
  constructor(
    private readonly principal: Principal,
    private readonly guarded: ReadonlySet<bigint>,
  ) {}

  maySeeAll(session: SessionLike): boolean {
    // The instructor teaching it needs the register; `owns` is the same test
    // every `*_own` permission is decided by, rather than a second spelling of
    // it that could drift.
    return this.principal.has(P.SESSION_VIEW_ANY) || owns(this.principal, session);
  }

  mayName(session: SessionLike, userId: bigint): boolean {
    if (this.maySeeAll(session)) return true;
    return userId === this.principal.userId || this.guarded.has(userId);
  }

  namesFor(session: SessionLike, participants: readonly NameableParticipant[]): RosterNames {
    const students = participants.filter((row) => row.role === ParticipantRole.STUDENT);
    const names = students
      .filter((row) => this.mayName(session, row.userId))
      .map((row) => `${row.user.firstName} ${row.user.lastName}`.trim())
      .filter((name) => name !== "");
    return { names, total: students.length };
  }
}

/**
 * Resolve the viewer's roster rights once, for a whole page.
 *
 * The guardian lookup is one statement per render rather than one per session:
 * a month of a parent's calendar is a hundred rows and the answer is the same
 * for all of them. Skipped entirely for somebody who may see every roster
 * anyway, which is the common case and the one on the hottest screens.
 */
export async function rosterFor(db: Db, principal: Principal): Promise<Roster> {
  if (principal.has(P.SESSION_VIEW_ANY)) {
    return new ViewerRoster(principal, new Set());
  }
  const links = await db.guardianStudent.findMany({
    where: { guardianId: principal.userId, organizationId: principal.organizationId },
    select: { studentId: true },
  });
  return new ViewerRoster(
    principal,
    new Set(links.map((link) => link.studentId)),
  );
}
