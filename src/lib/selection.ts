/**
 * A filter drawn as a set of ticks, and what an untouched one looks like.
 *
 * **Every box starts ticked.** A filter's job is to take things away, so the
 * state before anybody has filtered is everything shown — and that is what the
 * control now says. It used to draw the same state as an empty set of boxes and
 * explain itself in a hint ("with none ticked, every status is shown"), which
 * is a rule to be read rather than a picture to be recognised, and which drew
 * "nothing is excluded" identically to "exclude everything".
 *
 * Underneath, an empty selection still means no narrowing — every query in the
 * codebase reads it that way, and so do the URLs already in people's
 * bookmarks. So the two ends of the same state have different spellings, and
 * these two functions are the join between them: `ticked` draws an empty
 * selection as a full one, and `narrows` collapses a full one back to nothing.
 *
 * The consequence, which is deliberate: unticking the last box submits nothing,
 * arrives as no filter, and comes back with every box ticked again. "Show me no
 * sessions at all" is not a state worth being able to reach, and the way out of
 * it — tick something — is the same gesture as the way in.
 */

/**
 * Whether a checkbox is drawn ticked.
 *
 * Compare lowercased values: the query string carries `scheduled` where the
 * enum holds `SCHEDULED`, and callers pass whichever they have.
 */
export function ticked(selected: readonly string[], value: string): boolean {
  if (selected.length === 0) return true;
  const wanted = value.toLowerCase();
  return selected.some((chosen) => chosen.toLowerCase() === wanted);
}

/**
 * Whether a selection actually excludes anything.
 *
 * Complete is measured against what the control **offers**, not against the
 * whole enum. Those differ on purpose — the status menu leaves `in_progress`
 * out because nothing sets it yet, and the role menu leaves out `payer` and
 * `regional_admin` because neither is a job somebody holds — and it is the
 * offered set that a person can actually have ticked. Measuring against the
 * enum would make the default state, every box ticked, count as a filter, and
 * write a parameter naming every value into the address on a screen nobody had
 * filtered.
 *
 * A selection naming something outside the offered set — an older link, a
 * hand-typed value — still counts as complete once it covers everything
 * offered. It is asking for more than the menu can show, not for less.
 *
 * When a value becomes reachable it must join the offered list. Nothing here
 * can detect that; `tests/presentation.test.ts` holds the tripwire.
 */
export function narrows<T extends string>(
  selected: readonly T[],
  offered: readonly T[],
): boolean {
  if (selected.length === 0) return false;
  return !offered.every((option) => selected.includes(option));
}
