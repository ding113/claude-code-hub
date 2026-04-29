import type { AuthSession } from "@/lib/auth";
import type { ErrorRule } from "@/repository/error-rules";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listErrorRulesMock = vi.hoisted(() => vi.fn());
const createErrorRuleActionMock = vi.hoisted(() => vi.fn());
const updateErrorRuleActionMock = vi.hoisted(() => vi.fn());
const deleteErrorRuleActionMock = vi.hoisted(() => vi.fn());
const refreshCacheActionMock = vi.hoisted(() => vi.fn());
const testErrorRuleActionMock = vi.hoisted(() => vi.fn());
const getCacheStatsMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/error-rules", () => ({
  listErrorRules: listErrorRulesMock,
  createErrorRuleAction: createErrorRuleActionMock,
  updateErrorRuleAction: updateErrorRuleActionMock,
  deleteErrorRuleAction: deleteErrorRuleActionMock,
  refreshCacheAction: refreshCacheActionMock,
  testErrorRuleAction: testErrorRuleActionMock,
  getCacheStats: getCacheStatsMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

function rule(overrides: Partial<ErrorRule> = {}): ErrorRule {
  return {
    id: 1,
    pattern: "context length exceeded",
    matchType: "contains",
    category: "prompt_limit",
    description: "Prompt limit",
    overrideResponse: null,
    overrideStatusCode: null,
    isEnabled: true,
    isDefault: false,
    priority: 0,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 error rules endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    listErrorRulesMock.mockResolvedValue([rule()]);
    createErrorRuleActionMock.mockResolvedValue({
      ok: true,
      data: rule({ id: 2, pattern: "blocked", matchType: "exact" }),
    });
    updateErrorRuleActionMock.mockResolvedValue({
      ok: true,
      data: rule({ id: 1, isEnabled: false }),
    });
    deleteErrorRuleActionMock.mockResolvedValue({ ok: true });
    refreshCacheActionMock.mockResolvedValue({
      ok: true,
      data: {
        stats: { rules: 1 },
        syncResult: { inserted: 1, updated: 0, skipped: 0, deleted: 0 },
      },
    });
    testErrorRuleActionMock.mockResolvedValue({
      ok: true,
      data: { matched: true, finalResponse: null, finalStatusCode: null },
    });
    getCacheStatsMock.mockResolvedValue({ rules: 1 });
  });

  test("lists and mutates error rules with REST semantics", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/error-rules",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 1, category: "prompt_limit", updatedAt: "2026-04-28T00:00:00.000Z" }],
    });

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/error-rules",
      headers: { Authorization: "Bearer admin-token" },
      body: { pattern: "blocked", category: "content_filter", matchType: "exact" },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/error-rules/2");
    expect(createErrorRuleActionMock).toHaveBeenCalledWith({
      pattern: "blocked",
      category: "content_filter",
      matchType: "exact",
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/error-rules/1",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(updated.response.status).toBe(200);
    expect(updateErrorRuleActionMock).toHaveBeenCalledWith(1, { isEnabled: false });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/error-rules/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
    expect(deleteErrorRuleActionMock).toHaveBeenCalledWith(1);
  });

  test("refreshes cache, returns stats, and tests a sample message", async () => {
    const refreshed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/error-rules/cache:refresh",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.json).toMatchObject({ stats: { rules: 1 }, syncResult: { inserted: 1 } });

    const stats = await callV1Route({
      method: "GET",
      pathname: "/api/v1/error-rules/cache/stats",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(stats.response.status).toBe(200);
    expect(stats.json).toEqual({ rules: 1 });

    const tested = await callV1Route({
      method: "POST",
      pathname: "/api/v1/error-rules:test",
      headers: { Authorization: "Bearer admin-token" },
      body: { message: "context length exceeded" },
    });
    expect(tested.response.status).toBe(200);
    expect(tested.json).toMatchObject({ matched: true });
    expect(testErrorRuleActionMock).toHaveBeenCalledWith({ message: "context length exceeded" });
  });

  test("returns problem+json for invalid requests and not-found failures", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/error-rules",
      headers: { Authorization: "Bearer admin-token" },
      body: { pattern: "", category: "prompt_limit" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    updateErrorRuleActionMock.mockResolvedValueOnce({ ok: false, error: "错误规则不存在" });
    const missing = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/error-rules/404",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "error_rule.not_found" });
  });

  test("documents error rule REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/error-rules");
    expect(doc.paths).toHaveProperty("/api/v1/error-rules/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/error-rules/cache:refresh");
    expect(doc.paths).toHaveProperty("/api/v1/error-rules/cache/stats");
    expect(doc.paths).toHaveProperty("/api/v1/error-rules:test");
  });
});
