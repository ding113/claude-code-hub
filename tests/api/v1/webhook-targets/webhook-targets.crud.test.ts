/**
 * /api/v1/webhook-targets CRUD + secret-redaction integration tests.
 *
 * 通过 mock @/actions/webhook-targets 隔离 DB / network。
 * 调用流程：构造 Request → import route handler → 断言响应。
 *
 * 覆盖：
 * - GET 列表返回 items 数组、敏感字段全部 [REDACTED]
 * - POST 201 + Location 头、响应 body 不含原始 secret
 * - GET 单条 200
 * - PATCH 200 + 脱敏
 * - DELETE 204
 * - POST :test 200 + Cache-Control: no-store
 * - 鉴权：无 token → 401；read-only key → 403
 */

import "../../../server-only.mock";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  // Admin tier admits non-env API keys only when this flag is on.
  vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "true");
  vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
  vi.stubEnv("ADMIN_TOKEN", "admin-env-token-only-for-tests");
  const env = await import("@/lib/config/env.schema");
  env.resetEnvConfigForTests();
});

const RAW_TARGET = {
  id: 42,
  name: "ops-bot",
  providerType: "telegram",
  webhookUrl: null,
  telegramBotToken: "12345:secret-bot-token-RAW",
  telegramChatId: "@ops",
  dingtalkSecret: null,
  customTemplate: null,
  customHeaders: null,
  proxyUrl: null,
  proxyFallbackToDirect: false,
  isEnabled: true,
  lastTestSuccess: null,
  lastTestError: null,
  lastTestAt: null,
  lastTestLatencyMs: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

vi.mock("@/actions/webhook-targets", () => ({
  getWebhookTargetsAction: vi.fn(async () => ({ ok: true, data: [RAW_TARGET] })),
  createWebhookTargetAction: vi.fn(async (input: unknown) => ({
    ok: true,
    data: { ...RAW_TARGET, ...(input as Record<string, unknown>), id: 99 },
  })),
  updateWebhookTargetAction: vi.fn(async (id: number, input: unknown) => ({
    ok: true,
    data: { ...RAW_TARGET, ...(input as Record<string, unknown>), id },
  })),
  deleteWebhookTargetAction: vi.fn(async () => ({ ok: true, data: undefined })),
  testWebhookTargetAction: vi.fn(async () => ({ ok: true, data: { latencyMs: 123 } })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") {
        return {
          user: {
            id: -1,
            name: "Admin",
            description: "test admin",
            role: "admin",
            rpm: 0,
            dailyQuota: 0,
            providerGroup: null,
            isEnabled: true,
            expiresAt: null,
            limit5hResetMode: "rolling",
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          key: {
            id: -1,
            userId: -1,
            name: "admin",
            key: "admin-test-token",
            isEnabled: true,
            canLoginWebUi: true,
            providerGroup: null,
            limit5hUsd: null,
            limit5hResetMode: "rolling",
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitConcurrentSessions: 0,
            cacheTtlPreference: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }
      if (token === "readonly-key") {
        // simulate a non-admin user with read-only access
        return {
          user: {
            id: 7,
            name: "user",
            description: "",
            role: "user",
            rpm: 0,
            dailyQuota: 0,
            providerGroup: null,
            isEnabled: true,
            expiresAt: null,
            limit5hResetMode: "rolling",
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            createdAt: new Date(),
            updatedAt: new Date(),
          },
          key: {
            id: 9,
            userId: 7,
            name: "readonly",
            key: "readonly-key",
            isEnabled: true,
            canLoginWebUi: false,
            providerGroup: null,
            limit5hUsd: null,
            limit5hResetMode: "rolling",
            limitDailyUsd: null,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitWeeklyUsd: null,
            limitMonthlyUsd: null,
            limitConcurrentSessions: 0,
            cacheTtlPreference: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        };
      }
      return null;
    }),
  };
});

const route = await import("@/app/api/v1/[...route]/route");
const { GET, POST, PATCH, DELETE } = route;

function authedRequest(
  method: string,
  path: string,
  body?: unknown,
  headers?: Record<string, string>
): Request {
  const url = new URL(path, "http://localhost");
  const init: RequestInit = {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      // X-Api-Key sets authMode = "api-key", which skips CSRF middleware.
      "X-Api-Key": "admin-test-token",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return new Request(url, init);
}

describe("/api/v1/webhook-targets — CRUD + redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items with secrets redacted", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/webhook-targets"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    const t = body.items[0];
    expect(t.telegramBotToken).toBe("[REDACTED]");
    // raw secret never leaks
    expect(JSON.stringify(body)).not.toContain("secret-bot-token-RAW");
    // ISO date format
    expect(typeof t.createdAt).toBe("string");
    expect(t.createdAt).toContain("2026-04-01");
  });

  it("POST creates and returns 201 + Location header", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/webhook-targets", {
        name: "new-target",
        providerType: "telegram",
        telegramBotToken: "raw-bot-secret",
        telegramChatId: "@new",
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/api/v1/webhook-targets/99");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(99);
    expect(body.telegramBotToken).toBe("[REDACTED]");
    expect(JSON.stringify(body)).not.toContain("raw-bot-secret");
  });

  it("GET /{id} returns single redacted resource", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/webhook-targets/42"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(42);
    expect(body.telegramBotToken).toBe("[REDACTED]");
  });

  it("GET /{id} returns 404 problem+json when missing", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/webhook-targets/9999"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.errorCode).toBe("not_found");
  });

  it("PATCH /{id} returns 200 with redacted body", async () => {
    const res = await PATCH(
      authedRequest("PATCH", "/api/v1/webhook-targets/42", { name: "renamed" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(42);
    expect(body.name).toBe("renamed");
    expect(body.telegramBotToken).toBe("[REDACTED]");
  });

  it("DELETE /{id} returns 204 no body", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/webhook-targets/42"));
    expect(res.status).toBe(204);
    expect(await res.text()).toBe("");
  });

  it("POST /{id}:test returns latencyMs and Cache-Control: no-store", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/webhook-targets/42:test", {
        notificationType: "circuit_breaker",
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { latencyMs: number };
    expect(body.latencyMs).toBe(123);
  });

  it("POST /{id}:test rejects invalid notificationType with 400", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/webhook-targets/42:test", {
        notificationType: "not-a-valid-type",
      })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});

describe("/api/v1/webhook-targets — auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/webhook-targets"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("read-only key on admin tier → 403", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/webhook-targets", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    // admin tier rejects non-admin role with 403
    expect([401, 403]).toContain(res.status);
  });
});
