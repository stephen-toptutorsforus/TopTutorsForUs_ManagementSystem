/**
 * What an address and a phone number have to look like.
 *
 * Here rather than in `services/people.ts` because both ends need them and only
 * one end can import that module: it pulls in the Prisma client and the audit
 * log, so a client component that imported it would drag the server into the
 * browser bundle. This file imports nothing.
 *
 * One definition, both ends, on purpose. A form that accepts what the service
 * rejects is a form that fails at the last step with a message about a field
 * three screens back — and a form stricter than the service quietly refuses
 * addresses the product accepts. They have to be the same regex, not two
 * regexes somebody keeps in step by hand.
 */

/**
 * Deliberately permissive: the authority on whether an address works is whether
 * mail reaches it, not a regex. This rejects only what is obviously not an
 * address, and never rejects a valid but unusual one.
 */
export const EMAIL_SHAPE = /^[^@\s]+@[^@\s.]+(\.[^@\s.]+)+$/;

/**
 * Deliberately loose: digits, and the punctuation people actually type around
 * them. Anything stricter rejects real numbers — extensions, country codes
 * written half a dozen ways — and this field is for a human to ring, not for a
 * machine to dial.
 */
export const PHONE_SHAPE = /^[0-9 ()+.\-]{6,32}$/;

/** The shapes as the browser's own `pattern` attribute wants them. */
export const PHONE_PATTERN = "[0-9 ()+.\\-]{6,32}";

/**
 * Both trim first, because a trailing space is a typing accident rather than an
 * answer — and the service trims before it stores, so a form that judged the
 * untrimmed text would refuse what the service would have accepted.
 */
export function isEmail(value: string): boolean {
  return EMAIL_SHAPE.test(value.trim().toLowerCase());
}

export function isPhone(value: string): boolean {
  return PHONE_SHAPE.test(value.trim());
}
