import { defineConfig, devices } from "@playwright/test";

/**
 * UI (E2E) tests via Playwright.
 *
 * No `webServer` is configured on purpose: the suite assumes an already
 * running ISOLATED instance (never the production one on 30141), e.g.:
 *
 *   npm run dev:isolated                # http://localhost:30143
 *   PLAYWRIGHT_BASE_URL=http://localhost:30143 npm run test:e2e
 */
const baseURL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:30143";

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 60_000,
  retries: 0,
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
});
