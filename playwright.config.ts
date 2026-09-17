/**
 * Browser tests.
 *
 * The third suite, and deliberately the smallest. `npm test` covers pure logic
 * and `npm run test:db` covers the database; neither has ever rendered a page,
 * so nothing in either can notice a stylesheet that puts half a table
 * off-screen. This suite exists for that class of defect and little else — it
 * asserts what a page *is*, not what it looks like, so it does not have to be
 * rewritten every time a colour changes.
 *
 * Kept separate from the other two so a machine with no browsers installed can
 * still gate the logic that does not need them.
 */

import { defineConfig, devices } from "@playwright/test";

/**
 * Its own port, and its own build.
 *
 * Not the dev server on 3000. Two reasons, both found the hard way: a dev
 * server compiles routes on demand, so the first request to each pays for it
 * and slow tests time out under a parallel run — and it can serve a stale
 * bundle when its HMR socket has dropped, which means a green suite proves
 * nothing about the code on disk. A build is slower to start once and honest
 * about what it is testing. The separate port also means a dev server can stay
 * running while these do.
 *
 * `reuseExistingServer` used to be on outside CI, and reintroduced the very
 * hazard the paragraph above exists to avoid — from the other direction. A
 * server left running from an earlier command is a *build* from an earlier
 * command, so an edit made since is not under test and the suite goes green on
 * code that is no longer there. That is not theoretical: a whole afternoon's
 * runs passed that way here, and the change they were supposedly proving turned
 * out to break seven tests the moment the port was cleared. Rebuilding costs
 * about fifteen seconds. A green suite that proves nothing costs more.
 */
const PORT = process.env.E2E_PORT ?? "3100";
const BASE_URL = process.env.E2E_BASE_URL ?? `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  reporter: [["list"]],
  timeout: 30_000,
  expect: { timeout: 10_000 },

  use: {
    baseURL: BASE_URL,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },

  /* One browser, two widths. The viewport is overridden rather than a phone
     device preset borrowed: these tests are about the layout at a width, and a
     preset would also bring a touch model and a user agent that nothing here
     asserts on. */
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],

  webServer: {
    /*
     * `npm start`, which serves the standalone bundle — the artifact a
     * deployment actually runs — rather than `next start`, which serves out of
     * `.next/` and is a different thing.
     *
     * It matters more than it sounds. `.next/standalone/` ships `server.js` and
     * a trimmed `node_modules` and nothing else: no client chunks, no `public/`.
     * Run as it comes out of the build it answers 200 for every page and 404s
     * every stylesheet and script. This suite was green throughout, because it
     * was testing something else. `scripts/serve.mjs` assembles the bundle and
     * runs it, so what these tests drive is what a container would.
     */
    command: `npm run build && npm start`,
    url: BASE_URL,
    env: { ...process.env, PORT },
    reuseExistingServer: false,
    timeout: 420_000,
  },
});
