import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getMyUsageMetadataMock = vi.hoisted(() => vi.fn());
const getMyQuotaMock = vi.hoisted(() => vi.fn());
const getMyTodayStatsMock = vi.hoisted(() => vi.fn());
const getMyUsageLogsMock = vi.hoisted(() => vi.fn());
const getMyUsageLogsBatchMock = vi.hoisted(() => vi.fn());
const getMyUsageLogsBatchFullMock = vi.hoisted(() => vi.fn());
const getMyAvailableModelsMock = vi.hoisted(() => vi.fn());
const getMyAvailableEndpointsMock = vi.hoisted(() => vi.fn());
const getMyIpGeoDetailsMock = vi.hoisted(() => vi.fn());
const getMyStatsSummaryMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/my-usage", () => ({
  getMyUsageMetadata: getMyUsageMetadataMock,
  getMyQuota: getMyQuotaMock,
  getMyTodayStats: getMyTodayStatsMock,
  getMyUsageLogs: getMyUsageLogsMock,
  getMyUsageLogsBatch: getMyUsageLogsBatchMock,
  getMyUsageLogsBatchFull: getMyUsageLogsBatchFullMock,
  getMyAvailableModels: getMyAvailableModelsMock,
  getMyAvailableEndpoints: getMyAvailableEndpointsMock,
  getMyIpGeoDetails: getMyIpGeoDetailsMock,
  getMyStatsSummary: getMyStatsSummaryMock,
}));

const { callV1Route } = await import("../test-utils");

const readSession = {
  user: { id: 1, role: "user", isEnabled: true },
  key: { id: 1, userId: 1, key: "user-token", canLoginWebUi: false },
} as AuthSession;

const headers = { Authorization: "Bearer user-token" };

describe("v1 me endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(readSession);
    getMyUsageMetadataMock.mockResolvedValue({
      ok: true,
      data: { keyName: "default", userName: "alice" },
    });
    getMyQuotaMock.mockResolvedValue({ ok: true, data: { keyCurrentDailyUsd: 1 } });
    getMyTodayStatsMock.mockResolvedValue({ ok: true, data: { calls: 2, costUsd: 0.1 } });
    getMyUsageLogsMock.mockResolvedValue({
      ok: true,
      data: { logs: [{ id: 1, model: "claude" }], total: 1, page: 1, pageSize: 20 },
    });
    getMyUsageLogsBatchMock.mockResolvedValue({
      ok: true,
      data: { logs: [{ id: 2, model: "codex" }], nextCursor: null, hasMore: false },
    });
    getMyUsageLogsBatchFullMock.mockResolvedValue({
      ok: true,
      data: { logs: [{ id: 3, model: "openai" }], nextCursor: null, hasMore: false },
    });
    getMyAvailableModelsMock.mockResolvedValue({ ok: true, data: ["claude"] });
    getMyAvailableEndpointsMock.mockResolvedValue({ ok: true, data: ["/v1/messages"] });
    getMyStatsSummaryMock.mockResolvedValue({ ok: true, data: { totalRequests: 2 } });
    getMyIpGeoDetailsMock.mockResolvedValue({
      ok: true,
      data: { status: "ok", data: { country: "US" } },
    });
  });

  test("reads metadata quota and today's stats", async () => {
    const metadata = await callV1Route({ method: "GET", pathname: "/api/v1/me/metadata", headers });
    expect(metadata.response.status).toBe(200);
    expect(metadata.json).toMatchObject({ keyName: "default", userName: "alice" });

    const quota = await callV1Route({ method: "GET", pathname: "/api/v1/me/quota", headers });
    expect(quota.response.status).toBe(200);
    expect(quota.json).toMatchObject({ keyCurrentDailyUsd: 1 });

    const today = await callV1Route({ method: "GET", pathname: "/api/v1/me/today", headers });
    expect(today.response.status).toBe(200);
    expect(today.json).toMatchObject({ calls: 2, costUsd: 0.1 });
  });

  test("lists usage logs with offset cursor and full read-only shape", async () => {
    const offset = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/usage-logs?page=2&pageSize=10&excludeStatusCode200=false",
      headers,
    });
    expect(offset.response.status).toBe(200);
    expect(offset.json).toMatchObject({
      items: [{ id: 1, model: "claude" }],
      pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(getMyUsageLogsMock).toHaveBeenCalledWith({
      limit: 20,
      page: 2,
      pageSize: 10,
      excludeStatusCode200: false,
    });
    expect(getMyUsageLogsMock).toHaveBeenCalledTimes(1);
    expect(getMyUsageLogsBatchMock).not.toHaveBeenCalled();
    getMyUsageLogsMock.mockClear();
    getMyUsageLogsBatchMock.mockClear();

    const firstCursorPage = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/usage-logs?limit=15",
      headers,
    });
    expect(firstCursorPage.response.status).toBe(200);
    expect(firstCursorPage.json).toMatchObject({
      items: [{ id: 2, model: "codex" }],
      pageInfo: { nextCursor: null, hasMore: false, limit: 15 },
    });
    expect(getMyUsageLogsBatchMock).toHaveBeenCalledWith({ limit: 15 });
    expect(getMyUsageLogsBatchMock).toHaveBeenCalledTimes(1);
    expect(getMyUsageLogsMock).not.toHaveBeenCalled();
    getMyUsageLogsMock.mockClear();
    getMyUsageLogsBatchMock.mockClear();

    const cursor = await callV1Route({
      method: "GET",
      pathname:
        "/api/v1/me/usage-logs?cursorCreatedAt=2026-04-28T00:00:00.000Z&cursorId=42&limit=15",
      headers,
    });
    expect(cursor.response.status).toBe(200);
    expect(cursor.json).toMatchObject({
      items: [{ id: 2, model: "codex" }],
      pageInfo: { nextCursor: null, hasMore: false, limit: 15 },
    });
    expect(getMyUsageLogsBatchMock).toHaveBeenLastCalledWith({
      limit: 15,
      cursor: { createdAt: "2026-04-28T00:00:00.000Z", id: 42 },
    });
    expect(getMyUsageLogsBatchMock).toHaveBeenCalledTimes(1);
    expect(getMyUsageLogsMock).not.toHaveBeenCalled();
    getMyUsageLogsMock.mockClear();
    getMyUsageLogsBatchMock.mockClear();

    const mixed = await callV1Route({
      method: "GET",
      pathname:
        "/api/v1/me/usage-logs?page=2&pageSize=10&cursorCreatedAt=2026-04-28T00:00:00.000Z&cursorId=42&limit=15",
      headers,
    });
    expect(mixed.response.status).toBe(200);
    expect(mixed.json).toMatchObject({
      items: [{ id: 1, model: "claude" }],
      pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(getMyUsageLogsMock).toHaveBeenCalledWith({
      limit: 15,
      page: 2,
      pageSize: 10,
    });
    expect(getMyUsageLogsMock).toHaveBeenCalledTimes(1);
    expect(getMyUsageLogsBatchMock).not.toHaveBeenCalled();

    const full = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/usage-logs/full?model=claude",
      headers,
    });
    expect(full.response.status).toBe(200);
    expect(getMyUsageLogsBatchFullMock).toHaveBeenCalledWith({ limit: 20, model: "claude" });
  });

  test("reads filter options stats summary and scoped ip geo", async () => {
    const models = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/usage-logs/models",
      headers,
    });
    expect(models.json).toEqual({ items: ["claude"] });

    const endpoints = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/usage-logs/endpoints",
      headers,
    });
    expect(endpoints.json).toEqual({ items: ["/v1/messages"] });

    const stats = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/usage-logs/stats-summary?startDate=2026-04-01&endDate=2026-04-28",
      headers,
    });
    expect(stats.response.status).toBe(200);
    expect(getMyStatsSummaryMock).toHaveBeenCalledWith({
      startDate: "2026-04-01",
      endDate: "2026-04-28",
    });

    const geo = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/ip-geo/8.8.8.8?lang=en",
      headers,
    });
    expect(geo.response.status).toBe(200);
    expect(getMyIpGeoDetailsMock).toHaveBeenCalledWith({ ip: "8.8.8.8", lang: "en" });
  });

  test("returns problem+json for action failures and documents paths", async () => {
    getMyIpGeoDetailsMock.mockResolvedValueOnce({
      ok: false,
      error: "Not found",
      errorCode: "NOT_FOUND",
    });
    const missing = await callV1Route({
      method: "GET",
      pathname: "/api/v1/me/ip-geo/127.0.0.1",
      headers,
    });
    expect(missing.response.status).toBe(404);
    expect(missing.response.headers.get("content-type")).toContain("application/problem+json");

    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty("/api/v1/me/metadata");
    expect(doc.paths).toHaveProperty("/api/v1/me/quota");
    expect(doc.paths).toHaveProperty("/api/v1/me/today");
    expect(doc.paths).toHaveProperty("/api/v1/me/usage-logs");
    expect(doc.paths).toHaveProperty("/api/v1/me/usage-logs/full");
    expect(doc.paths).toHaveProperty("/api/v1/me/usage-logs/models");
    expect(doc.paths).toHaveProperty("/api/v1/me/usage-logs/endpoints");
    expect(doc.paths).toHaveProperty("/api/v1/me/usage-logs/stats-summary");
    expect(doc.paths).toHaveProperty("/api/v1/me/ip-geo/{ip}");
  });
});
