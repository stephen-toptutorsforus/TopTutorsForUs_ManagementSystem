import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // A self-contained server bundle, so the container image needs Node and a
  // minimal node_modules rather than the whole repository.
  output: "standalone",

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
