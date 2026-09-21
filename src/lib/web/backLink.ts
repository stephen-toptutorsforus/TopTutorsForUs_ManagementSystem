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
 * **The referrer alone is not enough, and that was a real defect.** A server
 * action re-renders the page it was submitted from, and the `Referer` on that
 * POST is the page itself — so the moment anybody saved an edit, "back" stopped
 * meaning "the calendar I came from" and silently became the session list. The
 * screens that lead into a record therefore say where they are in a `from`
 * parameter, which survives every re-render because it is in the address; the
 * referrer stays as the fallback for a link written before this existed, and
 * for anybody arriving from the audit trail or a bookmark.
 *
 * The *label* is not this module's business: the button says "Back" wherever
 * it goes. Naming the destination meant a map of paths to words that had to be
 * kept in step with the routes, and got a screen wrong the moment somebody
 * added one.
 */

/** The fallback, when the referrer says nothing usable. */
export const SESSION_LIST = "/sessions";

/**
 * A `from` parameter, as a path, or null if it is not one.
 *
 * Treated as hostile: it reaches the page from the address bar, and the value
 * ends up in an `href`. Only a single-slash absolute path is accepted, which
 * rules out `//evil.test` (protocol-relative, and a browser reads it as a host)
 * and anything carrying a scheme.
 */
export function originPath(value: string | string[] | undefined): string | null {
  const asked = Array.isArray(value) ? value[0] : value;
  if (typeof asked !== "string" || asked.length === 0) return null;
  if (!asked.startsWith("/") || asked.startsWith("//")) return null;
  if (asked.includes(":") || asked.includes("\\")) return null;
  return asked;
}

/** `?from=` for a link into a record, or "" when there is nowhere to say. */
export function fromQuery(origin: string | null | undefined): string {
  return origin ? `?from=${encodeURIComponent(origin)}` : "";
}

/**
 * @param referer the request's `Referer` header, if it sent one
 * @param host the request's own `Host`, which the referrer must match
 * @param currentPath the page being rendered, so it never links to itself
 * @param from the `from` parameter, which wins because it survives a re-render
 * @returns a same-origin path, always beginning with `/`
 */
export function backTarget(
  referer: string | null,
  host: string | null,
  currentPath: string,
  from?: string | string[] | undefined,
): string {
  const stated = originPath(from);
  if (stated !== null && stated !== currentPath) return stated;

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
