import { defineConfig } from "vitest/config";

// The pure-logic suite: civil time, recurrence, conflict rules. No database, so
// it runs anywhere and gates every commit.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/db/**"],
    environment: "node",
  },
  resolve: { alias: { "@": new URL("./src/", import.meta.url).pathname } },
});
