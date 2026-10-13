/**
 * Vitest configuration.
 *
 * Tests run against plain modules, so they deliberately do not load the app's
 * Nitro and TanStack Start plugins: those start dev servers that Vitest then has
 * to wait on at shutdown. Nothing under test needs them — the pure logic has no
 * framework dependency, and the MongoDB tests talk to Mongoose directly.
 */

import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 30_000,
  },
});
