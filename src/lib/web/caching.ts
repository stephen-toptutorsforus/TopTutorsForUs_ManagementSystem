/**
 * What may be stored, and by whom.
 *
 * Next sets `private, no-cache, no-store, max-age=0, must-revalidate` on a
 * dynamically rendered *page*, and sets nothing at all on a route handler's
 * response. Every route handler here answers with tenant data: the session
 * export is a CSV of who was taught and when, the JSON API is the same rows in
 * another shape, and both are authorised by a cookie. A response with no
 * `Cache-Control` is one a shared cache may keep on its own heuristics — and a
 * cache that keeps a per-tenant answer under a URL that does not name the
 * tenant is a cache that hands it to the next person who asks.
 *
 * `Vary` does not save it. Next adds its own router `Vary` values, none of
 * which is `Cookie`, so the identity the answer actually depends on is not in
 * the key. Rather than add `Vary: Cookie` — which asks every cache in the path
 * to be careful, and quietly loses if one is not — these responses say they may
 * not be stored at all.
 *
 * `private` and `no-store` together on purpose. `private` refuses the shared
 * caches; `no-store` refuses the browser's disk as well, which matters on the
 * export in particular, since that one is a file about students and this
 * product does not leave those lying in a cache directory.
 */

/** For anything that answers with one tenant's data. */
export const NO_STORE = "private, no-store, max-age=0";

/**
 * For a health probe.
 *
 * Not about secrecy — about truth. A readiness answer is only worth anything at
 * the instant it is given, and a load balancer reading a cached "ok" from the
 * minute before is exactly the failure the endpoint exists to prevent.
 */
export const NO_STORE_PROBE = "no-store, max-age=0";

/** The same, as a headers object, for a `Response.json` that takes one. */
export const NO_STORE_HEADERS = { "cache-control": NO_STORE } as const;
