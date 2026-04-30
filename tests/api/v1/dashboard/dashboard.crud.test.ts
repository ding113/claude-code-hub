/**
 * /api/v1/dashboard integration tests.
 *
 * Most endpoints use read tier (action enforces admin-only data scope).
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

vi.mock("@/actions/overview", () => ({
  getOverviewData: vi.fn(async () => ({
    ok: true,
    data: { totalUsers: 10, totalKeys: 30, totalRequests: 1000 },
  })),
}));

vi.mock("@/actions/dashboard-realtime", () => ({
  getDashboardRealtimeData: vi.fn(async () => ({
    ok: true,
    data: { rpm: 5, providers: [] },
  })),
}));

vi.mock("@/actions/statistics", () => ({
  getUserStatistics: vi.fn(async () => ({
    ok: true,
    data: { items: [] },
  })),
}));

vi.mock("@/actions/concurrent-sessions", () => ({
  getConcurrentSessions: vi.fn(async () => ({ ok: true, data: 7 })),
}));

vi.mock("@/actions/provider-slots", () => ({
  getProviderSlots: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/actions/rate-limit-stats", () => ({
  getRateLimitStats: vi.fn(async () => ({ ok: true, data: {} })),
}));

vi.mock("@/actions/client-versions", () => ({
  fetchClientVersionStats: vi.fn(async () => ({ ok: true, data: [] })),
}));

vi.mock("@/actions/proxy-status", () => ({
  getProxyStatus: vi.fn(async () => ({
    ok: true,
    data: { healthy: true },
  })),
}));

vi.mock("@/actions/dispatch-simulator", () => ({
  simulateDispatchDecisionTree: vi.fn(async () => ({
    ok: true,
    data: { tree: [] },
  })),
  simulateDispatchAction: vi.fn(async () => ({
    ok: true,
    data: { providerId: 1 },
  })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") {
        return adminSession();
      }
      if (token === "readonly-key") {
        return readonlySession();
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

function readonlySession() {
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

const route = await import("@/app/api/v1/[...route]/route");
const { GET } = route;

function authedRequest(method: string, path: string, headers?: Record<string, string>): Request {
  const url = new URL(path, "http://localhost");
  return new Request(url, {
    method,
    headers: {
      "X-Api-Key": "admin-test-token",
      ...(headers ?? {}),
    },
  });
}

describe("/api/v1/dashboard", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /overview returns dashboard overview", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/dashboard/overview"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalUsers).toBe(10);
  });

  it("GET /concurrent-sessions returns count", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/dashboard/concurrent-sessions"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { count: number; generatedAt: string };
    expect(body.count).toBe(7);
    expect(typeof body.generatedAt).toBe("string");
  });

  it("GET /statistics returns statistics", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/dashboard/statistics"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("items");
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/dashboard/overview"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
