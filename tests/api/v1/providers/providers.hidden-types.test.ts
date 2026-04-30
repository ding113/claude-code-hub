/**
 * /api/v1/providers — hidden providerType rejection.
 *
 * - 写入 providerType=claude-auth 必须被 zod 校验拒绝（400 validation_failed）；
 * - 读列表已经在 providers.crud.test 中覆盖 hidden 类型过滤。
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

// 让 createProviderHandler 在 addProvider 之后能从 getProviders 反查到新建项：
// addProvider mock 把请求中的 name 加到内部列表，getProviders 返回当前列表。
const __mockProviderList: Array<Record<string, unknown>> = [];

vi.mock("@/actions/providers", () => ({
  getProviders: vi.fn(async () => [...__mockProviderList]),
  getProviderStatisticsAsync: vi.fn(async () => ({})),
  addProvider: vi.fn(async (input: Record<string, unknown>) => {
    __mockProviderList.push({
      id: __mockProviderList.length + 1,
      name: input.name ?? input.legacyName ?? "added",
      provider_type: input.provider_type ?? input.providerType ?? "claude",
      url: input.url ?? "",
      key: input.key ?? "",
      // serializeProvider only consumes a small set of fields; keep them present.
      is_enabled: true,
      priority: 0,
      weight: 1,
      created_at: new Date(),
      updated_at: new Date(),
    });
    return { ok: true };
  }),
  editProvider: vi.fn(async () => ({ ok: true })),
  removeProvider: vi.fn(async () => ({ ok: true })),
  getProvidersHealthStatus: vi.fn(async () => ({})),
  resetProviderCircuit: vi.fn(async () => ({ ok: true })),
  resetProviderTotalUsage: vi.fn(async () => ({ ok: true })),
  batchResetProviderCircuits: vi.fn(async () => ({ ok: true, data: { resetCount: 0 } })),
  getAvailableProviderGroups: vi.fn(async () => []),
  getProviderGroupsWithCount: vi.fn(async () => ({ ok: true, data: [] })),
  autoSortProviderPriority: vi.fn(async () => ({ ok: true, data: {} })),
  batchUpdateProviders: vi.fn(async () => ({ ok: true, data: { updatedCount: 0 } })),
  getUnmaskedProviderKey: vi.fn(async () => ({ ok: true, data: { key: "" } })),
  getModelSuggestionsByProviderGroup: vi.fn(async () => ({ ok: true, data: [] })),
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
const { POST, PATCH } = route;

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

describe("/api/v1/providers — hidden providerType rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __mockProviderList.length = 0;
  });

  it("POST with providerType=claude-auth → 400 validation_failed", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/providers", {
        name: "Hidden",
        url: "https://api.anthropic.com",
        key: "sk-x",
        providerType: "claude-auth",
      })
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("application/problem+json");
    const body = (await res.json()) as { errorCode?: string };
    expect(body.errorCode).toBe("validation_failed");
  });

  it("POST with providerType=gemini-cli → 400 validation_failed", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/providers", {
        name: "Hidden",
        url: "https://api.example.com",
        key: "sk-x",
        providerType: "gemini-cli",
      })
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { errorCode?: string };
    expect(body.errorCode).toBe("validation_failed");
  });

  it("PATCH with providerType=claude-auth → 400 validation_failed", async () => {
    const res = await PATCH(
      authedRequest("PATCH", "/api/v1/providers/1", { providerType: "claude-auth" })
    );
    expect(res.status).toBe(400);
  });

  it("POST with providerType=claude → 201 (visible type accepted)", async () => {
    const res = await POST(
      authedRequest("POST", "/api/v1/providers", {
        name: "Visible",
        url: "https://api.anthropic.com",
        key: "sk-x",
        providerType: "claude",
      })
    );
    expect(res.status).toBe(201);
  });
});
