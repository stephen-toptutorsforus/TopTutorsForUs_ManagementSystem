import { defineConfig } from "vitest/config";

// The pure-logic suite: civil time, recurrence, conflict rules, and the shared
// components, which render to a string with `react-dom/server` rather than into
// a DOM — they are server components with no state, so a jsdom environment would
// buy nothing but a dependency. No database, so it runs anywhere and gates every
// commit.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    exclude: ["tests/db/**"],
    environment: "node",
  },
  resolve: { alias: { "@": new URL("./src/", import.meta.url).pathname } },
});
