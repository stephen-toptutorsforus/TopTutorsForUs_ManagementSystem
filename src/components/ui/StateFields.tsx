/**
 * The state a form is not asking about, carried through it.
 *
 * Every filter form posts the *whole* state, because the action stores what it
 * is given and forgets the rest — a pagination form that submitted only a page
 * number would clear the filter on its way to page two. The query string used
 * to do this for free: a link carried the state because the state was in the
 * address.
 *
 * So each form renders the current state as hidden fields, minus whatever it
 * asks about itself. `omit` is that minus: the search box owns `q`, the status
 * menu owns `status`, the pagination owns `page`.
 *
 * A repeated key stays repeated — `status=scheduled&status=missed` becomes two
 * inputs — because that is what the parsers read and what a checkbox group
 * would have submitted.
 */

export function StateFields({
  state,
  omit = [],
}: {
  /** The screen's current filter, as the page parsed it. */
  state: URLSearchParams;
  /** Fields this form has controls for, so they are not submitted twice. */
  omit?: readonly string[];
}) {
  const skip = new Set(omit);
  return (
    <>
      {[...state.entries()]
        .filter(([key]) => !skip.has(key))
        .map(([key, value], index) => (
          <input type="hidden" name={key} value={value} key={`${key}-${index}`} />
        ))}
    </>
  );
}
