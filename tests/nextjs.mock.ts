/**
 * Mock Next.js 特定 API 用于测试环境
 *
 * 目的：
 * - Mock next/headers cookies()
 * - Mock next-intl getTranslations()
 *
 * 这样测试环境就能正常调用 Server Actions
 */

import { vi } from "vitest";

// ==================== Mock next/headers ====================

vi.mock("next/headers", () => ({
  cookies: vi.fn(() => ({
    get: vi.fn((name: string) => {
      // 从测试环境变量读取 Cookie
      if (name === "auth-token") {
        const token = process.env.TEST_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
        return token ? { value: token } : undefined;
      }
      return undefined;
    }),
    set: vi.fn(),
    delete: vi.fn(),
    has: vi.fn((name: string) => name === "auth-token" && !!process.env.TEST_ADMIN_TOKEN),
  })),
}));

// ==================== Mock next-intl ====================

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(() => {
    return (key: string, params?: Record<string, unknown>) => {
      // 简单的翻译映射
      const messages: Record<string, string> = {
        "users.created": "用户创建成功",
        "users.updated": "用户更新成功",
        "users.deleted": "用户删除成功",
        "users.toggledEnabled": "用户状态已切换",
        "users.renewed": "用户已续期",
        "providers.created": "供应商创建成功",
        "providers.updated": "供应商更新成功",
        "providers.deleted": "供应商删除成功",
        "providers.toggledEnabled": "供应商状态已切换",
        "keys.created": "密钥创建成功",
        "keys.deleted": "密钥删除成功",
        "errors.unauthorized": "未认证",
        "errors.forbidden": "权限不足",
        "errors.notFound": "未找到",
        "errors.invalidInput": "输入无效",
      };

      let msg = messages[key] || key;

      // 替换参数
      if (params) {
        Object.entries(params).forEach(([k, v]) => {
          msg = msg.replace(`{${k}}`, String(v));
        });
      }

      return msg;
    };
  }),
}));
