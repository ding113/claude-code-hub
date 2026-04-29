/**
 * /api/v1/users CRUD + auth integration tests.
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
  note: "test user",
  role: "user" as const,
  rpm: 60,
  dailyQuota: 50,
  providerGroup: "default",
  tags: ["team-a"],
  isEnabled: true,
  expiresAt: null,
  limit5hUsd: null,
  limit5hResetMode: "rolling" as const,
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: null,
  limitConcurrentSessions: null,
  dailyResetMode: "fixed" as const,
  dailyResetTime: "00:00",
  allowedClients: [],
  blockedClients: [],
  allowedModels: [],
  keys: [
    {
      id: 100,
      name: "default",
      maskedKey: "sk-A•••••B0c1",
      fullKey: undefined,
      canCopy: false,
      expiresAt: "neverExpires",
      status: "enabled" as const,
      createdAt: new Date("2026-04-01T00:00:00Z"),
      createdAtFormatted: "2026/04/01 00:00:00",
      todayUsage: 0,
      todayCallCount: 0,
      todayTokens: 0,
      lastUsedAt: null,
      lastProviderName: null,
      modelStats: [],
      canLoginWebUi: true,
      limit5hUsd: null,
      limit5hResetMode: "rolling" as const,
      limitDailyUsd: null,
      dailyResetMode: "fixed" as const,
      dailyResetTime: "00:00",
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd: null,
      limitConcurrentSessions: 0,
      providerGroup: "default",
    },
  ],
};

vi.mock("@/actions/users", () => ({
  getUsersBatch: vi.fn(async () => ({
    ok: true,
    data: { users: [RAW_USER], nextCursor: null, hasMore: false },
  })),
  getUsersBatchCore: vi.fn(async () => ({
    ok: true,
    data: { users: [RAW_USER], nextCursor: null, hasMore: false },
  })),
  addUser: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: {
      user: {
        id: 99,
        name: input.name,
        note: input.note ?? "",
        role: "user",
        isEnabled: true,
        expiresAt: null,
        rpm: input.rpm ?? null,
        dailyQuota: input.dailyQuota ?? null,
        providerGroup: "default",
        tags: input.tags ?? [],
        limit5hUsd: null,
        limit5hResetMode: "rolling",
        limitWeeklyUsd: null,
        limitMonthlyUsd: null,
        limitTotalUsd: null,
        limitConcurrentSessions: null,
        allowedModels: [],
      },
      defaultKey: { id: 200, name: "default", key: "sk-RAW-NEW-KEY-EXPOSED-ONCE" },
    },
  })),
  editUser: vi.fn(async () => ({ ok: true })),
  removeUser: vi.fn(async () => ({ ok: true })),
  toggleUserEnabled: vi.fn(async () => ({ ok: true })),
  renewUser: vi.fn(async () => ({ ok: true })),
  resetUserLimitsOnly: vi.fn(async () => ({ ok: true })),
  getAllUserTags: vi.fn(async () => ({ ok: true, data: ["team-a", "team-b"] })),
  getAllUserKeyGroups: vi.fn(async () => ({ ok: true, data: ["default", "claude-only"] })),
  // syncUserProviderGroupFromKeys is referenced by keys.ts at module load time —
  // exporting a no-op avoids TS ReferenceError when test imports both.
  syncUserProviderGroupFromKeys: vi.fn(async () => undefined),
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
      "X-Api-Key": "admin-test-token",
      ...(headers ?? {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  };
  return new Request(url, init);
}

describe("/api/v1/users — CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items + pageInfo with masked keys", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      pageInfo: Record<string, unknown>;
    };
    expect(body.items).toHaveLength(1);
    expect((body.items[0].keys as Array<{ maskedKey: string }>)[0].maskedKey).toContain("•");
    expect(body.pageInfo).toHaveProperty("hasMore", false);
  });

  it("GET /{id} returns user when found", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users/1"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
    expect(body.name).toBe("alice");
  });

  it("GET /{id} returns 404 problem+json when missing", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users/9999"));
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("POST creates and returns 201 + Location + defaultKey.key (one-time)", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/users", {
        name: "bob",
        note: "new user",
        rpm: 30,
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/api/v1/users/99");
    const body = (await res.json()) as { user: { id: number }; defaultKey: { key: string } };
    expect(body.user.id).toBe(99);
    expect(body.defaultKey.key).toBe("sk-RAW-NEW-KEY-EXPOSED-ONCE");
  });

  it("PATCH /{id} returns 200 with refreshed user", async () => {
    const res = await PATCH(authedRequest("PATCH", "/api/v1/users/1", { rpm: 120 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.id).toBe(1);
  });

  it("DELETE /{id} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/users/1"));
    expect(res.status).toBe(204);
  });

  it("POST /{id}:enable toggles user", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/users/1:enable", { enabled: false }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /{id}:renew renews user", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/users/1:renew", { expiresAt: "2027-01-01" })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /{id}/limits:reset resets limits", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/users/1/limits:reset"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("GET /tags returns tag list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users/tags"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: string[] };
    expect(body.items).toContain("team-a");
  });

  it("GET /key-groups returns groups list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users/key-groups"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: string[] };
    expect(body.items).toContain("default");
  });
});

describe("/api/v1/users — auth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/users"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });

  it("read-only key on admin tier → 403 / 401", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/users", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    expect([401, 403]).toContain(res.status);
  });
});
