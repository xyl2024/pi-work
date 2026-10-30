import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

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
    hookTimeout: 900_000,
  },
});
