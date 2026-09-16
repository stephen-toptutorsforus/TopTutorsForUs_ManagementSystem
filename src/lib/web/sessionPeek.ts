/**
 * What the calendar hands its modal about one session.
 *
 * The calendar already loads every field this needs — `SessionRow` carries the
 * occurrence, the instructor's name, the students' names, the location and the
 * series position — so opening the modal costs no second query and cannot show
 * anything the page was not already allowed to show.
 *
 * Serialised flat and small, because one of these exists for every session in
 * the month being looked at and all of them cross to the browser together. The
 * ref is the only identifier: no database ids, the same rule the address bar
 * follows.
 */

import { durationWords, sessionStateMeta } from "@/lib/presentation";
import { Moment } from "@/lib/rendering";
import type { SessionRow } from "@/lib/services/sessionQuery";

export interface PeekSession {
  ref: string;
  title: string;
  description: string | null;
  /** `Online`, `In person` — the delivery type's own word. */
  deliveryLabel: string;
  /**
   * The session's state, already resolved.
   *
   * Not the raw status: a scheduled session whose hour has gone by reads
   * *Incomplete*, and working that out means comparing against "now". The
   * modal is a client component, so doing it there would compare the browser's
   * clock against a server-rendered page and disagree with itself by a second
   * now and then. Resolved here, where the page was rendered.
   */
  state: { label: string; tone: string; icon: string; meaning?: string };
  /** `Thu 10 Sep 2026, 09:00 EDT`. */
  startLabel: string;
  /** `1 hour 15 minutes`. */
  durationLabel: string;
  /**
   * The meeting link, or the room. One field because the modal has one row for
   * it and only one of the two can apply.
   */
  place: string | null;
  /** Whether `place` is a URL to follow rather than a room to walk to. */
  placeIsLink: boolean;
  instructorName: string | null;
  studentNames: string[];
  /** `6 of 15`, or null for a session that stands alone. */
  seriesPosition: string | null;
  /**
   * What this person may do to *this* session, in this state — the answer
   * `availableActions` gives, carried per session rather than decided once for
   * the page.
   *
   * A broad permission is not an answer: status gates action, so somebody who
   * may cancel sessions in general still may not cancel a completed one. The
   * modal offering it anyway would be a promise the write then refuses, and
   * this list is what stops that.
   */
  actions: string[];
}

export function peekOf(
  row: SessionRow,
  deliveryLabel: string,
  actions: readonly string[],
): PeekSession {
  const session = row.session;
  const start = new Moment(session.scheduledStart, session.timezone);
  const minutes = Math.round(
    (session.scheduledEnd.getTime() - session.scheduledStart.getTime()) / 60_000,
  );
  const isLink = session.deliveryType !== "IN_PERSON";

  return {
    ref: session.ref,
    title: session.title,
    description: session.description,
    deliveryLabel,
    state: sessionStateMeta(session.status, session.scheduledEnd),
    startLabel: start.full,
    durationLabel: durationWords(minutes),
    // Shown only to somebody already allowed to see this session, and never
    // written to a log or the audit trail — the same rule the detail page's
    // meeting link follows.
    place: isLink ? session.meetingUrl : (row.locationName ?? session.locationDetail),
    placeIsLink: isLink,
    instructorName: row.instructorName,
    studentNames: row.studentNames,
    seriesPosition: row.seriesPosition,
    actions: [...actions],
  };
}
