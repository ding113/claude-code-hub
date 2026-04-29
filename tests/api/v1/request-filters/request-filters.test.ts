import type { AuthSession } from "@/lib/auth";
import type { RequestFilter } from "@/repository/request-filters";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listRequestFiltersMock = vi.hoisted(() => vi.fn());
const createRequestFilterActionMock = vi.hoisted(() => vi.fn());
const updateRequestFilterActionMock = vi.hoisted(() => vi.fn());
const deleteRequestFilterActionMock = vi.hoisted(() => vi.fn());
const refreshRequestFiltersCacheMock = vi.hoisted(() => vi.fn());
const listProvidersForFilterActionMock = vi.hoisted(() => vi.fn());
const getDistinctProviderGroupsActionMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/request-filters", () => ({
  listRequestFilters: listRequestFiltersMock,
  createRequestFilterAction: createRequestFilterActionMock,
  updateRequestFilterAction: updateRequestFilterActionMock,
  deleteRequestFilterAction: deleteRequestFilterActionMock,
  refreshRequestFiltersCache: refreshRequestFiltersCacheMock,
  listProvidersForFilterAction: listProvidersForFilterActionMock,
  getDistinctProviderGroupsAction: getDistinctProviderGroupsActionMock,
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

function filter(overrides: Partial<RequestFilter> = {}): RequestFilter {
  return {
    id: 1,
    name: "Strip beta header",
    description: "Remove beta header",
    scope: "header",
    action: "remove",
    matchType: "exact",
    target: "anthropic-beta",
    replacement: null,
    priority: 0,
    isEnabled: true,
    bindingType: "global",
    providerIds: null,
    groupTags: null,
    ruleMode: "simple",
    executionPhase: "guard",
    operations: null,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 request filters endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    listRequestFiltersMock.mockResolvedValue([filter()]);
    createRequestFilterActionMock.mockResolvedValue({
      ok: true,
      data: filter({ id: 2, name: "Set header", target: "x-test", action: "set" }),
    });
    updateRequestFilterActionMock.mockResolvedValue({
      ok: true,
      data: filter({ id: 1, isEnabled: false }),
    });
    deleteRequestFilterActionMock.mockResolvedValue({ ok: true });
    refreshRequestFiltersCacheMock.mockResolvedValue({ ok: true, data: { count: 1 } });
    listProvidersForFilterActionMock.mockResolvedValue({
      ok: true,
      data: [{ id: 1, name: "Anthropic" }],
    });
    getDistinctProviderGroupsActionMock.mockResolvedValue({ ok: true, data: ["default", "vip"] });
  });

  test("lists and mutates request filters with REST semantics", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/request-filters",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 1, target: "anthropic-beta", updatedAt: "2026-04-28T00:00:00.000Z" }],
    });

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/request-filters",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "Set header", scope: "header", action: "set", target: "x-test" },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/request-filters/2");
    expect(createRequestFilterActionMock).toHaveBeenCalledWith({
      name: "Set header",
      scope: "header",
      action: "set",
      target: "x-test",
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/request-filters/1",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(updated.response.status).toBe(200);
    expect(updateRequestFilterActionMock).toHaveBeenCalledWith(1, { isEnabled: false });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/request-filters/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
    expect(deleteRequestFilterActionMock).toHaveBeenCalledWith(1);
  });

  test("refreshes cache and exposes provider/group options", async () => {
    const refreshed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/request-filters/cache:refresh",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.json).toEqual({ count: 1 });

    const providers = await callV1Route({
      method: "GET",
      pathname: "/api/v1/request-filters/options/providers",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(providers.response.status).toBe(200);
    expect(providers.json).toEqual({ items: [{ id: 1, name: "Anthropic" }] });

    const groups = await callV1Route({
      method: "GET",
      pathname: "/api/v1/request-filters/options/groups",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(groups.response.status).toBe(200);
    expect(groups.json).toEqual({ items: ["default", "vip"] });
  });

  test("returns problem+json for invalid requests and not-found failures", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/request-filters",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "", scope: "header", action: "remove", target: "x-test" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    updateRequestFilterActionMock.mockResolvedValueOnce({ ok: false, error: "记录不存在" });
    const missing = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/request-filters/404",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "request_filter.not_found" });
  });

  test("documents request filter REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/request-filters");
    expect(doc.paths).toHaveProperty("/api/v1/request-filters/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/request-filters/cache:refresh");
    expect(doc.paths).toHaveProperty("/api/v1/request-filters/options/providers");
    expect(doc.paths).toHaveProperty("/api/v1/request-filters/options/groups");
  });
});
