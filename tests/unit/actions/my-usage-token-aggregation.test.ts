import { describe, expect, test, vi } from "vitest";

// 禁用 tests/setup.ts 中基于 DSN/Redis 的默认同步与清理协调，避免无关依赖引入。
process.env.DSN = "";
process.env.AUTO_CLEANUP_TEST_DATA = "false";

function sqlToString(sqlObj: unknown): string {
  const visited = new Set<unknown>();

  const walk = (node: unknown): string => {
    if (!node || visited.has(node)) return "";
    visited.add(node);

    if (typeof node === "string") return node;

    if (typeof node === "object") {
      const anyNode = node as any;
      if (Array.isArray(anyNode)) {
        return anyNode.map(walk).join("");
      }

      if (anyNode.value) {
        if (Array.isArray(anyNode.value)) {
          return anyNode.value.map(String).join("");
        }
        return String(anyNode.value);
      }

      if (anyNode.queryChunks) {
        return walk(anyNode.queryChunks);
      }
    }

    return "";
  };

  return walk(sqlObj);
}

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.innerJoin = vi.fn(() => query);
  query.leftJoin = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.groupBy = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  query.offset = vi.fn(() => query);

  return query;
}

const mocks = vi.hoisted(() => ({
  getSession: vi.fn(),
  getSystemSettings: vi.fn(),
  getEnvConfig: vi.fn(),
  getTimeRangeForPeriodWithMode: vi.fn(),
  findUsageLogsStats: vi.fn(),
  select: vi.fn(),
  execute: vi.fn(async () => ({ count: 0 })),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/lib/config", () => ({
  getEnvConfig: mocks.getEnvConfig,
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriodWithMode: mocks.getTimeRangeForPeriodWithMode,
}));

vi.mock("@/repository/usage-logs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/repository/usage-logs")>();
  return {
    ...actual,
    findUsageLogsStats: mocks.findUsageLogsStats,
  };
});

vi.mock("@/drizzle/db", () => ({
  db: {
    select: mocks.select,
    execute: mocks.execute,
  },
}));

function expectNoIntTokenSum(selection: Record<string, unknown>, field: string) {
  const tokenSql = sqlToString(selection[field]).toLowerCase();
  expect(tokenSql).toContain("sum");
  expect(tokenSql).not.toContain("::int");
  expect(tokenSql).not.toContain("::int4");
  expect(tokenSql).toContain("double precision");
}

describe("my-usage token aggregation", () => {
  test("getMyTodayStats: token sum 不应使用 ::int", async () => {
    vi.resetModules();

    const capturedSelections: Array<Record<string, unknown>> = [];
    const selectQueue: any[] = [];
    selectQueue.push(
      createThenableQuery([
        {
          calls: 0,
          inputTokens: 0,
          outputTokens: 0,
          costUsd: "0",
        },
      ])
    );
    selectQueue.push(createThenableQuery([]));

    mocks.select.mockImplementation((selection: unknown) => {
      capturedSelections.push(selection as Record<string, unknown>);
      return selectQueue.shift() ?? createThenableQuery([]);
    });

    mocks.getTimeRangeForPeriodWithMode.mockReturnValue({
      startTime: new Date("2024-01-01T00:00:00.000Z"),
      endTime: new Date("2024-01-02T00:00:00.000Z"),
    });

    mocks.getSession.mockResolvedValue({
      key: {
        id: 1,
        key: "k",
        dailyResetTime: "00:00",
        dailyResetMode: "fixed",
      },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    const { getMyTodayStats } = await import("@/actions/my-usage");
    const res = await getMyTodayStats();
    expect(res.ok).toBe(true);

    expect(capturedSelections.length).toBeGreaterThanOrEqual(2);
    expectNoIntTokenSum(capturedSelections[0], "inputTokens");
    expectNoIntTokenSum(capturedSelections[0], "outputTokens");
    expectNoIntTokenSum(capturedSelections[1], "inputTokens");
    expectNoIntTokenSum(capturedSelections[1], "outputTokens");
  });

  test("getMyStatsSummary: token sum 不应使用 ::int", async () => {
    vi.resetModules();

    const capturedSelections: Array<Record<string, unknown>> = [];
    const selectQueue: any[] = [];
    selectQueue.push(createThenableQuery([]));
    selectQueue.push(createThenableQuery([]));

    mocks.select.mockImplementation((selection: unknown) => {
      capturedSelections.push(selection as Record<string, unknown>);
      return selectQueue.shift() ?? createThenableQuery([]);
    });

    mocks.getEnvConfig.mockReturnValue({ TZ: "UTC" });

    mocks.getSession.mockResolvedValue({
      key: { id: 1, key: "k" },
      user: { id: 1 },
    });

    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });

    mocks.findUsageLogsStats.mockResolvedValue({
      totalRequests: 0,
      totalCost: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreation5mTokens: 0,
      totalCacheCreation1hTokens: 0,
    });

    const { getMyStatsSummary } = await import("@/actions/my-usage");
    const res = await getMyStatsSummary({ startDate: "2024-01-01", endDate: "2024-01-01" });
    expect(res.ok).toBe(true);

    expect(capturedSelections).toHaveLength(2);

    for (const selection of capturedSelections) {
      expectNoIntTokenSum(selection, "inputTokens");
      expectNoIntTokenSum(selection, "outputTokens");
      expectNoIntTokenSum(selection, "cacheCreationTokens");
      expectNoIntTokenSum(selection, "cacheReadTokens");
    }
  });
});
