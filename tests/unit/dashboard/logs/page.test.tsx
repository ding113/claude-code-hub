import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

function MockUsageLogsActiveSessionsSection() {
  return null;
}

MockUsageLogsActiveSessionsSection.displayName = "UsageLogsActiveSessionsSection";

function MockUsageLogsDataSection() {
  return null;
}

MockUsageLogsDataSection.displayName = "UsageLogsDataSection";

vi.mock("@/app/[locale]/dashboard/logs/_components/usage-logs-sections", () => ({
  UsageLogsActiveSessionsSection: MockUsageLogsActiveSessionsSection,
  UsageLogsDataSection: MockUsageLogsDataSection,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

function getChildComponentNames(element: ReactElement<{ children?: ReactNode }>) {
  return Children.toArray(element.props.children)
    .filter(isValidElement)
    .map((child) => {
      const innerChild = child.props?.children;
      if (isValidElement(innerChild)) {
        if (typeof innerChild.type === "string") {
          return innerChild.type;
        }

        return innerChild.type.displayName ?? innerChild.type.name ?? "unknown";
      }

      if (typeof child.type === "string") {
        return child.type;
      }

      return child.type.displayName ?? child.type.name ?? "unknown";
    });
}

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
    expect(getChildComponentNames(element)).toEqual(["UsageLogsDataSection"]);
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
    expect(getChildComponentNames(element)).toEqual([
      "UsageLogsActiveSessionsSection",
      "UsageLogsDataSection",
    ]);
  });
});
