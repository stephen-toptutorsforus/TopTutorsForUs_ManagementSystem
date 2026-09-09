import { defineConfig } from "vitest/config";

// The database-backed suite. Separate from the pure one so a machine with no
// Postgres can still run and gate the logic that does not need it.
export default defineConfig({
  test: {
    include: ["tests/db/**/*.test.ts"],
    setupFiles: ["dotenv/config"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
    // `beforeAll` here is not a cheap hook: the first `testClient()` in each
    // worker shells out to `npx prisma migrate deploy`, which resolves `npx`,
    // loads the Prisma CLI and replays the migrations. On a cold cache that
    // passes the 10s vitest allows a hook by default, and the file fails with
    // "Hook timed out" and 44 skipped tests — intermittently, which is worse
    // than always. `testTimeout` was raised for the same reason and this was
    // missed.
    hookTimeout: 60_000,
  },
  resolve: { alias: { "@": new URL("./src/", import.meta.url).pathname } },
});
