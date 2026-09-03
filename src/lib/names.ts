/**
 * Cookie and field names.
 *
 * Separate from `security.ts` so a browser bundle can import them. That module
 * pulls in a native Argon2 binding with no browser build, and a form component
 * that only wants the name of its CSRF field must not drag the password hasher
 * across the boundary to get it.
 */

export const SESSION_COOKIE = "toptutorsforus_session";
export const CSRF_FIELD = "csrf_token";
