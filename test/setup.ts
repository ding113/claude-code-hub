import "@testing-library/jest-dom/vitest";
import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

// 自动清理 React 组件
afterEach(() => {
  cleanup();
});

// Mock Next.js 路由
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
    replace: vi.fn(),
    back: vi.fn(),
    forward: vi.fn(),
    refresh: vi.fn(),
    prefetch: vi.fn(),
  }),
  usePathname: () => "/",
  useSearchParams: () => new URLSearchParams(),
}));

// Mock next-intl
vi.mock("next-intl", () => ({
  useTranslations: () => (key: string) => key,
  useLocale: () => "en",
}));

// Mock 环境变量
process.env = {
  ...process.env,
  NODE_ENV: "test",
  ADMIN_TOKEN: "test-admin-token",
  TZ: "Asia/Shanghai",
} as NodeJS.ProcessEnv;
