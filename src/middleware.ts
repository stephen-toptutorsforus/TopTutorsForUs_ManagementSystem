/**
 * An older link, honoured once.
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
  const screen = SCREENS[pathname as keyof typeof SCREENS];
  if (screen === undefined || [...searchParams.keys()].length === 0) {
    return NextResponse.next();
  }

  const kept = new URLSearchParams();
  for (const key of screen.keys) {
    for (const value of searchParams.getAll(key)) {
      if (value !== "") kept.append(key, value);
    }
  }

  const bare = new URL(request.nextUrl);
  bare.search = "";
  const response = NextResponse.redirect(bare);

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

export const config = {
  matcher: ["/people", "/sessions", "/calendar"],
};
