import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listKeywordRoutingRulesMock = vi.fn();
const createKeywordRoutingRuleActionMock = vi.fn();
const updateKeywordRoutingRuleActionMock = vi.fn();
const deleteKeywordRoutingRuleActionMock = vi.fn();
const refreshKeywordRoutingCacheActionMock = vi.fn();
const getKeywordRoutingCacheStatsMock = vi.fn();
const validateAuthTokenMock = vi.fn();

vi.mock("@/actions/keyword-routing", () => ({
  listKeywordRoutingRules: listKeywordRoutingRulesMock,
  createKeywordRoutingRuleAction: createKeywordRoutingRuleActionMock,
  updateKeywordRoutingRuleAction: updateKeywordRoutingRuleActionMock,
  deleteKeywordRoutingRuleAction: deleteKeywordRoutingRuleActionMock,
  refreshKeywordRoutingCacheAction: refreshKeywordRoutingCacheActionMock,
  getKeywordRoutingCacheStats: getKeywordRoutingCacheStatsMock,
}));

vi.mock("@/lib/auth", () => ({
  validateAuthToken: validateAuthTokenMock,
}));

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

const userSession = {
  user: { id: 2, role: "user", isEnabled: true },
  key: { id: 2, userId: 2, key: "user-token", canLoginWebUi: true },
} as AuthSession;

describe("v1 keyword routing authorization", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listKeywordRoutingRulesMock.mockResolvedValue([]);
    createKeywordRoutingRuleActionMock.mockResolvedValue({
      ok: true,
      data: { id: 1 },
    });
    updateKeywordRoutingRuleActionMock.mockResolvedValue({
      ok: true,
      data: { id: 1 },
    });
    deleteKeywordRoutingRuleActionMock.mockResolvedValue({ ok: true });
    refreshKeywordRoutingCacheActionMock.mockResolvedValue({
      ok: true,
      data: { stats: { ruleCount: 0 } },
    });
    getKeywordRoutingCacheStatsMock.mockResolvedValue({
      ruleCount: 0,
      lastReloadTime: 0,
      isLoading: false,
    });
  });

  describe("Unauthenticated access", () => {
    test("GET /api/v1/keyword-routing-rules rejects without authorization", async () => {
      validateAuthTokenMock.mockResolvedValueOnce(null);

      const response = await callV1Route({
        method: "GET",
        pathname: "/api/v1/keyword-routing-rules",
      });

      expect(response.response.status).toBe(401);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/auth\.missing|UNAUTHORIZED/),
      });
      expect(listKeywordRoutingRulesMock).not.toHaveBeenCalled();
    });

    test("POST /api/v1/keyword-routing-rules rejects without authorization", async () => {
      validateAuthTokenMock.mockResolvedValueOnce(null);

      const response = await callV1Route({
        method: "POST",
        pathname: "/api/v1/keyword-routing-rules",
        body: { keyword: "test", targetModel: "model-a" },
      });

      expect(response.response.status).toBe(401);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/auth\.missing|UNAUTHORIZED/),
      });
      expect(createKeywordRoutingRuleActionMock).not.toHaveBeenCalled();
    });

    test("PATCH /api/v1/keyword-routing-rules/:id rejects without authorization", async () => {
      validateAuthTokenMock.mockResolvedValueOnce(null);

      const response = await callV1Route({
        method: "PATCH",
        pathname: "/api/v1/keyword-routing-rules/1",
        body: { isEnabled: false },
      });

      expect(response.response.status).toBe(401);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/auth\.missing|UNAUTHORIZED/),
      });
      expect(updateKeywordRoutingRuleActionMock).not.toHaveBeenCalled();
    });

    test("DELETE /api/v1/keyword-routing-rules/:id rejects without authorization", async () => {
      validateAuthTokenMock.mockResolvedValueOnce(null);

      const response = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/keyword-routing-rules/1",
      });

      expect(response.response.status).toBe(401);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/auth\.missing|UNAUTHORIZED/),
      });
      expect(deleteKeywordRoutingRuleActionMock).not.toHaveBeenCalled();
    });

    test("GET /api/v1/keyword-routing-rules/cache/stats rejects without authorization", async () => {
      validateAuthTokenMock.mockResolvedValueOnce(null);

      const response = await callV1Route({
        method: "GET",
        pathname: "/api/v1/keyword-routing-rules/cache/stats",
      });

      expect(response.response.status).toBe(401);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/auth\.missing|UNAUTHORIZED/),
      });
      expect(getKeywordRoutingCacheStatsMock).not.toHaveBeenCalled();
    });

    test("POST /api/v1/keyword-routing-rules/cache:refresh rejects without authorization", async () => {
      validateAuthTokenMock.mockResolvedValueOnce(null);

      const response = await callV1Route({
        method: "POST",
        pathname: "/api/v1/keyword-routing-rules/cache:refresh",
      });

      expect(response.response.status).toBe(401);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/auth\.missing|UNAUTHORIZED/),
      });
      expect(refreshKeywordRoutingCacheActionMock).not.toHaveBeenCalled();
    });
  });

  describe("Non-admin user access", () => {
    test("GET /api/v1/keyword-routing-rules rejects non-admin users", async () => {
      validateAuthTokenMock.mockResolvedValue(userSession);

      const response = await callV1Route({
        method: "GET",
        pathname: "/api/v1/keyword-routing-rules",
        headers: { Authorization: "Bearer user-token" },
      });

      expect(response.response.status).toBe(403);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/PERMISSION_DENIED|FORBIDDEN|auth\.forbidden/),
      });
      expect(listKeywordRoutingRulesMock).not.toHaveBeenCalled();
    });

    test("POST /api/v1/keyword-routing-rules rejects non-admin users", async () => {
      validateAuthTokenMock.mockResolvedValue(userSession);

      const response = await callV1Route({
        method: "POST",
        pathname: "/api/v1/keyword-routing-rules",
        headers: { Authorization: "Bearer user-token" },
        body: { keyword: "test", targetModel: "model-a" },
      });

      expect(response.response.status).toBe(403);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/PERMISSION_DENIED|FORBIDDEN|auth\.forbidden/),
      });
      expect(createKeywordRoutingRuleActionMock).not.toHaveBeenCalled();
    });

    test("PATCH /api/v1/keyword-routing-rules/:id rejects non-admin users", async () => {
      validateAuthTokenMock.mockResolvedValue(userSession);

      const response = await callV1Route({
        method: "PATCH",
        pathname: "/api/v1/keyword-routing-rules/1",
        headers: { Authorization: "Bearer user-token" },
        body: { isEnabled: false },
      });

      expect(response.response.status).toBe(403);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/PERMISSION_DENIED|FORBIDDEN|auth\.forbidden/),
      });
      expect(updateKeywordRoutingRuleActionMock).not.toHaveBeenCalled();
    });

    test("DELETE /api/v1/keyword-routing-rules/:id rejects non-admin users", async () => {
      validateAuthTokenMock.mockResolvedValue(userSession);

      const response = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/keyword-routing-rules/1",
        headers: { Authorization: "Bearer user-token" },
      });

      expect(response.response.status).toBe(403);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/PERMISSION_DENIED|FORBIDDEN|auth\.forbidden/),
      });
      expect(deleteKeywordRoutingRuleActionMock).not.toHaveBeenCalled();
    });

    test("GET /api/v1/keyword-routing-rules/cache/stats rejects non-admin users", async () => {
      validateAuthTokenMock.mockResolvedValue(userSession);

      const response = await callV1Route({
        method: "GET",
        pathname: "/api/v1/keyword-routing-rules/cache/stats",
        headers: { Authorization: "Bearer user-token" },
      });

      expect(response.response.status).toBe(403);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/PERMISSION_DENIED|FORBIDDEN|auth\.forbidden/),
      });
      expect(getKeywordRoutingCacheStatsMock).not.toHaveBeenCalled();
    });

    test("POST /api/v1/keyword-routing-rules/cache:refresh rejects non-admin users", async () => {
      validateAuthTokenMock.mockResolvedValue(userSession);

      const response = await callV1Route({
        method: "POST",
        pathname: "/api/v1/keyword-routing-rules/cache:refresh",
        headers: { Authorization: "Bearer user-token" },
      });

      expect(response.response.status).toBe(403);
      expect(response.response.headers.get("content-type")).toContain("application/problem+json");
      expect(response.json).toMatchObject({
        errorCode: expect.stringMatching(/PERMISSION_DENIED|FORBIDDEN|auth\.forbidden/),
      });
      expect(refreshKeywordRoutingCacheActionMock).not.toHaveBeenCalled();
    });
  });

  describe("Admin user access", () => {
    test("allows admin to GET keyword routing rules", async () => {
      validateAuthTokenMock.mockResolvedValue(adminSession);

      const response = await callV1Route({
        method: "GET",
        pathname: "/api/v1/keyword-routing-rules",
        headers: { Authorization: "Bearer admin-token" },
      });

      expect(response.response.status).toBe(200);
      expect(listKeywordRoutingRulesMock).toHaveBeenCalled();
    });

    test("allows admin to POST keyword routing rules", async () => {
      validateAuthTokenMock.mockResolvedValue(adminSession);

      const response = await callV1Route({
        method: "POST",
        pathname: "/api/v1/keyword-routing-rules",
        headers: { Authorization: "Bearer admin-token" },
        body: { keyword: "test", targetModel: "model-a" },
      });

      expect(response.response.status).toBe(201);
      expect(createKeywordRoutingRuleActionMock).toHaveBeenCalled();
    });

    test("allows admin to PATCH keyword routing rules", async () => {
      validateAuthTokenMock.mockResolvedValue(adminSession);

      const response = await callV1Route({
        method: "PATCH",
        pathname: "/api/v1/keyword-routing-rules/1",
        headers: { Authorization: "Bearer admin-token" },
        body: { isEnabled: false },
      });

      expect(response.response.status).toBe(200);
      expect(updateKeywordRoutingRuleActionMock).toHaveBeenCalled();
    });

    test("allows admin to DELETE keyword routing rules", async () => {
      validateAuthTokenMock.mockResolvedValue(adminSession);

      const response = await callV1Route({
        method: "DELETE",
        pathname: "/api/v1/keyword-routing-rules/1",
        headers: { Authorization: "Bearer admin-token" },
      });

      expect(response.response.status).toBe(204);
      expect(deleteKeywordRoutingRuleActionMock).toHaveBeenCalled();
    });

    test("allows admin to GET cache stats", async () => {
      validateAuthTokenMock.mockResolvedValue(adminSession);

      const response = await callV1Route({
        method: "GET",
        pathname: "/api/v1/keyword-routing-rules/cache/stats",
        headers: { Authorization: "Bearer admin-token" },
      });

      expect(response.response.status).toBe(200);
      expect(getKeywordRoutingCacheStatsMock).toHaveBeenCalled();
    });

    test("allows admin to POST cache refresh", async () => {
      validateAuthTokenMock.mockResolvedValue(adminSession);

      const response = await callV1Route({
        method: "POST",
        pathname: "/api/v1/keyword-routing-rules/cache:refresh",
        headers: { Authorization: "Bearer admin-token" },
      });

      expect(response.response.status).toBe(200);
      expect(refreshKeywordRoutingCacheActionMock).toHaveBeenCalled();
    });
  });
});
