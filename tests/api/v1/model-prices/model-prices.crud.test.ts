/**
 * /api/v1/model-prices CRUD + sync + manual pin integration tests.
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

const RAW_PRICE = {
  id: 1,
  modelName: "gpt-4-turbo",
  priceData: {
    mode: "chat",
    display_name: "GPT-4 Turbo",
    litellm_provider: "openai",
    input_cost_per_token: 0.00001,
    output_cost_per_token: 0.00003,
  },
  source: "litellm" as const,
  createdAt: new Date("2026-04-01T00:00:00Z"),
  updatedAt: new Date("2026-04-02T00:00:00Z"),
};

vi.mock("@/actions/model-prices", () => ({
  getModelPrices: vi.fn(async () => [RAW_PRICE]),
  getModelPricesPaginated: vi.fn(async () => ({
    ok: true,
    data: { data: [RAW_PRICE], total: 1, page: 1, pageSize: 20, totalPages: 1 },
  })),
  hasPriceTable: vi.fn(async () => true),
  getAvailableModelCatalog: vi.fn(async () => [
    { modelName: "gpt-4-turbo", litellmProvider: "openai", updatedAt: "2026-04-02T00:00:00.000Z" },
  ]),
  getAvailableModelsByProviderType: vi.fn(async () => ["gpt-4-turbo"]),
  uploadPriceTable: vi.fn(async () => ({
    ok: true,
    data: {
      added: ["gpt-4-turbo"],
      updated: [],
      unchanged: [],
      failed: [],
      total: 1,
    },
  })),
  checkLiteLLMSyncConflicts: vi.fn(async () => ({
    ok: true,
    data: { hasConflicts: false, conflicts: [] },
  })),
  syncLiteLLMPrices: vi.fn(async () => ({
    ok: true,
    data: { added: [], updated: [], unchanged: ["gpt-4-turbo"], failed: [], total: 1 },
  })),
  upsertSingleModelPrice: vi.fn(async (input: Record<string, unknown>) => ({
    ok: true,
    data: { ...RAW_PRICE, modelName: input.modelName },
  })),
  deleteSingleModelPrice: vi.fn(async () => ({ ok: true, data: undefined })),
  pinModelPricingProviderAsManual: vi.fn(async () => ({
    ok: true,
    data: { ...RAW_PRICE, source: "manual" as const },
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
const { GET, POST, PUT, DELETE } = route;

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

describe("/api/v1/model-prices", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("GET list returns items + pageInfo", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/model-prices"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: Array<Record<string, unknown>>;
      pageInfo: Record<string, unknown>;
    };
    expect(body.items).toHaveLength(1);
    expect(body.items[0].modelName).toBe("gpt-4-turbo");
    expect(body.pageInfo).toHaveProperty("total");
  });

  it("GET /exists returns boolean", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/model-prices/exists"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { exists: boolean };
    expect(body.exists).toBe(true);
  });

  it("GET /catalog returns items", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/model-prices/catalog"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { items: Array<{ modelName: string }> };
    expect(body.items.length).toBeGreaterThan(0);
  });

  it("POST :upload returns update result", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/model-prices:upload", {
        jsonContent: JSON.stringify({ "gpt-4-turbo": { mode: "chat" } }),
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { added: string[]; total: number };
    expect(body.added).toContain("gpt-4-turbo");
  });

  it("POST :syncLitellm returns update result with empty body", async () => {
    const res = await POST(authedRequest("POST", "/api/v1/model-prices:syncLitellm"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { total: number };
    expect(body.total).toBe(1);
  });

  it("GET /{modelName} returns single record", async () => {
    const res = await GET(authedRequest("GET", "/api/v1/model-prices/gpt-4-turbo"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.modelName).toBe("gpt-4-turbo");
  });

  it("PUT /{modelName} upserts and returns 200", async () => {
    const res = await PUT(
      authedRequest("PUT", "/api/v1/model-prices/custom-model", {
        mode: "chat",
        inputCostPerToken: 0.000005,
      })
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.modelName).toBe("custom-model");
  });

  it("DELETE /{modelName} returns 204", async () => {
    const res = await DELETE(authedRequest("DELETE", "/api/v1/model-prices/gpt-4-turbo"));
    expect(res.status).toBe(204);
  });

  it("POST .../pricing/{providerType}:pinManual returns 200", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/model-prices/gpt-4-turbo/pricing/openai:pinManual")
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { source: string };
    expect(body.source).toBe("manual");
  });
});

describe("/api/v1/model-prices — auth", () => {
  it("unauthenticated GET returns 401 problem+json", async () => {
    const res = await GET(new Request("http://localhost/api/v1/model-prices"));
    expect(res.status).toBe(401);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
  });
});
