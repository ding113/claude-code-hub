/**
 * /api/v1/admin/users/{id}/insights/* integration tests.
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

const RAW_USER = {
  id: 1,
  name: "alice",
  description: "test",
  role: "user" as const,
  isEnabled: true,
  expiresAt: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
  rpm: 0,
  dailyQuota: 0,
  providerGroup: null,
  limit5hResetMode: "rolling",
  dailyResetMode: "fixed",
  dailyResetTime: "00:00",
};

vi.mock("@/actions/admin-user-insights", () => ({
  getUserInsightsOverview: vi.fn(async () => ({
    ok: true,
    data: {
      user: RAW_USER,
      overview: {
        requestCount: 100,
        totalCost: 1.23,
        avgResponseTime: 850,
        errorRate: 0.01,
      },
      currencyCode: "USD",
    },
  })),
  getUserInsightsKeyTrend: vi.fn(async () => ({
    ok: true,
    data: [
      { key_id: 100, key_name: "default", date: "2026-04-01", api_calls: 10, total_cost: "0.12" },
    ],
  })),
  getUserInsightsModelBreakdown: vi.fn(async () => ({
    ok: true,
    data: {
      breakdown: [
        {
          model: "claude-sonnet-4",
          requests: 50,
          cost: 1.0,
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      ],
      currencyCode: "USD",
    },
  })),
  getUserInsightsProviderBreakdown: vi.fn(async () => ({
    ok: true,
    data: {
      breakdown: [
        {
          providerId: 1,
          providerName: "anthropic",
          requests: 50,
          cost: 1.0,
          inputTokens: 1000,
          outputTokens: 500,
          cacheCreationTokens: 0,
          cacheReadTokens: 0,
        },
      ],
      currencyCode: "USD",
    },
  })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") return adminSession();
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
const { GET } = route;

function authedRequest(method: string, path: string): Request {
  return new Request(new URL(path, "http://localhost"), {
    method,
    headers: { "X-Api-Key": "admin-test-token" },
  });
}

describe("/api/v1/admin/users/{id}/insights", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET overview returns user + overview + currencyCode", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/admin/users/1/insights/overview"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect((body.overview as { requestCount: number }).requestCount).toBe(100);
    expect(body.currencyCode).toBe("USD");
    expect((body.user as { id: number }).id).toBe(1);
  });

  it("GET key-trend rejects invalid timeRange with 400", async () => {
    const res = await GET(
      authedRequest("GET", "/api/v1/admin/users/1/insights/key-trend?timeRange=bad")
    );
    expect(res.status).toBe(400);
    // Hono's openapi-zod query validator may return either application/json
    // (built-in) or application/problem+json (our handler-level validation);
    // accept both since both indicate the rejection happened.
    expect(res.headers.get("content-type") ?? "").toMatch(/application\/(?:problem\+)?json/);
  });

  it("GET key-trend with valid timeRange returns items", async () => {
    const res = await GET(
      authedRequest("GET", "/api/v1/admin/users/1/insights/key-trend?timeRange=7days")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[] };
    expect(body.items).toHaveLength(1);
  });

  it("GET model-breakdown returns breakdown + currencyCode", async () => {
    const res = await GET(
      authedRequest(
        "GET",
        "/api/v1/admin/users/1/insights/model-breakdown?startDate=2026-04-01&endDate=2026-04-28"
      )
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.breakdown)).toBe(true);
    expect(body.currencyCode).toBe("USD");
  });

  it("GET provider-breakdown returns breakdown + currencyCode", async () => {
    const res = await GET(
      authedRequest("GET", "/api/v1/admin/users/1/insights/provider-breakdown")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(Array.isArray(body.breakdown)).toBe(true);
  });

  it("GET overview unauthenticated → 401", async () => {
    const res = await GET(new Request("http://localhost/api/v1/admin/users/1/insights/overview"));
    expect(res.status).toBe(401);
  });

  it("GET overview rejects invalid date with 400", async () => {
    const res = await GET(
      authedRequest("GET", "/api/v1/admin/users/1/insights/overview?startDate=not-a-date")
    );
    expect(res.status).toBe(400);
  });
});
