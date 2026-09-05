import { expect, test } from "@playwright/test";

/**
 * Smoke example for the UI test layer. Copy this file's shape for new E2E
 * tests. Requires an isolated instance running (see playwright.config.ts).
 */
test("home page loads the app shell", async ({ page }) => {
  await page.goto("/");
  await expect(page).toHaveTitle(/Pi Work/i);
  await expect(page.locator("body")).toBeVisible();
});
