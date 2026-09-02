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
  },
  resolve: { alias: { "@": new URL("./src/", import.meta.url).pathname } },
});
