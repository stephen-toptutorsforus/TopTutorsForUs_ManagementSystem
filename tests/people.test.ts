/**
 * The directory's role filter parser.
 *
 * Ported from the pure half of `tests/test_people_filter.py`. The menu and the
 * parser deliberately disagree about which roles exist: the menu is a curated
 * list, and narrowing the parser to it would turn a working bookmark into a
 * page that silently shows everybody.
 */

import { describe, expect, it } from "vitest";

import { Role, UserStatus } from "@/generated/prisma/enums";
import { ROLE_FILTER_ORDER } from "@/lib/presentation";
import {
  NO_DIRECTORY_FILTERS,
  activeDirectoryFilters,
  directoryQuery,
  parseDirectoryFilters,
  parseRoles,
  parseStatuses,
} from "@/lib/services/peopleQuery";
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
    return canonicalUrl("/people", params, directoryQuery(parseDirectoryFilters(params)));
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

    expect(directoryQuery({ ...NO_DIRECTORY_FILTERS, roles: [...ROLE_FILTER_ORDER] })).toBe(
      everyOffered,
    );
    expect(directoryQuery({ ...NO_DIRECTORY_FILTERS, roles: Object.values(Role) })).toBe("");
  });

  it("is a fixed point, or the page redirects to itself for ever", () => {
    expect(tidy("")).toBeNull();
    expect(tidy("role=instructor")).toBeNull();
    expect(tidy("q=mercer&role=admin")).toBeNull();
  });
});

describe("the filter drawer's parameters", () => {
  const filtersFrom = (query: string) => parseDirectoryFilters(new URLSearchParams(query));

  it("reads a status the same way it reads a role", () => {
    expect(parseStatuses(["active", "ACTIVE", "disabled"])).toEqual([
      UserStatus.ACTIVE,
      UserStatus.DISABLED,
    ]);
    expect(parseStatuses(["../../etc/passwd", "active"])).toEqual([UserStatus.ACTIVE]);
    expect(parseStatuses([])).toEqual([]);
  });

  it("cannot name more statuses than exist", () => {
    const flood = Array.from({ length: 200 }, () => "active");
    expect(parseStatuses(flood)).toEqual([UserStatus.ACTIVE]);
  });

  it("reads a whole filter off the query", () => {
    const filters = filtersFrom(
      "q=%20mercer%20&role=admin&status=active&status=invited&region=reg_a&district=dis_b&school=sch_c",
    );

    expect(filters.search).toBe("mercer");
    expect(filters.roles).toEqual([Role.ADMIN]);
    expect(filters.statuses).toEqual([UserStatus.ACTIVE, UserStatus.INVITED]);
    expect(filters.regionRef).toBe("reg_a");
    expect(filters.districtRef).toBe("dis_b");
    expect(filters.schoolRef).toBe("sch_c");
  });

  it("treats an empty place as no place at all", () => {
    // A select left on "Any region" submits `region=`, which is the absence of
    // a choice rather than a region whose ref is the empty string.
    const filters = filtersFrom("region=&district=%20%20&school=");

    expect(filters.regionRef).toBeNull();
    expect(filters.districtRef).toBeNull();
    expect(filters.schoolRef).toBeNull();
  });

  it("drops a status set covering every status, like a full role set", () => {
    expect(
      directoryQuery({ ...NO_DIRECTORY_FILTERS, statuses: Object.values(UserStatus) }),
    ).toBe("");
    expect(directoryQuery({ ...NO_DIRECTORY_FILTERS, statuses: [UserStatus.ACTIVE] })).toBe(
      "status=active",
    );
  });

  it("keeps a region, a district and a school together", () => {
    // Not collapsed to the narrowest: somebody may hold a school in one
    // district and a district in another, and dropping one the person set is
    // worse than returning nothing.
    expect(
      directoryQuery({
        ...NO_DIRECTORY_FILTERS,
        regionRef: "reg_a",
        districtRef: "dis_b",
        schoolRef: "sch_c",
      }),
    ).toBe("region=reg_a&district=dis_b&school=sch_c");
  });

  it("is still a fixed point with everything set", () => {
    const query =
      "q=mercer&role=admin&status=active&region=reg_a&district=dis_b&school=sch_c";
    const params = new URLSearchParams(query);

    expect(canonicalUrl("/people", params, directoryQuery(parseDirectoryFilters(params)))).toBeNull();
  });

  it("counts each parameter once, however many values it holds", () => {
    // Three ticked roles are one decision about roles, and the button says so.
    expect(activeDirectoryFilters(NO_DIRECTORY_FILTERS)).toBe(0);
    expect(
      activeDirectoryFilters({
        ...NO_DIRECTORY_FILTERS,
        roles: [Role.ADMIN, Role.PARENT, Role.STUDENT],
      }),
    ).toBe(1);
    expect(
      activeDirectoryFilters({
        ...NO_DIRECTORY_FILTERS,
        search: "a",
        roles: [Role.ADMIN],
        statuses: [UserStatus.ACTIVE],
        schoolRef: "sch_c",
      }),
    ).toBe(4);
  });
});
