"use client";

/**
 * Upload, read what it would do, then say yes.
 *
 * Two forms rather than one screen that quietly does both. The first previews
 * and writes nothing; the second names the batch the first produced and
 * commits it. What the preview reported is what the commit writes, because
 * both read the same stored bytes — the rule booking already follows with
 * `plan()` and `createFromPlan()`.
 *
 * The confirm step carries only the batch ref, not the files again: a second
 * upload could be a different file, and then the report somebody read would
 * have been about something else.
 *
 * No inline styles anywhere in here. `style-src 'self'` is enforced in
 * production and permissive in development, so a `style={{...}}` on a progress
 * bar or a highlighted drop zone is exactly the mistake that passes every local
 * check and fails once deployed.
 */

import { useActionState } from "react";

import { commitImportAction, previewImportAction } from "@/app/actions/imports";
import { Button, Card, Notice, TableWrap, Tag } from "@/components/ui";
import { CSRF_FIELD } from "@/lib/names";
import {
  hasWork,
  summarise,
  type ImportFileReport,
  type ImportFormState,
  type ImportReport,
} from "@/lib/web/importReport";

const LABELS: Record<string, string> = {
  people: "People",
  sessions: "Sessions",
  series: "Series",
};

function FileReport({ file, committed }: { file: ImportFileReport; committed: boolean }) {
  return (
    <section className="import-file">
      <h3>
        {LABELS[file.kind] ?? file.kind}{" "}
        {file.counts.written > 0 && <Tag>{file.counts.written}</Tag>}
      </h3>

      {file.missing.length > 0 ? (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span>{" "}
          <span>
            That file is missing {file.missing.length === 1 ? "a column" : "columns"} this
            reader needs: {file.missing.join(", ")}. Nothing was read from it.
          </span>
        </p>
      ) : (
        <p className="hint">{summarise(file, committed)}</p>
      )}

      {file.ragged.length > 0 && (
        <p className="hint">
          {file.ragged.length} row{file.ragged.length === 1 ? "" : "s"} had the wrong number
          of cells and {file.ragged.length === 1 ? "was" : "were"} skipped — line
          {file.ragged.length === 1 ? " " : "s "}
          {file.ragged.slice(0, 10).join(", ")}
          {file.ragged.length > 10 && ", …"}.
        </p>
      )}

      {file.reasons.length > 0 && (
        <TableWrap caption={`Why ${LABELS[file.kind] ?? file.kind} rows were not written`}>
          <thead>
            <tr>
              <th scope="col">Reason</th>
              <th scope="col" className="numeric">
                Rows
              </th>
            </tr>
          </thead>
          <tbody>
            {file.reasons.map((reason) => (
              <tr key={reason.code}>
                <td data-label="Reason">{reason.message}</td>
                <td data-label="Rows" className="numeric">
                  {reason.count}
                </td>
              </tr>
            ))}
          </tbody>
        </TableWrap>
      )}
    </section>
  );
}

function Report({ report }: { report: ImportReport }) {
  return (
    <>
      {report.committed ? (
        <Notice tone="good">Import finished. Nothing was deleted or overwritten.</Notice>
      ) : report.seenBefore ? (
        <Notice tone="warn">
          These exact files have been imported before. Nothing will be written twice — every
          row is matched against what that import wrote — but you may not have meant to.
        </Notice>
      ) : null}

      {report.files.map((file) => (
        <FileReport key={file.kind} file={file} committed={report.committed} />
      ))}
    </>
  );
}

export function ImportForm({ csrfToken }: { csrfToken: string }) {
  const [preview, submitPreview, previewing] = useActionState<ImportFormState, FormData>(
    previewImportAction,
    {},
  );
  const [commit, submitCommit, committing] = useActionState<ImportFormState, FormData>(
    commitImportAction,
    {},
  );

  // Once a commit has happened its report is the one that matters: the preview
  // it came from is a forecast that has been overtaken.
  const shown = commit.report ?? preview.report;
  const error = commit.error ?? preview.error;
  const awaitingConfirmation =
    preview.report !== undefined && commit.report === undefined && !preview.report.committed;

  return (
    <>
      {error !== undefined && (
        <p className="notice notice-bad" role="alert">
          <span aria-hidden="true">!</span> <span>{error}</span>
        </p>
      )}

      <Card>
        <h2>Choose the files</h2>
        <p className="hint">
          Comma-separated exports, with their column names in the first row. Each is
          optional; at least one is needed. Nothing is written until you have read what it
          would do.
        </p>

        <form action={submitPreview}>
          <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
          <div className="form-row">
            {(["people", "sessions", "series"] as const).map((kind) => (
              <div className="field" key={kind}>
                <label htmlFor={`file-${kind}`}>{LABELS[kind]}</label>
                <input
                  id={`file-${kind}`}
                  name={kind}
                  type="file"
                  accept=".csv,text/csv"
                />
              </div>
            ))}
          </div>
          <Button variant="primary" type="submit" disabled={previewing}>
            {previewing ? "Reading…" : "Read the files"}
          </Button>
        </form>
      </Card>

      {shown !== undefined && (
        <Card>
          <h2>{shown.committed ? "What was imported" : "What this would do"}</h2>
          <Report report={shown} />

          {awaitingConfirmation && (
            <form action={submitCommit}>
              <input type="hidden" name={CSRF_FIELD} value={csrfToken} />
              <input type="hidden" name="batch" value={preview.report!.batchRef} />
              <p className="hint">
                Importing adds records. It never deletes or changes one that is already
                here.
              </p>
              <Button
                variant="primary"
                type="submit"
                disabled={committing || !hasWork(preview.report!)}
              >
                {committing ? "Importing…" : "Import these"}
              </Button>
            </form>
          )}
        </Card>
      )}
    </>
  );
}
