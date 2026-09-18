/**
 * What a database refusal was about, without quoting the row it was about.
 *
 * Postgres puts the *conflicting values* in an exclusion violation's `detail`
 * field — which here is somebody's session, their instructor and the hour they
 * were taught. The constraint's name is in `originalMessage` instead, and that
 * is the only part this reads. The rule mattered in a terminal; it matters more
 * now, because these reasons are rendered on a screen and written to an audit
 * trail that other people read.
 *
 * A reason is a stable `code` plus a sentence. The CLI returned free English,
 * which is fine to print and useless to count, group or translate — and the
 * whole value of this tally is that one refused row is an anecdote and nine
 * hundred is a finding.
 */

export interface Refusal {
  /** Stable, and safe to group by. Never interpolates anything from the row. */
  readonly code: string;
  /** One sentence, for somebody reading the report. */
  readonly message: string;
}

/** The shape Prisma's driver adapter wraps a Postgres error in. */
interface AdapterError {
  code?: string;
  meta?: {
    driverAdapterError?: {
      cause?: { code?: string; originalMessage?: string };
    };
  };
}

export const REFUSALS = {
  INSTRUCTOR_BUSY: {
    code: "instructor_busy",
    message: "the instructor is already teaching then",
  },
  ROOM_BUSY: {
    code: "room_busy",
    message: "the room is already in use then",
  },
  EXCLUDED: {
    code: "excluded",
    message: "a database rule refused it",
  },
  DUPLICATE: {
    code: "duplicate",
    message: "a matching row is already here",
  },
  MISSING_REFERENCE: {
    code: "missing_reference",
    message: "it refers to something that was not imported",
  },
  UNCLASSIFIED: {
    code: "unclassified",
    message: "the database refused it",
  },

  // Not database refusals — reasons a row never reached the database at all.
  // They share the vocabulary because a reader does not care which layer said
  // no, only how many rows did not arrive and why.
  NO_ROLE: {
    code: "no_role",
    message: "no role this schema recognises",
  },
  SHARED_NAME: {
    code: "shared_name",
    message: "shares a display name with somebody already imported",
  },
  UNREADABLE_START: {
    code: "unreadable_start",
    message: "the start time could not be read",
  },
  UNREADABLE_DURATION: {
    code: "unreadable_duration",
    message: "the length could not be read",
  },
  UNKNOWN_STATUS: {
    code: "unknown_status",
    message: "the status has no equivalent here",
  },
  UNKNOWN_PERSON: {
    code: "unknown_person",
    message: "it names somebody who is not in the export",
  },
  ALREADY_PRESENT: {
    code: "already_present",
    message: "it is already here, from an earlier import or from this product",
  },
} as const satisfies Record<string, Refusal>;

/**
 * Classify a write failure.
 *
 * Prisma surfaces a Postgres exclusion violation as `P2039` and keeps the real
 * SQLSTATE (`23P01`) underneath, so both are tested — the CLI named `P2039` in
 * a comment and then never looked at it, which left the classification resting
 * entirely on the nested code.
 */
export function refusalFor(error: unknown): Refusal {
  // Never throws. This is called from inside the catch that keeps one bad row
  // from ending an import of two thousand, so a classifier that can itself
  // fail — on `null`, on a string, on anything not shaped like a Prisma error —
  // defeats the whole arrangement it exists to serve.
  if (typeof error !== "object" || error === null) return REFUSALS.UNCLASSIFIED;

  const err = error as AdapterError;
  const cause = err.meta?.driverAdapterError?.cause;
  const named = cause?.originalMessage ?? "";

  const excluded =
    err.code === "P2039" ||
    cause?.code === "23P01" ||
    named.includes("exclusion constraint");

  if (excluded) {
    if (named.includes("ex_session_instructor_overlap")) return REFUSALS.INSTRUCTOR_BUSY;
    if (named.includes("ex_session_location_overlap")) return REFUSALS.ROOM_BUSY;
    return REFUSALS.EXCLUDED;
  }
  if (err.code === "P2002") return REFUSALS.DUPLICATE;
  if (err.code === "P2003") return REFUSALS.MISSING_REFERENCE;
  return REFUSALS.UNCLASSIFIED;
}

/**
 * A tally of reasons.
 *
 * Counts only, keyed by code: nothing from a row ever reaches it, so the whole
 * structure is safe to render, serialise into the batch record and put in an
 * audit event.
 */
export class Tally {
  private readonly counts = new Map<string, { refusal: Refusal; count: number }>();

  add(refusal: Refusal): void {
    const seen = this.counts.get(refusal.code);
    if (seen) seen.count += 1;
    else this.counts.set(refusal.code, { refusal, count: 1 });
  }

  get total(): number {
    let sum = 0;
    for (const { count } of this.counts.values()) sum += count;
    return sum;
  }

  /** Most common first, which is the order somebody reads a finding in. */
  entries(): { code: string; message: string; count: number }[] {
    return [...this.counts.values()]
      .sort((a, b) => b.count - a.count)
      .map(({ refusal, count }) => ({
        code: refusal.code,
        message: refusal.message,
        count,
      }));
  }
}
