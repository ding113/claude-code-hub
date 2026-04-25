import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, usageLedger, users } from "@/drizzle/schema";

let callActionsRouteImpl: typeof import("../test-utils")["callActionsRoute"] | undefined;
const originalSessionTokenMode = process.env.SESSION_TOKEN_MODE;

async function ensureLegacyApiRuntime() {
  if (!callActionsRouteImpl) {
    vi.resetModules();
    process.env.SESSION_TOKEN_MODE = "legacy";
    ({ callActionsRoute: callActionsRouteImpl } = await import("../test-utils"));
  }
}

async function callActionsRoute(
  ...args: Parameters<typeof import("../test-utils")["callActionsRoute"]>
) {
  await ensureLegacyApiRuntime();

  return callActionsRouteImpl(...args);
}

/**
 * 说明：
 * - /api/actions 的鉴权在 adapter 层支持 Cookie 与 Authorization: Bearer <token>
 * - my-usage 的业务逻辑在 action 层仍会调用 getSession()（next/headers cookies/headers）
 * - 测试环境下需要 mock next/headers，否则 getSession 无法读取认证信息
 *
 * 这里用一个可变的 currentAuthToken 作为“当前请求 Cookie”，并确保：
 * - adapter 校验用的 Cookie（callActionsRoute.authToken）
 * - action 读取到的 Cookie（currentAuthToken）
 * 两者保持一致，避免出现“adapter 通过但 action 读不到 session”的假失败。
 */
let currentAuthToken: string | undefined;
let currentAuthorization: string | undefined;

vi.mock("next/headers", () => ({
  cookies: () => ({
    get: (name: string) => {
      if (name !== "auth-token") return undefined;
      return currentAuthToken ? { value: currentAuthToken } : undefined;
    },
    set: vi.fn(),
    delete: vi.fn(),
    has: (name: string) => name === "auth-token" && Boolean(currentAuthToken),
  }),
  headers: () => ({
    get: (name: string) => {
      if (name.toLowerCase() !== "authorization") return null;
      return currentAuthorization ?? null;
    },
  }),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
  getTranslations: vi.fn(async () => (key: string) => key),
}));

type TestKey = { id: number; userId: number; key: string; name: string };
type TestUser = { id: number; name: string };

let ledgerRequestCursor = 980_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 10;
let ledgerProviderCursor = 990_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 10;

function nextLedgerRequestId() {
  ledgerRequestCursor += 1;
  return ledgerRequestCursor;
}

function nextLedgerProviderId() {
  ledgerProviderCursor += 1;
  return ledgerProviderCursor;
}

function getStableRecentUtcTimestamp(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    0,
    0
  );
}

async function createTestUser(name: string): Promise<TestUser> {
  await ensureLegacyApiRuntime();
  const { createUser } = await import("@/repository/user");
  const row = await createUser({
    name,
    description: "",
    providerGroup: "default",
    tags: [],
    allowedClients: [],
    blockedClients: [],
    allowedModels: [],
    dailyResetMode: "rolling",
    dailyResetTime: "00:00",
    isEnabled: true,
  });

  return { id: row.id, name: row.name };
}

async function createTestKey(params: {
  userId: number;
  key: string;
  name: string;
  canLoginWebUi: boolean;
}): Promise<TestKey> {
  await ensureLegacyApiRuntime();
  const { createKey } = await import("@/repository/key");
  const row = await createKey({
    user_id: params.userId,
    name: params.name,
    key: params.key,
    is_enabled: true,
    can_login_web_ui: params.canLoginWebUi,
    daily_reset_mode: "rolling",
    daily_reset_time: "00:00",
    limit_5h_reset_mode: "rolling",
    provider_group: "default",
  });

  return { id: row.id, userId: row.userId, key: row.key, name: row.name };
}

async function createMessage(params: {
  userId: number;
  key: string;
  model: string;
  originalModel?: string;
  endpoint?: string | null;
  costUsd?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  blockedBy?: string | null;
  clientIp?: string | null;
  createdAt: Date;
}): Promise<number> {
  const [row] = await db
    .insert(messageRequest)
    .values({
      providerId: 0,
      userId: params.userId,
      key: params.key,
      model: params.model,
      originalModel: params.originalModel ?? params.model,
      endpoint: params.endpoint ?? "/v1/messages",
      costUsd: params.costUsd ?? "0",
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      blockedBy: params.blockedBy ?? null,
      clientIp: params.clientIp ?? null,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    })
    .returning({ id: messageRequest.id });

  if (!row?.id) {
    throw new Error("创建 message_request 失败：未返回 id");
  }

  return row.id;
}

async function insertLedgerOnlyRow(params: {
  userId: number;
  key: string;
  model: string;
  endpoint: string;
  costUsd: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  clientIp?: string | null;
}) {
  const requestId = nextLedgerRequestId();
  const providerId = nextLedgerProviderId();

  await db.insert(usageLedger).values({
    requestId,
    userId: params.userId,
    key: params.key,
    providerId,
    finalProviderId: providerId,
    model: params.model,
    originalModel: params.model,
    endpoint: params.endpoint,
    apiType: "openai",
    statusCode: 200,
    isSuccess: true,
    blockedBy: null,
    costUsd: params.costUsd,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    clientIp: params.clientIp ?? null,
    createdAt: params.createdAt,
  });

  return requestId;
}

describe.skipIf(!process.env.DSN)("my-usage API：只读 Key 自助查询", () => {
  const createdUserIds: number[] = [];
  const createdKeyIds: number[] = [];
  const createdMessageIds: number[] = [];
  const createdLedgerRequestIds: number[] = [];

  afterAll(async () => {
    if (originalSessionTokenMode === undefined) {
      delete process.env.SESSION_TOKEN_MODE;
    } else {
      process.env.SESSION_TOKEN_MODE = originalSessionTokenMode;
    }

    // 软删除更安全：避免潜在外键约束或其他测试依赖
    const now = new Date();
    if (createdMessageIds.length + createdLedgerRequestIds.length > 0) {
      await db
        .delete(usageLedger)
        .where(inArray(usageLedger.requestId, [...createdMessageIds, ...createdLedgerRequestIds]));
    }

    if (createdMessageIds.length > 0) {
      await db
        .update(messageRequest)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(messageRequest.id, createdMessageIds));
    }

    if (createdKeyIds.length > 0) {
      await db
        .update(keys)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(keys.id, createdKeyIds));
    }

    if (createdUserIds.length > 0) {
      await db
        .update(users)
        .set({ deletedAt: now, updatedAt: now })
        .where(inArray(users.id, createdUserIds));
    }
  });

  beforeEach(() => {
    currentAuthToken = undefined;
    currentAuthorization = undefined;
  });

  test("未携带 auth-token：my-usage 端点应返回 401", async () => {
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyTodayStats",
      body: {},
    });

    expect(response.status).toBe(401);
    expect(json).toMatchObject({ ok: false });
  });

  test("只读 Key：允许访问 my-usage 端点和其他 allowReadOnlyAccess 端点", async () => {
    const unique = `my-usage-readonly-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    currentAuthToken = readonlyKey.key;

    // 允许访问 my-usage（allowReadOnlyAccess 白名单）
    const meta = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyUsageMetadata",
      authToken: readonlyKey.key,
      body: {},
    });
    expect(meta.response.status).toBe(200);
    expect(meta.json).toMatchObject({ ok: true });

    const quota = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyQuota",
      authToken: readonlyKey.key,
      body: {},
    });
    expect(quota.response.status).toBe(200);
    expect(quota.json).toMatchObject({ ok: true });

    // Issue #687 fix: getUsers 和 getUsageLogs 现在也支持 allowReadOnlyAccess
    // 普通用户只能看到自己的数据
    const usersApi = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUsers",
      authToken: readonlyKey.key,
      body: {},
    });
    expect(usersApi.response.status).toBe(200);
    expect(usersApi.json).toMatchObject({ ok: true });
    // 验证只返回自己的数据
    const usersData = (
      usersApi.json as {
        ok: boolean;
        data: Array<{
          id: number;
          keys: Array<{ id: number; maskedKey: string; fullKey?: string; canCopy: boolean }>;
        }>;
      }
    ).data;
    expect(usersData.length).toBe(1);
    expect(usersData[0].id).toBe(user.id);
    expect(usersData[0].keys).toHaveLength(1);
    expect(usersData[0].keys[0].maskedKey).toBeTruthy();
    expect(usersData[0].keys[0].fullKey).toBeUndefined();
    expect(usersData[0].keys[0].canCopy).toBe(false);

    const usageLogsApi = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/usage-logs/getUsageLogs",
      authToken: readonlyKey.key,
      body: {},
    });
    expect(usageLogsApi.response.status).toBe(200);
    expect(usageLogsApi.json).toMatchObject({ ok: true });
  });

  test("Bearer-only：仅 Authorization 也应可查询 my-usage 和其他 allowReadOnlyAccess 端点", async () => {
    const unique = `my-usage-bearer-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    await db
      .update(users)
      .set({
        rpmLimit: 60,
        dailyLimitUsd: "15",
        limit5hUsd: 12,
        limitWeeklyUsd: 25,
        limitMonthlyUsd: 35,
        providerGroup: "default",
      })
      .where(eq(users.id, user.id));

    await db
      .update(keys)
      .set({
        limit5hUsd: 10,
        limitDailyUsd: 20,
        limitWeeklyUsd: 30,
        limitMonthlyUsd: 40,
      })
      .where(eq(keys.id, readonlyKey.id));

    const now = new Date();
    const usedAt = new Date(now.getTime() - 60 * 1000);
    const msgId = await createMessage({
      userId: user.id,
      key: readonlyKey.key,
      model: "gpt-4.1-mini",
      endpoint: "/v1/messages",
      costUsd: "0.0100",
      inputTokens: 10,
      outputTokens: 20,
      createdAt: usedAt,
    });
    createdMessageIds.push(msgId);

    currentAuthorization = `Bearer ${readonlyKey.key}`;

    const stats = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyTodayStats",
      headers: { Authorization: currentAuthorization },
      body: {},
    });
    expect(stats.response.status).toBe(200);
    expect(stats.json).toMatchObject({ ok: true });
    expect((stats.json as any).data.calls).toBe(1);

    const quota = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyQuota",
      headers: { Authorization: currentAuthorization },
      body: {},
    });
    expect(quota.response.status).toBe(200);
    expect(quota.json).toMatchObject({ ok: true });

    const quotaData = (quota.json as { ok: boolean; data: Record<string, unknown> }).data;
    expect(quotaData.keyName).toBe(readonlyKey.name);
    expect(quotaData.userName).toBe(user.name);
    expect(quotaData.providerGroup).toBe("default");
    expect(quotaData.keyIsEnabled).toBe(true);
    expect(quotaData.userIsEnabled).toBe(true);
    expect(quotaData.rpmLimit).toBe(60);
    expect(quotaData.unit).toBe("USD");
    expect(quotaData.remaining).toBeTypeOf("number");
    expect(quotaData.remaining5hUsd).toBeTypeOf("number");
    expect(quotaData.remainingDailyUsd).toBeTypeOf("number");
    expect(quotaData.remainingWeeklyUsd).toBeTypeOf("number");
    expect(quotaData.remainingMonthlyUsd).toBeTypeOf("number");
    expect(quotaData.used5hUsd).toBeTypeOf("number");
    expect(quotaData.usedDailyUsd).toBeTypeOf("number");
    expect(quotaData.usedWeeklyUsd).toBeTypeOf("number");
    expect(quotaData.usedMonthlyUsd).toBeTypeOf("number");
    expect(quotaData.limit5hUsd).toBe(10);
    expect(quotaData.limitDailyUsd).toBe(15);
    expect(quotaData.limitWeeklyUsd).toBe(25);
    expect(quotaData.limitMonthlyUsd).toBe(35);
    expect(quotaData.limitTotalUsd).toBe(35);
    expect(quotaData.todayUsedUsd).toBeCloseTo(0.01, 6);
    expect(quotaData.todayRemainingUsd).toBeCloseTo(14.99, 6);
    expect(quotaData.todayUsedPercent).toBeCloseTo(0.07, 6);
    expect(quotaData.todayRemainingPercent).toBeCloseTo(99.93, 6);
    expect(quotaData.remainingPercent).toBeCloseTo(99.9, 6);
    expect(quotaData.quotaWindows).toMatchObject({
      fiveHour: {
        period: "5h",
        limitUsd: 10,
        usedUsd: 0.01,
        remainingUsd: 9.99,
        usedPercent: 0.1,
        remainingPercent: 99.9,
        isUnlimited: false,
        isExhausted: false,
      },
      daily: {
        period: "daily",
        limitUsd: 15,
        usedUsd: 0.01,
        remainingUsd: 14.99,
        usedPercent: 0.07,
        remainingPercent: 99.93,
        isUnlimited: false,
        isExhausted: false,
      },
      weekly: {
        period: "weekly",
        limitUsd: 25,
        usedUsd: 0.01,
        remainingUsd: 24.99,
      },
      monthly: {
        period: "monthly",
        limitUsd: 35,
        usedUsd: 0.01,
        remainingUsd: 34.99,
      },
      total: {
        period: "total",
        limitUsd: 35,
        usedUsd: 0.01,
        remainingUsd: 34.99,
      },
    });
    expect(quotaData.userAllowedModels).toEqual([]);
    expect(quotaData.userAllowedClients).toEqual([]);

    // Issue #687 fix: getUsers 现在也支持 allowReadOnlyAccess
    const usersApi = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUsers",
      headers: { Authorization: currentAuthorization },
      body: {},
    });
    expect(usersApi.response.status).toBe(200);
    expect(usersApi.json).toMatchObject({ ok: true });
    // 验证只返回自己的数据
    const usersData = (usersApi.json as { ok: boolean; data: Array<{ id: number }> }).data;
    expect(usersData.length).toBe(1);
    expect(usersData[0].id).toBe(user.id);
  });

  test("只读 Key：只能查询当前 key 日志里出现过的 IP 详情", async () => {
    const unique = `my-usage-ip-geo-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const userA = await createTestUser(`Test ${unique}-A`);
    createdUserIds.push(userA.id);
    const keyA = await createTestKey({
      userId: userA.id,
      key: `test-ip-geo-key-A-${unique}`,
      name: `ip-geo-A-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyA.id);

    const userB = await createTestUser(`Test ${unique}-B`);
    createdUserIds.push(userB.id);
    const keyB = await createTestKey({
      userId: userB.id,
      key: `test-ip-geo-key-B-${unique}`,
      name: `ip-geo-B-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyB.id);

    const now = new Date();
    const visibleIp = "203.0.113.9";
    const hiddenIp = "198.51.100.88";

    createdMessageIds.push(
      await createMessage({
        userId: userA.id,
        key: keyA.key,
        model: "gpt-4.1-mini",
        clientIp: visibleIp,
        createdAt: now,
      })
    );
    createdMessageIds.push(
      await createMessage({
        userId: userB.id,
        key: keyB.key,
        model: "gpt-4.1-mini",
        clientIp: hiddenIp,
        createdAt: now,
      })
    );

    currentAuthToken = keyA.key;

    const visible = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyIpGeoDetails",
      authToken: keyA.key,
      body: { ip: visibleIp, lang: "en" },
    });
    expect(visible.json).not.toMatchObject({
      ok: false,
      error: "IP not found in current key usage logs",
    });

    const hidden = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyIpGeoDetails",
      authToken: keyA.key,
      body: { ip: hiddenIp, lang: "en" },
    });
    expect(hidden.response.status).toBe(400);
    expect(hidden.json).toMatchObject({
      ok: false,
      error: "NOT_FOUND",
    });
  });

  test("总额度缺失时应回退 monthly，且只读日志隐藏 endpoint", async () => {
    const unique = `my-usage-total-fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);

    const readonlyKey = await createTestKey({
      userId: user.id,
      key: `test-readonly-key-${unique}`,
      name: `readonly-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(readonlyKey.id);

    await db
      .update(users)
      .set({
        limitMonthlyUsd: 9,
        limitTotalUsd: null,
        allowedModels: ["gpt-4.1", "claude-3-7-sonnet"],
        allowedClients: ["claude-code", "codex"],
      })
      .where(eq(users.id, user.id));

    await db
      .update(keys)
      .set({
        limitMonthlyUsd: 7,
        limitTotalUsd: null,
      })
      .where(eq(keys.id, readonlyKey.id));

    const now = new Date();
    const msgId = await createMessage({
      userId: user.id,
      key: readonlyKey.key,
      model: "gpt-4.1-mini",
      endpoint: "/v1/chat/completions",
      costUsd: "1.5000",
      inputTokens: 12,
      outputTokens: 34,
      createdAt: new Date(now.getTime() - 30 * 1000),
    });
    createdMessageIds.push(msgId);

    currentAuthorization = `Bearer ${readonlyKey.key}`;

    const quota = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyQuota",
      headers: { Authorization: currentAuthorization },
      body: {},
    });
    expect(quota.response.status).toBe(200);
    const quotaData = (quota.json as { ok: boolean; data: Record<string, unknown> }).data;
    expect(quotaData.keyLimitTotalUsd).toBe(7);
    expect(quotaData.userLimitTotalUsd).toBe(9);
    expect(quotaData.limitTotalUsd).toBe(7);
    expect(quotaData.remainingTotalUsd).toBeTypeOf("number");
    expect(quotaData.userAllowedModels).toEqual([]);
    expect(quotaData.userAllowedClients).toEqual([]);

    const logs = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyUsageLogs",
      headers: { Authorization: currentAuthorization },
      body: {},
    });
    expect(logs.response.status).toBe(200);
    const logData = (
      logs.json as {
        ok: boolean;
        data: { logs: Array<{ endpoint: string | null; model: string | null }> };
      }
    ).data.logs;
    expect(logData.length).toBeGreaterThan(0);
    expect(logData[0].model).toBe("gpt-4.1-mini");
    expect(logData[0].endpoint).toBeNull();
  });

  test("今日统计：应与 message_request 数据一致，并排除 warmup 与其他 Key 数据", async () => {
    const unique = `my-usage-stats-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const userA = await createTestUser(`Test ${unique}-A`);
    createdUserIds.push(userA.id);
    const keyA = await createTestKey({
      userId: userA.id,
      key: `test-readonly-key-A-${unique}`,
      name: `readonly-A-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyA.id);

    const userB = await createTestUser(`Test ${unique}-B`);
    createdUserIds.push(userB.id);
    const keyB = await createTestKey({
      userId: userB.id,
      key: `test-readonly-key-B-${unique}`,
      name: `readonly-B-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyB.id);

    const now = new Date();
    const t0 = new Date(now.getTime() - 60 * 1000);

    // A：两条正常计费请求 + 一条 warmup（应被排除）
    const a1 = await createMessage({
      userId: userA.id,
      key: keyA.key,
      model: "gpt-4.1",
      originalModel: "gpt-4.1-original",
      endpoint: "/v1/messages",
      costUsd: "0.0125",
      inputTokens: 100,
      outputTokens: 200,
      createdAt: t0,
    });
    const a2 = await createMessage({
      userId: userA.id,
      key: keyA.key,
      model: "gpt-4.1-mini",
      originalModel: "gpt-4.1-mini-original",
      endpoint: "/v1/chat/completions",
      costUsd: "0.0075",
      inputTokens: 50,
      outputTokens: 80,
      createdAt: t0,
    });
    const warmup = await createMessage({
      userId: userA.id,
      key: keyA.key,
      model: "gpt-4.1-mini",
      originalModel: "gpt-4.1-mini",
      endpoint: "/v1/messages",
      costUsd: null,
      inputTokens: 999,
      outputTokens: 999,
      blockedBy: "warmup",
      createdAt: t0,
    });
    createdMessageIds.push(a1, a2, warmup);

    // B：一条正常请求（不应泄漏给 A）
    const b1 = await createMessage({
      userId: userB.id,
      key: keyB.key,
      model: "gpt-4.1",
      originalModel: "gpt-4.1",
      endpoint: "/v1/messages",
      costUsd: "0.1000",
      inputTokens: 1000,
      outputTokens: 1000,
      createdAt: t0,
    });
    createdMessageIds.push(b1);

    currentAuthToken = keyA.key;

    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyTodayStats",
      authToken: keyA.key,
      body: {},
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });

    const data = (json as any).data as {
      calls: number;
      inputTokens: number;
      outputTokens: number;
      costUsd: number;
      modelBreakdown: Array<{
        model: string | null;
        billingModel: string | null;
        calls: number;
        costUsd: number;
        inputTokens: number;
        outputTokens: number;
      }>;
      billingModelSource: "original" | "redirected";
    };

    // warmup 排除后：只剩两条
    expect(data.calls).toBe(2);
    expect(data.inputTokens).toBe(150);
    expect(data.outputTokens).toBe(280);
    expect(data.costUsd).toBeCloseTo(0.02, 10);

    // breakdown：至少包含两个模型
    const breakdownByModel = new Map(data.modelBreakdown.map((row) => [row.model, row]));
    expect(breakdownByModel.get("gpt-4.1")?.calls).toBe(1);
    expect(breakdownByModel.get("gpt-4.1-mini")?.calls).toBe(1);

    // billingModelSource 不假设固定值，但要求 billingModel 字段与配置一致
    const originalModelByModel = new Map<string, string>([
      ["gpt-4.1", "gpt-4.1-original"],
      ["gpt-4.1-mini", "gpt-4.1-mini-original"],
    ]);
    for (const row of data.modelBreakdown) {
      if (!row.model) continue;
      const expectedBillingModel =
        data.billingModelSource === "original" ? originalModelByModel.get(row.model) : row.model;
      expect(row.billingModel).toBe(expectedBillingModel);
    }

    // 同时验证 usage logs：不应返回 B 的日志（不泄漏）
    const logs = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyUsageLogsBatch",
      authToken: keyA.key,
      body: { limit: 50 },
    });

    expect(logs.response.status).toBe(200);
    expect(logs.json).toMatchObject({ ok: true });

    const logIds = ((logs.json as any).data.logs as Array<{ id: number }>).map((l) => l.id);
    expect(logIds).toContain(a1);
    expect(logIds).toContain(a2);
    // warmup 行是否展示不做强约束（日志口径可见），但绝不能泄漏 B
    expect(logIds).not.toContain(b1);

    // 筛选项接口：模型与端点列表应可用
    const models = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyAvailableModels",
      authToken: keyA.key,
      body: {},
    });
    expect(models.response.status).toBe(200);
    expect((models.json as any).ok).toBe(true);
    expect((models.json as any).data).toEqual(expect.arrayContaining(["gpt-4.1", "gpt-4.1-mini"]));

    const endpoints = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyAvailableEndpoints",
      authToken: keyA.key,
      body: {},
    });
    expect(endpoints.response.status).toBe(200);
    expect((endpoints.json as any).ok).toBe(true);
    expect((endpoints.json as any).data).toEqual(
      expect.arrayContaining(["/v1/messages", "/v1/chat/completions"])
    );
  });

  test("getMyStatsSummary：未认证返回 401", async () => {
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyStatsSummary",
      body: {},
    });

    expect(response.status).toBe(401);
    expect(json).toMatchObject({ ok: false });
  });

  test("getMyStatsSummary：基础聚合统计，排除 warmup，区分 key/user breakdown", async () => {
    const unique = `stats-summary-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    // 创建两个用户，每个用户一个 key
    const userA = await createTestUser(`Test ${unique}-A`);
    createdUserIds.push(userA.id);
    const keyA = await createTestKey({
      userId: userA.id,
      key: `test-stats-key-A-${unique}`,
      name: `stats-A-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyA.id);

    // 用户 A 的第二个 key（用于测试 user breakdown 聚合多个 key）
    const keyA2 = await createTestKey({
      userId: userA.id,
      key: `test-stats-key-A2-${unique}`,
      name: `stats-A2-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyA2.id);

    const userB = await createTestUser(`Test ${unique}-B`);
    createdUserIds.push(userB.id);
    const keyB = await createTestKey({
      userId: userB.id,
      key: `test-stats-key-B-${unique}`,
      name: `stats-B-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(keyB.id);

    const now = new Date();
    const today = now.toISOString().split("T")[0];
    const t0 = new Date(now.getTime() - 60 * 1000);

    // Key A 的请求
    const a1 = await createMessage({
      userId: userA.id,
      key: keyA.key,
      model: "claude-3-opus",
      endpoint: "/v1/messages",
      costUsd: "0.1000",
      inputTokens: 500,
      outputTokens: 200,
      createdAt: t0,
    });
    const a2 = await createMessage({
      userId: userA.id,
      key: keyA.key,
      model: "claude-3-sonnet",
      endpoint: "/v1/messages",
      costUsd: "0.0500",
      inputTokens: 300,
      outputTokens: 100,
      createdAt: t0,
    });

    // Key A 的 warmup（应被排除）
    const warmupA = await createMessage({
      userId: userA.id,
      key: keyA.key,
      model: "claude-3-opus",
      endpoint: "/v1/messages",
      costUsd: "0.9999",
      inputTokens: 9999,
      outputTokens: 9999,
      blockedBy: "warmup",
      createdAt: t0,
    });

    // Key A2 的请求（同一用户的不同 key，应在 userBreakdown 中聚合）
    const a2_1 = await createMessage({
      userId: userA.id,
      key: keyA2.key,
      model: "claude-3-opus",
      endpoint: "/v1/messages",
      costUsd: "0.0800",
      inputTokens: 400,
      outputTokens: 150,
      createdAt: t0,
    });

    // Key B 的请求（不应泄漏给 A）
    const b1 = await createMessage({
      userId: userB.id,
      key: keyB.key,
      model: "gpt-4",
      endpoint: "/v1/chat/completions",
      costUsd: "0.5000",
      inputTokens: 2000,
      outputTokens: 1000,
      createdAt: t0,
    });

    createdMessageIds.push(a1, a2, warmupA, a2_1, b1);

    currentAuthToken = keyA.key;

    // 调用 getMyStatsSummary
    const { response, json } = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyStatsSummary",
      authToken: keyA.key,
      body: { startDate: today, endDate: today },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({ ok: true });

    const data = (json as any).data as {
      totalRequests: number;
      totalCost: number;
      totalInputTokens: number;
      totalOutputTokens: number;
      keyModelBreakdown: Array<{
        model: string | null;
        requests: number;
        cost: number;
        inputTokens: number;
        outputTokens: number;
      }>;
      userModelBreakdown: Array<{
        model: string | null;
        requests: number;
        cost: number;
        inputTokens: number;
        outputTokens: number;
      }>;
      currencyCode: string;
    };

    // 验证总计（仅 key A，排除 warmup）
    expect(data.totalRequests).toBe(2); // a1, a2
    expect(data.totalInputTokens).toBe(800); // 500 + 300
    expect(data.totalOutputTokens).toBe(300); // 200 + 100
    expect(data.totalCost).toBeCloseTo(0.15, 4); // 0.1 + 0.05

    // 验证 keyModelBreakdown（仅当前 key A 的数据）
    const keyBreakdownMap = new Map(data.keyModelBreakdown.map((r) => [r.model, r]));
    expect(keyBreakdownMap.get("claude-3-opus")?.requests).toBe(1);
    expect(keyBreakdownMap.get("claude-3-opus")?.cost).toBeCloseTo(0.1, 4);
    expect(keyBreakdownMap.get("claude-3-sonnet")?.requests).toBe(1);
    expect(keyBreakdownMap.get("claude-3-sonnet")?.cost).toBeCloseTo(0.05, 4);
    // warmup 不应出现（blockedBy = 'warmup'）
    // 其他用户的模型不应出现
    expect(keyBreakdownMap.has("gpt-4")).toBe(false);

    // 验证 userModelBreakdown（用户 A 的所有 key，包括 keyA2）
    const userBreakdownMap = new Map(data.userModelBreakdown.map((r) => [r.model, r]));
    // claude-3-opus: a1 (0.1) + a2_1 (0.08) = 0.18, requests = 2
    expect(userBreakdownMap.get("claude-3-opus")?.requests).toBe(2);
    expect(userBreakdownMap.get("claude-3-opus")?.cost).toBeCloseTo(0.18, 4);
    // claude-3-sonnet: a2 only
    expect(userBreakdownMap.get("claude-3-sonnet")?.requests).toBe(1);
    // 其他用户的模型不应出现
    expect(userBreakdownMap.has("gpt-4")).toBe(false);

    // 验证 currencyCode 存在
    expect(data.currencyCode).toBeDefined();
  });

  test("getMyStatsSummary：日期范围过滤", async () => {
    const unique = `stats-date-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const user = await createTestUser(`Test ${unique}`);
    createdUserIds.push(user.id);
    const key = await createTestKey({
      userId: user.id,
      key: `test-stats-date-key-${unique}`,
      name: `stats-date-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(key.id);

    const today = new Date();
    const yesterday = new Date(today.getTime() - 24 * 60 * 60 * 1000);
    const todayStr = today.toISOString().split("T")[0];
    const yesterdayStr = yesterday.toISOString().split("T")[0];

    // 昨天的请求
    const m1 = await createMessage({
      userId: user.id,
      key: key.key,
      model: "old-model",
      endpoint: "/v1/messages",
      costUsd: "0.0100",
      inputTokens: 100,
      outputTokens: 50,
      createdAt: yesterday,
    });

    // 今天的请求
    const m2 = await createMessage({
      userId: user.id,
      key: key.key,
      model: "new-model",
      endpoint: "/v1/messages",
      costUsd: "0.0200",
      inputTokens: 200,
      outputTokens: 100,
      createdAt: today,
    });

    createdMessageIds.push(m1, m2);

    currentAuthToken = key.key;

    // 仅查询今天
    const todayOnly = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyStatsSummary",
      authToken: key.key,
      body: { startDate: todayStr, endDate: todayStr },
    });

    expect(todayOnly.response.status).toBe(200);
    const todayData = (todayOnly.json as any).data;
    expect(todayData.totalRequests).toBe(1);
    expect(todayData.keyModelBreakdown.length).toBe(1);
    expect(todayData.keyModelBreakdown[0].model).toBe("new-model");

    // 查询昨天到今天
    const bothDays = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyStatsSummary",
      authToken: key.key,
      body: { startDate: yesterdayStr, endDate: todayStr },
    });

    expect(bothDays.response.status).toBe(200);
    const bothData = (bothDays.json as any).data;
    expect(bothData.totalRequests).toBe(2);
    expect(bothData.keyModelBreakdown.length).toBe(2);
  });

  test("imported ledger：full batch / filters / IP / summary / quota 在全局 message_request 非空时仍可用", async () => {
    const unique = `imported-ledger-api-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const user = await createTestUser(`Imported ${unique}`);
    createdUserIds.push(user.id);
    const key = await createTestKey({
      userId: user.id,
      key: `test-imported-key-${unique}`,
      name: `imported-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(key.id);

    const otherUser = await createTestUser(`Other ${unique}`);
    createdUserIds.push(otherUser.id);
    const otherKey = await createTestKey({
      userId: otherUser.id,
      key: `test-imported-other-key-${unique}`,
      name: `imported-other-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(otherKey.id);

    const now = getStableRecentUtcTimestamp();
    const today = new Date(now).toISOString().slice(0, 10);
    const visibleIp = "203.0.113.29";

    createdLedgerRequestIds.push(
      await insertLedgerOnlyRow({
        userId: user.id,
        key: key.key,
        model: "imported-model-a",
        endpoint: "/v1/messages",
        costUsd: "1.200000000000000",
        inputTokens: 120,
        outputTokens: 24,
        createdAt: new Date(now),
        clientIp: visibleIp,
      })
    );
    createdLedgerRequestIds.push(
      await insertLedgerOnlyRow({
        userId: user.id,
        key: key.key,
        model: "imported-model-b",
        endpoint: "/v1/chat/completions",
        costUsd: "0.800000000000000",
        inputTokens: 80,
        outputTokens: 16,
        createdAt: new Date(now),
      })
    );

    createdMessageIds.push(
      await createMessage({
        userId: otherUser.id,
        key: otherKey.key,
        model: "other-live-model",
        endpoint: "/v1/messages",
        costUsd: "0.1000",
        inputTokens: 10,
        outputTokens: 5,
        createdAt: new Date(now),
      })
    );

    currentAuthToken = key.key;

    const full = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyUsageLogsBatchFull",
      authToken: key.key,
      body: { limit: 20 },
    });
    expect(full.response.status).toBe(200);
    expect((full.json as any).ok).toBe(true);
    expect(((full.json as any).data.logs as Array<{ id: number }>).map((row) => row.id)).toEqual(
      createdLedgerRequestIds.slice(-2).reverse()
    );
    expect((full.json as any).data.logs[0].providerChain).toBeNull();
    expect((full.json as any).data.logs[0].userAgent).toBeNull();

    const models = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyAvailableModels",
      authToken: key.key,
      body: {},
    });
    expect(models.response.status).toBe(200);
    expect((models.json as any).data).toEqual(["imported-model-a", "imported-model-b"]);

    const endpoints = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyAvailableEndpoints",
      authToken: key.key,
      body: {},
    });
    expect(endpoints.response.status).toBe(200);
    expect((endpoints.json as any).data).toEqual(["/v1/chat/completions", "/v1/messages"]);

    const ip = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyIpGeoDetails",
      authToken: key.key,
      body: { ip: visibleIp, lang: "en" },
    });
    expect(ip.response.status).toBe(200);
    expect((ip.json as any).ok).toBe(true);

    const summary = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyStatsSummary",
      authToken: key.key,
      body: { startDate: today, endDate: today },
    });
    expect(summary.response.status).toBe(200);
    expect((summary.json as any).data.totalRequests).toBe(2);
    expect((summary.json as any).data.totalCost).toBeCloseTo(2.0, 10);

    const quota = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyQuota",
      authToken: key.key,
      body: {},
    });
    expect(quota.response.status).toBe(200);
    expect((quota.json as any).data.keyCurrent5hUsd).toBeCloseTo(2.0, 10);
  });

  test("imported ledger：mixed old/new data 在 readonly full batch 与 summary 中不重复计数", async () => {
    const unique = `imported-mixed-api-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    const user = await createTestUser(`Mixed ${unique}`);
    createdUserIds.push(user.id);
    const key = await createTestKey({
      userId: user.id,
      key: `test-imported-mixed-key-${unique}`,
      name: `imported-mixed-${unique}`,
      canLoginWebUi: false,
    });
    createdKeyIds.push(key.id);

    const now = getStableRecentUtcTimestamp();
    const today = new Date(now).toISOString().slice(0, 10);

    const importedRequestId = await insertLedgerOnlyRow({
      userId: user.id,
      key: key.key,
      model: "imported-only-model",
      endpoint: "/v1/messages",
      costUsd: "1.100000000000000",
      inputTokens: 110,
      outputTokens: 22,
      createdAt: new Date(now),
    });
    createdLedgerRequestIds.push(importedRequestId);

    const liveRequestId = await createMessage({
      userId: user.id,
      key: key.key,
      model: "live-model",
      endpoint: "/v1/responses",
      costUsd: "0.900000000000000",
      inputTokens: 90,
      outputTokens: 18,
      createdAt: new Date(now),
    });
    createdMessageIds.push(liveRequestId);

    currentAuthToken = key.key;

    const full = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyUsageLogsBatchFull",
      authToken: key.key,
      body: { limit: 20 },
    });
    expect(full.response.status).toBe(200);
    expect(((full.json as any).data.logs as Array<{ id: number }>).map((row) => row.id)).toEqual([
      importedRequestId,
      liveRequestId,
    ]);

    const summary = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/my-usage/getMyStatsSummary",
      authToken: key.key,
      body: { startDate: today, endDate: today },
    });
    expect(summary.response.status).toBe(200);
    expect((summary.json as any).data.totalRequests).toBe(2);
    expect((summary.json as any).data.totalCost).toBeCloseTo(2.0, 10);
  });
});
