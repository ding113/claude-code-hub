import { test, expect } from "@playwright/test";

test.describe("设置页与登录页冒烟", () => {
  test("login page should be reachable", async ({ page }) => {
    const response = await page.goto("/en/login", { waitUntil: "domcontentloaded" });
    expect([200, 301, 302, 307, 308]).toContain(response?.status() || 0);

    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("settings page should require authentication", async ({ page }) => {
    const response = await page.goto("/en/settings", { waitUntil: "domcontentloaded" });
    expect([200, 301, 302, 307, 308]).toContain(response?.status() || 0);

    const currentUrl = page.url();
    const redirectedToLogin = currentUrl.includes("/login");
    const unauthorizedMessage = await page
      .locator("text=/401|403|unauthorized|forbidden/i")
      .first()
      .isVisible();

    expect(redirectedToLogin || unauthorizedMessage).toBeTruthy();
  });
});
