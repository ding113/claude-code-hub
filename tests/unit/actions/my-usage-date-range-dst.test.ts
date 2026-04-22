import { describe, expect, it, vi } from "vitest";
import { fromZonedTime } from "date-fns-tz";

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  findReadonlyUsageLogsBatchForKey: vi.fn(),
  findUsageLogsForKeySlim: vi.fn(),
  findUsageLogsForKeyBatch: vi.fn(),
  getTranslations: vi.fn(async () => (key: string) => key),
  resolveSystemTimezone: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
}));

vi.mock("@/repository/usage-logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/usage-logs")>();
  return {
    ...actual,
    findReadonlyUsageLogsBatchForKey: mocks.findReadonlyUsageLogsBatchForKey,
    findUsageLogsForKeySlim: mocks.findUsageLogsForKeySlim,
    findUsageLogsForKeyBatch: mocks.findUsageLogsForKeyBatch,
  };
});

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

describe("my-usage date range parsing", () => {
  it("computes exclusive endTime as next local midnight across DST start for batch logs", async () => {
    const tz = "America/Los_Angeles";
    mocks.resolveSystemTimezone.mockResolvedValue(tz);

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsForKeyBatch.mockResolvedValue({
      logs: [],
      nextCursor: null,
      hasMore: false,
    });
    mocks.findReadonlyUsageLogsBatchForKey.mockResolvedValue({
      logs: [],
      nextCursor: null,
      hasMore: false,
    });

    const { getMyUsageLogsBatch } = await import("@/actions/my-usage");
    const res = await getMyUsageLogsBatch({ startDate: "2024-03-10", endDate: "2024-03-10" });

    expect(res.ok).toBe(true);
    expect(mocks.findUsageLogsForKeyBatch).toHaveBeenCalledTimes(1);

    const args = mocks.findUsageLogsForKeyBatch.mock.calls[0]?.[0];
    expect(args.startTime).toBe(fromZonedTime("2024-03-10T00:00:00", tz).getTime());
    expect(args.endTime).toBe(fromZonedTime("2024-03-11T00:00:00", tz).getTime());
    expect(args.limit).toBe(20);

    expect(args.endTime - args.startTime).toBe(23 * 60 * 60 * 1000);
  });

  it("computes exclusive endTime as next local midnight across DST end for batch logs", async () => {
    const tz = "America/Los_Angeles";
    mocks.resolveSystemTimezone.mockResolvedValue(tz);

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsForKeyBatch.mockResolvedValue({
      logs: [],
      nextCursor: null,
      hasMore: false,
    });

    const { getMyUsageLogsBatch } = await import("@/actions/my-usage");
    const res = await getMyUsageLogsBatch({ startDate: "2024-11-03", endDate: "2024-11-03" });

    expect(res.ok).toBe(true);
    expect(mocks.findUsageLogsForKeyBatch).toHaveBeenCalledTimes(1);

    const args = mocks.findUsageLogsForKeyBatch.mock.calls[0]?.[0];
    expect(args.startTime).toBe(fromZonedTime("2024-11-03T00:00:00", tz).getTime());
    expect(args.endTime).toBe(fromZonedTime("2024-11-04T00:00:00", tz).getTime());
    expect(args.limit).toBe(20);

    expect(args.endTime - args.startTime).toBe(25 * 60 * 60 * 1000);
  });

  it("computes DST-safe range for legacy page-based logs API", async () => {
    const tz = "America/Los_Angeles";
    mocks.resolveSystemTimezone.mockResolvedValue(tz);

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsForKeySlim.mockResolvedValue({
      logs: [],
      total: 0,
    });

    const { getMyUsageLogs } = await import("@/actions/my-usage");
    const res = await getMyUsageLogs({ startDate: "2024-03-10", endDate: "2024-03-10" });

    expect(res.ok).toBe(true);
    expect(mocks.findUsageLogsForKeySlim).toHaveBeenCalledTimes(1);

    const args = mocks.findUsageLogsForKeySlim.mock.calls[0]?.[0];
    expect(args.startTime).toBe(fromZonedTime("2024-03-10T00:00:00", tz).getTime());
    expect(args.endTime).toBe(fromZonedTime("2024-03-11T00:00:00", tz).getTime());
    expect(args.page).toBe(1);
    expect(args.pageSize).toBe(20);
  });

  it("passes explicit startTime/endTime through to full batch readonly API without reparsing dates", async () => {
    const tz = "America/Los_Angeles";
    mocks.resolveSystemTimezone.mockResolvedValue(tz);

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.findReadonlyUsageLogsBatchForKey.mockResolvedValue({
      logs: [],
      nextCursor: null,
      hasMore: false,
    });

    const explicitStart = 1_700_000_000_000;
    const explicitEnd = 1_700_003_600_000;
    const { getMyUsageLogsBatchFull } = await import("@/actions/my-usage");
    const res = await getMyUsageLogsBatchFull({
      startDate: "2024-03-10",
      endDate: "2024-03-10",
      startTime: explicitStart,
      endTime: explicitEnd,
    });

    expect(res.ok).toBe(true);
    expect(mocks.findReadonlyUsageLogsBatchForKey).toHaveBeenCalledWith(
      expect.objectContaining({
        startTime: explicitStart,
        endTime: explicitEnd,
      })
    );
  });
});
