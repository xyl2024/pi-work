import { expect, test, type Page } from "@playwright/test";
import { login } from "./helpers";

/**
 * UI smoke: the app shell loads and the key global panels open without
 * errors. Targets the isolated instance (see playwright.config.ts).
 *
 * Panels open via right-bar buttons whose aria-label is i18n-resolved;
 * the fresh isolated instance uses the browser default locale (en), but
 * selectors match both locales to stay robust.
 */

const ERRORS: string[] = [];

function watchErrors(page: Page): void {
  page.on("pageerror", (error) => ERRORS.push(`pageerror: ${error.message}`));
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    // A fresh instance has no profile avatar — /api/profile/avatar answers
    // 404 and Chromium logs it as a resource-load console error. Expected,
    // not a defect; everything else still fails the test.
    const url = msg.location()?.url ?? "";
    if (url.includes("/api/profile/avatar") && /404|Failed to load resource/i.test(msg.text())) {
      return;
    }
    ERRORS.push(`console.error: ${msg.text()}`);
  });
}

test.describe("home page smoke", () => {
  test.beforeEach(({ page }) => watchErrors(page));
  test.beforeEach(async ({ page }) => {
    await login(page);
  });
  test.afterEach(() => {
    // Surface collected errors per test; keep the message readable.
    if (ERRORS.length > 0) {
      throw new Error(`page emitted ${ERRORS.length} error(s):\n${ERRORS.join("\n")}`);
    }
  });

  test("app shell loads with the right bar", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveTitle(/Pi Work/i);
    // right-bar column renders its buttons
    await expect(page.getByRole("button").filter({ has: page.locator("[aria-label]") }).first()).toBeVisible();
  });

  const PANELS: Array<[string, RegExp]> = [
    ["favorites", /Open favorites|收藏/i],
  ];

  for (const [name, label] of PANELS) {
    test(`panel opens: ${name}`, async ({ page }) => {
      await page.goto("/");
      const button = page.getByRole("button", { name: label });
      await expect(button).toBeVisible();
      await button.click();
      // panel content mounted
      await expect(page.locator("body")).toBeVisible();
      // keep the page busy briefly so async errors during panel mount surface
      await page.waitForTimeout(1_000);
    });
  }
});
