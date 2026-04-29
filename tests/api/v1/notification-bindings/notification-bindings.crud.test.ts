/**
 * /api/v1/notifications/types/{type}/bindings integration tests.
 */

import "../../../server-only.mock";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

beforeAll(async () => {
  vi.stubEnv("ENABLE_API_KEY_ADMIN_ACCESS", "true");
  vi.stubEnv("ENABLE_LEGACY_ACTIONS_API", "true");
  vi.stubEnv("ADMIN_TOKEN", "admin-env-token-only-for-tests");
  const env = await import("@/lib/config/env.schema");
  env.resetEnvConfigForTests();
});

const RAW_TARGET = {
  id: 42,
  name: "ops-bot",
  providerType: "wechat" as const,
  webhookUrl: "https://example.com/hook",
  telegramBotToken: null,
  telegramChatId: null,
  dingtalkSecret: null,
  customTemplate: null,
  customHeaders: null,
  proxyUrl: null,
  proxyFallbackToDirect: false,
  isEnabled: true,
  lastTestAt: null,
  lastTestResult: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

const RAW_BINDING = {
  id: 1,
  notificationType: "circuit_breaker" as const,
  targetId: 42,
  isEnabled: true,
  scheduleCron: null,
  scheduleTimezone: "Asia/Shanghai",
  templateOverride: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  target: RAW_TARGET,
};

vi.mock("@/actions/notification-bindings", () => ({
  getBindingsForTypeAction: vi.fn(async () => ({ ok: true, data: [RAW_BINDING] })),
  updateBindingsAction: vi.fn(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") {
        return adminSession();
      }
      return null;
    }),
  };
});

function adminSession() {
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

const route = await import("@/app/api/v1/[...route]/route");
const { GET, PUT } = route;

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
      "X-Api-Key": "admin-test-token",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return new Request(url, init);
}

describe("/api/v1/notifications/types/{type}/bindings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET returns bindings list with redacted target", async () => {
    const res = await GET(
      authedRequest("GET", "/api/v1/notifications/types/circuit_breaker/bindings")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<{
        id: number;
        notificationType: string;
        target: { webhookUrl: unknown };
      }>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].notificationType).toBe("circuit_breaker");
    // webhook URL gets redacted
    expect(body.items[0].target.webhookUrl).toBe("[REDACTED]");
  });

  it("PUT replaces bindings and returns refreshed list", async () => {
    const res = await PUT(
      authedRequest("PUT", "/api/v1/notifications/types/circuit_breaker/bindings", {
        bindings: [{ targetId: 42, isEnabled: true }],
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ targetId: number }> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].targetId).toBe(42);
  });

  it("GET with invalid type returns 400 problem+json", async () => {
    const res = await GET(
      authedRequest("GET", "/api/v1/notifications/types/not_a_real_type/bindings")
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("PUT rejects invalid bindings shape with 400", async () => {
    const res = await PUT(
      authedRequest("PUT", "/api/v1/notifications/types/circuit_breaker/bindings", {
        bindings: [{ targetId: -1 }],
      })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/notifications/types/circuit_breaker/bindings")
    );
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
