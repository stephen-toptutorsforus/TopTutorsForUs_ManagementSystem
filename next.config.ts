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
