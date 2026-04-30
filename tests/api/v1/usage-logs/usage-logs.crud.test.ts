/**
 * /api/v1/usage-logs integration tests (read tier; admin enforced inside actions).
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

const RAW_LOG = {
  id: 1,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  userId: 1,
  userName: "alice",
  keyId: 100,
  providerId: 1,
  model: "claude-sonnet-4",
  endpoint: "/v1/messages",
  statusCode: 200,
  inputTokens: 100,
  outputTokens: 50,
};

vi.mock("@/actions/usage-logs", () => ({
  getUsageLogs: vi.fn(async () => ({ ok: true, data: { logs: [RAW_LOG], total: 1 } })),
  getUsageLogsBatch: vi.fn(async () => ({
    ok: true,
    data: { logs: [RAW_LOG], nextCursor: null, hasMore: false },
  })),
  getUsageLogsStats: vi.fn(async () => ({
    ok: true,
    data: { totalCount: 1, totalCost: 0.05 },
  })),
  getFilterOptions: vi.fn(async () => ({
    ok: true,
    data: { users: [], keys: [], providers: [] },
  })),
  getUsageLogSessionIdSuggestions: vi.fn(async () => ({
    ok: true,
    data: ["session-abc", "session-def"],
  })),
  exportUsageLogs: vi.fn(async () => ({ ok: true, data: "id,user\n1,alice\n" })),
  startUsageLogsExport: vi.fn(async () => ({ ok: true, data: { jobId: "job-123" } })),
  getUsageLogsExportStatus: vi.fn(async () => ({
    ok: true,
    data: { jobId: "job-123", status: "completed" },
  })),
  downloadUsageLogsExport: vi.fn(async () => ({ ok: true, data: "id,user\n1,alice\n" })),
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

describe("/api/v1/usage-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items + pageInfo", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/usage-logs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      pageInfo: Record<string, unknown>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].model).toBe("claude-sonnet-4");
    expect(body.pageInfo).toHaveProperty("hasMore", false);
  });

  it("GET /stats returns stats", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/usage-logs/stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.totalCount).toBe(1);
  });

  it("GET /filter-options returns filter options", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/usage-logs/filter-options"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toHaveProperty("users");
  });

  it("GET with malformed cursor returns 400 problem+json", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/usage-logs?cursor=not-base64-or-json"));
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/usage-logs"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
