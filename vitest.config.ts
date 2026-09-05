import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
  test: {
    include: ["tests/unit/**/*.test.ts"],
    globalSetup: ["tests/global-setup.ts"],
    testTimeout: 30_000,
    // prod mode (PI_WORK_TEST_PROD=1) runs `next build` inside globalSetup,
    // which can take several minutes.
    hookTimeout: 900_000,
  },
});
