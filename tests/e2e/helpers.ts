import { expect, type Page } from "@playwright/test";

/**
 * Sign in through the login form so e2e specs land on the app shell.
 * Idempotent: passing an already-valid session shows no form; then we just
 * navigate on. The form is submitted with default admin/admin credentials
 * (the isolated instance ships without PI_WORK_AUTH_* overrides).
 */
export async function login(page: Page): Promise<void> {
  await page.goto("/");
  const signinButton = page.getByRole("button", { name: /Sign in|登录/ });
  if (await signinButton.count()) {
    await page.getByLabel(/Username|用户名/).fill("admin");
    await page.locator("input[type=password]").fill("admin");
    await signinButton.click();
  }
  await page.waitForURL((url) => new URL(url).pathname === "/");
  await expect(page.getByRole("button", { name: /Sign in|登录/ })).toHaveCount(0);
}
