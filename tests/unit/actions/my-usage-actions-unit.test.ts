import { beforeEach, describe, expect, test, vi } from "vitest";
import { ERROR_CODES } from "@/lib/utils/error-messages";

// 禁用 tests/setup.ts 中基于 DSN/Redis 的默认同步与清理协调，避免无关依赖引入。
process.env.DSN = "";
process.env.AUTO_CLEANUP_TEST_DATA = "false";

/**
 * 说明：
 * - 本文件通过 mock 仓储层/基础设施为 my-usage actions 提供无 DB 的行为覆盖
 * - 与 tests/api/my-usage-readonly.test.ts（真实 PG 集成）互补：
 *   集成文件在无 DSN 环境会整体跳过，这里保证核心分支仍被验证
 */

function createThenableQuery<T>(result: T) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
  resolveSystemTimezone: vi.fn(),
  getTranslations: vi.fn(),
  findUsageLogsForKeySlim: vi.fn(),
  findUsageLogsForKeyBatch: vi.fn(),
  findReadonlyUsageLogsBatchForKey: vi.fn(),
  getDistinctModelsForKey: vi.fn(),
  getDistinctEndpointsForKey: vi.fn(),
  lookupIp: vi.fn(),
  select: vi.fn(),
  getTimeRangeForPeriodWithMode: vi.fn(),
  getTimeRangeForPeriod: vi.fn(),
  sumKeyQuotaCostsById: vi.fn(),
  sumUserQuotaCosts: vi.fn(),
  getCurrentCost: vi.fn(),
  getKeySessionCount: vi.fn(),
  getUserSessionCount: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getSession: mocks.getSession,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mocks.getSystemSettings,
}));

vi.mock("@/lib/utils/timezone", () => ({
  resolveSystemTimezone: mocks.resolveSystemTimezone,
}));

vi.mock("next-intl/server", () => ({
  getTranslations: mocks.getTranslations,
}));

vi.mock("@/repository/usage-logs", () => ({
  findUsageLogsForKeySlim: mocks.findUsageLogsForKeySlim,
  findUsageLogsForKeyBatch: mocks.findUsageLogsForKeyBatch,
  findReadonlyUsageLogsBatchForKey: mocks.findReadonlyUsageLogsBatchForKey,
  getDistinctModelsForKey: mocks.getDistinctModelsForKey,
  getDistinctEndpointsForKey: mocks.getDistinctEndpointsForKey,
}));

vi.mock("@/lib/ip-geo/client", () => ({
  lookupIp: mocks.lookupIp,
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: mocks.select,
  },
}));

vi.mock("@/lib/rate-limit/time-utils", () => ({
  getTimeRangeForPeriodWithMode: mocks.getTimeRangeForPeriodWithMode,
  getTimeRangeForPeriod: mocks.getTimeRangeForPeriod,
}));

vi.mock("@/repository/statistics", () => ({
  sumKeyQuotaCostsById: mocks.sumKeyQuotaCostsById,
  sumUserQuotaCosts: mocks.sumUserQuotaCosts,
}));

vi.mock("@/lib/rate-limit/service", () => ({
  RateLimitService: {
    getCurrentCost: mocks.getCurrentCost,
  },
}));

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getKeySessionCount: mocks.getKeySessionCount,
    getUserSessionCount: mocks.getUserSessionCount,
  },
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

function buildSessionKey(overrides: Record<string, unknown> = {}) {
  return {
    id: 31,
    userId: 11,
    name: "unit-key",
    key: "sk-unit-key",
    isEnabled: true,
    canLoginWebUi: false,
    providerGroup: "key-group",
    expiresAt: new Date("2030-01-02T00:00:00.000Z"),
    dailyResetMode: "rolling",
    dailyResetTime: "08:00",
    ...overrides,
  };
}

function buildSessionUser(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    name: "unit-user",
    role: "user",
    providerGroup: "user-group",
    expiresAt: new Date("2031-01-02T00:00:00.000Z"),
    isEnabled: true,
    ...overrides,
  };
}

function buildSession(overrides?: {
  key?: Record<string, unknown>;
  user?: Record<string, unknown>;
}) {
  return {
    key: buildSessionKey(overrides?.key),
    user: buildSessionUser(overrides?.user),
  };
}

function buildSlimRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    createdAt: new Date("2024-06-01T10:00:00.000Z"),
    model: "claude-3-5",
    originalModel: "claude-3",
    actualResponseModel: null,
    endpoint: "/v1/messages",
    statusCode: 200,
    inputTokens: 100,
    outputTokens: 50,
    costUsd: "1.25",
    durationMs: 800,
    cacheCreationInputTokens: 10,
    cacheReadInputTokens: 20,
    cacheCreation5mInputTokens: 5,
    cacheCreation1hInputTokens: 5,
    cacheTtlApplied: "5m",
    anthropicEffort: "high",
    ...overrides,
  };
}

beforeEach(() => {
  mocks.getSession.mockResolvedValue(buildSession());
  mocks.getSystemSettings.mockResolvedValue({
    currencyDisplay: "USD",
    billingModelSource: "redirected",
    ipGeoLookupEnabled: true,
  });
  mocks.resolveSystemTimezone.mockResolvedValue("UTC");
  mocks.getTranslations.mockImplementation(async () => (key: string) => key);
  mocks.select.mockImplementation(() => createThenableQuery([]));
});

async function importMyUsage() {
  vi.resetModules();
  return import("@/actions/my-usage");
}

describe("getMyUsageMetadata", () => {
  test("未授权：应返回 Unauthorized", async () => {
    mocks.getSession.mockResolvedValue(null);
    const { getMyUsageMetadata } = await importMyUsage();
    await expect(getMyUsageMetadata()).resolves.toEqual({ ok: false, error: "Unauthorized" });
  });

  test("成功：应返回 key/user 元数据与系统设置", async () => {
    const { getMyUsageMetadata } = await importMyUsage();
    const result = await getMyUsageMetadata();

    expect(result).toEqual({
      ok: true,
      data: {
        keyName: "unit-key",
        keyProviderGroup: "key-group",
        keyExpiresAt: new Date("2030-01-02T00:00:00.000Z"),
        keyIsEnabled: true,
        userName: "unit-user",
        userProviderGroup: "user-group",
        userExpiresAt: new Date("2031-01-02T00:00:00.000Z"),
        userIsEnabled: true,
        dailyResetMode: "rolling",
        dailyResetTime: "08:00",
        currencyCode: "USD",
        billingModelSource: "redirected",
      },
    });
  });

  test("缺省字段：应回退到默认值", async () => {
    mocks.getSession.mockResolvedValue(
      buildSession({
        key: {
          providerGroup: undefined,
          expiresAt: undefined,
          isEnabled: undefined,
          dailyResetMode: undefined,
          dailyResetTime: undefined,
        },
        user: { providerGroup: undefined, expiresAt: undefined, isEnabled: undefined },
      })
    );

    const { getMyUsageMetadata } = await importMyUsage();
    const result = await getMyUsageMetadata();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      keyProviderGroup: null,
      keyExpiresAt: null,
      keyIsEnabled: true,
      userProviderGroup: null,
      userExpiresAt: null,
      userIsEnabled: true,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
    });
  });

  test("设置读取失败：应返回通用错误", async () => {
    mocks.getSystemSettings.mockRejectedValue(new Error("settings down"));
    const { getMyUsageMetadata } = await importMyUsage();
    await expect(getMyUsageMetadata()).resolves.toEqual({
      ok: false,
      error: "Failed to get metadata",
    });
  });
});

describe("getMyAvailableModels / getMyAvailableEndpoints", () => {
  test("成功：应按当前 key 查询去重列表", async () => {
    mocks.getDistinctModelsForKey.mockResolvedValue(["claude-3", "gpt-4"]);
    mocks.getDistinctEndpointsForKey.mockResolvedValue(["/v1/messages"]);

    const { getMyAvailableModels, getMyAvailableEndpoints } = await importMyUsage();

    await expect(getMyAvailableModels()).resolves.toEqual({
      ok: true,
      data: ["claude-3", "gpt-4"],
    });
    expect(mocks.getDistinctModelsForKey).toHaveBeenCalledWith("sk-unit-key");

    await expect(getMyAvailableEndpoints()).resolves.toEqual({
      ok: true,
      data: ["/v1/messages"],
    });
    expect(mocks.getDistinctEndpointsForKey).toHaveBeenCalledWith("sk-unit-key");
  });

  test("未授权：应返回 UNAUTHORIZED 错误码", async () => {
    mocks.getSession.mockResolvedValue(null);
    const { getMyAvailableModels, getMyAvailableEndpoints } = await importMyUsage();

    await expect(getMyAvailableModels()).resolves.toEqual({
      ok: false,
      error: "UNAUTHORIZED",
      errorCode: ERROR_CODES.UNAUTHORIZED,
    });
    await expect(getMyAvailableEndpoints()).resolves.toEqual({
      ok: false,
      error: "UNAUTHORIZED",
      errorCode: ERROR_CODES.UNAUTHORIZED,
    });
  });

  test("仓储异常：应返回 OPERATION_FAILED 错误码", async () => {
    mocks.getDistinctModelsForKey.mockRejectedValue(new Error("db down"));
    mocks.getDistinctEndpointsForKey.mockRejectedValue(new Error("db down"));
    const { getMyAvailableModels, getMyAvailableEndpoints } = await importMyUsage();

    await expect(getMyAvailableModels()).resolves.toEqual({
      ok: false,
      error: "OPERATION_FAILED",
      errorCode: ERROR_CODES.OPERATION_FAILED,
    });
    await expect(getMyAvailableEndpoints()).resolves.toEqual({
      ok: false,
      error: "OPERATION_FAILED",
      errorCode: ERROR_CODES.OPERATION_FAILED,
    });
  });
});

describe("getMyUsageLogs", () => {
  test("billingModelSource=original：应映射重定向标记与计费模型", async () => {
    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "CNY",
      billingModelSource: "original",
    });
    mocks.findUsageLogsForKeySlim.mockResolvedValue({
      logs: [
        buildSlimRow(),
        buildSlimRow({
          id: 2,
          createdAt: null,
          model: "claude-3-5",
          originalModel: null,
          endpoint: null,
          statusCode: null,
          inputTokens: null,
          outputTokens: null,
          costUsd: null,
          durationMs: null,
          cacheCreationInputTokens: null,
          cacheReadInputTokens: null,
          cacheCreation5mInputTokens: null,
          cacheCreation1hInputTokens: null,
          cacheTtlApplied: null,
          anthropicEffort: null,
        }),
      ],
      total: 2,
    });

    const { getMyUsageLogs } = await importMyUsage();
    const result = await getMyUsageLogs();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.total).toBe(2);
    expect(result.data.page).toBe(1);
    expect(result.data.pageSize).toBe(20);
    expect(result.data.currencyCode).toBe("CNY");
    expect(result.data.billingModelSource).toBe("original");
    expect(result.data.logs[0]).toMatchObject({
      id: 1,
      model: "claude-3-5",
      billingModel: "claude-3",
      modelRedirect: "claude-3 → claude-3-5",
      anthropicEffort: "high",
      inputTokens: 100,
      outputTokens: 50,
      cost: 1.25,
      statusCode: 200,
      duration: 800,
      endpoint: "/v1/messages",
      cacheCreationInputTokens: 10,
      cacheReadInputTokens: 20,
      cacheCreation5mInputTokens: 5,
      cacheCreation1hInputTokens: 5,
      cacheTtlApplied: "5m",
    });
    expect(result.data.logs[1]).toMatchObject({
      id: 2,
      billingModel: null,
      modelRedirect: null,
      anthropicEffort: null,
      inputTokens: 0,
      outputTokens: 0,
      cost: 0,
      statusCode: null,
      duration: null,
      endpoint: null,
      cacheCreationInputTokens: null,
      cacheTtlApplied: null,
    });
  });

  test("billingModelSource=redirected：计费模型应取重定向后的 model", async () => {
    mocks.findUsageLogsForKeySlim.mockResolvedValue({
      logs: [
        buildSlimRow({ model: "m-redirect", originalModel: "m-orig" }),
        buildSlimRow({ id: 2, model: null, originalModel: "m-orig" }),
      ],
      total: 2,
    });

    const { getMyUsageLogs } = await importMyUsage();
    const result = await getMyUsageLogs();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.logs[0]?.billingModel).toBe("m-redirect");
    expect(result.data.logs[0]?.modelRedirect).toBe("m-orig → m-redirect");
    expect(result.data.logs[1]?.billingModel).toBeNull();
    expect(result.data.logs[1]?.modelRedirect).toBeNull();
  });

  test("分页参数：应截断小数并钳制在 1..100", async () => {
    mocks.findUsageLogsForKeySlim.mockResolvedValue({ logs: [], total: 0 });
    const { getMyUsageLogs } = await importMyUsage();

    await getMyUsageLogs({ page: 2.9, pageSize: 500 });
    expect(mocks.findUsageLogsForKeySlim).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 2, pageSize: 100 })
    );

    await getMyUsageLogs({ page: 0, pageSize: 0 });
    expect(mocks.findUsageLogsForKeySlim).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, pageSize: 20 })
    );
  });

  test("startTime/endTime：应优先于 startDate/endDate", async () => {
    mocks.findUsageLogsForKeySlim.mockResolvedValue({ logs: [], total: 0 });
    const { getMyUsageLogs } = await importMyUsage();

    await getMyUsageLogs({
      startTime: 1111,
      endTime: 2222,
      startDate: "2024-01-01",
      endDate: "2024-01-02",
    });
    expect(mocks.findUsageLogsForKeySlim).toHaveBeenLastCalledWith(
      expect.objectContaining({ startTime: 1111, endTime: 2222 })
    );
  });

  test("startDate/endDate：应按服务器时区解析为当日与次日零点", async () => {
    mocks.findUsageLogsForKeySlim.mockResolvedValue({ logs: [], total: 0 });
    const { getMyUsageLogs } = await importMyUsage();

    await getMyUsageLogs({ startDate: "2024-01-01", endDate: "2024-01-02" });
    expect(mocks.findUsageLogsForKeySlim).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startTime: Date.UTC(2024, 0, 1),
        endTime: Date.UTC(2024, 0, 3),
      })
    );
  });

  test("时区缺失与非法日期：应回退 UTC 并忽略非法输入", async () => {
    mocks.resolveSystemTimezone.mockResolvedValue(undefined);
    mocks.findUsageLogsForKeySlim.mockResolvedValue({ logs: [], total: 0 });
    const { getMyUsageLogs } = await importMyUsage();

    await getMyUsageLogs({ startDate: "01/01/2024", endDate: "2024-01-02" });
    expect(mocks.findUsageLogsForKeySlim).toHaveBeenLastCalledWith(
      expect.objectContaining({
        startTime: undefined,
        endTime: Date.UTC(2024, 0, 3),
      })
    );
  });

  test("未授权与仓储异常：应返回错误结果", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const { getMyUsageLogs } = await importMyUsage();
    await expect(getMyUsageLogs()).resolves.toEqual({ ok: false, error: "Unauthorized" });

    mocks.findUsageLogsForKeySlim.mockRejectedValue(new Error("db down"));
    await expect(getMyUsageLogs()).resolves.toEqual({
      ok: false,
      error: "Failed to get usage logs",
    });
  });
});

describe("getMyUsageLogsBatch", () => {
  test("成功：应透传 cursor 并钳制 limit", async () => {
    const cursor = { createdAt: "2024-06-01T00:00:00.000Z", id: 9 };
    mocks.findUsageLogsForKeyBatch.mockResolvedValue({
      logs: [buildSlimRow()],
      nextCursor: { createdAt: "2024-06-01T10:00:00.000Z", id: 1 },
      hasMore: true,
    });

    const { getMyUsageLogsBatch } = await importMyUsage();
    const result = await getMyUsageLogsBatch({ cursor, limit: 500 });

    expect(mocks.findUsageLogsForKeyBatch).toHaveBeenCalledWith(
      expect.objectContaining({ keyString: "sk-unit-key", cursor, limit: 100 })
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.hasMore).toBe(true);
    expect(result.data.nextCursor).toEqual({ createdAt: "2024-06-01T10:00:00.000Z", id: 1 });
    expect(result.data.logs[0]?.id).toBe(1);
  });

  test("limit<=0：应回退默认 20", async () => {
    mocks.findUsageLogsForKeyBatch.mockResolvedValue({
      logs: [],
      nextCursor: null,
      hasMore: false,
    });
    const { getMyUsageLogsBatch } = await importMyUsage();

    await getMyUsageLogsBatch({ limit: 0 });
    expect(mocks.findUsageLogsForKeyBatch).toHaveBeenLastCalledWith(
      expect.objectContaining({ limit: 20 })
    );
  });

  test("未授权与仓储异常：应返回错误结果", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const { getMyUsageLogsBatch } = await importMyUsage();
    await expect(getMyUsageLogsBatch()).resolves.toEqual({ ok: false, error: "Unauthorized" });

    mocks.findUsageLogsForKeyBatch.mockRejectedValue(new Error("db down"));
    await expect(getMyUsageLogsBatch()).resolves.toEqual({
      ok: false,
      error: "Failed to get usage logs",
    });
  });
});

describe("getMyUsageLogsBatchFull", () => {
  test("未授权：应返回 UNAUTHORIZED 错误码", async () => {
    mocks.getSession.mockResolvedValue(null);
    const { getMyUsageLogsBatchFull } = await importMyUsage();
    await expect(getMyUsageLogsBatchFull()).resolves.toEqual({
      ok: false,
      error: "UNAUTHORIZED",
      errorCode: ERROR_CODES.UNAUTHORIZED,
    });
  });

  test("仓储异常：应返回 OPERATION_FAILED 错误码", async () => {
    mocks.findReadonlyUsageLogsBatchForKey.mockRejectedValue(new Error("db down"));
    const { getMyUsageLogsBatchFull } = await importMyUsage();
    await expect(getMyUsageLogsBatchFull()).resolves.toEqual({
      ok: false,
      error: "OPERATION_FAILED",
      errorCode: ERROR_CODES.OPERATION_FAILED,
    });
  });

  test("脱敏：providerChain 为空/无 provider 详情/非拦截 specialSettings 的边界", async () => {
    mocks.findReadonlyUsageLogsBatchForKey.mockResolvedValue({
      logs: [
        {
          id: 1,
          userName: "admin",
          keyName: "some-key",
          providerName: "provider-x",
          errorMessage: "boom",
          blockedReason: "blocked",
          userAgent: "ua",
          messagesCount: 3,
          _liveChain: { chain: [], phase: "provider", updatedAt: 1 },
          providerChain: null,
          costMultiplier: 2,
          groupCostMultiplier: 3,
          costBreakdown: { input: { usd: "0.1" } },
          specialSettings: [{ type: "cache_ttl", ttl: "5m" }],
        },
        {
          id: 2,
          userName: "admin",
          keyName: "some-key",
          providerName: null,
          errorMessage: null,
          blockedReason: null,
          userAgent: null,
          messagesCount: null,
          _liveChain: null,
          providerChain: [
            {
              id: 9,
              name: "no-provider-details",
              errorDetails: { clientError: "client saw this" },
            },
          ],
          costMultiplier: null,
          groupCostMultiplier: null,
          costBreakdown: null,
          specialSettings: null,
        },
      ],
      nextCursor: null,
      hasMore: false,
    });

    const { getMyUsageLogsBatchFull } = await importMyUsage();
    const result = await getMyUsageLogsBatchFull({ limit: 10 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.logs[0]).toMatchObject({
      id: 1,
      userName: "",
      keyName: "",
      providerName: null,
      errorMessage: null,
      blockedReason: null,
      userAgent: null,
      messagesCount: null,
      _liveChain: null,
      providerChain: null,
      costMultiplier: null,
      groupCostMultiplier: null,
      costBreakdown: null,
      specialSettings: [{ type: "cache_ttl", ttl: "5m" }],
    });
    const scrubbedChain = result.data.logs[1]?.providerChain;
    expect(scrubbedChain?.[0]?.errorDetails?.clientError).toBe("client saw this");
    expect(scrubbedChain?.[0]?.errorDetails?.provider).toBeUndefined();
    expect(result.data.logs[1]?.specialSettings).toBeNull();
  });
});

describe("getMyTodayStats", () => {
  beforeEach(() => {
    mocks.getTimeRangeForPeriodWithMode.mockResolvedValue({
      startTime: new Date("2024-06-01T00:00:00.000Z"),
      endTime: new Date("2024-06-02T00:00:00.000Z"),
    });
  });

  test("聚合：应按 billingModelSource=original 计算合计与分模型明细", async () => {
    mocks.getSystemSettings.mockResolvedValue({
      currencyDisplay: "USD",
      billingModelSource: "original",
    });
    mocks.select.mockImplementation(() =>
      createThenableQuery([
        {
          model: "m1",
          originalModel: "m0",
          calls: 2,
          costUsd: "3.25",
          inputTokens: 100,
          outputTokens: 40,
        },
        {
          model: "m2",
          originalModel: null,
          calls: null,
          costUsd: null,
          inputTokens: null,
          outputTokens: null,
        },
        {
          model: "m3",
          originalModel: "m3o",
          calls: 1,
          costUsd: "not-a-number",
          inputTokens: 1,
          outputTokens: 1,
        },
      ])
    );

    const { getMyTodayStats } = await importMyUsage();
    const result = await getMyTodayStats();

    expect(mocks.getTimeRangeForPeriodWithMode).toHaveBeenCalledWith("daily", "08:00", "rolling");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.calls).toBe(3);
    expect(result.data.inputTokens).toBe(101);
    expect(result.data.outputTokens).toBe(41);
    expect(result.data.costUsd).toBe(3.25);
    expect(result.data.modelBreakdown).toEqual([
      {
        model: "m1",
        billingModel: "m0",
        calls: 2,
        costUsd: 3.25,
        inputTokens: 100,
        outputTokens: 40,
      },
      {
        model: "m2",
        billingModel: null,
        calls: null,
        costUsd: 0,
        inputTokens: null,
        outputTokens: null,
      },
      { model: "m3", billingModel: "m3o", calls: 1, costUsd: 0, inputTokens: 1, outputTokens: 1 },
    ]);
  });

  test("key 缺省重置配置：应回退 00:00/fixed，redirected 计费模型取 model", async () => {
    mocks.getSession.mockResolvedValue(
      buildSession({ key: { dailyResetTime: undefined, dailyResetMode: undefined } })
    );
    mocks.select.mockImplementation(() =>
      createThenableQuery([
        {
          model: "m1",
          originalModel: "m0",
          calls: 1,
          costUsd: "1",
          inputTokens: 1,
          outputTokens: 1,
        },
      ])
    );

    const { getMyTodayStats } = await importMyUsage();
    const result = await getMyTodayStats();

    expect(mocks.getTimeRangeForPeriodWithMode).toHaveBeenCalledWith("daily", "00:00", "fixed");
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.modelBreakdown[0]?.billingModel).toBe("m1");
  });

  test("未授权与查询异常：应返回错误结果", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const { getMyTodayStats } = await importMyUsage();
    await expect(getMyTodayStats()).resolves.toEqual({ ok: false, error: "Unauthorized" });

    mocks.select.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(getMyTodayStats()).resolves.toEqual({
      ok: false,
      error: "Failed to get today's usage",
    });
  });
});

describe("getMyStatsSummary", () => {
  function buildSummaryRow(overrides: Record<string, unknown> = {}) {
    return {
      model: "mA",
      userRequests: 5,
      userCost: "9",
      userInputTokens: 500,
      userOutputTokens: 200,
      userCacheCreationTokens: 10,
      userCacheReadTokens: 20,
      userCacheCreation5mTokens: 1,
      userCacheCreation1hTokens: 2,
      keyRequests: 2,
      keyCost: "1.5",
      keyInputTokens: 100,
      keyOutputTokens: 50,
      keyCacheCreationTokens: 5,
      keyCacheReadTokens: 6,
      keyCacheCreation5mTokens: 1,
      keyCacheCreation1hTokens: 1,
      ...overrides,
    };
  }

  test("聚合：Key 维度过滤零请求行并按成本排序，User 维度保留全部", async () => {
    mocks.select.mockImplementation(() =>
      createThenableQuery([
        buildSummaryRow(),
        buildSummaryRow({
          model: "mB",
          userRequests: 3,
          userCost: null,
          keyRequests: 3,
          keyCost: "4.5",
          keyInputTokens: null,
          keyOutputTokens: null,
          keyCacheCreationTokens: null,
          keyCacheReadTokens: null,
          keyCacheCreation5mTokens: null,
          keyCacheCreation1hTokens: null,
        }),
        buildSummaryRow({
          model: "mC",
          userRequests: 1,
          userCost: "2",
          keyRequests: 0,
          keyCost: null,
        }),
      ])
    );

    const { getMyStatsSummary } = await importMyUsage();
    const result = await getMyStatsSummary({ startDate: "2024-01-01", endDate: "2024-01-31" });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalRequests).toBe(5);
    expect(result.data.totalCost).toBe(6);
    expect(result.data.totalInputTokens).toBe(100);
    expect(result.data.totalOutputTokens).toBe(50);
    expect(result.data.totalCacheCreationTokens).toBe(5);
    expect(result.data.totalCacheReadTokens).toBe(6);
    expect(result.data.totalTokens).toBe(161);
    expect(result.data.currencyCode).toBe("USD");

    expect(result.data.keyModelBreakdown.map((item) => item.model)).toEqual(["mB", "mA"]);
    expect(result.data.keyModelBreakdown[0]).toMatchObject({
      model: "mB",
      requests: 3,
      cost: 4.5,
      inputTokens: null,
      cacheCreationTokens: null,
    });
    expect(result.data.userModelBreakdown).toHaveLength(3);
    expect(result.data.userModelBreakdown[1]).toMatchObject({ model: "mB", cost: 0 });
  });

  test("无日期过滤：应查询全量并返回空聚合", async () => {
    const { getMyStatsSummary } = await importMyUsage();
    const result = await getMyStatsSummary();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.totalRequests).toBe(0);
    expect(result.data.totalCost).toBe(0);
    expect(result.data.keyModelBreakdown).toEqual([]);
    expect(result.data.userModelBreakdown).toEqual([]);
  });

  test("未授权与查询异常：应返回错误结果", async () => {
    mocks.getSession.mockResolvedValueOnce(null);
    const { getMyStatsSummary } = await importMyUsage();
    await expect(getMyStatsSummary()).resolves.toEqual({ ok: false, error: "Unauthorized" });

    mocks.select.mockImplementation(() => {
      throw new Error("db down");
    });
    await expect(getMyStatsSummary()).resolves.toEqual({
      ok: false,
      error: "Failed to get statistics summary",
    });
  });
});

describe("getMyQuota", () => {
  function mockQuotaDependencies() {
    mocks.getTimeRangeForPeriodWithMode.mockResolvedValue({
      startTime: new Date("2024-06-01T00:00:00.000Z"),
      endTime: new Date("2024-06-02T00:00:00.000Z"),
    });
    mocks.getTimeRangeForPeriod.mockResolvedValue({
      startTime: new Date("2024-06-01T00:00:00.000Z"),
      endTime: new Date("2024-06-02T00:00:00.000Z"),
    });
    mocks.sumKeyQuotaCostsById.mockResolvedValue({
      cost5h: 1,
      costDaily: 2,
      costWeekly: 3,
      costMonthly: 4,
      costTotal: 5,
    });
    mocks.sumUserQuotaCosts.mockResolvedValue({
      cost5h: 6,
      costDaily: 7,
      costWeekly: 8,
      costMonthly: 9,
      costTotal: 10,
    });
    mocks.getCurrentCost.mockResolvedValue(0.5);
    mocks.getKeySessionCount.mockResolvedValue(1);
    mocks.getUserSessionCount.mockResolvedValue(2);
  }

  test("fixed 5h 模式：应使用 RateLimitService 的固定窗口消费", async () => {
    mockQuotaDependencies();
    mocks.getSession.mockResolvedValue(
      buildSession({
        key: {
          limit5hResetMode: "fixed",
          limit5hUsd: 20,
          limitDailyUsd: 30,
          limitWeeklyUsd: 40,
          limitMonthlyUsd: 50,
          limitTotalUsd: 60,
          limitConcurrentSessions: 3,
          costResetAt: null,
        },
        user: {
          limit5hResetMode: "fixed",
          limit5hUsd: 21,
          limitWeeklyUsd: 41,
          limitMonthlyUsd: 51,
          limitTotalUsd: 61,
          limitConcurrentSessions: 4,
          rpm: 60,
          dailyQuota: 31,
          costResetAt: null,
          limit5hCostResetAt: null,
          allowedModels: ["claude-3"],
          allowedClients: ["claude-cli"],
        },
      })
    );

    const { getMyQuota } = await importMyUsage();
    const result = await getMyQuota();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      keyLimit5hUsd: 20,
      keyCurrent5hUsd: 0.5,
      keyCurrentDailyUsd: 2,
      keyCurrentTotalUsd: 5,
      keyCurrentConcurrentSessions: 1,
      keyLimitConcurrentSessions: 3,
      userLimit5hUsd: 21,
      userCurrent5hUsd: 0.5,
      userCurrentDailyUsd: 7,
      userCurrentTotalUsd: 10,
      userCurrentConcurrentSessions: 2,
      userLimitConcurrentSessions: 4,
      userRpmLimit: 60,
      userLimitDailyUsd: 31,
      userAllowedModels: ["claude-3"],
      userAllowedClients: ["claude-cli"],
    });
    expect(mocks.getCurrentCost).toHaveBeenCalledTimes(2);
  });

  test("rolling 5h 与缺省字段：应回退 DB 聚合与默认值", async () => {
    mockQuotaDependencies();
    mocks.getSession.mockResolvedValue(
      buildSession({
        key: {
          dailyResetTime: undefined,
          dailyResetMode: undefined,
          limit5hResetMode: undefined,
          limit5hUsd: undefined,
          limitDailyUsd: undefined,
          limitWeeklyUsd: undefined,
          limitMonthlyUsd: undefined,
          limitTotalUsd: undefined,
          limitConcurrentSessions: undefined,
          expiresAt: undefined,
          providerGroup: undefined,
          isEnabled: undefined,
        },
        user: {
          dailyResetTime: undefined,
          dailyResetMode: undefined,
          limit5hResetMode: undefined,
          limit5hUsd: undefined,
          limitWeeklyUsd: undefined,
          limitMonthlyUsd: undefined,
          limitTotalUsd: undefined,
          limitConcurrentSessions: undefined,
          rpm: undefined,
          dailyQuota: undefined,
          expiresAt: undefined,
          providerGroup: undefined,
          isEnabled: undefined,
          allowedModels: undefined,
          allowedClients: undefined,
        },
      })
    );

    const { getMyQuota } = await importMyUsage();
    const result = await getMyQuota();

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toMatchObject({
      keyLimit5hUsd: null,
      keyCurrent5hUsd: 1,
      userCurrent5hUsd: 6,
      userLimitConcurrentSessions: null,
      userRpmLimit: null,
      userLimitDailyUsd: null,
      userAllowedModels: [],
      userAllowedClients: [],
      keyIsEnabled: true,
      userIsEnabled: true,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      expiresAt: null,
    });
    expect(mocks.getCurrentCost).not.toHaveBeenCalled();
  });

  test("未授权与依赖异常：应返回错误结果", async () => {
    const { getMyQuota } = await importMyUsage();

    mocks.getSession.mockResolvedValueOnce(null);
    await expect(getMyQuota()).resolves.toEqual({ ok: false, error: "Unauthorized" });

    mockQuotaDependencies();
    mocks.getTimeRangeForPeriodWithMode.mockRejectedValue(new Error("time utils down"));
    await expect(getMyQuota()).resolves.toEqual({
      ok: false,
      error: "Failed to get quota information",
    });
  });
});

describe("getMyIpGeoDetails", () => {
  test("查询异常：应返回 OPERATION_FAILED 错误码", async () => {
    mocks.select.mockImplementation(() => {
      throw new Error("db down");
    });

    const { getMyIpGeoDetails } = await importMyUsage();
    await expect(getMyIpGeoDetails({ ip: "1.2.3.4" })).resolves.toEqual({
      ok: false,
      error: "OPERATION_FAILED",
      errorCode: ERROR_CODES.OPERATION_FAILED,
    });
  });
});
