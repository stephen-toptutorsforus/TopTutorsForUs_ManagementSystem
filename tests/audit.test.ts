/**
 * The audit trail's redaction allowlist.
 *
 * The reference service tests this through booking — one assertion that a
 * cancellation note is recorded as «provided» rather than as what it said. The
 * allowlist is the property that assertion depends on, and it is cheap to hold
 * directly: a field added to a snapshot must be invisible to the trail until
 * somebody deliberately names it.
 */

import { describe, expect, it } from "vitest";

import { AUDITABLE_FIELDS, buildChanges } from "@/lib/audit";

describe("buildChanges", () => {
  it("records only fields that changed", () => {
    const changes = buildChanges(
      { status: "scheduled", title: "Algebra" },
      { status: "cancelled", title: "Algebra" },
    );

    expect(Object.keys(changes)).toEqual(["status"]);
    expect(changes.status).toEqual({ from: "scheduled", to: "cancelled" });
  });

  it("drops a field nobody put on the allowlist", () => {
    const changes = buildChanges({ email: "a@example.test" }, { email: "b@example.test" });

    expect(changes).toEqual({});
    expect(AUDITABLE_FIELDS.has("email")).toBe(false);
  });

  it("records that a note was given, not what it said", () => {
    const changes = buildChanges(
      { cancellation_note: null },
      { cancellation_note: "family emergency, mother in hospital" },
    );

    expect(changes.cancellation_note).toEqual({ from: null, to: "«provided»" });
    expect(JSON.stringify(changes)).not.toContain("hospital");
  });

  it("says nothing when a note stays absent", () => {
    expect(buildChanges({ cancellation_note: null }, { cancellation_note: "" })).toEqual({});
  });

  it("renders an instant as a string rather than an object", () => {
    const changes = buildChanges(
      { scheduled_start: new Date("2026-04-06T16:00:00Z") },
      { scheduled_start: new Date("2026-04-06T17:00:00Z") },
    );

    expect(changes.scheduled_start).toEqual({
      from: "2026-04-06T16:00:00.000Z",
      to: "2026-04-06T17:00:00.000Z",
    });
  });

  it("redacts a value that is neither a scalar nor a list of strings", () => {
    const changes = buildChanges(
      { title: "Algebra" },
      { title: { toString: () => "leaks" } as unknown as string },
    );

    expect(changes.title).toEqual({ from: "Algebra", to: "«redacted»" });
  });

  it("compares lists by value, not by identity", () => {
    expect(buildChanges({ weekdays: ["mon"] }, { weekdays: ["mon"] })).toEqual({});
    expect(buildChanges({ weekdays: ["mon"] }, { weekdays: ["mon", "wed"] })).toEqual({
      weekdays: { from: ["mon"], to: ["mon", "wed"] },
    });
  });
});
