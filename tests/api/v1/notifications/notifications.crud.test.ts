/**
 * /api/v1/notifications settings + test-webhook integration tests.
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

const RAW_NOTIFICATION_SETTINGS = {
  id: 1,
  enabled: true,
  useLegacyMode: false,
  circuitBreakerEnabled: true,
  circuitBreakerWebhook: null,
  dailyLeaderboardEnabled: false,
  dailyLeaderboardWebhook: null,
  dailyLeaderboardTime: "09:00",
  dailyLeaderboardTopN: 10,
  costAlertEnabled: false,
  costAlertWebhook: null,
  costAlertThreshold: "100.00",
  costAlertCheckInterval: 3600,
  cacheHitRateAlertEnabled: false,
  cacheHitRateAlertWebhook: null,
  cacheHitRateAlertWindowMode: "auto" as const,
  cacheHitRateAlertCheckInterval: 600,
  cacheHitRateAlertHistoricalLookbackDays: 7,
  cacheHitRateAlertMinEligibleRequests: 50,
  cacheHitRateAlertMinEligibleTokens: 1000,
  cacheHitRateAlertAbsMin: "0.20",
  cacheHitRateAlertDropRel: "0.30",
  cacheHitRateAlertDropAbs: "0.10",
  cacheHitRateAlertCooldownMinutes: 30,
  cacheHitRateAlertTopN: 5,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-02T00:00:00Z"),
};

vi.mock("@/actions/notifications", () => ({
  getNotificationSettingsAction: vi.fn(async () => RAW_NOTIFICATION_SETTINGS),
  updateNotificationSettingsAction: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_NOTIFICATION_SETTINGS, ...input },
  })),
  testWebhookAction: vi.fn(async () => ({ success: true })),
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
const { GET, PUT, POST } = route;

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

describe("/api/v1/notifications", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /settings returns notification settings", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/notifications/settings"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
    expect(body.enabled).toBe(true);
    expect(body.cacheHitRateAlertWindowMode).toBe("auto");
  });

  it("PUT /settings updates and returns 200", async () => {
    const res = await PUT(
      authedRequest("PUT", "/api/v1/notifications/settings", {
        enabled: false,
        circuitBreakerEnabled: false,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.enabled).toBe(false);
    expect(body.circuitBreakerEnabled).toBe(false);
  });

  it("POST /test-webhook returns success + Cache-Control: no-store", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/notifications/test-webhook", {
        webhookUrl: "https://example.com/hook",
        type: "circuit-breaker",
      })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toContain("no-store");
    const body = (await res.json()) as { success: boolean };
    expect(body.success).toBe(true);
  });

  it("POST /test-webhook rejects invalid type with 400", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/notifications/test-webhook", {
        webhookUrl: "https://example.com/hook",
        type: "invalid-type",
      })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("unauthenticated GET /settings → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/notifications/settings"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
