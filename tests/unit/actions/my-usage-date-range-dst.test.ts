import { describe, expect, it, vi } from "vitest";
import { fromZonedTime } from "date-fns-tz";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  findUsageLogsWithDetails: vi.fn(),
  getEnvConfig: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/repository/usage-logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/usage-logs")>();
  return {
    ...actual,
    findUsageLogsWithDetails: mocks.findUsageLogsWithDetails,
  };
});

vi.mock("@/lib/config", () => ({
  getEnvConfig: mocks.getEnvConfig,
}));

describe("my-usage date range parsing", () => {
  it("computes exclusive endTime as next local midnight across DST start", async () => {
    const tz = "America/Los_Angeles";
    mocks.getEnvConfig.mockReturnValue({ TZ: tz });

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsWithDetails.mockResolvedValue({ logs: [], total: 0 });

    const { getMyUsageLogs } = await import("@/actions/my-usage");
    const res = await getMyUsageLogs({ startDate: "2024-03-10", endDate: "2024-03-10" });

    expect(res.ok).toBe(true);
    expect(mocks.findUsageLogsWithDetails).toHaveBeenCalledTimes(1);

    const args = mocks.findUsageLogsWithDetails.mock.calls[0]?.[0];
    expect(args.startTime).toBe(fromZonedTime("2024-03-10T00:00:00", tz).getTime());
    expect(args.endTime).toBe(fromZonedTime("2024-03-11T00:00:00", tz).getTime());

    expect(args.endTime - args.startTime).toBe(23 * 60 * 60 * 1000);
  });

  it("computes exclusive endTime as next local midnight across DST end", async () => {
    const tz = "America/Los_Angeles";
    mocks.getEnvConfig.mockReturnValue({ TZ: tz });

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsWithDetails.mockResolvedValue({ logs: [], total: 0 });

    const { getMyUsageLogs } = await import("@/actions/my-usage");
    const res = await getMyUsageLogs({ startDate: "2024-11-03", endDate: "2024-11-03" });

    expect(res.ok).toBe(true);
    expect(mocks.findUsageLogsWithDetails).toHaveBeenCalledTimes(1);

    const args = mocks.findUsageLogsWithDetails.mock.calls[0]?.[0];
    expect(args.startTime).toBe(fromZonedTime("2024-11-03T00:00:00", tz).getTime());
    expect(args.endTime).toBe(fromZonedTime("2024-11-04T00:00:00", tz).getTime());

    expect(args.endTime - args.startTime).toBe(25 * 60 * 60 * 1000);
  });
});
