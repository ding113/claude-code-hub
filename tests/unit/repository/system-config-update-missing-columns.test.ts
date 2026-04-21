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

function createRejectedThenableQuery(error: unknown) {
  const query: any = {};

  query.from = vi.fn(() => query);
  query.limit = vi.fn(() => Promise.reject(error));

  query.set = vi.fn(() => query);
  query.where = vi.fn(() => query);
  query.returning = vi.fn(() => Promise.reject(error));

  query.values = vi.fn(() => query);
  query.onConflictDoNothing = vi.fn(() => Promise.reject(error));

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

  test("getSystemSettings 在仅缺 codex_priority_billing_source 列时应保留已有设置", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const selectMock = vi
      .fn()
      .mockReturnValueOnce(createRejectedThenableQuery({ code: "42703" }))
      .mockReturnValueOnce(
        createThenableQuery([
          {
            id: 1,
            siteTitle: "Claude Code Hub",
            allowGlobalUsageView: false,
            currencyDisplay: "USD",
            billingModelSource: "original",
            timezone: "Asia/Shanghai",
            enableAutoCleanup: true,
            cleanupRetentionDays: 90,
            cleanupSchedule: "0 3 * * *",
            cleanupBatchSize: 5000,
            enableClientVersionCheck: true,
            verboseProviderError: true,
            enableHttp2: true,
            interceptAnthropicWarmupRequests: true,
            enableThinkingSignatureRectifier: false,
            enableThinkingBudgetRectifier: false,
            enableBillingHeaderRectifier: false,
            enableResponseInputRectifier: false,
            enableCodexSessionIdCompletion: false,
            enableClaudeMetadataUserIdInjection: false,
            enableResponseFixer: false,
            responseFixerConfig: {
              fixTruncatedJson: false,
              fixSseFormat: false,
              fixEncoding: false,
              maxJsonDepth: 50,
              maxFixSize: 2048,
            },
            quotaDbRefreshIntervalSeconds: 30,
            quotaLeasePercent5h: "0.10",
            quotaLeasePercentDaily: "0.11",
            quotaLeasePercentWeekly: "0.12",
            quotaLeasePercentMonthly: "0.13",
            quotaLeaseCapUsd: "1.50",
            createdAt: now,
            updatedAt: now,
          },
        ])
      );

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: vi.fn(() => createThenableQuery([])),
        insert: vi.fn(() => createThenableQuery([])),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { getSystemSettings } = await import("@/repository/system-config");

    const result = await getSystemSettings();

    expect(result.codexPriorityBillingSource).toBe("requested");
    expect(result.enableHttp2).toBe(true);
    expect(result.interceptAnthropicWarmupRequests).toBe(true);
    expect(result.verboseProviderError).toBe(true);
    expect(result.quotaLeasePercentDaily).toBe(0.11);

    vi.useRealTimers();
  });

  test("getSystemSettings 在缺少新列且无记录时应使用降级插入初始化", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const selectMock = vi
      .fn()
      .mockReturnValueOnce(createRejectedThenableQuery({ code: "42703" }))
      .mockReturnValueOnce(createThenableQuery([]))
      .mockReturnValueOnce(createRejectedThenableQuery({ code: "42703" }))
      .mockReturnValueOnce(
        createThenableQuery([
          {
            id: 1,
            siteTitle: "Claude Code Hub",
            allowGlobalUsageView: false,
            currencyDisplay: "USD",
            billingModelSource: "original",
            createdAt: now,
            updatedAt: now,
          },
        ])
      );

    const rejectedInsertQuery = createThenableQuery([] as unknown[]);
    rejectedInsertQuery.onConflictDoNothing = vi.fn(() => Promise.reject({ code: "42703" }));

    const legacyInsertQuery = createThenableQuery([]);
    const insertMock = vi
      .fn()
      .mockReturnValueOnce(rejectedInsertQuery)
      .mockReturnValueOnce(legacyInsertQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: vi.fn(() => createThenableQuery([])),
        insert: insertMock,
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { getSystemSettings } = await import("@/repository/system-config");

    const result = await getSystemSettings();

    expect(result.siteTitle).toBe("Claude Code Hub");
    expect(result.codexPriorityBillingSource).toBe("requested");
    expect(insertMock).toHaveBeenCalledTimes(2);
    expect(legacyInsertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        siteTitle: "Claude Code Hub",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
      })
    );
    expect(legacyInsertQuery.values).not.toHaveBeenCalledWith(
      expect.objectContaining({
        publicStatusWindowHours: expect.anything(),
      })
    );
    expect(legacyInsertQuery.values).not.toHaveBeenCalledWith(
      expect.objectContaining({
        publicStatusAggregationIntervalMinutes: expect.anything(),
      })
    );

    vi.useRealTimers();
  });

  test("updateSystemSettings 在仅缺新列时应降级保存其他字段", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const selectMock = vi
      .fn()
      .mockReturnValueOnce(createRejectedThenableQuery({ code: "42703" }))
      .mockReturnValueOnce(
        createThenableQuery([
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
        ])
      );

    const rejectedUpdateQuery = createThenableQuery([] as unknown[]);
    rejectedUpdateQuery.returning = vi.fn(() => Promise.reject({ code: "42703" }));

    const downgradedUpdateQuery = createThenableQuery([
      {
        id: 1,
        siteTitle: "Updated Title",
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

    const updateMock = vi
      .fn()
      .mockReturnValueOnce(rejectedUpdateQuery)
      .mockReturnValueOnce(downgradedUpdateQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(() => createThenableQuery([])),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    const result = await updateSystemSettings({
      siteTitle: "Updated Title",
      codexPriorityBillingSource: "actual",
    });

    expect(result.siteTitle).toBe("Updated Title");
    expect(result.codexPriorityBillingSource).toBe("requested");
    expect(updateMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  test("updateSystemSettings 在仅缺 enable_high_concurrency_mode 列时，仍应保留 codexPriorityBillingSource 更新", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    vi.useFakeTimers();
    vi.setSystemTime(now);

    const selectMock = vi.fn().mockReturnValue(
      createThenableQuery([
        {
          id: 1,
          siteTitle: "Claude Code Hub",
          allowGlobalUsageView: false,
          currencyDisplay: "USD",
          billingModelSource: "original",
          codexPriorityBillingSource: "requested",
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
      ])
    );

    const rejectedUpdateQuery = createThenableQuery([] as unknown[]);
    rejectedUpdateQuery.returning = vi.fn(() => Promise.reject({ code: "42703" }));

    const downgradedUpdateQuery = createThenableQuery([
      {
        id: 1,
        siteTitle: "Updated Title",
        allowGlobalUsageView: false,
        currencyDisplay: "USD",
        billingModelSource: "original",
        codexPriorityBillingSource: "actual",
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

    const updateMock = vi
      .fn()
      .mockReturnValueOnce(rejectedUpdateQuery)
      .mockReturnValueOnce(downgradedUpdateQuery);

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(() => createThenableQuery([])),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    const result = await updateSystemSettings({
      siteTitle: "Updated Title",
      codexPriorityBillingSource: "actual",
      enableHighConcurrencyMode: true,
    });

    expect(result.siteTitle).toBe("Updated Title");
    expect(result.codexPriorityBillingSource).toBe("actual");
    expect(result.enableHighConcurrencyMode).toBe(false);
    expect(updateMock).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });
});
