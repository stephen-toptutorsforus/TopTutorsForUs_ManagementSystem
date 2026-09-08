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
import { ROLE_FILTER_ORDER } from "@/lib/presentation";
import { directoryQuery, parseRoles } from "@/lib/services/peopleQuery";
import { canonicalUrl } from "@/lib/urlState";

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

describe("the directory's address", () => {
  const tidy = (query: string) => {
    const params = new URLSearchParams(query);
    return canonicalUrl("/people", params, directoryQuery(params.get("q")?.trim() ?? "", parseRoles(params.getAll("role"))));
  };

  it("does not write down an empty search", () => {
    // A GET form submits its empty fields, so this is what searching for
    // nothing used to leave in the address bar.
    expect(tidy("q=")).toBe("/people");
    expect(tidy("q=&role=instructor")).toBe("/people?role=instructor");
  });

  it("keeps every role the menu offers, because four of six is a filter", () => {
    // Ticking all four still hides somebody who only holds `payer` or
    // `regional_admin`, so collapsing it would show people the ticks exclude.
    const everyOffered = ROLE_FILTER_ORDER.map((role) => `role=${role.toLowerCase()}`).join("&");

    expect(directoryQuery("", ROLE_FILTER_ORDER)).toBe(everyOffered);
    expect(directoryQuery("", Object.values(Role))).toBe("");
  });

  it("is a fixed point, or the page redirects to itself for ever", () => {
    expect(tidy("")).toBeNull();
    expect(tidy("role=instructor")).toBeNull();
    expect(tidy("q=mercer&role=admin")).toBeNull();
  });
});
