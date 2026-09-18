/**
 * Reading a CSV somebody else wrote.
 *
 * There was only a writer here — `toCsv` in `sessionQuery.ts` — and no parser at
 * all, because until an import screen existed nothing in this product had ever
 * been handed a file. This is that half, and it is hand-written for the same
 * reason the writer is: the whole of the format that matters here is quoting,
 * and a dependency for thirty lines is a dependency to keep current for ever.
 *
 * It takes text rather than a path or a stream. The CLI reads a file, the screen
 * reads an upload, and neither difference belongs in the parser.
 *
 * Three things it does that the tool's original did not, each of which was a
 * real defect rather than a refinement:
 *
 * - **It strips the byte-order mark.** Excel writes one, and without this the
 *   first header becomes `﻿Name` rather than `Name`, so every lookup of
 *   that column returns undefined and the import dies on the first row with a
 *   `TypeError` that says nothing about the cause. Every spreadsheet-exported
 *   file hits it.
 * - **It treats `\r` consistently.** The original dropped it outside quotes and
 *   kept it inside them, so a quoted multi-line cell carried stray carriage
 *   returns into the database while a row terminator's was discarded.
 * - **It reports a ragged row instead of padding it silently.** A row with
 *   fewer cells than the header is a truncated file or the wrong file; padding
 *   it with blanks turns that into a person with no surname.
 */

/** A row keyed by header name, which is what every caller actually wants. */
export type CsvRow = Record<string, string>;

export interface CsvTable {
  /** Header names, trimmed, in file order. */
  readonly columns: readonly string[];
  readonly rows: readonly CsvRow[];
  /**
   * 1-based line numbers whose cell count did not match the header.
   *
   * Reported rather than thrown: one ragged row in a file of two thousand is
   * worth naming and skipping, not worth refusing the other one thousand nine
   * hundred and ninety-nine over.
   */
  readonly ragged: readonly number[];
}

/**
 * Split CSV text into rows of cells.
 *
 * Quoted fields, doubled quotes, and commas and newlines inside them — all
 * three occur in a real export.
 */
export function parseCsv(text: string): string[][] {
  // The BOM, once, before anything looks at position zero.
  const source = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < source.length; i += 1) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') {
        if (source[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else if (c !== "\r") {
        // Dropped here as well as below: a cell's newlines are content, but a
        // carriage return is a line ending either way, and keeping it in one
        // place and not the other is how `\r` ends up stored in a name.
        field += c;
      }
      continue;
    }
    if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (c !== "\r") field += c;
  }

  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  // A wholly empty line is separation, not data.
  return rows.filter((cells) => cells.some((value) => value !== ""));
}

/**
 * Parse text whose first row names the columns.
 *
 * Header names are trimmed — a trailing space in a spreadsheet's header is
 * invisible to whoever exported it and would otherwise make every lookup of
 * that column miss.
 */
export function parseTable(text: string): CsvTable {
  const rows = parseCsv(text);
  if (rows.length === 0) return { columns: [], rows: [], ragged: [] };

  const columns = rows[0]!.map((name) => name.trim());
  const parsed: CsvRow[] = [];
  const ragged: number[] = [];

  for (const [index, cells] of rows.slice(1).entries()) {
    if (cells.length !== columns.length) {
      // +2: one for the header, one because people count lines from one. It is
      // approximate where a quoted cell spans lines, and it is still the best
      // pointer available to somebody looking for the row in a spreadsheet.
      ragged.push(index + 2);
      continue;
    }
    const row: CsvRow = {};
    for (const [column, name] of columns.entries()) row[name] = cells[column] ?? "";
    parsed.push(row);
  }

  return { columns, rows: parsed, ragged };
}

/** Whether a table has the columns a reader needs, naming the ones it lacks. */
export function missingColumns(
  table: CsvTable,
  required: readonly string[],
): string[] {
  const present = new Set(table.columns);
  return required.filter((name) => !present.has(name));
}
