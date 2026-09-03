/**
 * What a form action hands back to the form.
 *
 * In its own module because a `"use server"` file may only export async
 * functions: a type or a constant exported alongside the actions makes the
 * whole module unloadable, and the error names the missing action rather than
 * the extra export.
 */

export interface SignInState {
  error?: string;
  email?: string;
}

/**
 * Deliberately identical whether the address is unknown, the password is wrong,
 * or the account is disabled. Distinguishing them, by wording or by timing,
 * turns the form into an account-enumeration oracle.
 */
export const SIGN_IN_FAILED =
  "That email address and password do not match an active account.";

/** The result of a form that either succeeds or explains itself. */
export interface FormResult {
  error?: string;
  notice?: string;
}
