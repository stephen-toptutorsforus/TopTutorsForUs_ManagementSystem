/**
 * Mapping the error vocabulary onto responses, once.
 *
 * Ported from the exception handlers in `app/main.py`. No page builds its own
 * refusal: a route that wants to stop calls `interrupt()` and the shape of the
 * answer is decided here, so 403 and 404 cannot come to mean different things
 * on different screens.
 *
 * The distinction that matters is the one the error vocabulary already draws:
 * anything outside the caller's tenant is `NotFound`, and reaches the browser
 * as a 404, because a 403 would confirm the record exists.
 */

import { forbidden, notFound, redirect } from "next/navigation";

import { AppError, Forbidden, NotFound, Unauthenticated } from "@/lib/errors";

/**
 * Turn a thrown application error into the right interrupt.
 *
 * Next's interrupts throw, so this never returns — the `never` return type lets
 * a caller write `catch (error) { interrupt(error); }` without TypeScript
 * believing the function can fall through.
 */
export function interrupt(error: unknown): never {
  if (error instanceof Unauthenticated) {
    // A redirect, not `unauthorized()`. A signed-out visitor needs the sign-in
    // form, not a page telling them they are signed out with a link to it —
    // and the reference does the same, reserving the bare 401 for the JSON
    // API, where the route handlers already answer with one.
    redirect("/sign-in");
  }
  if (error instanceof Forbidden) forbidden();
  if (error instanceof NotFound) notFound();
  throw error;
}

/**
 * Run a page's work, refusing in the product's own vocabulary.
 *
 * Next's own interrupts (`notFound`, `redirect`) throw a control-flow signal
 * that must not be swallowed, so they are re-thrown untouched: only an
 * `AppError` is translated.
 */
export async function guard<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    if (error instanceof AppError) interrupt(error);
    throw error;
  }
}
