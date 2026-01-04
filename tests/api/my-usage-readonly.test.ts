import { afterAll, beforeEach, describe, expect, test, vi } from "vitest";
import { inArray } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, users } from "@/drizzle/schema";
import { callActionsRoute } from "../test-utils";

/**
 * 说明：
 * - /api/actions 的鉴权在 adapter 层通过 Cookie 读取 auth-token
 * - my-usage 的业务逻辑在 action 层仍会调用 getSession()（next/headers cookies）
 * - 测试环境下需要 mock next/headers，否则 getSession 无法读取 Cookie
 *
 * 这里用一个可变的 currentAuthToken 作为“当前请求 Cookie”，并确保：
 * - adapter 校验用的 Cookie（callActionsRoute.authToken）
 * - action 读取到的 Cookie（currentAuthToken）
 * 两者保持一致，避免出现“adapter 通过但 action 读不到 session”的假失败。
 */
let currentAuthToken: string | undefined;

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
}));

type TestKey = { id: number; userId: number; key: string; name: string };
type TestUser = { id: number; name: string };

async function createTestUser(name: string): Promise<TestUser> {
  const [row] = await db
    .insert(users)
    .values({
      name,
    })
    .returning({ id: users.id, name: users.name });

  if (!row) {
    throw new Error("创建测试用户失败：未返回插入结果");
  }

  return row;
}

async function createTestKey(params: {
  userId: number;
  key: string;
  name: string;
  canLoginWebUi: boolean;
}): Promise<TestKey> {
  const [row] = await db
    .insert(keys)
    .values({
      userId: params.userId,
      key: params.key,
      name: params.name,
      canLoginWebUi: params.canLoginWebUi,
      // 为避免跨时区/临界点导致“今日”边界不稳定，这里固定使用 rolling
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
    })
    .returning({ id: keys.id, userId: keys.userId, key: keys.key, name: keys.name });

  if (!row) {
    throw new Error("创建测试 Key 失败：未返回插入结果");
  }

  return row;
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
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    })
    .returning({ id: messageRequest.id });

  if (!row?.id) {
    throw new Error("创建 message_request 失败：未返回 id");
  }

  return row.id;
}

describe("my-usage API：只读 Key 自助查询", () => {
  const createdUserIds: number[] = [];
  const createdKeyIds: number[] = [];
  const createdMessageIds: number[] = [];

  afterAll(async () => {
    // 软删除更安全：避免潜在外键约束或其他测试依赖
    const now = new Date();
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

  test("只读 Key：允许访问 my-usage 端点，但禁止访问其他 WebUI API", async () => {
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

    // 禁止访问需要 WebUI 权限的 actions（默认 validateKey 会拒绝 canLoginWebUi=false 的 key）
    const usersApi = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/users/getUsers",
      authToken: readonlyKey.key,
      body: {},
    });
    expect(usersApi.response.status).toBe(401);
    expect(usersApi.json).toMatchObject({ ok: false });

    const usageLogsApi = await callActionsRoute({
      method: "POST",
      pathname: "/api/actions/usage-logs/getUsageLogs",
      authToken: readonlyKey.key,
      body: {},
    });
    expect(usageLogsApi.response.status).toBe(401);
    expect(usageLogsApi.json).toMatchObject({ ok: false });
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
      pathname: "/api/actions/my-usage/getMyUsageLogs",
      authToken: keyA.key,
      body: { page: 1, pageSize: 50 },
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
});
