import { describe, expect, test, vi } from "vitest";

function createThenableQuery<T>(result: T) {
  const query: any = Promise.resolve(result);

  query.from = vi.fn(() => query);
  query.limit = vi.fn(() => query);

  query.set = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.returning = vi.fn(() => query);

  query.values = vi.fn(() => query);
  query.onConflictDoNothing = vi.fn(() => query);

  return query;
}

describe("SystemSettings：数据库缺列时的保存兜底", () => {
  test("updateSystemSettings 遇到 42703（列缺失）应返回可行动的错误信息", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const selectQuery = createThenableQuery([
      {
        id: 1,
        siteTitle: "Claude Code Hub",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        enableAutoCleanup: false,
        cleanupRetentionDays: 30,
        cleanupSchedule: "0 2 * * *",
        cleanupBatchSize: 10000,
        enableClientVersionCheck: false,
        verboseProviderError: false,
        enableHttp2: false,
        interceptAnthropicWarmupRequests: false,
        createdAt: now,
        updatedAt: now,
      },
    ]);

    const selectMock = vi.fn(() => selectQuery);

    const updateQuery = createThenableQuery([] as unknown[]);
    updateQuery.returning = vi.fn(() => Promise.reject({ code: "42703" }));

    const updateMock = vi.fn(() => updateQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(() => createThenableQuery([])),
        // 给 tests/setup.ts 的 afterAll 清理逻辑一个可用的 execute
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    await expect(updateSystemSettings({ siteTitle: "AutoBits Claude Code Hub" })).rejects.toThrow(
      "system_settings 表列缺失"
    );

    vi.useRealTimers();
  });

  test("updateSystemSettings 遇到 42P01（表不存在）应提示先执行迁移", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const selectQuery = createThenableQuery([
      {
        id: 1,
        siteTitle: "Claude Code Hub",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        createdAt: now,
        updatedAt: now,
      },
    ]);
    const selectMock = vi.fn(() => selectQuery);

    const updateQuery = createThenableQuery([] as unknown[]);
    updateQuery.returning = vi.fn(() => Promise.reject({ code: "42P01" }));

    const updateMock = vi.fn(() => updateQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(() => createThenableQuery([])),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    await expect(updateSystemSettings({ siteTitle: "AutoBits Claude Code Hub" })).rejects.toThrow(
      "系统设置数据表不存在"
    );

    vi.useRealTimers();
  });
});
