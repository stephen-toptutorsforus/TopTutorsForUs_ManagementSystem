/**
 * The directory's role filter parser.
 *
 * Ported from the pure half of `tests/test_people_filter.py`. The menu and the
 * parser deliberately disagree about which roles exist: the menu is a curated
 * list, and narrowing the parser to it would turn a working bookmark into a
 * page that silently shows everybody.
 */

import { describe, expect, it } from "vitest";

import { Role } from "@/generated/prisma/enums";
import { parseRoles } from "@/lib/services/peopleQuery";

describe("parseRoles", () => {
  it("counts a repeated role once", () => {
    expect(parseRoles(["parent", "parent", "student"])).toEqual([Role.PARENT, Role.STUDENT]);
  });

  it("drops nonsense rather than raising", () => {
    expect(parseRoles(["", "../../etc/passwd", "student"])).toEqual([Role.STUDENT]);
  });

  it("accepts a role the filter menu does not offer", () => {
    // The calendar accepts a status its own menu leaves out, for the same
    // reason: a link that names one must still filter by it.
    expect(parseRoles(["regional_admin"])).toEqual([Role.REGIONAL_ADMIN]);
    expect(parseRoles(["payer"])).toEqual([Role.PAYER]);
  });

  it("returns nothing when nothing is ticked", () => {
    expect(parseRoles([])).toEqual([]);
  });

  it("refuses to be lengthened past the number of roles that exist", () => {
    const flood = Array.from({ length: 500 }, () => "student");
    expect(parseRoles(flood)).toEqual([Role.STUDENT]);
  });
});
