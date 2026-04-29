/**
 * /api/v1/keys CRUD + secret-redaction integration tests.
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

const RAW_KEY = {
  id: 100,
  userId: 1,
  name: "default",
  key: "sk-abcdefghijklmnopqrstuvwx0123",
  isEnabled: true,
  canLoginWebUi: true,
  expiresAt: undefined,
  providerGroup: "default",
  limit5hUsd: null,
  limit5hResetMode: "rolling" as const,
  limitDailyUsd: null,
  dailyResetMode: "fixed" as const,
  dailyResetTime: "00:00",
  limitWeeklyUsd: null,
  limitMonthlyUsd: null,
  limitTotalUsd: null,
  limitConcurrentSessions: 0,
  cacheTtlPreference: null,
  costResetAt: null,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

vi.mock("@/actions/keys", () => ({
  getKeys: vi.fn(async () => ({ ok: true, data: [RAW_KEY] })),
  getKeysWithStatistics: vi.fn(async () => ({ ok: true, data: [] })),
  addKey: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { generatedKey: "sk-NEW-RAW-KEY-EXPOSED-ONCE-1234", name: input.name as string },
  })),
  editKey: vi.fn(async () => ({ ok: true })),
  removeKey: vi.fn(async () => ({ ok: true })),
  toggleKeyEnabled: vi.fn(async () => ({ ok: true })),
  renewKeyExpiresAt: vi.fn(async () => ({ ok: true })),
  resetKeyLimitsOnly: vi.fn(async () => ({ ok: true })),
  getKeyLimitUsage: vi.fn(async () => ({
    ok: true,
    data: {
      cost5h: { current: 0, limit: null },
      costDaily: { current: 0, limit: null },
      costWeekly: { current: 0, limit: null },
      costMonthly: { current: 0, limit: null },
      costTotal: { current: 0, limit: null, resetAt: new Date("2026-04-01T00:00:00Z") },
      concurrentSessions: { current: 0, limit: 0 },
    },
  })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") return adminSession();
      if (token === "readonly-key") return readonlySession();
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

describe("/api/v1/keys — list + redaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /users/{userId}/keys returns redacted key list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users/1/keys"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    const item = body.items[0];
    // raw secret never leaks
    expect(JSON.stringify(body)).not.toContain("abcdefghijklmnopqrstuvwx0123");
    expect(typeof item.key).toBe("string");
    expect(item.key as string).toContain("•");
  });

  it("GET /users/{userId}/keys?include=statistics returns items + statistics", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/users/1/keys?include=statistics"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: unknown[]; statistics: unknown[] };
    expect(Array.isArray(body.statistics)).toBe(true);
  });
});

describe("/api/v1/keys — create + CRUD", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("POST /users/{userId}/keys returns 201 + Location + raw key string ONCE", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/users/1/keys", {
        name: "extra",
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toContain("/api/v1/keys/");
    const body = (await res.json()) as { key: string; name: string };
    expect(body.name).toBe("extra");
    expect(body.key).toBe("sk-NEW-RAW-KEY-EXPOSED-ONCE-1234");
  });

  it("PATCH /keys/{id} returns 200 ok+id", async () => {
    const res = await PATCH(authedRequest("PATCH", "/api/v1/keys/100", { name: "renamed" }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; id: number };
    expect(body.ok).toBe(true);
    expect(body.id).toBe(100);
  });

  it("DELETE /keys/{id} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/keys/100"));
    expect(res.status).toBe(204);
  });

  it("POST /keys/{id}:enable toggles state", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/keys/100:enable", { enabled: false }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it("POST /keys/{id}:renew renews", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/keys/100:renew", {
        expiresAt: "2027-01-01",
      })
    );
    expect(res.status).toBe(200);
  });

  it("POST /keys/{id}/limits:reset resets limits", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/keys/100/limits:reset"));
    expect(res.status).toBe(200);
  });

  it("GET /keys/{id}/limit-usage returns usage with ISO resetAt", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/keys/100/limit-usage"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      costTotal: { resetAt?: string };
      concurrentSessions: { current: number; limit: number };
    };
    expect(body.concurrentSessions).toEqual({ current: 0, limit: 0 });
    expect(body.costTotal.resetAt).toContain("2026-04-01");
  });
});

describe("/api/v1/keys — auth", () => {
  it("unauthenticated → 401", async () => {
    const res = await GET(new Request("http://localhost/api/v1/users/1/keys"));
    expect(res.status).toBe(401);
  });
});
