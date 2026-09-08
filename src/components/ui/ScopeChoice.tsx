/**
 * Which occurrences an edit reaches.
 *
 * Always asked, never inferred — see the note on the component itself.
 */

/**
 * Which occurrences an edit reaches.
 *
 * Always shown, never inferred: guessing wrongly here silently rewrites work
 * somebody has already done.
 */
export function ScopeChoice({
  name = "scope",
  series = false,
  legend = "Apply this change to",
}: {
  name?: string;
  series?: boolean;
  legend?: string;
}) {
  return (
    <fieldset>
      <legend>{legend}</legend>
      <div className="choice-row">
        <label className="choice">
          <input type="radio" name={name} value="this" defaultChecked />
          <span>Only this session</span>
        </label>
        {series && (
          <>
            <label className="choice">
              <input type="radio" name={name} value="this_and_future" />
              <span>This and all later sessions</span>
            </label>
            <label className="choice">
              <input type="radio" name={name} value="all" />
              <span>The whole series</span>
            </label>
          </>
        )}
      </div>
      {series && (
        <p className="hint">
          Sessions that have already run, been cancelled, or been edited on their own are
          never changed by a series-wide edit.
        </p>
      )}
    </fieldset>
  );
}
