/**
 * What an import says it did, or would do.
 *
 * In `lib/web` rather than beside the action that returns it, because a
 * `"use server"` module may export nothing but async functions — a type
 * exported alongside them makes the whole module unloadable.
 *
 * **Counts and reason codes only.** This shape is rendered on a screen, stored
 * on the batch row and summarised into an audit event, and all three are read
 * by people who did not do the import. Nothing derived from a row's content —
 * no name, no address, no meeting link — may be added to it.
 */

/** One reason, and how many rows it accounted for. */
export interface ImportReason {
  readonly code: string;
  readonly message: string;
  readonly count: number;
}

export interface ImportCounts {
  /** Rows in the file. */
  readonly seen: number;
  /** Rows that became a record, or would. */
  readonly written: number;
  /** Rows matched to something already here, and therefore left alone. */
  readonly alreadyHere: number;
  /** Rows that could not be written, explained by `reasons`. */
  readonly refused: number;
}

export type ImportKindName = "people" | "sessions" | "series";

export interface ImportFileReport {
  readonly kind: ImportKindName;
  readonly counts: ImportCounts;
  readonly reasons: readonly ImportReason[];
  /** Line numbers whose cell count did not match the header. */
  readonly ragged: readonly number[];
  /** Columns the file should have had and did not. Non-empty means nothing ran. */
  readonly missing: readonly string[];
}

export interface ImportReport {
  readonly batchRef: string;
  /** False for a preview: nothing has been written yet. */
  readonly committed: boolean;
  readonly files: readonly ImportFileReport[];
  /**
   * Set when this exact file has been imported before.
   *
   * Not a refusal — a second import is safe by construction, since every row
   * is matched by the key it came from. It is said out loud because somebody
   * uploading the same file twice usually did not mean to.
   */
  readonly seenBefore?: boolean;
}

/** Whether anything at all would be written. Drives the confirm button. */
export function hasWork(report: ImportReport): boolean {
  return report.files.some((file) => file.counts.written > 0);
}

/** One line for a person, without making them add the columns up. */
export function summarise(file: ImportFileReport, committed: boolean): string {
  const { seen, written, alreadyHere, refused } = file.counts;
  const verb = committed ? "added" : "to add";
  const parts = [`${seen} row${seen === 1 ? "" : "s"}`, `${written} ${verb}`];
  if (alreadyHere > 0) parts.push(`${alreadyHere} already here`);
  if (refused > 0) parts.push(`${refused} not written`);
  return parts.join(", ");
}
