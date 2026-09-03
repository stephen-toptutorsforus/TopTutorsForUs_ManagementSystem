/**
 * Public references.
 *
 * Ported from `new_ref` in `app/models/base.py`. Every row keeps an integer
 * surrogate `id` for joins and carries a separate random `ref` used in URLs,
 * exports, and anything a person can see. A sequential integer in a URL tells a
 * visitor how many students an organization has and invites enumeration; a
 * `ref` tells them nothing.
 *
 * The alphabet omits look-alike characters, because these get read aloud and
 * typed back in.
 */

import { randomBytes } from "node:crypto";

export const REF_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const BODY_LENGTH = 10;

/**
 * Rejection sampling rather than `% alphabet.length`.
 *
 * 256 is not a multiple of 31, so the modulo would make the first eight letters
 * fractionally more likely than the rest. It would not be a practical weakness
 * at this length, but a biased identifier generator is the kind of thing that
 * gets copied into a context where it is one.
 */
function randomIndex(bound: number): number {
  const limit = Math.floor(256 / bound) * bound;
  for (;;) {
    const byte = randomBytes(1)[0]!;
    if (byte < limit) return byte % bound;
  }
}

/** A short, opaque, URL-safe public identifier, e.g. `ses_k7m2q9x4pd`. */
export function newRef(prefix: string): string {
  let body = "";
  for (let index = 0; index < BODY_LENGTH; index += 1) {
    body += REF_ALPHABET[randomIndex(REF_ALPHABET.length)];
  }
  return `${prefix}_${body}`;
}
