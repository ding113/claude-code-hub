/**
 * /api/v1/ip-geo integration tests (read tier; admin enforced inside legacy route).
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

const IP_LOOKUP_RESPONSE = {
  status: "success" as const,
  ip: "8.8.8.8",
  country: "US",
  city: "Mountain View",
};

// Mock the legacy /api/ip-geo/[ip]/route to avoid pulling in real Redis / network.
vi.mock("@/app/api/ip-geo/[ip]/route", () => ({
  GET: vi.fn(async () => {
    return new Response(JSON.stringify(IP_LOOKUP_RESPONSE), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  }),
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

describe("/api/v1/ip-geo", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /{ip} returns geolocation for admin token", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/ip-geo/8.8.8.8", {
        headers: { "X-Api-Key": "admin-test-token" },
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.country).toBe("US");
  });

  it("GET /{ip} with readonly key on read tier → 200 (delegated handler answers)", async () => {
    const res = await GET(
      new Request("http://localhost/api/v1/ip-geo/8.8.8.8", {
        headers: { Authorization: "Bearer readonly-key" },
      })
    );
    // read tier itself accepts the readonly key; the underlying legacy handler
    // (mocked above) returns the canned response.
    expect(res.status).toBe(200);
  });

  it("unauthenticated GET → 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/ip-geo/8.8.8.8"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
