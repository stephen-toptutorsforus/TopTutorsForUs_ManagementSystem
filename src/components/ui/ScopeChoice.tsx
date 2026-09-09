/**
 * Which occurrences an edit reaches.
 *
 * Always asked, never inferred — see the note on the component itself.
 */

import { Choice, ChoiceGroup } from "./Field";

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
    <ChoiceGroup
      legend={legend}
      hint={
        series && (
          <p className="hint">
            Sessions that have already run, been cancelled, or been edited on their own
            are never changed by a series-wide edit.
          </p>
        )
      }
    >
      <Choice type="radio" name={name} value="this" defaultChecked label="Only this session" />
      {series && (
        <>
          <Choice
            type="radio"
            name={name}
            value="this_and_future"
            label="This and all later sessions"
          />
          <Choice type="radio" name={name} value="all" label="The whole series" />
        </>
      )}
    </ChoiceGroup>
  );
}
