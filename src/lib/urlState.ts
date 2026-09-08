/**
 * One rule for what a screen's address is allowed to say.
 *
 * Filter state belongs in the URL. It is what makes a refresh, a back button, a
 * bookmark and a link sent to a colleague all mean the same thing, and it is
 * what lets every filter form be a plain GET that still works with scripting
 * off. None of it identifies anybody: the parameters that name a record carry
 * an opaque `ref`, never a name, an address or an id.
 *
 * What does not belong there is a parameter restating a default. A GET form
 * submits its empty fields, so filtering the session grid on nothing at all
 * used to leave `?q=&from=&to=&instructor=&program=` in the bar — five
 * parameters saying what their own absence says already, and enough noise to
 * hide the one that means something.
 *
 * So each screen with filter state serialises what it parsed, compares that
 * with what arrived, and redirects when they differ. Two properties make that
 * safe to do on every request:
 *
 * - the serialiser must omit every default, and be the *only* spelling of a
 *   given state — otherwise the address bar keeps whichever spelling it was
 *   handed;
 * - the tidy form of a tidy address must be itself, or the redirect and the
 *   parser trade the request between them for ever. There is a test for this
 *   per screen, because it is not obvious by reading and it fails hard.
 *
 * The reward is that a parameter left on the address is now information. If
 * `status` is there, somebody filtered by status.
 */

/**
 * The tidiest address for the state these parameters ask for, or `null` when
 * the address that arrived is already it.
 *
 * `canonical` is the screen's own serialisation of what it parsed. Anything
 * present in `params` and absent from it gets dropped — which is safe only
 * because a parameter the screen does not serialise is one it never read.
 */
export function canonicalUrl(
  path: string,
  params: URLSearchParams,
  canonical: string,
): string | null {
  if (canonical === params.toString()) return null;
  return canonical ? `${path}?${canonical}` : path;
}
