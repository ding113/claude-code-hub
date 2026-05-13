import type { AuthSession } from "@/lib/auth";
import type { SensitiveWord } from "@/repository/sensitive-words";
import { beforeEach, describe, expect, test, vi } from "vitest";

const listSensitiveWordsMock = vi.hoisted(() => vi.fn());
const createSensitiveWordActionMock = vi.hoisted(() => vi.fn());
const updateSensitiveWordActionMock = vi.hoisted(() => vi.fn());
const deleteSensitiveWordActionMock = vi.hoisted(() => vi.fn());
const refreshCacheActionMock = vi.hoisted(() => vi.fn());
const getCacheStatsMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/sensitive-words", () => ({
  listSensitiveWords: listSensitiveWordsMock,
  createSensitiveWordAction: createSensitiveWordActionMock,
  updateSensitiveWordAction: updateSensitiveWordActionMock,
  deleteSensitiveWordAction: deleteSensitiveWordActionMock,
  refreshCacheAction: refreshCacheActionMock,
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

function word(overrides: Partial<SensitiveWord> = {}): SensitiveWord {
  return {
    id: 1,
    word: "secret",
    matchType: "contains",
    description: "Blocks secret text",
    isEnabled: true,
    createdAt: new Date("2026-04-28T00:00:00.000Z"),
    updatedAt: new Date("2026-04-28T00:00:00.000Z"),
    ...overrides,
  };
}

describe("v1 sensitive words endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    listSensitiveWordsMock.mockResolvedValue([word()]);
    createSensitiveWordActionMock.mockResolvedValue({
      ok: true,
      data: word({ id: 2, word: "token", matchType: "exact" }),
    });
    updateSensitiveWordActionMock.mockResolvedValue({
      ok: true,
      data: word({ id: 1, isEnabled: false }),
    });
    deleteSensitiveWordActionMock.mockResolvedValue({ ok: true });
    refreshCacheActionMock.mockResolvedValue({ ok: true, data: { stats: { rules: 1 } } });
    getCacheStatsMock.mockResolvedValue({ rules: 1 });
  });

  test("lists and mutates sensitive words with REST semantics", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sensitive-words",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    expect(list.json).toMatchObject({
      items: [{ id: 1, word: "secret", updatedAt: "2026-04-28T00:00:00.000Z" }],
    });

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/sensitive-words",
      headers: { Authorization: "Bearer admin-token" },
      body: { word: "token", matchType: "exact", description: "Exact token" },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/sensitive-words/2");
    expect(createSensitiveWordActionMock).toHaveBeenCalledWith({
      word: "token",
      matchType: "exact",
      description: "Exact token",
    });

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/sensitive-words/1",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(updated.response.status).toBe(200);
    expect(updateSensitiveWordActionMock).toHaveBeenCalledWith(1, { isEnabled: false });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/sensitive-words/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
    expect(deleteSensitiveWordActionMock).toHaveBeenCalledWith(1);
  });

  test("refreshes and reads cache stats", async () => {
    const refreshed = await callV1Route({
      method: "POST",
      pathname: "/api/v1/sensitive-words/cache:refresh",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(refreshed.response.status).toBe(200);
    expect(refreshed.json).toEqual({ stats: { rules: 1 } });

    const stats = await callV1Route({
      method: "GET",
      pathname: "/api/v1/sensitive-words/cache/stats",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(stats.response.status).toBe(200);
    expect(stats.json).toEqual({ rules: 1 });
  });

  test("returns problem+json for invalid requests and not-found failures", async () => {
    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/sensitive-words",
      headers: { Authorization: "Bearer admin-token" },
      body: { word: "", matchType: "contains" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    updateSensitiveWordActionMock.mockResolvedValueOnce({ ok: false, error: "敏感词不存在" });
    const missing = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/sensitive-words/404",
      headers: { Authorization: "Bearer admin-token" },
      body: { isEnabled: false },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "sensitive_word.not_found" });
  });

  test("documents sensitive word REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/sensitive-words");
    expect(doc.paths).toHaveProperty("/api/v1/sensitive-words/{id}");
    expect(doc.paths).toHaveProperty("/api/v1/sensitive-words/cache:refresh");
    expect(doc.paths).toHaveProperty("/api/v1/sensitive-words/cache/stats");
  });
});
