/**
 * The application's error vocabulary and its HTTP mapping.
 *
 * Ported from `app/errors.py`. Every failure a caller can provoke has a class
 * here, so a route handler never throws a bare `Error` with an ad-hoc message.
 * That matters for two reasons: the messages stay consistent enough to
 * translate, and no handler can accidentally put a name, an email address, or a
 * meeting URL into a response body while explaining what went wrong.
 *
 * The distinction between `NotFound` and `Forbidden` is deliberate. When a user
 * asks for a record belonging to another tenant, they get **404, not 403** — a
 * 403 confirms the record exists, which is itself a cross-tenant disclosure.
 */

export interface ErrorPayload {
  error: string;
  message: string;
  details?: unknown;
}

export class AppError extends Error {
  /** The HTTP code. */
  readonly status: number = 500;
  /** The stable machine string, for clients that branch on the failure. */
  readonly code: string = "internal_error";
  readonly details: unknown;

  constructor(message: string, details?: unknown) {
    super(message);
    // Without this, `instanceof` fails for subclasses under a downlevel target,
    // and every `catch (e) { if (e instanceof NotFound) ... }` silently takes
    // the wrong branch.
    this.name = new.target.name;
    Object.setPrototypeOf(this, new.target.prototype);
    this.details = details;
  }

  asPayload(): ErrorPayload {
    const payload: ErrorPayload = { error: this.code, message: this.message };
    if (this.details !== undefined) payload.details = this.details;
    return payload;
  }
}

export class ValidationError extends AppError {
  readonly status = 422;
  readonly code = "validation_failed";
}

/** Also thrown for anything outside the caller's tenant. See the note above. */
export class NotFound extends AppError {
  readonly status = 404;
  readonly code = "not_found";
}

export class Forbidden extends AppError {
  readonly status = 403;
  readonly code = "forbidden";
}

export class Unauthenticated extends AppError {
  readonly status = 401;
  readonly code = "unauthenticated";
}

/** A scheduling or state conflict the caller could resolve and retry. */
export class ConflictError extends AppError {
  readonly status = 409;
  readonly code = "conflict";
}

export class RateLimited extends AppError {
  readonly status = 429;
  readonly code = "rate_limited";
}

/**
 * An integration we asked to do something and it could not.
 *
 * 502 rather than 500: the booking itself was valid and the failure is
 * outside it. The message must never carry a token, a meeting URL, or a
 * Zoom response body — those belong in nobody's error page.
 */
export class ServiceUnavailable extends AppError {
  readonly status = 502;
  readonly code = "service_unavailable";
}

/** The status to answer with, for anything that reaches a handler's catch. */
export function statusFor(error: unknown): number {
  return error instanceof AppError ? error.status : 500;
}

/**
 * A body safe to return. Anything that is not an `AppError` is deliberately
 * flattened to a generic message: an unexpected exception's text is written for
 * a developer reading a log, not for a browser, and may quote a value that
 * should never leave the process.
 */
export function payloadFor(error: unknown): ErrorPayload {
  if (error instanceof AppError) return error.asPayload();
  return { error: "internal_error", message: "something went wrong" };
}
