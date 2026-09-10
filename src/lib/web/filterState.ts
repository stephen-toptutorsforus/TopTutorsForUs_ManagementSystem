/**
 * Where a screen's filter lives, now that it is not the address bar.
 *
 * The rule this replaces was "the URL says the state, and only the state": a
 * filter, a page number, a calendar range and a set of columns all rode in the
 * query string, so a refresh, a bookmark and a link sent to a colleague all
 * meant the same thing. That is a real property and it is being given up
 * deliberately — the address of a page must not change as a result of anything
 * done on that page.
 *
 * What replaces it is a cookie per screen, written by a server action and read
 * on the next render. Three things made that the cheapest way to do it:
 *
 * - **The pages stay server components.** Filtering still happens in the
 *   service layer, under the same policy checks and the same tenant scoping,
 *   against the database rather than in the browser over a list somebody was
 *   already allowed to see.
 * - **The serialisers survive.** The cookie's value *is* the canonical query
 *   string the address used to hold, so `directoryQuery`, `toQuery` and
 *   `queryString` keep their jobs and their tests. Only the destination
 *   changed.
 * - **It works without a script.** A `<form action={serverAction}>` posts and
 *   the page re-renders; the address is untouched either way.
 *
 * What it costs, stated where somebody will find it: two tabs on the same
 * screen now share one filter, a filtered view cannot be bookmarked or sent to
 * anybody, and Back no longer steps through filter changes. Export CSV is the
 * one place a query string remains, because it is a download rather than a
 * page.
 */

import { cookies } from "next/headers";

/** The screens that hold a filter. Each owns one cookie. */
export type FilterScreen = "people" | "sessions" | "calendar";

const COOKIE: Record<FilterScreen, string> = {
  people: "toptutorsforus_people_filter",
  sessions: "toptutorsforus_sessions_filter",
  calendar: "toptutorsforus_calendar_filter",
};

/** Where each screen lives, for the cookie's path and for revalidation. */
export const SCREEN_PATH: Record<FilterScreen, string> = {
  people: "/people",
  sessions: "/sessions",
  calendar: "/calendar",
};

/**
 * Long enough to still be there after a weekend and a holiday, short enough
 * that a filter set once and forgotten does not follow somebody for ever. The
 * same span the calendar's remembered status used, which this supersedes.
 */
const MAX_AGE = 60 * 60 * 24 * 90;

/**
 * A cap on what will be read back. The value is written by this application,
 * but it arrives from the browser like any other header and a hand-edited one
 * should cost a parse, not a page.
 */
const MAX_LENGTH = 2048;

/**
 * The screen's filter, in the shape every parser here already takes.
 *
 * An absent or oversized cookie reads as no filter at all, which is the same
 * thing an empty query string used to mean — so every parser's existing
 * behaviour for "nothing set" is what governs a first visit.
 */
export async function readScreenState(screen: FilterScreen): Promise<URLSearchParams> {
  const raw = (await cookies()).get(COOKIE[screen])?.value ?? "";
  if (raw.length > MAX_LENGTH) return new URLSearchParams();
  return new URLSearchParams(raw);
}

/**
 * Replace it. `query` is the canonical serialisation the address used to carry,
 * so an empty string means "nothing set" and the cookie is removed rather than
 * stored empty.
 *
 * `httpOnly`, because nothing in the browser reads this — the server renders
 * from it. Path-scoped, so the directory's filter is not sent with every
 * request for the calendar.
 */
export async function writeScreenState(
  screen: FilterScreen,
  query: string,
): Promise<void> {
  const jar = await cookies();
  if (query === "") {
    jar.delete({ name: COOKIE[screen], path: SCREEN_PATH[screen] });
    return;
  }
  jar.set(COOKIE[screen], query, {
    path: SCREEN_PATH[screen],
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MAX_AGE,
  });
}

/** Every cookie this module owns — what signing out clears. */
export const FILTER_COOKIES: readonly string[] = Object.values(COOKIE);

/**
 * A form's fields as the parsers want them.
 *
 * A checkbox group arrives as repeated entries under one name, which is what
 * `URLSearchParams` holds too, so this is a copy rather than a translation.
 * Files are dropped: no filter field is one, and a `File` has no string form
 * worth guessing at.
 */
export function paramsFromForm(form: FormData): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of form.entries()) {
    if (typeof value === "string") params.append(key, value);
  }
  return params;
}
