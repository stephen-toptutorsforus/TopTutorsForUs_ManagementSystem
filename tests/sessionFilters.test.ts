/**
 * The session grid's filter state.
 *
 * The grid's state lives in the URL, which is what makes it shareable — so
 * parsing and serialising have to round-trip, and parsing has to survive
 * anything a person can type into an address bar. Two of these hold refusals
 * the reference found the hard way: a `columns=` value outside the allowlist
 * cannot surface a field the product does not intend to show, and a
 * twenty-digit page number must render an empty page rather than becoming an
 * OFFSET past the range of a bigint and 500ing.
 */

import { describe, expect, it } from "vitest";

import { SessionStatus } from "@/generated/prisma/enums";
import {
  DEFAULT_COLUMNS,
  MAX_PAGE,
  parseFilters,
  toQuery,
} from "@/lib/services/sessionQuery";

const filtersFrom = (query: string) => parseFilters(new URLSearchParams(query));

describe("parseFilters", () => {
  it("reads an empty query as the defaults", () => {
    const filters = filtersFrom("");

    expect(filters.search).toBe("");
    expect(filters.statuses).toEqual([]);
    expect(filters.dateFrom).toBeNull();
    expect(filters.dateTo).toBeNull();
    expect(filters.page).toBe(1);
    expect(filters.columns).toEqual(DEFAULT_COLUMNS);
  });

  it("drops an unknown status rather than raising", () => {
    expect(filtersFrom("status=scheduled&status=wizard").statuses).toEqual([
      SessionStatus.SCHEDULED,
    ]);
  });

  it("keeps several statuses", () => {
    expect(filtersFrom("status=scheduled&status=missed").statuses).toEqual([
      SessionStatus.SCHEDULED,
      SessionStatus.MISSED,
    ]);
  });

  it("accepts columns as repeated values or as one comma-separated value", () => {
    // The form posts repeated checkboxes; a shared link carries one value.
    expect(filtersFrom("columns=title&columns=status").columns).toEqual(["title", "status"]);
    expect(filtersFrom("columns=title,status").columns).toEqual(["title", "status"]);
  });

  it("refuses a column outside the allowlist", () => {
    // A crafted `columns=` must not surface a field the product does not intend
    // to display.
    expect(filtersFrom("columns=password_hash").columns).toEqual(DEFAULT_COLUMNS);
    expect(filtersFrom("columns=title,password_hash").columns).toEqual(["title"]);
  });

  it("bounds the page at both ends", () => {
    expect(filtersFrom("page=0").page).toBe(1);
    expect(filtersFrom("page=-5").page).toBe(1);
    expect(filtersFrom("page=99999999999999999999").page).toBe(MAX_PAGE);
    expect(filtersFrom("page=nonsense").page).toBe(1);
    expect(filtersFrom("page=3").page).toBe(3);
  });

  it("truncates a very long search rather than passing it on", () => {
    const long = "a".repeat(500);
    expect(filtersFrom(`q=${long}`).search.length).toBe(100);
  });

  it("ignores a date that is not one", () => {
    expect(filtersFrom("from=not-a-date").dateFrom).toBeNull();
    expect(filtersFrom("from=2026-02-30").dateFrom).toBeNull();
    expect(filtersFrom("from=2026-04-06").dateFrom).toBe("2026-04-06");
  });
});

describe("toQuery", () => {
  it("round-trips through parseFilters", () => {
    const original = filtersFrom(
      "q=algebra&status=scheduled&status=missed&from=2026-04-01&to=2026-04-30" +
        "&instructor=usr_abc&program=prg_xyz&page=4&columns=title,status",
    );

    expect(filtersFrom(toQuery(original))).toEqual(original);
  });

  it("leaves out what is at its default, so a plain link stays plain", () => {
    expect(toQuery(filtersFrom(""))).toBe("");
  });

  it("takes an override without disturbing the rest", () => {
    const filters = filtersFrom("q=algebra&status=missed");
    const next = toQuery(filters, { page: 3 });

    expect(next).toContain("page=3");
    expect(next).toContain("q=algebra");
    expect(next).toContain("status=missed");
  });
});

describe("what the grid stores", () => {
  const tidy = (query: string) => toQuery(parseFilters(new URLSearchParams(query)));

  it("drops the empty fields the filter form submits", () => {
    // Filtering on nothing at all submits all five as empty strings.
    expect(tidy("q=&from=&to=&instructor=&program=")).toBe("");
    expect(tidy("q=&page=1")).toBe("");
  });

  it("settles one spelling of a status and a column set", () => {
    expect(tidy("status=SCHEDULED")).toBe("status=scheduled");
    // One parameter with a real comma in it, not `%2C`: joining the values is
    // only an improvement if the result is still readable.
    expect(tidy("columns=title&columns=status")).toBe("columns=title,status");
    expect(tidy("status=scheduled&status=missed")).toBe("status=scheduled,missed");
  });

  it("reads a status list written either way", () => {
    expect(filtersFrom("status=scheduled,missed").statuses).toEqual(
      filtersFrom("status=scheduled&status=missed").statuses,
    );
  });

  it("is a fixed point: storing what it stored changes nothing", () => {
    // The stored value is read back and re-serialised on every filter change,
    // so a second spelling would drift a little further on each one.
    for (const query of [
      "",
      "page=3",
      "status=scheduled",
      "columns=title,status",
      "status=scheduled,missed",
      "q=algebra&status=missed&from=2026-04-01&instructor=abc&page=2",
    ]) {
      expect(tidy(tidy(query)), query).toBe(tidy(query));
    }
  });
});
