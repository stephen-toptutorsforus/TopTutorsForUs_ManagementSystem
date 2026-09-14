/**
 * Where "back" goes from a record's own page.
 *
 * A session is reached from six places — the calendar, its time grid, the
 * session list, the dashboard, a series, the audit trail — so a fixed link is
 * wrong five times out of six. `router.back()` would be right every time and
 * costs the page its script-free behaviour, which every other control here
 * keeps.
 *
 * So the referrer decides, and it is treated as untrusted input: only the path
 * of a same-host URL is ever used, never the whole URL, so nothing here can
 * become a redirect to somewhere else. A referrer that is missing, foreign,
 * unparseable, or the current page itself falls back to the session list.
 *
 * Only the path is kept. Every screen's filter state lives in a cookie rather
 * than the address — see `lib/web/filterState.ts` — so a bare path returns
 * somebody to the calendar they were looking at, not to a reset one.
 */

export interface BackTarget {
  readonly href: string;
  readonly label: string;
}

/** The fallback, when the referrer says nothing usable. */
export const SESSION_LIST: BackTarget = { href: "/sessions", label: "Back to sessions" };

/**
 * What to call each destination.
 *
 * Longest prefix first, so `/sessions/new` is not read as the session list.
 * Anything unlisted gets a plain "Back": a label invented from a path segment
 * reads like a bug the first time somebody adds a route.
 */
const LABELS: readonly (readonly [string, string])[] = [
  ["/sessions/new", "Back to booking"],
  ["/sessions", "Back to sessions"],
  ["/calendar", "Back to calendar"],
  ["/series", "Back to series"],
  ["/people", "Back to people"],
  ["/groups", "Back to groups"],
  ["/availability", "Back to availability"],
  ["/audit", "Back to history"],
];

function labelFor(path: string): string {
  if (path === "/") return "Back to insights";
  const match = LABELS.find(([prefix]) => path === prefix || path.startsWith(`${prefix}/`));
  return match ? match[1] : "Back";
}

/**
 * @param referer the request's `Referer` header, if it sent one
 * @param host the request's own `Host`, which the referrer must match
 * @param currentPath the page being rendered, so it never links to itself
 */
export function backTarget(
  referer: string | null,
  host: string | null,
  currentPath: string,
): BackTarget {
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

  return { href: path, label: labelFor(path) };
}
