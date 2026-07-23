import { describe, expect, test, vi } from "vitest";
import type { UpdateSystemSettingsInput } from "@/types/system-config";

// 行为锁定测试：system_settings 列降级阶梯。
// 逐层尝试的列集合、尝试顺序与最终结果必须与既有实现完全一致，
// 防止数据驱动重构（或后续新增列）意外改变降级语义。

// 近代新增列（最新在前），降级链按引入顺序逐层累计剥离。
const RECENT_COLUMNS = [
  "stickyTimeoutCooldownMs",
  "racingTotalTimeoutMs",
  "stickySlaMs",
  "discoverySlaMs",
  "maxDiscoveryRounds",
  "discoveryConcurrency",
  "discoveryEnabled",
  "enableGeminiFunctionIdRectifier",
  "enableThinkingEffortConflictRectifier",
  "billHedgeLosers",
  "billNonSuccessfulRequests",
  "enableOpenaiResponsesWebsocket",
  "fakeStreamingWhitelist",
  "allowNonConversationEndpointProviderFallback",
] as const;

// 全量字段集（44 列）。
const FULL_COLUMNS = [
  "discoveryEnabled",
  "discoveryConcurrency",
  "maxDiscoveryRounds",
  "discoverySlaMs",
  "stickySlaMs",
  "racingTotalTimeoutMs",
  "stickyTimeoutCooldownMs",
  "enableGeminiFunctionIdRectifier",
  "billHedgeLosers",
  "billNonSuccessfulRequests",
  "passThroughUpstreamErrorMessage",
  "fakeStreamingWhitelist",
  "enableOpenaiResponsesWebsocket",
  "id",
  "siteTitle",
  "allowGlobalUsageView",
  "currencyDisplay",
  "billingModelSource",
  "timezone",
  "enableAutoCleanup",
  "cleanupRetentionDays",
  "cleanupSchedule",
  "cleanupBatchSize",
  "enableClientVersionCheck",
  "verboseProviderError",
  "enableHttp2",
  "codexPriorityBillingSource",
  "interceptAnthropicWarmupRequests",
  "enableThinkingSignatureRectifier",
  "enableThinkingBudgetRectifier",
  "enableThinkingEffortConflictRectifier",
  "enableBillingHeaderRectifier",
  "enableResponseInputRectifier",
  "allowNonConversationEndpointProviderFallback",
  "enableCodexSessionIdCompletion",
  "enableClaudeMetadataUserIdInjection",
  "enableResponseFixer",
  "responseFixerConfig",
  "quotaDbRefreshIntervalSeconds",
  "quotaLeasePercent5h",
  "quotaLeasePercentDaily",
  "quotaLeasePercentWeekly",
  "quotaLeasePercentMonthly",
  "quotaLeaseCapUsd",
  "publicStatusWindowHours",
  "publicStatusAggregationIntervalMinutes",
  "createdAt",
  "updatedAt",
  "enableHighConcurrencyMode",
  "ipExtractionConfig",
  "ipGeoLookupEnabled",
] as const;

// 历史世代字段集（冻结）：passThrough 世代之前的 schema 没有以下五列，
// 但仍包含 enableThinkingEffortConflictRectifier / allowNonConversationEndpointProviderFallback。
const PASS_THROUGH_ERA_OMIT = [
  "billHedgeLosers",
  "billNonSuccessfulRequests",
  "passThroughUpstreamErrorMessage",
  "fakeStreamingWhitelist",
  "enableOpenaiResponsesWebsocket",
] as const;
const HIGH_CONCURRENCY_ERA_OMIT = [
  ...PASS_THROUGH_ERA_OMIT,
  "enableHighConcurrencyMode",
  "ipExtractionConfig",
  "ipGeoLookupEnabled",
] as const;
// 读取链的 codex 世代保留 allowNonConversationEndpointProviderFallback；更新链连同剥离。
const CODEX_ERA_SELECT_OMIT = [...HIGH_CONCURRENCY_ERA_OMIT, "codexPriorityBillingSource"] as const;
const CODEX_ERA_RETURNING_OMIT = [
  ...CODEX_ERA_SELECT_OMIT,
  "allowNonConversationEndpointProviderFallback",
] as const;
const MINIMAL_COLUMNS = [
  "id",
  "siteTitle",
  "allowGlobalUsageView",
  "currencyDisplay",
  "billingModelSource",
  "createdAt",
  "updatedAt",
] as const;

function omit(keys: readonly string[], dropped: readonly string[]): string[] {
  return keys.filter((key) => !dropped.includes(key));
}

function sorted(keys: readonly string[]): string[] {
  return [...keys].sort();
}

function sortedKeys(value: unknown): string[] {
  return Object.keys(value as Record<string, unknown>).sort();
}

function createRejectingSelectQuery(error: unknown) {
  const query: Record<string, unknown> = {};
  query.from = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => Promise.reject(error));
  return query;
}

function createResolvingSelectQuery(rows: unknown[]) {
  const query: any = Promise.resolve(rows);
  query.from = vi.fn(() => query);
  query.orderBy = vi.fn(() => query);
  query.limit = vi.fn(() => query);
  return query;
}

describe("SystemSettings：列降级阶梯的尝试序列锁定", () => {
  test("getSystemSettings 全部列缺失时按既定顺序尝试 12 套字段集", async () => {
    vi.resetModules();

    const selections: string[][] = [];
    const selectMock = vi.fn((selection: Record<string, unknown>) => {
      selections.push(sortedKeys(selection));
      return createRejectingSelectQuery({ code: "42703" });
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: vi.fn(),
        insert: vi.fn(),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { getSystemSettings } = await import("@/repository/system-config");

    await expect(getSystemSettings()).rejects.toMatchObject({ code: "42703" });

    const expectedSequence = [
      [...FULL_COLUMNS],
      ...RECENT_COLUMNS.map((_, index) => omit(FULL_COLUMNS, RECENT_COLUMNS.slice(0, index + 1))),
      omit(FULL_COLUMNS, PASS_THROUGH_ERA_OMIT),
      omit(FULL_COLUMNS, HIGH_CONCURRENCY_ERA_OMIT),
      omit(FULL_COLUMNS, CODEX_ERA_SELECT_OMIT),
      [...MINIMAL_COLUMNS],
    ].map(sorted);

    expect(selections).toEqual(expectedSequence);
  });

  test("getSystemSettings 在 passThrough 世代命中时重新选取更晚引入的列", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    const selections: string[][] = [];
    let callIndex = 0;
    const selectMock = vi.fn((selection: Record<string, unknown>) => {
      selections.push(sortedKeys(selection));
      callIndex += 1;
      if (callIndex < 16) {
        return createRejectingSelectQuery({ code: "42703" });
      }
      return createResolvingSelectQuery([
        {
          id: 1,
          siteTitle: "Era Row",
          allowGlobalUsageView: false,
          currencyDisplay: "USD",
          billingModelSource: "original",
          codexPriorityBillingSource: "actual",
          enableThinkingEffortConflictRectifier: false,
          allowNonConversationEndpointProviderFallback: false,
          enableHighConcurrencyMode: true,
          createdAt: now,
          updatedAt: now,
        },
      ]);
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: vi.fn(),
        insert: vi.fn(),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { getSystemSettings } = await import("@/repository/system-config");

    const result = await getSystemSettings();

    expect(selectMock).toHaveBeenCalledTimes(16);
    // 第 15 次（近代链末层）不含这些新列；第 16 次（passThrough 世代）重新包含旧列。
    expect(selections[14]).not.toContain("enableThinkingEffortConflictRectifier");
    expect(selections[14]).not.toContain("allowNonConversationEndpointProviderFallback");
    expect(selections[14]).toContain("passThroughUpstreamErrorMessage");
    expect(selections[15]).toContain("enableThinkingEffortConflictRectifier");
    expect(selections[15]).toContain("allowNonConversationEndpointProviderFallback");
    expect(selections[15]).not.toContain("passThroughUpstreamErrorMessage");

    // 世代字段集选出的真实值要透传，缺失列由 transformer 落默认值。
    expect(result.siteTitle).toBe("Era Row");
    expect(result.enableThinkingEffortConflictRectifier).toBe(false);
    expect(result.allowNonConversationEndpointProviderFallback).toBe(false);
    expect(result.enableHighConcurrencyMode).toBe(true);
    expect(result.codexPriorityBillingSource).toBe("actual");
    expect(result.passThroughUpstreamErrorMessage).toBe(true);
  });

  test("updateSystemSettings 全部列缺失时按既定顺序尝试 11 套 set/returning 组合", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    const selectMock = vi.fn(() =>
      createResolvingSelectQuery([
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

    const setKeySequence: string[][] = [];
    const returningKeySequence: string[][] = [];
    const updateMock = vi.fn(() => {
      const query: Record<string, unknown> = {};
      query.set = vi.fn((updates: Record<string, unknown>) => {
        setKeySequence.push(sortedKeys(updates));
        return query;
      });
      query.where = vi.fn(() => query);
      query.returning = vi.fn((returning: Record<string, unknown>) => {
        returningKeySequence.push(sortedKeys(returning));
        return Promise.reject({ code: "42703" });
      });
      return query;
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    const payload: UpdateSystemSettingsInput = {
      siteTitle: "Ladder Pin",
      codexPriorityBillingSource: "actual",
      billNonSuccessfulRequests: true,
      billHedgeLosers: false,
      passThroughUpstreamErrorMessage: false,
      enableOpenaiResponsesWebsocket: false,
      enableHighConcurrencyMode: true,
      enableThinkingEffortConflictRectifier: false,
      enableGeminiFunctionIdRectifier: false,
      allowNonConversationEndpointProviderFallback: false,
      fakeStreamingWhitelist: [],
      publicStatusWindowHours: 48,
      publicStatusAggregationIntervalMinutes: 10,
      ipExtractionConfig: null,
      ipGeoLookupEnabled: false,
    };

    await expect(updateSystemSettings(payload)).rejects.toThrow(
      "system_settings 表列缺失，请执行数据库迁移以升级数据库结构。"
    );

    expect(updateMock).toHaveBeenCalledTimes(18);

    const expectedReturningSequence = [
      [...FULL_COLUMNS],
      ...RECENT_COLUMNS.map((_, index) => omit(FULL_COLUMNS, RECENT_COLUMNS.slice(0, index + 1))),
      omit(FULL_COLUMNS, PASS_THROUGH_ERA_OMIT),
      omit(FULL_COLUMNS, HIGH_CONCURRENCY_ERA_OMIT),
      omit(FULL_COLUMNS, CODEX_ERA_RETURNING_OMIT),
    ].map(sorted);
    expect(returningKeySequence).toEqual(expectedReturningSequence);

    const fullSetKeys = [
      "updatedAt",
      "siteTitle",
      "codexPriorityBillingSource",
      "billNonSuccessfulRequests",
      "billHedgeLosers",
      "passThroughUpstreamErrorMessage",
      "enableOpenaiResponsesWebsocket",
      "enableHighConcurrencyMode",
      "enableThinkingEffortConflictRectifier",
      "enableGeminiFunctionIdRectifier",
      "allowNonConversationEndpointProviderFallback",
      "fakeStreamingWhitelist",
      "publicStatusWindowHours",
      "publicStatusAggregationIntervalMinutes",
      "ipExtractionConfig",
      "ipGeoLookupEnabled",
    ];
    const downgradedSetOmit = [
      ...RECENT_COLUMNS,
      "passThroughUpstreamErrorMessage",
      "enableHighConcurrencyMode",
      "publicStatusWindowHours",
      "publicStatusAggregationIntervalMinutes",
      "ipExtractionConfig",
      "ipGeoLookupEnabled",
    ];
    const expectedSetSequence = [
      fullSetKeys,
      ...RECENT_COLUMNS.map((_, index) => omit(fullSetKeys, RECENT_COLUMNS.slice(0, index + 1))),
      omit(fullSetKeys, [...RECENT_COLUMNS, "passThroughUpstreamErrorMessage"]),
      omit(fullSetKeys, downgradedSetOmit),
      omit(fullSetKeys, [...downgradedSetOmit, "codexPriorityBillingSource"]),
    ].map(sorted);
    expect(setKeySequence).toEqual(expectedSetSequence);
  });

  test("updateSystemSettings 在 highConcurrency 世代命中时停止降级并返回行值", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    const selectMock = vi.fn(() =>
      createResolvingSelectQuery([
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

    let updateCallIndex = 0;
    const updateMock = vi.fn(() => {
      updateCallIndex += 1;
      const shouldResolve = updateCallIndex === 10;
      const query: Record<string, unknown> = {};
      query.set = vi.fn(() => query);
      query.where = vi.fn(() => query);
      query.returning = vi.fn(() =>
        shouldResolve
          ? Promise.resolve([
              {
                id: 1,
                siteTitle: "Tail Success",
                allowGlobalUsageView: false,
                currencyDisplay: "USD",
                billingModelSource: "original",
                codexPriorityBillingSource: "actual",
                createdAt: now,
                updatedAt: now,
              },
            ])
          : Promise.reject({ code: "42703" })
      );
      return query;
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    const result = await updateSystemSettings({
      siteTitle: "Tail Success",
      codexPriorityBillingSource: "actual",
    });

    expect(updateMock).toHaveBeenCalledTimes(10);
    expect(result.siteTitle).toBe("Tail Success");
    expect(result.codexPriorityBillingSource).toBe("actual");
  });

  test("updateSystemSettings 某层返回空结果时继续向下尝试而不报错", async () => {
    vi.resetModules();

    const now = new Date("2026-01-04T00:00:00.000Z");
    const selectMock = vi.fn(() =>
      createResolvingSelectQuery([
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

    const returningKeySequence: string[][] = [];
    let updateCallIndex = 0;
    const updateMock = vi.fn(() => {
      updateCallIndex += 1;
      const currentCall = updateCallIndex;
      const query: Record<string, unknown> = {};
      query.set = vi.fn(() => query);
      query.where = vi.fn(() => query);
      query.returning = vi.fn((returning: Record<string, unknown>) => {
        returningKeySequence.push(sortedKeys(returning));
        if (currentCall === 1) {
          return Promise.reject({ code: "42703" });
        }
        if (currentCall === 2) {
          // 列存在但未命中行：应继续尝试下一层而不是直接失败。
          return Promise.resolve([]);
        }
        return Promise.resolve([
          {
            id: 1,
            siteTitle: "Empty Then Hit",
            allowGlobalUsageView: false,
            currencyDisplay: "USD",
            billingModelSource: "original",
            createdAt: now,
            updatedAt: now,
          },
        ]);
      });
      return query;
    });

    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: selectMock,
        update: updateMock,
        insert: vi.fn(),
        execute: vi.fn(async () => ({ count: 0 })),
      },
    }));

    const { updateSystemSettings } = await import("@/repository/system-config");

    const result = await updateSystemSettings({ siteTitle: "Empty Then Hit" });

    expect(updateMock).toHaveBeenCalledTimes(3);
    expect(returningKeySequence).toEqual(
      [
        [...FULL_COLUMNS],
        omit(FULL_COLUMNS, RECENT_COLUMNS.slice(0, 1)),
        omit(FULL_COLUMNS, RECENT_COLUMNS.slice(0, 2)),
      ].map(sorted)
    );
    expect(result.siteTitle).toBe("Empty Then Hit");
  });
});
