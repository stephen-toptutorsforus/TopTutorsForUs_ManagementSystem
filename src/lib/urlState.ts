/**
 * How a screen's state is written down.
 *
 * It used to be written into the address bar, and this file held the rule for
 * that: serialise what you parsed, compare it with what arrived, redirect when
 * they differ. The address does not hold it any more — see
 * `lib/web/filterState.ts` for where it went and what that cost — but the
 * serialisation survived the move intact, because a cookie holding one screen's
 * whole state wants exactly the same properties an address did:
 *
 * - every default omitted, so "nothing set" is the empty string and not a list
 *   of parameters saying what their own absence says;
 * - one spelling per state, or the value drifts a little on every filter change
 *   as it is read back and re-written.
 *
 * There is a fixed-point test per screen for the second of those. It used to
 * exist because the failure was an infinite redirect; it exists now because the
 * failure is quieter and worse.
 */

/**
 * A query string with its commas left alone.
 *
 * `URLSearchParams.toString()` percent-encodes a comma, so a list written as
 * one parameter comes out as `status=scheduled%2Cmissed` — considerably harder
 * to read, which defeats the point of joining it. A comma is a legal
 * sub-delimiter; nothing that reads these values treats an encoded one
 * differently from a literal one.
 *
 * This mattered most when both sides of a comparison had to agree: a canonical
 * string with a literal comma against an arriving string with an encoded one
 * never matched, and never matching was an infinite redirect. The comparison is
 * gone and the readability is still worth having — a stored value somebody has
 * to read in a debugger is no different from one in an address bar.
 */
export function readableQuery(params: URLSearchParams): string {
  return params.toString().replaceAll("%2C", ",");
}
