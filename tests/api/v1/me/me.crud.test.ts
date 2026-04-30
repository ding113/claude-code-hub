/**
 * /api/v1/me integration tests (read tier; self-scoped).
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

vi.mock("@/actions/my-usage", () => ({
  getMyUsageMetadata: vi.fn(async () => ({
    ok: true,
    data: { userId: 7, userName: "user", keyId: 9 },
  })),
  getMyQuota: vi.fn(async () => ({
    ok: true,
    data: { dailyQuota: 50, dailyUsed: 0 },
  })),
  getMyTodayStats: vi.fn(async () => ({
    ok: true,
    data: { totalCost: 0, totalCallCount: 0 },
  })),
  getMyUsageLogsBatch: vi.fn(async () => ({
    ok: true,
    data: { logs: [], nextCursor: null, hasMore: false },
  })),
  getMyUsageLogsBatchFull: vi.fn(async () => ({
    ok: true,
    data: { logs: [], total: 0 },
  })),
  getMyAvailableModels: vi.fn(async () => ({
    ok: true,
    data: ["claude-sonnet-4", "claude-opus-4"],
  })),
  getMyAvailableEndpoints: vi.fn(async () => ({
    ok: true,
    data: ["/v1/messages", "/v1/chat/completions"],
  })),
  getMyStatsSummary: vi.fn(async () => ({
    ok: true,
    data: { totalCost: 1.23, totalCallCount: 42 },
  })),
  getMyIpGeoDetails: vi.fn(async () => ({
    ok: true,
    data: { country: "US", city: "Mountain View" },
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

function authedRequest(
  method: string,
  path: string,
  token: string,
  headers?: Record<string, string>
): Request {
  const url = new URL(path, "http://localhost");
  return new Request(url, {
    method,
    headers: {
      "X-Api-Key": token,
      ...(headers ?? {}),
    },
  });
}

describe("/api/v1/me", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /metadata returns metadata for admin token", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/me/metadata", "admin-test-token"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("userId");
  });

  it("GET /quota returns quota", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/me/quota", "admin-test-token"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.dailyQuota).toBe(50);
  });

  it("GET /usage-logs/models returns model list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/me/usage-logs/models", "admin-test-token"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: string[] };
    expect(body.items).toContain("claude-sonnet-4");
  });

  it("readonly key on read tier → 200 (allowed)", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/me/metadata", "readonly-key"));
    expect(res.status).toBe(200);
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/me/metadata"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
