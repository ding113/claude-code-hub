import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getUsageLogsMock = vi.hoisted(() => vi.fn());
const getUsageLogsBatchMock = vi.hoisted(() => vi.fn());
const getUsageLogsStatsMock = vi.hoisted(() => vi.fn());
const getFilterOptionsMock = vi.hoisted(() => vi.fn());
const getModelListMock = vi.hoisted(() => vi.fn());
const getStatusCodeListMock = vi.hoisted(() => vi.fn());
const getEndpointListMock = vi.hoisted(() => vi.fn());
const getUsageLogSessionIdSuggestionsMock = vi.hoisted(() => vi.fn());
const exportUsageLogsMock = vi.hoisted(() => vi.fn());
const startUsageLogsExportMock = vi.hoisted(() => vi.fn());
const getUsageLogsExportStatusMock = vi.hoisted(() => vi.fn());
const downloadUsageLogsExportMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});

vi.mock("@/actions/usage-logs", () => ({
  getUsageLogs: getUsageLogsMock,
  getUsageLogsBatch: getUsageLogsBatchMock,
  getUsageLogsStats: getUsageLogsStatsMock,
  getFilterOptions: getFilterOptionsMock,
  getModelList: getModelListMock,
  getStatusCodeList: getStatusCodeListMock,
  getEndpointList: getEndpointListMock,
  getUsageLogSessionIdSuggestions: getUsageLogSessionIdSuggestionsMock,
  exportUsageLogs: exportUsageLogsMock,
  startUsageLogsExport: startUsageLogsExportMock,
  getUsageLogsExportStatus: getUsageLogsExportStatusMock,
  downloadUsageLogsExport: downloadUsageLogsExportMock,
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

const headers = { Authorization: "Bearer admin-token" };

describe("v1 usage log endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getUsageLogsMock.mockResolvedValue({
      ok: true,
      data: { logs: [{ id: 1, model: "claude" }], total: 1, page: 1, pageSize: 20 },
    });
    getUsageLogsBatchMock.mockResolvedValue({
      ok: true,
      data: { logs: [{ id: 2, model: "codex" }], nextCursor: null, hasMore: false },
    });
    getUsageLogsStatsMock.mockResolvedValue({ ok: true, data: { totalRequests: 2 } });
    getFilterOptionsMock.mockResolvedValue({
      ok: true,
      data: { models: ["claude"], statusCodes: [200], endpoints: ["/v1/messages"] },
    });
    getModelListMock.mockResolvedValue({ ok: true, data: ["claude"] });
    getStatusCodeListMock.mockResolvedValue({ ok: true, data: [200, 500] });
    getEndpointListMock.mockResolvedValue({ ok: true, data: ["/v1/messages"] });
    getUsageLogSessionIdSuggestionsMock.mockResolvedValue({
      ok: true,
      data: ["session-a"],
    });
    exportUsageLogsMock.mockResolvedValue({ ok: true, data: "Time,Model\nnow,claude" });
    startUsageLogsExportMock.mockResolvedValue({ ok: true, data: { jobId: "job-1" } });
    getUsageLogsExportStatusMock.mockResolvedValue({
      ok: true,
      data: {
        jobId: "job-1",
        status: "completed",
        processedRows: 1,
        totalRows: 1,
        progressPercent: 100,
      },
    });
    downloadUsageLogsExportMock.mockResolvedValue({ ok: true, data: "Time,Model\nnow,claude" });
  });

  test("lists usage logs with offset and cursor filters", async () => {
    const offset = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs?page=2&pageSize=10&excludeStatusCode200=false",
      headers,
    });
    expect(offset.response.status).toBe(200);
    expect(offset.json).toMatchObject({
      items: [{ id: 1, model: "claude" }],
      pageInfo: { page: 1, pageSize: 20, total: 1, totalPages: 1 },
    });
    expect(getUsageLogsMock).toHaveBeenCalledWith({
      limit: 20,
      page: 2,
      pageSize: 10,
      excludeStatusCode200: false,
    });

    const cursor = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs?cursorCreatedAt=2026-04-28T00:00:00.000Z&cursorId=42&limit=15",
      headers,
    });
    expect(cursor.response.status).toBe(200);
    expect(cursor.json).toMatchObject({
      items: [{ id: 2, model: "codex" }],
      pageInfo: { nextCursor: null, hasMore: false, limit: 15 },
    });
    expect(getUsageLogsBatchMock).toHaveBeenCalledWith({
      limit: 15,
      cursor: { createdAt: "2026-04-28T00:00:00.000Z", id: 42 },
    });
  });

  test("reads stats filters lists and session suggestions", async () => {
    const stats = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/stats?model=claude",
      headers,
    });
    expect(stats.response.status).toBe(200);
    expect(getUsageLogsStatsMock).toHaveBeenCalledWith({ limit: 20, model: "claude" });

    const filters = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/filter-options",
      headers,
    });
    expect(filters.json).toMatchObject({ models: ["claude"] });

    const models = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/models",
      headers,
    });
    expect(models.json).toEqual({ items: ["claude"] });

    const codes = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/status-codes",
      headers,
    });
    expect(codes.json).toEqual({ items: [200, 500] });

    const endpoints = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/endpoints",
      headers,
    });
    expect(endpoints.json).toEqual({ items: ["/v1/messages"] });

    const suggestions = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/session-id-suggestions?q=session&userId=1",
      headers,
    });
    expect(suggestions.response.status).toBe(200);
    expect(getUsageLogSessionIdSuggestionsMock).toHaveBeenCalledWith({
      term: "session",
      userId: 1,
    });
  });

  test("keeps global usage-log metadata admin-only", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);

    for (const pathname of [
      "/api/v1/usage-logs/filter-options",
      "/api/v1/usage-logs/models",
      "/api/v1/usage-logs/status-codes",
      "/api/v1/usage-logs/endpoints",
    ]) {
      const got = await callV1Route({
        method: "GET",
        pathname,
        headers: { Authorization: "Bearer user-token" },
      });
      expect(got.response.status).toBe(403);
      expect(got.json).toMatchObject({ errorCode: "auth.forbidden" });
    }

    expect(getFilterOptionsMock).not.toHaveBeenCalled();
    expect(getModelListMock).not.toHaveBeenCalled();
    expect(getStatusCodeListMock).not.toHaveBeenCalled();
    expect(getEndpointListMock).not.toHaveBeenCalled();
  });

  test("creates sync and async exports and downloads completed csv", async () => {
    const sync = await callV1Route({
      method: "POST",
      pathname: "/api/v1/usage-logs/exports",
      headers,
      body: { model: "claude" },
    });
    expect(sync.response.status).toBe(200);
    expect(sync.json).toEqual({ csv: "Time,Model\nnow,claude" });
    expect(exportUsageLogsMock).toHaveBeenCalledWith({ model: "claude" });

    const asyncJob = await callV1Route({
      method: "POST",
      pathname: "/api/v1/usage-logs/exports",
      headers: { ...headers, Prefer: "respond-async" },
      body: { model: "claude" },
    });
    expect(asyncJob.response.status).toBe(202);
    expect(asyncJob.response.headers.get("Location")).toBe("/api/v1/usage-logs/exports/job-1");
    expect(startUsageLogsExportMock).toHaveBeenCalledWith({ model: "claude" });

    const status = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/exports/job-1",
      headers,
    });
    expect(status.response.status).toBe(200);
    expect(getUsageLogsExportStatusMock).toHaveBeenCalledWith("job-1");

    const download = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/exports/job-1/download",
      headers,
    });
    expect(download.response.status).toBe(200);
    expect(download.response.headers.get("content-type")).toContain("text/csv");
    expect(download.text).toContain("Time,Model");
  });

  test("returns problem+json for action failures and documents paths", async () => {
    getUsageLogsStatsMock.mockResolvedValueOnce({
      ok: false,
      error: "使用日志不存在",
      errorCode: "NOT_FOUND",
    });
    const failed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/usage-logs/stats",
      headers,
    });
    expect(failed.response.status).toBe(404);
    expect(failed.response.headers.get("content-type")).toContain("application/problem+json");

    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };
    expect(doc.paths).toHaveProperty("/api/v1/usage-logs");
    expect(doc.paths).toHaveProperty("/api/v1/usage-logs/stats");
    expect(doc.paths).toHaveProperty("/api/v1/usage-logs/filter-options");
    expect(doc.paths).toHaveProperty("/api/v1/usage-logs/exports");
    expect(doc.paths).toHaveProperty("/api/v1/usage-logs/exports/{jobId}");
    expect(doc.paths).toHaveProperty("/api/v1/usage-logs/exports/{jobId}/download");
  });
});
