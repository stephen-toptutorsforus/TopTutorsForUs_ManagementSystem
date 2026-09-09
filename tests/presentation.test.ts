/**
 * The lists that decide what an unfiltered screen is.
 *
 * `STATUS_FILTER_ORDER` and `ROLE_FILTER_ORDER` are not only the order the
 * boxes are drawn in. Every box starts ticked, and a complete set of ticks is
 * written as no filter at all, so these lists *are* the definition of the
 * unfiltered screen — see `lib/selection.ts`.
 *
 * That makes an omission expensive and silent: a status left off the list can
 * never be ticked back on, so any tick somebody removes hides it for good, and
 * nothing in the type system notices. These are the tripwires. They fail when a
 * value is added to either enum and not answered for here, which is the moment
 * somebody has to decide whether it belongs in the menu.
 */

import { describe, expect, it } from "vitest";

import { Role, SessionStatus, UserStatus } from "@/generated/prisma/enums";
import {
  ROLE_FILTER_ORDER,
  STATUS_FILTER_ORDER,
  USER_STATUS_FILTER_ORDER,
} from "@/lib/presentation";
import { narrows, ticked } from "@/lib/selection";

describe("what the filter menus offer", () => {
  it("offers every session status except in_progress", () => {
    // `in_progress` is left out because nothing sets it yet. When the classroom
    // integration starts marking sessions live in Phase 5 it has to be added
    // here, or a live session becomes unfilterable and any unticked box hides
    // it. This test is what says so at the moment it matters.
    const offered = new Set<string>(STATUS_FILTER_ORDER);
    const expected = (Object.values(SessionStatus) as SessionStatus[]).filter(
      (status) => status !== SessionStatus.IN_PROGRESS,
    );

    expect(offered).toEqual(new Set<string>(expected));
    expect(offered.has(SessionStatus.IN_PROGRESS)).toBe(false);
  });

  it("offers four of the six roles, and says which two it leaves out", () => {
    // `payer` is granted by assigning somebody to pay rather than held as a
    // job, and `regional_admin` is a narrowing of `admin`. Both still show as
    // tags on the rows they belong to.
    expect(new Set<string>(ROLE_FILTER_ORDER)).toEqual(
      new Set<string>([Role.INSTRUCTOR, Role.STUDENT, Role.PARENT, Role.ADMIN]),
    );
  });

  it("offers every account state, because each is one somebody can be in", () => {
    // Unlike the roles: a status is a state the platform puts somebody in, so
    // there is none a person would never want to look for. A new one added to
    // the enum and not to this list would be invisible to the filter.
    expect(new Set<string>(USER_STATUS_FILTER_ORDER)).toEqual(
      new Set<string>(Object.values(UserStatus)),
    );
  });

  it("has no duplicates, which would draw a box twice", () => {
    for (const list of [STATUS_FILTER_ORDER, ROLE_FILTER_ORDER, USER_STATUS_FILTER_ORDER]) {
      expect(new Set<string>(list).size).toBe(list.length);
    }
  });
});

describe("drawing and reading a set of ticks", () => {
  it("draws an untouched filter as every box ticked", () => {
    for (const status of STATUS_FILTER_ORDER) {
      expect(ticked([], status.toLowerCase())).toBe(true);
    }
  });

  it("draws a filtered screen as the boxes it names, and no others", () => {
    expect(ticked(["scheduled"], "scheduled")).toBe(true);
    expect(ticked(["scheduled"], "missed")).toBe(false);
  });

  it("compares the enum's spelling against the address bar's", () => {
    // The URL carries `scheduled`; the enum holds `SCHEDULED`. Callers pass
    // whichever they have, so both have to match.
    expect(ticked([SessionStatus.SCHEDULED], "scheduled")).toBe(true);
    expect(ticked(["scheduled"], SessionStatus.SCHEDULED)).toBe(true);
  });

  it("reads a complete set and an empty one as the same thing", () => {
    expect(narrows([], STATUS_FILTER_ORDER)).toBe(false);
    expect(narrows([...STATUS_FILTER_ORDER], STATUS_FILTER_ORDER)).toBe(false);
  });

  it("reads more than the menu offers as still asking for everything", () => {
    // An older link, or one typed by hand. It wants a status the menu cannot
    // show as well as all the ones it can — which is more than unfiltered, not
    // less, so it is not a narrowing.
    expect(
      narrows([...STATUS_FILTER_ORDER, SessionStatus.IN_PROGRESS], STATUS_FILTER_ORDER),
    ).toBe(false);
  });

  it("reads one missing tick as a filter", () => {
    expect(narrows(STATUS_FILTER_ORDER.slice(1), STATUS_FILTER_ORDER)).toBe(true);
  });
});
