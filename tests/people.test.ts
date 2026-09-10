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
import { ROLE_FILTER_ORDER, USER_STATUS_FILTER_ORDER } from "@/lib/presentation";
import {
  NO_DIRECTORY_FILTERS,
  activeDirectoryFilters,
  directoryQuery,
  parseDirectoryFilters,
  parseRoles,
  parseStatuses,
} from "@/lib/services/peopleQuery";

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

describe("what the directory stores", () => {
  const tidy = (query: string) => {
    const params = new URLSearchParams(query);
    return directoryQuery(parseDirectoryFilters(params));
  };

  it("does not write down an empty search", () => {
    // The filter form submits its empty fields, so this is what searching for
    // nothing would otherwise store.
    expect(tidy("q=")).toBe("");
    expect(tidy("q=&role=instructor")).toBe("role=instructor");
  });

  it("writes nothing for every role the menu offers, because that is the resting state", () => {
    // Every box starts ticked, so all four roles is what an untouched filter
    // looks like — writing it down would put `role=instructor,student,parent,
    // admin` on the address of a directory nobody had filtered.
    expect(directoryQuery({ ...NO_DIRECTORY_FILTERS, roles: [...ROLE_FILTER_ORDER] })).toBe("");
    expect(directoryQuery({ ...NO_DIRECTORY_FILTERS, roles: Object.values(Role) })).toBe("");

    // Three of the four is a decision, and it is written down.
    expect(
      directoryQuery({ ...NO_DIRECTORY_FILTERS, roles: ROLE_FILTER_ORDER.slice(1) }),
    ).toBe(`role=${ROLE_FILTER_ORDER.slice(1).map((role) => role.toLowerCase()).join(",")}`);
  });

  it("does not count a full set of ticks as an active filter", () => {
    // The badge on the filter button counts decisions, and "everything" is not
    // one — it is the screen somebody arrived at.
    expect(
      activeDirectoryFilters({
        ...NO_DIRECTORY_FILTERS,
        roles: [...ROLE_FILTER_ORDER],
        statuses: [...USER_STATUS_FILTER_ORDER],
      }),
    ).toBe(0);
  });

  it("is a fixed point: storing what it stored changes nothing", () => {
    // The stored value is read back and re-serialised on every filter change,
    // so a second spelling would drift a little further on each one.
    for (const query of ["", "role=instructor", "q=mercer&role=admin"]) {
      expect(tidy(tidy(query)), query).toBe(tidy(query));
    }
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
      "q=%20mercer%20&role=admin&status=active,invited&region=reg_a&district=dis_b&school=sch_c",
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
    expect(
      directoryQuery({
        ...NO_DIRECTORY_FILTERS,
        statuses: [UserStatus.ACTIVE, UserStatus.DISABLED],
      }),
    ).toBe("status=active,disabled");
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

  it("reads a list written either way, so an old bookmark still works", () => {
    const joined = filtersFrom("role=admin,parent&status=active,invited");
    const separate = filtersFrom("role=admin&role=parent&status=active&status=invited");

    expect(joined.roles).toEqual(separate.roles);
    expect(joined.statuses).toEqual(separate.statuses);
  });

  it("is still a fixed point with everything set", () => {
    const query =
      "q=mercer&role=admin&status=active&region=reg_a&district=dis_b&school=sch_c";
    const once = directoryQuery(parseDirectoryFilters(new URLSearchParams(query)));

    expect(once).toBe(query);
    expect(directoryQuery(parseDirectoryFilters(new URLSearchParams(once)))).toBe(once);
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
