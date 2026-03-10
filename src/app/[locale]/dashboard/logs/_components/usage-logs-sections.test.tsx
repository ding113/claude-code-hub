import type { ReactElement } from "react";
import { describe, expect, it, vi } from "vitest";

// Mock dependencies before imports
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: vi.fn(),
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: vi.fn().mockResolvedValue("UTC"),
}));

vi.mock("./usage-logs-view-virtualized", () => ({
  UsageLogsViewVirtualized: () => null,
}));

vi.mock("@/components/customs/active-sessions-list", () => ({
  ActiveSessionsList: () => null,
}));

import { getSystemSettings } from "@/repository/system-config";
import { UsageLogsDataSection } from "./usage-logs-sections";

describe("UsageLogsDataSection", () => {
  it("passes billingModelSource and currencyCode from system settings", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue({
      billingModelSource: "redirected",
      currencyDisplay: "CNY",
    } as Awaited<ReturnType<typeof getSystemSettings>>);

    const searchParams = Promise.resolve({});
    const element = (await UsageLogsDataSection({
      isAdmin: true,
      userId: 1,
      searchParams,
    })) as ReactElement;

    expect(element.props).toMatchObject({
      billingModelSource: "redirected",
      currencyCode: "CNY",
    });
  });

  it("passes billingModelSource as original when configured", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue({
      billingModelSource: "original",
      currencyDisplay: "USD",
    } as Awaited<ReturnType<typeof getSystemSettings>>);

    const searchParams = Promise.resolve({});
    const element = (await UsageLogsDataSection({
      isAdmin: false,
      userId: 42,
      searchParams,
    })) as ReactElement;

    expect(element.props).toMatchObject({
      billingModelSource: "original",
      currencyCode: "USD",
      isAdmin: false,
      userId: 42,
    });
  });

  it("passes logsRefreshIntervalMs from env config", async () => {
    vi.mocked(getSystemSettings).mockResolvedValue({
      billingModelSource: "redirected",
      currencyDisplay: "USD",
    } as Awaited<ReturnType<typeof getSystemSettings>>);

    const searchParams = Promise.resolve({});
    const element = (await UsageLogsDataSection({
      isAdmin: true,
      userId: 1,
      searchParams,
    })) as ReactElement;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const props = (element as any).props;
    expect(props).toHaveProperty("logsRefreshIntervalMs");
    expect(typeof props.logsRefreshIntervalMs).toBe("number");
    expect(props.logsRefreshIntervalMs).toBeGreaterThanOrEqual(250);
  });
});
