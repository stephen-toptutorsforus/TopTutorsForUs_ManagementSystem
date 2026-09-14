/**
 * Where "back" goes from a record's own page.
 *
 * A session is reached from six places — the calendar, its time grid, the
 * session list, the dashboard, a series, the audit trail — so a fixed
 * destination is wrong five times out of six. `router.back()` would be right
 * every time and costs the page its script-free behaviour, which every other
 * control here keeps.
 *
 * So the referrer decides, and it is treated as untrusted input: only the path
 * of a same-host URL is ever used, never the whole URL, so nothing here can
 * become a redirect to somewhere else. A referrer that is missing, foreign,
 * unparseable, or the current page itself falls back to the session list.
 *
 * Only the path is kept. Every screen's filter state lives in a cookie rather
 * than the address — see `lib/web/filterState.ts` — so a bare path returns
 * somebody to the calendar they were looking at, not to a reset one.
 *
 * The *label* is not this module's business: the button says "Back" wherever
 * it goes. Naming the destination meant a map of paths to words that had to be
 * kept in step with the routes, and got a screen wrong the moment somebody
 * added one.
 */

/** The fallback, when the referrer says nothing usable. */
export const SESSION_LIST = "/sessions";

/**
 * @param referer the request's `Referer` header, if it sent one
 * @param host the request's own `Host`, which the referrer must match
 * @param currentPath the page being rendered, so it never links to itself
 * @returns a same-origin path, always beginning with `/`
 */
export function backTarget(
  referer: string | null,
  host: string | null,
  currentPath: string,
): string {
  if (!referer || !host) return SESSION_LIST;

  let url: URL;
  try {
    url = new URL(referer);
  } catch {
    return SESSION_LIST;
  }

  // Same host only, and http(s) only: a referrer from anywhere else is either
  // somebody else's page or a scheme this application does not serve.
  if (url.host !== host) return SESSION_LIST;
  if (url.protocol !== "http:" && url.protocol !== "https:") return SESSION_LIST;

  const path = url.pathname;
  // A reload, or a redirect that landed here from here. Going "back" to the
  // page somebody is already on is a button that does nothing.
  if (path === currentPath) return SESSION_LIST;
  // Not a page: a download, or the API. Neither is somewhere to return to.
  if (path.startsWith("/api/") || path.endsWith(".csv")) return SESSION_LIST;

  return path;
}
