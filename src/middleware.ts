/**
 * Two jobs, and they are here for the same reason: both have to happen before
 * anything renders.
 *
 * **A Content-Security-Policy, with a per-request nonce.** The stylesheet and
 * `lib/timegrid.ts` have both said `style-src 'self'` for as long as they have
 * existed — it is why a grid row resolves to a hand-written class instead of an
 * inline `top`, and why there is not one `style=` attribute in the codebase.
 * There was no such header. The constraint was obeyed everywhere and enforced
 * nowhere, so the design cost had been paid and the protection had not been
 * collected; a comment describing a policy no browser was ever told about is
 * worse than none, because it reads as a guarantee.
 *
 * A nonce rather than `'unsafe-inline'`, because Next inlines its own hydration
 * payload as a script and permitting inline script wholesale is permitting the
 * thing the policy exists to stop. It has to be minted per request, which is
 * what puts the policy here rather than in `next.config.ts` beside the static
 * headers: those are the same on every response and this one cannot be.
 *
 * **An older link, honoured once.**
 *
 * Filter state used to be the query string, so links, bookmarks and anything
 * anybody pasted into a chat carry it: `/people?role=student`,
 * `/calendar?view=week&status=missed`. The screens no longer read the address —
 * see `lib/web/filterState.ts` — so left alone, one of those would quietly show
 * an unfiltered page, which is worse than either honouring it or refusing it.
 *
 * So the parameters that screen understands are copied into its filter cookie
 * and the request is sent on to the bare path. What arrives is the page the
 * link meant, at an address that no longer says so.
 *
 * **This is the only place a URL changes on its own**, and it is an arrival
 * rather than something done on the page: the redirect happens before anything
 * renders, and it is the last time those parameters exist.
 *
 * **It parses nothing.** An earlier draft ran each screen's real parser and
 * serialiser here, which dragged the service layer — and through it Prisma and
 * `node:crypto` — into the edge runtime, where they do not build. It is not
 * needed: the cookie is read by those same parsers, which have always accepted
 * every spelling of a value, so an uncanonical string stored here reads
 * identically and is rewritten in canonical form by the next filter change.
 * What is worth doing here is dropping keys the screen never read, so a link
 * full of tracking parameters does not become a filter cookie full of them.
 *
 * No loop is possible: the address it redirects to has no parameters.
 *
 * `/sessions/export.csv` shares a prefix with one of these screens and still
 * takes its filter from its own query string, because it is a download rather
 * than a page. The matcher is exact paths for that reason.
 */

import { NextResponse, type NextRequest } from "next/server";

/**
 * The policy, given this request's nonce.
 *
 * `strict-dynamic` lets the nonced bootstrap load the chunks it needs without
 * every chunk URL being listed, and tells a browser that understands it to
 * ignore the host allow-list — which is the point: an allow-list is only as
 * good as its least careful entry.
 *
 * Development differs in exactly three ways, all of them the dev server's own
 * machinery: it compiles with `eval`, it injects styles as inline `<style>`
 * rather than linking a built stylesheet, and it holds a websocket open for
 * hot reload. Production gets none of the three, so none of them is a hole
 * anybody ships.
 */
function policy(nonce: string, dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self'${dev ? " 'unsafe-inline'" : ""}`,
    // `data:` for the inlined mark; no remote images, so no remote host to
    // quietly become an exfiltration channel for a URL that names a person.
    "img-src 'self' data:",
    "font-src 'self'",
    `connect-src 'self'${dev ? " ws: wss:" : ""}`,
    // Nothing here embeds a plugin, frames anything, or is meant to be framed.
    "object-src 'none'",
    "frame-src 'none'",
    "frame-ancestors 'none'",
    // A `<base>` tag would re-point every relative URL on the page, which turns
    // one injected tag into a redirect of every form on it.
    "base-uri 'none'",
    // Every form on this product posts to this product.
    "form-action 'self'",
    ...(dev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}

/** What each screen has ever read off an address. Anything else is dropped. */
const SCREENS = {
  "/people": {
    cookie: "toptutorsforus_people_filter",
    keys: ["q", "role", "status", "region", "district", "school"],
  },
  "/sessions": {
    cookie: "toptutorsforus_sessions_filter",
    keys: ["q", "status", "from", "to", "instructor", "program", "page", "columns"],
  },
  "/calendar": {
    cookie: "toptutorsforus_calendar_filter",
    keys: ["view", "date", "q", "status"],
  },
} as const;

export function middleware(request: NextRequest): NextResponse {
  const { pathname, searchParams } = request.nextUrl;

  // One nonce per request, from the platform's CSPRNG. `Math.random` would be
  // a nonce an attacker can predict, which is a nonce that is not one.
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const csp = policy(nonce, process.env.NODE_ENV !== "production");
  // On the *request* as well as the response: that is how Next finds the nonce
  // to put on the script tags it writes itself. Setting only the response
  // header yields a policy its own page cannot satisfy.
  const forwarded = new Headers(request.headers);
  forwarded.set("x-nonce", nonce);
  forwarded.set("content-security-policy", csp);
  const carry = (response: NextResponse): NextResponse => {
    response.headers.set("content-security-policy", csp);
    return response;
  };

  const screen = SCREENS[pathname as keyof typeof SCREENS];
  if (screen === undefined || [...searchParams.keys()].length === 0) {
    return carry(NextResponse.next({ request: { headers: forwarded } }));
  }

  const kept = new URLSearchParams();
  for (const key of screen.keys) {
    for (const value of searchParams.getAll(key)) {
      if (value !== "") kept.append(key, value);
    }
  }

  const bare = new URL(request.nextUrl);
  bare.search = "";
  const response = carry(NextResponse.redirect(bare));

  const stored = kept.toString().replaceAll("%2C", ",");
  if (stored === "") {
    // The link said nothing a filter could be made of — `?utm_source=…`, or
    // parameters that all mean their own default. Clearing is right: the
    // address asked for an unfiltered screen.
    response.cookies.delete({ name: screen.cookie, path: pathname });
  } else {
    response.cookies.set(screen.cookie, stored, {
      path: pathname,
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 90,
    });
  }
  return response;
}

/**
 * Everything a person can be served, which is wider than it was.
 *
 * It used to be the three screens that honour an older link, because that was
 * the only job. A policy that covers three pages is not a policy, so the
 * matcher now takes every path except the ones that are bytes on disk — the
 * build's own assets, the images, the icon. Those are served with the static
 * headers from `next.config.ts` and have no scripts to govern.
 *
 * The redirect is still exactly those three paths: it is keyed on `SCREENS`,
 * not on the matcher. `/sessions/export.csv` shares a prefix with one of them
 * and keeps its own query string, which is why that lookup is an exact match
 * and not a prefix.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|img/|favicon.ico).*)"],
};
