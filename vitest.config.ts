import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// In-process server-module tests (no HTTP interface) can opt out of the
// isolated-instance global setup: they must not trigger a service start just
// because they live under tests/unit/. Interface tests keep the default.
const skipInstance = process.env.PI_WORK_TEST_SKIP_INSTANCE === "1";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: skipInstance ? [] : ["tests/global-setup.ts"],
    testTimeout: 30_000,
    hookTimeout: 900_000, // globalSetup may boot the isolated dev instance
  },
});
