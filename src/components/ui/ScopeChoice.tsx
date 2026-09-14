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
  defaultValue = "this",
}: {
  name?: string;
  series?: boolean;
  legend?: string;
  /**
   * Which one starts chosen. "Edit Series" and "Edit Session" are the same
   * screen asked two ways, so the button that was pressed decides this — and
   * the choice is still shown and still changeable, because guessing wrongly
   * here silently rewrites work somebody has already done.
   */
  defaultValue?: string;
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
      <Choice
        type="radio"
        name={name}
        value="this"
        defaultChecked={!series || defaultValue === "this"}
        label="Only this session"
      />
      {series && (
        <>
          <Choice
            type="radio"
            name={name}
            value="this_and_future"
            defaultChecked={defaultValue === "this_and_future"}
            label="This and all later sessions"
          />
          <Choice
            type="radio"
            name={name}
            value="all"
            defaultChecked={defaultValue === "all"}
            label="The whole series"
          />
        </>
      )}
    </ChoiceGroup>
  );
}
