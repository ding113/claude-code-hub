import type { AuthSession } from "@/lib/auth";
import type { ProviderGroup } from "@/types/provider-group";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getProviderGroupsMock = vi.hoisted(() => vi.fn());
const createProviderGroupMock = vi.hoisted(() => vi.fn());
const updateProviderGroupMock = vi.hoisted(() => vi.fn());
const deleteProviderGroupMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/provider-groups", () => ({
  getProviderGroups: getProviderGroupsMock,
  createProviderGroup: createProviderGroupMock,
  updateProviderGroup: updateProviderGroupMock,
  deleteProviderGroup: deleteProviderGroupMock,
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

function group(overrides: Partial<ProviderGroup & { providerCount: number }> = {}) {
  return {
    id: 1,
    name: "default",
    costMultiplier: 1,
    description: null,
    providerCount: 2,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 provider groups endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getProviderGroupsMock.mockResolvedValue({ ok: true, data: [group()] });
    createProviderGroupMock.mockResolvedValue({
      ok: true,
      data: group({ id: 2, name: "vip", providerCount: undefined }),
    });
    updateProviderGroupMock.mockResolvedValue({
      ok: true,
      data: group({ id: 2, name: "vip", costMultiplier: 1.5, providerCount: undefined }),
    });
    deleteProviderGroupMock.mockResolvedValue({ ok: true });
  });

  test("lists and mutates provider groups with REST semantics", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/provider-groups",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 1, name: "default", providerCount: 2, updatedAt: "2026-04-28T00:00:00.000Z" }],
    });

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-groups",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "vip", costMultiplier: 1.5, description: "VIP group" },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/provider-groups/2");

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/provider-groups/2",
      headers: { Authorization: "Bearer admin-token" },
      body: { costMultiplier: 1.5 },
    });
    expect(updated.response.status).toBe(200);
    expect(updateProviderGroupMock).toHaveBeenCalledWith(2, { costMultiplier: 1.5 });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/provider-groups/2",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
    expect(deleteProviderGroupMock).toHaveBeenCalledWith(2);
  });

  test("returns problem+json for invalid requests and not-found failures", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/provider-groups",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "", costMultiplier: 1 },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    updateProviderGroupMock.mockResolvedValueOnce({
      ok: false,
      error: "Not found",
      errorCode: "NOT_FOUND",
    });
    const missing = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/provider-groups/404",
      headers: { Authorization: "Bearer admin-token" },
      body: { costMultiplier: 1.5 },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "provider_group.not_found" });
  });

  test("documents provider group REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/provider-groups");
    expect(doc.paths).toHaveProperty("/api/v1/provider-groups/{id}");
  });
});
