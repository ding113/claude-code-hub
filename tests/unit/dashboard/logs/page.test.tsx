import { Children, isValidElement, type ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";

const authMocks = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: authMocks.getSession,
}));

vi.mock("@/i18n/routing", () => ({
  redirect: vi.fn(),
}));

const systemConfigMocks = vi.hoisted(() => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: systemConfigMocks.getSystemSettings,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/active-sessions-skeleton", () => ({
  ActiveSessionsSkeleton: () => null,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/usage-logs-skeleton", () => ({
  UsageLogsSkeleton: () => null,
}));

vi.mock("@/app/[locale]/dashboard/logs/_components/usage-logs-sections", () => ({
  UsageLogsActiveSessionsSection: () => null,
  UsageLogsDataSection: () => null,
}));

describe("UsageLogsPage", () => {
  it("only renders the logs data section in high concurrency mode", async () => {
    authMocks.getSession.mockResolvedValue({
      user: {
        id: 7,
        role: "admin",
      },
    });
    systemConfigMocks.getSystemSettings.mockResolvedValue({
      enableHighConcurrencyMode: true,
    });

    const { default: UsageLogsPage } = await import("@/app/[locale]/dashboard/logs/page");
    const element = await UsageLogsPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    });

    expect(isValidElement<{ children?: ReactNode }>(element)).toBe(true);
    if (!isValidElement<{ children?: ReactNode }>(element)) {
      throw new Error("UsageLogsPage should return a React element");
    }
    expect(Children.toArray(element.props.children)).toHaveLength(1);
  });

  it("renders active sessions section and logs data section in normal mode", async () => {
    authMocks.getSession.mockResolvedValue({
      user: {
        id: 7,
        role: "admin",
      },
    });
    systemConfigMocks.getSystemSettings.mockResolvedValue({
      enableHighConcurrencyMode: false,
    });

    const { default: UsageLogsPage } = await import("@/app/[locale]/dashboard/logs/page");
    const element = await UsageLogsPage({
      params: Promise.resolve({ locale: "en" }),
      searchParams: Promise.resolve({}),
    });

    expect(isValidElement<{ children?: ReactNode }>(element)).toBe(true);
    if (!isValidElement<{ children?: ReactNode }>(element)) {
      throw new Error("UsageLogsPage should return a React element");
    }
    expect(Children.toArray(element.props.children)).toHaveLength(2);
  });
});
