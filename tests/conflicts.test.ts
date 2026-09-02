/**
 * The parts of conflict detection that need no database.
 *
 * A rule can generate a series that clashes with *itself* — a three-hour
 * session repeating daily at 23:00. Nothing in the database catches that until
 * the second insert fails, so the preview checks the batch against itself
 * first.
 */

import { describe, expect, it } from "vitest";

import {
  ABSOLUTE_KINDS,
  BLOCKING_STATUSES,
  type Conflict,
  ConflictKind,
  blocking,
  overridable,
  overridableConflicts,
  selfOverlaps,
  summary,
} from "@/lib/conflicts";

const at = (iso: string) => new Date(iso);

describe("a series that clashes with itself", () => {
  it("finds nothing when the occurrences are apart", () => {
    expect(
      selfOverlaps([
        [at("2026-06-01T10:00:00Z"), at("2026-06-01T11:00:00Z")],
        [at("2026-06-02T10:00:00Z"), at("2026-06-02T11:00:00Z")],
      ]),
    ).toEqual([]);
  });

  it("reports the positions of an overlapping pair", () => {
    expect(
      selfOverlaps([
        [at("2026-06-01T22:00:00Z"), at("2026-06-02T01:00:00Z")],
        [at("2026-06-02T00:00:00Z"), at("2026-06-02T03:00:00Z")],
      ]),
    ).toEqual([[0, 1]]);
  });

  it("lets back-to-back occurrences sit together", () => {
    // Half-open, the same rule as the database constraint.
    expect(
      selfOverlaps([
        [at("2026-06-01T10:00:00Z"), at("2026-06-01T11:00:00Z")],
        [at("2026-06-01T11:00:00Z"), at("2026-06-01T12:00:00Z")],
      ]),
    ).toEqual([]);
  });

  it("reports every clashing pair, in ascending order", () => {
    const three = at("2026-06-01T10:00:00Z");
    expect(
      selfOverlaps([
        [three, at("2026-06-01T13:00:00Z")],
        [at("2026-06-01T11:00:00Z"), at("2026-06-01T14:00:00Z")],
        [at("2026-06-01T12:00:00Z"), at("2026-06-01T15:00:00Z")],
      ]),
    ).toEqual([
      [0, 1],
      [0, 2],
      [1, 2],
    ]);
  });
});

describe("which conflicts an override can clear", () => {
  const conflict = (kind: ConflictKind): Conflict => ({
    kind,
    message: `a ${kind}`,
    sessionRef: null,
    subjectLabel: null,
  });

  it("refuses to override what the database will refuse anyway", () => {
    // Offering an override that then fails on an integrity error is worse than
    // not offering it: the person is told yes and then told no, without a
    // reason they can act on.
    expect(overridable(conflict(ConflictKind.INSTRUCTOR_BUSY))).toBe(false);
    expect(overridable(conflict(ConflictKind.LOCATION_BUSY))).toBe(false);
    expect(ABSOLUTE_KINDS.size).toBe(2);
  });

  it("allows an override for the judgement calls", () => {
    expect(overridable(conflict(ConflictKind.OUTSIDE_AVAILABILITY))).toBe(true);
    expect(overridable(conflict(ConflictKind.STUDENT_BUSY))).toBe(true);
    expect(overridable(conflict(ConflictKind.ORGANIZATION_CLOSED))).toBe(true);
  });

  it("splits a report into the two kinds", () => {
    const report = {
      conflicts: [
        conflict(ConflictKind.INSTRUCTOR_BUSY),
        conflict(ConflictKind.OUTSIDE_AVAILABILITY),
      ],
    };

    expect(blocking(report).map((c) => c.kind)).toEqual([ConflictKind.INSTRUCTOR_BUSY]);
    expect(overridableConflicts(report).map((c) => c.kind)).toEqual([
      ConflictKind.OUTSIDE_AVAILABILITY,
    ]);
    expect(summary(report)).toBe("a instructor_busy; a outside_availability");
  });
});

describe("which statuses hold a slot", () => {
  it("is the same three the database constraints name", () => {
    // Stated once. If this list and the constraint predicates ever disagree,
    // the preview promises a booking the insert then refuses, or reports a
    // clash the database would have allowed.
    //
    // These are the TypeScript member names; what reaches the column is the
    // lowercase value, which `tests/db/guarantees.test.ts` pins against the
    // live schema — that is the assertion that actually ties the two together,
    // and it has to run against a database to mean anything.
    expect([...BLOCKING_STATUSES].sort()).toEqual(["IN_PROGRESS", "RESCHEDULED", "SCHEDULED"]);
  });
});
