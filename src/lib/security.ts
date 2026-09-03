/**
 * Authentication primitives: password hashing, session cookies, CSRF, rate limits.
 *
 * Ported from `app/security.py`.
 *
 * **Passwords use Argon2id**, the current password-hashing recommendation, with
 * the library's defaults rather than hand-tuned parameters. `verifyPassword()`
 * also reports when a stored hash was made with older parameters so it can be
 * upgraded transparently on the next successful sign-in.
 *
 * **The session cookie carries a user id and nothing else.** It is signed, not
 * encrypted, because there is nothing secret in it — and a signature is far
 * easier to reason about than a symmetric encryption scheme whose key doubles
 * as a capability to mint any session. Roles and tenant come from the database
 * on every request (see `src/lib/policies/principal.ts`).
 *
 * **CSRF is a signed double-submit token**, because `SameSite=Lax` alone is a
 * single point of failure. The token is bound to the session id, so one lifted
 * from a different session does not validate.
 *
 * **Rate limits are in-process.** That is honest about what it is: enough to
 * blunt credential stuffing and invitation abuse on a single instance, and
 * explicitly not a distributed limiter. A multi-instance deployment needs a
 * shared store, and the interface here is narrow enough to swap.
 *
 * The signing is written out rather than pulled in. `itsdangerous` has no
 * TypeScript equivalent with the same shape, and the alternative — a JWT
 * library — brings an algorithm-negotiation field this does not need and a
 * class of `alg: none` mistakes this cannot make.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

import { hash, verify } from "@node-rs/argon2";

import { settings } from "@/lib/config";

export { CSRF_FIELD, SESSION_COOKIE } from "@/lib/names";

/**
 * A hash of a value nobody can sign in with, verified against when the account
 * has no password. It equalises the cost of "unknown address" and "wrong
 * password" so response timing cannot enumerate which addresses hold accounts.
 * Computed once, lazily, so importing this module stays cheap.
 */
let dummyHash: string | null = null;

async function dummy(): Promise<string> {
  dummyHash ??= await hash("toptutorsforus-timing-equaliser-never-a-real-password");
  return dummyHash;
}

/**
 * No options: the library already defaults to Argon2id at m=19456, t=2, p=1 —
 * the OWASP second-choice parameters — and naming them here would freeze this
 * build's numbers into every hash while pretending they were chosen. The
 * parameters are read back off the stored hash in `needsRehash`, which is where
 * the decision to upgrade actually belongs.
 *
 * The generated typings declare `Algorithm` as an ambient const enum, which
 * cannot be read under `isolatedModules`; the default makes that moot.
 */

export function hashPassword(password: string): Promise<string> {
  return hash(password);
}

export interface VerifyResult {
  valid: boolean;
  needsRehash: boolean;
}

/**
 * Check a password against a stored hash.
 *
 * A missing hash still runs a verification against a dummy so that an unknown
 * account and a wrong password take comparable time. Without it, response
 * timing enumerates which email addresses exist.
 */
export async function verifyPassword(
  storedHash: string | null | undefined,
  password: string,
): Promise<VerifyResult> {
  if (!storedHash) {
    try {
      await verify(await dummy(), password);
    } catch {
      // Expected: the dummy never matches. The cost is the point.
    }
    return { valid: false, needsRehash: false };
  }

  try {
    const valid = await verify(storedHash, password);
    return { valid, needsRehash: valid && needsRehash(storedHash) };
  } catch {
    // A malformed hash is a failed sign-in, not a crash.
    return { valid: false, needsRehash: false };
  }
}

/**
 * Whether a stored hash was made with weaker parameters than the current
 * default, so it can be upgraded on the next successful sign-in.
 *
 * Read off the encoded hash's own parameter block rather than asked of the
 * library, which exposes no equivalent of argon2-cffi's `check_needs_rehash`.
 */
function needsRehash(storedHash: string): boolean {
  if (!storedHash.startsWith("$argon2id$")) return true;
  const match = /\$m=(\d+),t=(\d+),p=(\d+)\$/.exec(storedHash);
  if (!match) return true;
  const [, memory, time, parallelism] = match;
  // The library's own defaults, which is what a fresh hash would use.
  return Number(memory) < 19_456 || Number(time) < 2 || Number(parallelism) < 1;
}

// --- Signed values ----------------------------------------------------------

const SESSION_SALT = "toptutorsforus.session";
const CSRF_SALT = "toptutorsforus.csrf";
const CSRF_MAX_AGE = 86_400;

function b64url(value: Buffer | string): string {
  return Buffer.from(value).toString("base64url");
}

function signature(salt: string, body: string): string {
  return createHmac("sha256", `${settings().secretKey}:${salt}`).update(body).digest("base64url");
}

/**
 * Sign a payload with the moment it was signed, so it can expire.
 *
 * `<base64url(json)>.<base64url(seconds)>.<hmac over both>` — the timestamp is
 * inside the signed body rather than beside it, so it cannot be edited to
 * extend a token's life.
 */
function sign(salt: string, payload: unknown): string {
  const body = `${b64url(JSON.stringify(payload))}.${b64url(String(Math.floor(Date.now() / 1000)))}`;
  return `${body}.${signature(salt, body)}`;
}

function unsign(salt: string, token: string | null | undefined, maxAge: number): unknown {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [encoded, stamp, provided] = parts as [string, string, string];

  const expected = signature(salt, `${encoded}.${stamp}`);
  // Constant-time, and length-checked first because timingSafeEqual throws on a
  // length mismatch — which would itself be a timing signal.
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const issued = Number(Buffer.from(stamp, "base64url").toString());
  if (!Number.isFinite(issued)) return null;
  if (Math.floor(Date.now() / 1000) - issued > maxAge) return null;

  try {
    return JSON.parse(Buffer.from(encoded, "base64url").toString());
  } catch {
    return null;
  }
}

/** Sign a session value. Contains the user id only. */
export function issueSession(userId: bigint | number): string {
  return sign(SESSION_SALT, { uid: String(userId) });
}

/** The user id from a session cookie, or null if it is not usable. */
export function readSession(token: string | null | undefined): bigint | null {
  const payload = unsign(SESSION_SALT, token, settings().sessionMaxAge);
  if (payload === null || typeof payload !== "object") return null;
  const uid = (payload as { uid?: unknown }).uid;
  if (typeof uid !== "string" || !/^\d+$/.test(uid)) return null;
  return BigInt(uid);
}

/** A CSRF token bound to this session, so it cannot be reused across accounts. */
export function issueCsrf(sessionToken: string): string {
  return sign(CSRF_SALT, { s: fingerprint(sessionToken) });
}

export function checkCsrf(
  sessionToken: string | null | undefined,
  submitted: string | null | undefined,
): boolean {
  if (!submitted) return false;
  const payload = unsign(CSRF_SALT, submitted, CSRF_MAX_AGE);
  if (payload === null || typeof payload !== "object") return false;

  const expected = fingerprint(sessionToken ?? "");
  const provided = String((payload as { s?: unknown }).s ?? "");
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** A short, non-reversible tag for the session, for binding the CSRF token. */
function fingerprint(sessionToken: string): string {
  return createHmac("sha256", settings().secretKey.slice(0, 32))
    .update(sessionToken)
    .digest("hex")
    .slice(0, 32);
}

// --- Rate limiting ----------------------------------------------------------

/**
 * A fixed-window counter, per key, held in this process.
 *
 * Deliberately simple and deliberately local. See the module comment.
 */
export class RateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    readonly limit: number,
    readonly windowSeconds: number,
  ) {}

  /** Record an attempt and report whether it is within the limit. */
  check(key: string): boolean {
    const now = Date.now();
    const cutoff = now - this.windowSeconds * 1000;
    const kept = (this.hits.get(key) ?? []).filter((at) => at > cutoff);
    kept.push(now);
    this.hits.set(key, kept);
    if (this.hits.size > 10_000) this.prune(cutoff); // bound memory under a spray of keys
    return kept.length <= this.limit;
  }

  /** Clear a key, called after a successful sign-in. */
  reset(key: string): void {
    this.hits.delete(key);
  }

  private prune(cutoff: number): void {
    for (const [key, times] of this.hits) {
      if (!times.some((at) => at > cutoff)) this.hits.delete(key);
    }
  }
}

/**
 * The limiters, kept on `globalThis` because the dev server reloads modules on
 * every edit and a fresh counter per reload is not a limit at all.
 */
const globalForLimiters = globalThis as unknown as {
  limiters?: { login: RateLimiter; invite: RateLimiter; public: RateLimiter };
};

globalForLimiters.limiters ??= {
  // Sign-in: slow enough to make credential stuffing impractical, loose enough
  // that a person mistyping a password twice is not locked out.
  login: new RateLimiter(10, 300),
  // Invitations: an authenticated but abusable endpoint that sends mail.
  invite: new RateLimiter(30, 3600),
  // Public booking-adjacent endpoints.
  public: new RateLimiter(60, 60),
};

export const loginLimiter = globalForLimiters.limiters.login;
export const inviteLimiter = globalForLimiters.limiters.invite;
export const publicLimiter = globalForLimiters.limiters.public;

/** Whether cookies should carry the Secure flag. */
export function isSecureEnvironment(): boolean {
  return settings().isProduction;
}
