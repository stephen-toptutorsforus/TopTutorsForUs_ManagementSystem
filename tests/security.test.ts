/**
 * Authentication primitives.
 *
 * The signing here is written out rather than pulled in, so it needs its own
 * tests: the reference leans on `itsdangerous` and tests the behaviour it buys,
 * while this has to test the behaviour it implements. Everything the reference
 * relies on is asserted — expiry, tampering, and the session binding that stops
 * a CSRF token being carried between accounts.
 */

import { beforeAll, describe, expect, it, vi } from "vitest";

import {
  RateLimiter,
  checkCsrf,
  hashPassword,
  issueCsrf,
  issueSession,
  readSession,
  verifyPassword,
} from "@/lib/security";

beforeAll(() => {
  process.env.SECRET_KEY = "a-test-key-that-is-comfortably-over-32-characters";
});

describe("passwords", () => {
  it("hashes with argon2id and verifies", async () => {
    const stored = await hashPassword("correct horse battery staple");

    expect(stored.startsWith("$argon2id$")).toBe(true);
    expect((await verifyPassword(stored, "correct horse battery staple")).valid).toBe(true);
    expect((await verifyPassword(stored, "wrong")).valid).toBe(false);
  });

  it("never stores the password itself", async () => {
    const stored = await hashPassword("correct horse battery staple");
    expect(stored).not.toContain("correct horse");
  });

  it("produces a different hash each time", async () => {
    // A per-hash salt, so two people with the same password do not share a row
    // that says so.
    const first = await hashPassword("same");
    const second = await hashPassword("same");
    expect(first).not.toBe(second);
  });

  it("still does the work when there is no stored hash", async () => {
    // Timing must not distinguish an unknown address from a wrong password.
    const started = Date.now();
    const result = await verifyPassword(null, "anything");
    const elapsed = Date.now() - started;

    expect(result.valid).toBe(false);
    // A no-op would return in well under a millisecond; argon2 cannot.
    expect(elapsed).toBeGreaterThan(1);
  });

  it("treats a malformed stored hash as a failed sign-in, not a crash", async () => {
    expect((await verifyPassword("not-a-hash", "anything")).valid).toBe(false);
  });

  it("asks for a rehash only when the parameters are behind", async () => {
    const current = await hashPassword("x");
    expect((await verifyPassword(current, "x")).needsRehash).toBe(false);
  });
});

describe("the session cookie", () => {
  it("round-trips a user id", () => {
    expect(readSession(issueSession(42n))).toBe(42n);
  });

  it("refuses a tampered token", () => {
    const token = issueSession(42n);
    const [payload, stamp, mac] = token.split(".");
    const forged = `${Buffer.from(JSON.stringify({ uid: "1" })).toString("base64url")}.${stamp}.${mac}`;

    expect(readSession(forged)).toBeNull();
    expect(readSession(`${payload}.${stamp}.${"a".repeat(mac!.length)}`)).toBeNull();
  });

  it("refuses nonsense rather than throwing", () => {
    expect(readSession(null)).toBeNull();
    expect(readSession("")).toBeNull();
    expect(readSession("not.a.token")).toBeNull();
    expect(readSession("one-part")).toBeNull();
  });

  it("expires", () => {
    const token = issueSession(42n);
    expect(readSession(token)).toBe(42n);

    // Thirteen hours later, past the twelve-hour default.
    vi.useFakeTimers();
    vi.setSystemTime(new Date(Date.now() + 13 * 3_600_000));
    expect(readSession(token)).toBeNull();
    vi.useRealTimers();
  });

  it("carries the id and nothing else", () => {
    const [payload] = issueSession(42n).split(".");
    const decoded = JSON.parse(Buffer.from(payload!, "base64url").toString());

    expect(Object.keys(decoded)).toEqual(["uid"]);
  });
});

describe("CSRF", () => {
  it("accepts a token bound to the same session", () => {
    const session = issueSession(42n);
    expect(checkCsrf(session, issueCsrf(session))).toBe(true);
  });

  it("refuses a token lifted from another session", () => {
    // The whole point of binding: a token harvested from one account must not
    // authorise a form submitted by another.
    const mine = issueSession(42n);
    const theirs = issueSession(43n);

    expect(checkCsrf(mine, issueCsrf(theirs))).toBe(false);
  });

  it("refuses a missing or malformed token", () => {
    const session = issueSession(42n);
    expect(checkCsrf(session, null)).toBe(false);
    expect(checkCsrf(session, "")).toBe(false);
    expect(checkCsrf(session, "garbage")).toBe(false);
  });

  it("refuses a token when there is no session at all", () => {
    expect(checkCsrf(null, issueCsrf(issueSession(42n)))).toBe(false);
  });
});

describe("rate limiting", () => {
  it("allows up to the limit and refuses past it", () => {
    const limiter = new RateLimiter(3, 60);

    expect(limiter.check("ip:one")).toBe(true);
    expect(limiter.check("ip:one")).toBe(true);
    expect(limiter.check("ip:one")).toBe(true);
    expect(limiter.check("ip:one")).toBe(false);
  });

  it("counts each key separately", () => {
    const limiter = new RateLimiter(1, 60);

    expect(limiter.check("ip:one")).toBe(true);
    expect(limiter.check("ip:two")).toBe(true);
    expect(limiter.check("ip:one")).toBe(false);
  });

  it("clears a key on reset, so a successful sign-in is not punished", () => {
    const limiter = new RateLimiter(1, 60);

    limiter.check("ip:one");
    limiter.reset("ip:one");
    expect(limiter.check("ip:one")).toBe(true);
  });

  it("forgets attempts once the window has passed", () => {
    vi.useFakeTimers();
    const limiter = new RateLimiter(1, 60);

    expect(limiter.check("ip:one")).toBe(true);
    expect(limiter.check("ip:one")).toBe(false);

    vi.setSystemTime(new Date(Date.now() + 61_000));
    expect(limiter.check("ip:one")).toBe(true);
    vi.useRealTimers();
  });
});
