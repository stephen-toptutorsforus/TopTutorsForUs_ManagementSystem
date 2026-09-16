import type { NextConfig } from "next";

/**
 * The headers that are the same on every response.
 *
 * The Content-Security-Policy is deliberately not here — it carries a
 * per-request nonce, so it is minted in `src/middleware.ts`. These are the ones
 * with nothing per-request in them, and they are set here so they reach the
 * static assets too, which the middleware does not run for.
 */
const SECURITY_HEADERS = [
  // Stop a browser guessing that a CSV export, or an uploaded file, is really
  // HTML and running it as a page on this origin.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // `frame-ancestors 'none'` in the CSP says this to any browser from the last
  // decade; this says it to the ones before that, and costs a header.
  { key: "X-Frame-Options", value: "DENY" },
  // A referrer is a URL, and a URL on this product can name a record. Same
  // origin gets the path, everybody else gets the origin and nothing more.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Nothing here wants a camera, a microphone or a location, and a feature not
  // asked for is a permission prompt nobody should ever see on this product.
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()",
  },
];

/**
 * HSTS, in production only.
 *
 * Over plain HTTP it is ignored, so setting it in development would be
 * decoration — and a developer whose browser has pinned `localhost` to HTTPS
 * for two years because a config file was tidy has a bad afternoon ahead.
 * No `preload`: that is a submission to a list this cannot be removed from
 * quickly, and it is the deployment's decision, not this file's.
 */
const HSTS = {
  key: "Strict-Transport-Security",
  value: "max-age=63072000; includeSubDomains",
};

const nextConfig: NextConfig = {
  // A self-contained server bundle, so the container image needs Node and a
  // minimal node_modules rather than the whole repository.
  output: "standalone",

  /**
   * `X-Powered-By: Next.js` names the framework and its major version to
   * anybody who asks, which is a free hint about which advisories to try. It
   * buys nothing back.
   */
  poweredByHeader: false,

  async headers() {
    const production = process.env.NODE_ENV === "production";
    return [
      {
        source: "/:path*",
        headers: production ? [...SECURITY_HEADERS, HSTS] : SECURITY_HEADERS,
      },
    ];
  },

  /**
   * The Argon2 binding is a native module with no browser build. Without this
   * it is traced into the client bundle — through the sign-in form, which
   * imports a server action, which imports the hasher — and the build fails on
   * a `browser.js` stub that exports nothing. Naming it here keeps it on the
   * server, where password hashing belongs anyway.
   */
  serverExternalPackages: ["@node-rs/argon2"],

  /**
   * `CLAUDE.md` says the dev server is at `http://127.0.0.1:3000`, and Next 16
   * serves it on `localhost`. Dev resources — `/_next/webpack-hmr` and the
   * client chunks with it — are refused across that difference by default, so
   * at 127.0.0.1 the page renders, styles, and **never hydrates**: no handler
   * anywhere on the page runs.
   *
   * It cost nothing while every panel opened from a URL fragment, because CSS
   * did that work. Now that the overlays are React state, an unhydrated page is
   * an application whose buttons do nothing — which is exactly how this was
   * found. The two addresses are the same machine; saying so here is the whole
   * fix, and it applies to development only.
   */
  allowedDevOrigins: ["127.0.0.1"],

  experimental: {
    /**
     * `forbidden()` and `unauthorized()`. Without them a refusal from the
     * policy layer reaches the browser as a 500, which is both the wrong status
     * and the wrong story — "something broke" rather than "you may not".
     */
    authInterrupts: true,
  },
};

export default nextConfig;
