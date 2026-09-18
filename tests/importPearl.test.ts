/**
 * What Pearl's words mean here, and what a refusal is allowed to say.
 *
 * These mappings were exercised only by running the CLI against a real export,
 * which is the one way of testing them that cannot be repeated in CI and cannot
 * be read as a specification. They are flat facts and belong pinned as flat
 * facts — particularly the two that carry a judgement rather than a
 * translation: a session the instructor missed leaves its students *excused*,
 * and "Incomplete" is not a mark at all.
 *
 * The second half is the rule that matters most in this whole feature. A
 * refusal is rendered on a screen and written to an audit trail, so it must
 * carry the constraint's *name* and never Postgres's `detail`, which spells out
 * the conflicting row — here, somebody's session and the hour they were taught.
 */

import { describe, expect, it } from "vitest";

import {
  AttendanceStatus,
  DeliveryType,
  Role,
  SessionStatus,
  UserStatus,
} from "@/generated/prisma/enums";
import {
  ACCOUNT,
  ATTENDANCE,
  STATUS,
  clockOf,
  dayOf,
  deliveryOf,
  emailOf,
  minutesOf,
  namesOf,
  rolesOf,
  splitName,
  startOf,
  weekdaysOf,
} from "@/lib/services/import/pearl";
import { REFUSALS, Tally, refusalFor } from "@/lib/services/import/refusals";
import { civilDate, civilTime } from "@/lib/time";

const CHICAGO = "America/Chicago";

describe("what Pearl's words mean", () => {
  it("maps the four roles it exports and drops anything else", () => {
    expect(rolesOf("Instructor")).toEqual([Role.INSTRUCTOR]);
    expect(rolesOf("Student, Parent")).toEqual([Role.STUDENT, Role.PARENT]);
    // Silently dropped rather than guessed at: a word this schema has no role
    // for is not an excuse to invent one.
    expect(rolesOf("Tutor Coordinator")).toEqual([]);
    expect(rolesOf("")).toEqual([]);
  });

  it("maps every account state to one of ours", () => {
    expect(ACCOUNT.Active).toBe(UserStatus.ACTIVE);
    expect(ACCOUNT["Invite Bounced"]).toBe(UserStatus.BOUNCED);
    expect(ACCOUNT["Pending Invite"]).toBe(UserStatus.PENDING_INVITE);
  });

  it("folds the two live-classroom states into one", () => {
    // Pearl distinguishes waiting from teaching; this schema does not, and
    // nothing here writes `IN_PROGRESS` until the Phase 4 classroom does — so
    // an import is currently its only source.
    expect(STATUS.Lobby).toBe(SessionStatus.IN_PROGRESS);
    expect(STATUS.Lesson).toBe(SessionStatus.IN_PROGRESS);
    expect(STATUS.Completed).toBe(SessionStatus.COMPLETED);
    expect(STATUS.Missed).toBe(SessionStatus.MISSED);
  });

  it("excuses a student when the instructor was the one who missed it", () => {
    // The judgement in this table. An authorised absence is not a mark against
    // the student, and `attendanceRate` counts EXCUSED differently from ABSENT.
    expect(ATTENDANCE["Missed By Instructor"]).toBe(AttendanceStatus.EXCUSED);
    expect(ATTENDANCE["Missed By Students"]).toBe(AttendanceStatus.ABSENT);
  });

  it("treats Incomplete as no mark rather than as a mark", () => {
    // It is this codebase's *derived* state — a scheduled session whose hour
    // has gone by — so storing it would turn something worked out at render
    // time into a stored fact that then cannot change when the session does.
    expect(ATTENDANCE.Incomplete).toBe(AttendanceStatus.UNMARKED);
    expect(ATTENDANCE[""]).toBe(AttendanceStatus.UNMARKED);
  });

  it("reads a location as a link, a classroom or a room", () => {
    expect(deliveryOf("https://example.test/room")).toBe(DeliveryType.EXTERNAL_LINK);
    expect(deliveryOf("Pearl Advanced Class")).toBe(DeliveryType.ADVANCED_CLASSROOM);
    expect(deliveryOf("Room 2B")).toBe(DeliveryType.IN_PERSON);
  });
});

describe("reading a length", () => {
  it("reads the three spellings the export uses", () => {
    expect(minutesOf("1 hour 30 minutes")).toBe(90);
    expect(minutesOf("54 minutes")).toBe(54);
    expect(minutesOf("3 hours")).toBe(180);
    expect(minutesOf("1 hour")).toBe(60);
  });

  it("reads the clock form the series file uses", () => {
    expect(minutesOf("0:32")).toBe(32);
    expect(minutesOf("1:15")).toBe(75);
  });

  it("returns zero for something it cannot read, so the caller can refuse it", () => {
    expect(minutesOf("")).toBe(0);
    expect(minutesOf("about an hour")).toBe(0);
  });
});

describe("reading a time", () => {
  it("puts a start where the tenant's clock says, not where UTC does", () => {
    const instant = startOf("09/10/2026 9:00:00 PM", CHICAGO);
    expect(instant).not.toBeNull();
    expect(civilDate(instant!, CHICAGO)).toBe("2026-09-10");
    expect(civilTime(instant!, CHICAGO)).toBe("21:00");
  });

  it("reads both ends of the twelve-hour clock", () => {
    const midnight = startOf("01/02/2026 12:30:00 AM", CHICAGO)!;
    expect(civilTime(midnight, CHICAGO)).toBe("00:30");
    const noon = startOf("01/02/2026 12:30:00 PM", CHICAGO)!;
    expect(civilTime(noon, CHICAGO)).toBe("12:30");
  });

  it("reads the same wall clock in whatever zone it is told", () => {
    // The zone is the tenant's, not a constant. A row is a wall-clock time in
    // the organization that exported it.
    const chicago = startOf("09/10/2026 9:00:00 PM", CHICAGO)!;
    const newYork = startOf("09/10/2026 9:00:00 PM", "America/New_York")!;
    expect(chicago.getTime()).not.toBe(newYork.getTime());
    expect(civilTime(newYork, "America/New_York")).toBe("21:00");
  });

  it("refuses a shape it does not recognise rather than guessing", () => {
    expect(startOf("2026-09-10 21:00", CHICAGO)).toBeNull();
    expect(startOf("9/10/2026 9:00:00 PM", CHICAGO)).toBeNull();
    expect(startOf("", CHICAGO)).toBeNull();
  });

  it("reads the series file's separate date and clock columns", () => {
    expect(dayOf("09/10/2026")).toBe("2026-09-10");
    expect(dayOf("2026-09-10")).toBeNull();
    expect(clockOf("6:00 PM")).toBe("18:00");
    expect(clockOf("12:00 AM")).toBe("00:00");
    expect(clockOf("18:00")).toBe("18:00");
    expect(clockOf("tea time")).toBeNull();
  });

  it("reads weekday names into the stored spelling, in week order", () => {
    expect(weekdaysOf("Monday, Wednesday")).toEqual(["mon", "wed"]);
    expect(weekdaysOf("Wed,Mon")).toEqual(["mon", "wed"]);
    expect(weekdaysOf("Thurs, Tues")).toEqual(["tue", "thu"]);
    expect(weekdaysOf("")).toEqual([]);
  });
});

describe("reading a person", () => {
  it("splits a display name at the last word", () => {
    expect(splitName("Ada Fenwick")).toEqual(["Ada", "Fenwick"]);
    expect(splitName("Maria del Carmen Ruiz")).toEqual(["Maria del Carmen", "Ruiz"]);
  });

  it("keeps a suffix on the surname rather than making it one", () => {
    expect(splitName("Bruno Salas Jr.")).toEqual(["Bruno", "Salas Jr."]);
    expect(splitName("Chiara Volpe III")).toEqual(["Chiara", "Volpe III"]);
  });

  it("copes with one word, and with none", () => {
    expect(splitName("Prince")).toEqual(["Prince", ""]);
    expect(splitName("   ")).toEqual(["Unknown", "Unknown"]);
  });

  it("keeps an address and refuses to invent one", () => {
    // A bare username stays null: the per-tenant unique index is over the rows
    // that have an address, and a made-up one is a false fact and a future
    // collision at the same time.
    expect(emailOf("Ada.Fenwick@Example.Test")).toBe("ada.fenwick@example.test");
    expect(emailOf("afenwick")).toBeNull();
    expect(emailOf("")).toBeNull();
  });

  it("lists the names in a roster cell", () => {
    expect(namesOf("Ada Fenwick, Bruno Salas")).toEqual(["Ada Fenwick", "Bruno Salas"]);
    expect(namesOf("")).toEqual([]);
  });
});

describe("saying why the database refused a row", () => {
  /** What `@prisma/adapter-pg` hands back for an exclusion violation. */
  const exclusion = (constraint: string) => ({
    code: "P2039",
    meta: {
      driverAdapterError: {
        cause: {
          code: "23P01",
          originalMessage: `conflicting key value violates exclusion constraint "${constraint}"`,
          // Postgres puts the conflicting row here. Nothing may read it.
          detail:
            "Key (instructor_id, during)=(42, [2026-09-10 21:00:00,2026-09-10 22:00:00)) conflicts with existing key.",
        },
      },
    },
  });

  it("names the constraint, and never quotes the row", () => {
    const refusal = refusalFor(exclusion("ex_session_instructor_overlap"));
    expect(refusal).toBe(REFUSALS.INSTRUCTOR_BUSY);
    // The assertion this file exists for, stated as an absence: no part of the
    // conflicting row may survive into something a screen renders.
    expect(JSON.stringify(refusal)).not.toContain("instructor_id");
    expect(JSON.stringify(refusal)).not.toContain("2026-09-10");
    expect(JSON.stringify(refusal)).not.toContain("conflicts with existing key");
  });

  it("tells the two exclusion constraints apart", () => {
    expect(refusalFor(exclusion("ex_session_location_overlap"))).toBe(REFUSALS.ROOM_BUSY);
    expect(refusalFor(exclusion("something_else"))).toBe(REFUSALS.EXCLUDED);
  });

  it("classifies an exclusion from the Prisma code alone", () => {
    // `P2039` was named in the original's comment and never tested, so the
    // whole classification rested on the nested SQLSTATE.
    expect(refusalFor({ code: "P2039" })).toBe(REFUSALS.EXCLUDED);
  });

  it("knows a duplicate from a missing reference", () => {
    expect(refusalFor({ code: "P2002" })).toBe(REFUSALS.DUPLICATE);
    expect(refusalFor({ code: "P2003" })).toBe(REFUSALS.MISSING_REFERENCE);
  });

  it("has an answer for anything at all, including a plain crash", () => {
    expect(refusalFor(new TypeError("undefined is not a function"))).toBe(
      REFUSALS.UNCLASSIFIED,
    );
    expect(refusalFor(null)).toBe(REFUSALS.UNCLASSIFIED);
  });
});

describe("tallying reasons", () => {
  it("counts by code, most common first", () => {
    const tally = new Tally();
    tally.add(REFUSALS.INSTRUCTOR_BUSY);
    tally.add(REFUSALS.DUPLICATE);
    tally.add(REFUSALS.INSTRUCTOR_BUSY);
    expect(tally.total).toBe(3);
    expect(tally.entries()).toEqual([
      { code: "instructor_busy", message: "the instructor is already teaching then", count: 2 },
      { code: "duplicate", message: "a matching row is already here", count: 1 },
    ]);
  });

  it("is empty until something is refused", () => {
    const tally = new Tally();
    expect(tally.total).toBe(0);
    expect(tally.entries()).toEqual([]);
  });
});
