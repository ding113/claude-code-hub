/**
 * /api/v1/sensitive-words integration tests (admin tier).
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

const RAW_WORD = {
  id: 1,
  word: "forbidden",
  matchMode: "literal" as const,
  isEnabled: true,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

vi.mock("@/actions/sensitive-words", () => ({
  // listSensitiveWords returns raw array (treatRawAsActionResult)
  listSensitiveWords: vi.fn(async () => [RAW_WORD]),
  createSensitiveWordAction: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_WORD, ...input, id: 99 },
  })),
  updateSensitiveWordAction: vi.fn(async (id: number, input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_WORD, ...input, id },
  })),
  deleteSensitiveWordAction: vi.fn(async () => ({ ok: true, data: undefined })),
  refreshCacheAction: vi.fn(async () => ({
    ok: true,
    data: { refreshed: true, count: 1 },
  })),
  // getCacheStats returns raw value (treatRawAsActionResult)
  getCacheStats: vi.fn(async () => ({ wordCount: 1, lastRefreshedAt: "2026-04-01T00:00:00Z" })),
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

describe("/api/v1/sensitive-words", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/sensitive-words"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].word).toBe("forbidden");
  });

  it("GET /cache/stats returns stats", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/sensitive-words/cache/stats"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.wordCount).toBe(1);
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/sensitive-words"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("readonly key on admin tier → 401 / 403", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/sensitive-words", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    expect([401, 403]).toContain(res.status);
  });
});
