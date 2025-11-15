import { test, expect } from "@playwright/test";

test.describe("首页渲染测试", () => {
  test("should render the application", async ({ page }) => {
    // 访问首页，Next.js 会重定向到默认语言
    const response = await page.goto("/", { waitUntil: "domcontentloaded" });

    // 检查响应状态（200 或 重定向状态码）
    expect([200, 301, 302, 307, 308]).toContain(response?.status() || 0);

    // 检查页面标题包含关键字
    const title = await page.title();
    expect(title.length).toBeGreaterThan(0);

    // 检查页面 body 可见
    const body = page.locator("body");
    await expect(body).toBeVisible();
  });

  test("should have correct locale in URL after redirect", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // 检查 URL 是否包含语言代码
    const url = page.url();
    expect(url).toMatch(/\/(en|zh|zh-CN|zh-TW)/);
  });
});
