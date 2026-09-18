/**
 * Reading a CSV somebody else wrote.
 *
 * The cases here are the ones a real export actually contains — a quoted cell
 * with a comma in it, a doubled quote, CRLF line endings, and the byte-order
 * mark Excel puts at the front of every file it saves. That last one is the
 * reason this suite exists at all: without stripping it the first column's name
 * is not the name anybody reads it by, every lookup of that column returns
 * undefined, and the import dies on its first row with an error that points
 * nowhere near the cause.
 */

import { describe, expect, it } from "vitest";

import { missingColumns, parseCsv, parseTable } from "@/lib/csv";

describe("splitting the text", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b\n1,2\n3,4")).toEqual([
      ["a", "b"],
      ["1", "2"],
      ["3", "4"],
    ]);
  });

  it("keeps a comma that is inside quotes", () => {
    // Every `Students` cell in a group session is this.
    expect(parseCsv('a,b\n"Fenwick, Ada",2')).toEqual([
      ["a", "b"],
      ["Fenwick, Ada", "2"],
    ]);
  });

  it("turns a doubled quote into one", () => {
    expect(parseCsv('a\n"she said ""no"""')).toEqual([["a"], ['she said "no"']]);
  });

  it("keeps a newline that is inside quotes", () => {
    expect(parseCsv('a,b\n"one\ntwo",3')).toEqual([
      ["a", "b"],
      ["one\ntwo", "3"],
    ]);
  });

  it("reads CRLF the same as LF, inside a quoted cell as well as outside", () => {
    // The original kept `\r` inside quotes and dropped it outside, so a
    // multi-line cell carried a stray carriage return into the database.
    expect(parseCsv("a,b\r\n1,2\r\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
    expect(parseCsv('a\r\n"one\r\ntwo"\r\n')).toEqual([["a"], ["one\ntwo"]]);
  });

  it("survives the byte-order mark a spreadsheet writes", () => {
    const withBom = "﻿Name,Roles\nAda,Student";
    expect(parseCsv(withBom)[0]).toEqual(["Name", "Roles"]);
    // Stated as the thing that actually broke: the header must be findable by
    // the name somebody types, not by that name with an invisible character in
    // front of it.
    expect(parseCsv(withBom)[0]![0]).toBe("Name");
  });

  it("ignores a wholly blank line", () => {
    expect(parseCsv("a,b\n\n1,2\n")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("reads a final row with no trailing newline", () => {
    expect(parseCsv("a\n1")).toEqual([["a"], ["1"]]);
  });

  it("returns nothing for nothing", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });
});

describe("keying rows by their header", () => {
  it("zips each row against the column names", () => {
    const table = parseTable("Name,Roles\nAda Fenwick,Student");
    expect(table.columns).toEqual(["Name", "Roles"]);
    expect(table.rows).toEqual([{ Name: "Ada Fenwick", Roles: "Student" }]);
    expect(table.ragged).toEqual([]);
  });

  it("trims a header, because a trailing space is invisible to whoever exported it", () => {
    const table = parseTable("Name ,Roles\nAda,Student");
    expect(table.columns).toEqual(["Name", "Roles"]);
    expect(table.rows[0]!.Name).toBe("Ada");
  });

  it("names a ragged row rather than padding it", () => {
    // Padding turns a truncated file into a person with no surname, which is
    // silently wrong data rather than a loud refusal.
    const table = parseTable("a,b,c\n1,2,3\n4,5\n6,7,8");
    expect(table.rows).toHaveLength(2);
    expect(table.ragged).toEqual([3]);
  });

  it("keeps an empty cell as an empty string, not as absent", () => {
    const table = parseTable("a,b\n1,");
    expect(table.rows[0]).toEqual({ a: "1", b: "" });
  });

  it("has no columns and no rows for an empty file", () => {
    expect(parseTable("")).toEqual({ columns: [], rows: [], ragged: [] });
  });
});

describe("checking a file is the file somebody meant", () => {
  it("names the columns that are missing", () => {
    const table = parseTable("Name,Roles\nAda,Student");
    expect(missingColumns(table, ["Name", "Roles"])).toEqual([]);
    expect(missingColumns(table, ["Name", "Status", "Email / Username"])).toEqual([
      "Status",
      "Email / Username",
    ]);
  });
});
