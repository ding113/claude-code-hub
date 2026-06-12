import type { AuthSession } from "@/lib/auth";
import type { KeywordRoutingRule } from "@/repository/keyword-routing-rules";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listKeywordRoutingRulesMock = vi.hoisted(() => vi.fn());
const createKeywordRoutingRuleActionMock = vi.hoisted(() => vi.fn());
const updateKeywordRoutingRuleActionMock = vi.hoisted(() => vi.fn());
const deleteKeywordRoutingRuleActionMock = vi.hoisted(() => vi.fn());
const refreshKeywordRoutingCacheActionMock = vi.hoisted(() => vi.fn());
const getKeywordRoutingCacheStatsMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/keyword-routing", () => ({
  listKeywordRoutingRules: listKeywordRoutingRulesMock,
  createKeywordRoutingRuleAction: createKeywordRoutingRuleActionMock,
  updateKeywordRoutingRuleAction: updateKeywordRoutingRuleActionMock,
  deleteKeywordRoutingRuleAction: deleteKeywordRoutingRuleActionMock,
  refreshKeywordRoutingCacheAction: refreshKeywordRoutingCacheActionMock,
  getKeywordRoutingCacheStats: getKeywordRoutingCacheStatsMock,
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

function rule(overrides: Partial<KeywordRoutingRule> = {}): KeywordRoutingRule {
  return {
    id: 1,
    keyword: "ultrathink",
    sourceModel: null,
    targetModel: "model-b",
    caseSensitive: true,
    priority: 0,
    description: "Route deep-thinking prompts",
    isEnabled: true,
    createdAt: new Date("2026-06-01T00:00:00.000Z"),
    updatedAt: new Date("2026-06-01T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 keyword routing endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    listKeywordRoutingRulesMock.mockResolvedValue([rule()]);
    createKeywordRoutingRuleActionMock.mockResolvedValue({
      ok: true,
      data: rule({ id: 2, keyword: "deep dive", targetModel: "model-c" }),
    });
    updateKeywordRoutingRuleActionMock.mockResolvedValue({
      ok: true,
      data: rule({ id: 1, isEnabled: false }),
    });
    deleteKeywordRoutingRuleActionMock.mockResolvedValue({ ok: true });
    refreshKeywordRoutingCacheActionMock.mockResolvedValue({
      ok: true,
      data: { stats: { ruleCount: 1, lastReloadTime: 1750000000000, isLoading: false } },
    });
    getKeywordRoutingCacheStatsMock.mockResolvedValue({
      ruleCount: 1,
      lastReloadTime: 1750000000000,
      isLoading: false,
    });
  });

  test("lists and mutates keyword routing rules with REST semantics", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/keyword-routing-rules",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 1, keyword: "ultrathink", updatedAt: "2026-06-01T00:00:00.000Z" }],
    });

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keyword-routing-rules",
      headers: { Authorization: "Bearer admin-token" },
      body: { keyword: "deep dive", targetModel: "model-c", priority: 10 },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/keyword-routing-rules/2");
    expect(createKeywordRoutingRuleActionMock).toHaveBeenCalledWith({
      keyword: "deep dive",
      targetModel: "model-c",
      priority: 10,
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keyword-routing-rules/1",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(updated.response.status).toBe(200);
    expect(updateKeywordRoutingRuleActionMock).toHaveBeenCalledWith(1, { isEnabled: false });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/keyword-routing-rules/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
    expect(deleteKeywordRoutingRuleActionMock).toHaveBeenCalledWith(1);
  });

  test("refreshes and reads cache stats", async () => {
    const refreshed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keyword-routing-rules/cache:refresh",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.json).toEqual({
      stats: { ruleCount: 1, lastReloadTime: 1750000000000, isLoading: false },
    });

    const stats = await callV1Route({
      method: "GET",
      pathname: "/api/v1/keyword-routing-rules/cache/stats",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(stats.response.status).toBe(200);
    expect(stats.json).toEqual({ ruleCount: 1, lastReloadTime: 1750000000000, isLoading: false });
  });

  test("returns problem+json for invalid requests and not-found failures", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/keyword-routing-rules",
      headers: { Authorization: "Bearer admin-token" },
      body: { keyword: "", targetModel: "model-c" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    updateKeywordRoutingRuleActionMock.mockResolvedValueOnce({
      ok: false,
      error: "关键词路由规则不存在",
    });
    const missing = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/keyword-routing-rules/404",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "keyword_routing_rule.not_found" });
  });

  test("documents keyword routing REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/keyword-routing-rules");
    expect(doc.paths).toHaveProperty("/api/v1/keyword-routing-rules/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/keyword-routing-rules/cache:refresh");
    expect(doc.paths).toHaveProperty("/api/v1/keyword-routing-rules/cache/stats");
  });
});
