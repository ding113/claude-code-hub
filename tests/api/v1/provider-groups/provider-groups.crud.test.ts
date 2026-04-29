/**
 * /api/v1/provider-groups CRUD tests.
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

const RAW_GROUP = {
  id: 1,
  name: "default",
  costMultiplier: 1,
  description: null,
  providerCount: 3,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-01T00:00:00Z"),
};

vi.mock("@/actions/provider-groups", () => ({
  getProviderGroups: vi.fn(async () => ({
    ok: true,
    data: [RAW_GROUP],
  })),
  createProviderGroup: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: {
      id: 99,
      name: input.name as string,
      costMultiplier: (input.costMultiplier as number | undefined) ?? 1,
      description: (input.description as string | null | undefined) ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })),
  updateProviderGroup: vi.fn(async (id: number, input: Record<string, unknown>) => ({
    ok: true,
    data: {
      id,
      name: "default",
      costMultiplier: (input.costMultiplier as number | undefined) ?? 1,
      description: (input.description as string | null | undefined) ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  })),
  deleteProviderGroup: vi.fn(async () => ({ ok: true, data: undefined })),
}));

vi.mock("@/lib/auth", async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    validateAuthToken: vi.fn(async (token: string) => {
      if (token === "admin-test-token") {
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
      return null;
    }),
  };
});

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

describe("/api/v1/provider-groups", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET /provider-groups returns groups list", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/provider-groups"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<Record<string, unknown>> };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].name).toBe("default");
    expect(body.items[0].providerCount).toBe(3);
  });

  it("POST /provider-groups returns 201 + Location", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/provider-groups", {
        name: "team-a",
        costMultiplier: 1.5,
      })
    );
    expect(res.status).toBe(201);
    expect(res.headers.get("location")).toBe("/api/v1/provider-groups/99");
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.name).toBe("team-a");
  });

  it("PATCH /provider-groups/{id} returns updated group", async () => {
    const res = await PATCH(
      authedRequest("PATCH", "/api/v1/provider-groups/1", { costMultiplier: 2 })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.costMultiplier).toBe(2);
  });

  it("DELETE /provider-groups/{id} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/provider-groups/1"));
    expect(res.status).toBe(204);
  });
});
