/**
 * /api/v1/audit-logs integration tests (admin tier).
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

const RAW_AUDIT_ROW = {
  id: 1,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  category: "user" as const,
  action: "user.create",
  actorId: -1,
  actorName: "Admin",
  targetType: "user",
  targetId: "42",
  targetName: "alice",
  success: true,
  errorMessage: null,
  ip: "127.0.0.1",
  userAgent: "test-agent",
  metadata: { foo: "bar" },
};

vi.mock("@/actions/audit-logs", () => ({
  getAuditLogsBatch: vi.fn(async () => ({
    ok: true,
    data: { rows: [RAW_AUDIT_ROW], nextCursor: null },
  })),
  getAuditLogDetail: vi.fn(async (id: number) => ({
    ok: true,
    data: id === 9999 ? null : { ...RAW_AUDIT_ROW, id },
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

describe("/api/v1/audit-logs", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items + pageInfo", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/audit-logs"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      pageInfo: Record<string, unknown>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].action).toBe("user.create");
    expect(body.pageInfo).toHaveProperty("hasMore", false);
  });

  it("GET /{id} returns audit log detail", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/audit-logs/42"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(42);
  });

  it("GET /{id} returns 404 problem+json when missing", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/audit-logs/9999"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/audit-logs"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("readonly key on admin tier → 401 / 403", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/audit-logs", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    expect([401, 403]).toContain(res.status);
  });
});
