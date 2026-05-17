import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const validateAuthTokenMock = vi.hoisted(() => vi.fn());
const getOverviewDataMock = vi.hoisted(() => vi.fn());
const getUserStatisticsMock = vi.hoisted(() => vi.fn());
const getConcurrentSessionsMock = vi.hoisted(() => vi.fn());
const getDashboardRealtimeDataMock = vi.hoisted(() => vi.fn());
const getProviderSlotsMock = vi.hoisted(() => vi.fn());
const getRateLimitStatsMock = vi.hoisted(() => vi.fn());
const getProxyStatusMock = vi.hoisted(() => vi.fn());
const fetchClientVersionStatsMock = vi.hoisted(() => vi.fn());
const simulateDispatchActionMock = vi.hoisted(() => vi.fn());
const getSystemSettingsRepoMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return { ...actual, validateAuthToken: validateAuthTokenMock };
});
vi.mock("@/actions/overview", () => ({ getOverviewData: getOverviewDataMock }));
vi.mock("@/actions/statistics", () => ({ getUserStatistics: getUserStatisticsMock }));
vi.mock("@/actions/concurrent-sessions", () => ({
  getConcurrentSessions: getConcurrentSessionsMock,
}));
vi.mock("@/actions/dashboard-realtime", () => ({
  getDashboardRealtimeData: getDashboardRealtimeDataMock,
}));
vi.mock("@/actions/provider-slots", () => ({ getProviderSlots: getProviderSlotsMock }));
vi.mock("@/actions/rate-limit-stats", () => ({ getRateLimitStats: getRateLimitStatsMock }));
vi.mock("@/actions/proxy-status", () => ({ getProxyStatus: getProxyStatusMock }));
vi.mock("@/actions/client-versions", () => ({
  fetchClientVersionStats: fetchClientVersionStatsMock,
}));
vi.mock("@/actions/dispatch-simulator", () => ({
  simulateDispatchAction: simulateDispatchActionMock,
}));
vi.mock("@/repository/system-config", () => ({
  getSystemSettings: getSystemSettingsRepoMock,
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

const overview = {
  concurrentSessions: 2,
  todayRequests: 10,
  todayCost: 1.2,
  avgResponseTime: 300,
  todayErrorRate: 0,
  yesterdaySamePeriodRequests: 8,
  yesterdaySamePeriodCost: 1,
  yesterdaySamePeriodAvgResponseTime: 280,
  recentMinuteRequests: 3,
};

describe("v1 dashboard endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getOverviewDataMock.mockResolvedValue({ ok: true, data: overview });
    getUserStatisticsMock.mockResolvedValue({
      ok: true,
      data: { timeRange: "7days", chartData: [] },
    });
    getConcurrentSessionsMock.mockResolvedValue({ ok: true, data: 2 });
    getDashboardRealtimeDataMock.mockResolvedValue({ ok: true, data: { metrics: overview } });
    getProviderSlotsMock.mockResolvedValue({ ok: true, data: [{ providerId: 1, name: "p1" }] });
    getRateLimitStatsMock.mockResolvedValue({ ok: true, data: { total_events: 1 } });
    getProxyStatusMock.mockResolvedValue({ ok: true, data: { users: [] } });
    fetchClientVersionStatsMock.mockResolvedValue({ ok: true, data: [{ client: "claude-code" }] });
    simulateDispatchActionMock.mockResolvedValue({ ok: true, data: { finalCandidateCount: 1 } });
    getSystemSettingsRepoMock.mockResolvedValue({ allowGlobalUsageView: true });
  });

  test("reads dashboard summary endpoints", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const overviewResponse = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/overview",
      headers,
    });
    expect(overviewResponse.response.status).toBe(200);
    expect(overviewResponse.json).toMatchObject({ todayRequests: 10 });

    const statistics = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/statistics?timeRange=7days",
      headers,
    });
    expect(statistics.response.status).toBe(200);
    expect(getUserStatisticsMock).toHaveBeenCalledWith("7days");

    const concurrent = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/concurrent-sessions",
      headers,
    });
    expect(concurrent.json).toEqual({ count: 2 });
  });

  test("guards global concurrent session count for non-admin callers", async () => {
    validateAuthTokenMock.mockResolvedValue(userSession);
    getSystemSettingsRepoMock.mockResolvedValueOnce({ allowGlobalUsageView: false });

    const forbidden = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/concurrent-sessions",
      headers: { Authorization: "Bearer user-token" },
    });
    expect(forbidden.response.status).toBe(403);
    expect(forbidden.json).toMatchObject({ errorCode: "dashboard.global_usage_forbidden" });
    expect(getConcurrentSessionsMock).not.toHaveBeenCalled();

    getSystemSettingsRepoMock.mockResolvedValueOnce({ allowGlobalUsageView: true });
    const allowed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/concurrent-sessions",
      headers: { Authorization: "Bearer user-token" },
    });
    expect(allowed.response.status).toBe(200);
    expect(allowed.json).toEqual({ count: 2 });
  });

  test("reads admin dashboard operational endpoints", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const realtime = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/realtime",
      headers,
    });
    expect(realtime.response.status).toBe(200);

    const slots = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/provider-slots",
      headers,
    });
    expect(slots.json).toMatchObject({ items: [{ providerId: 1 }] });

    const rateLimit = await callV1Route({
      method: "GET",
      pathname:
        "/api/v1/dashboard/rate-limit-stats?userId=1&providerId=2&keyId=3&limitType=rpm&startTime=2026-04-28T00:00:00.000Z&endTime=2026-04-30T00:00:00.000Z",
      headers,
    });
    expect(rateLimit.response.status).toBe(200);
    expect(getRateLimitStatsMock).toHaveBeenCalledWith({
      user_id: 1,
      provider_id: 2,
      key_id: 3,
      limit_type: "rpm",
      start_time: new Date("2026-04-28T00:00:00.000Z"),
      end_time: new Date("2026-04-30T00:00:00.000Z"),
    });

    const proxy = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/proxy-status",
      headers,
    });
    expect(proxy.response.status).toBe(200);

    const versions = await callV1Route({
      method: "GET",
      pathname: "/api/v1/dashboard/client-versions",
      headers,
    });
    expect(versions.json).toMatchObject({ items: [{ client: "claude-code" }] });
  });

  test("runs dispatch simulator and returns problem+json on invalid input", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const simulated = await callV1Route({
      method: "POST",
      pathname: "/api/v1/dashboard/dispatch-simulator:simulate",
      headers,
      body: { clientFormat: "claude", modelName: "sonnet", groupTags: ["default"] },
    });
    expect(simulated.response.status).toBe(200);
    expect(simulateDispatchActionMock).toHaveBeenCalledWith({
      clientFormat: "claude",
      modelName: "sonnet",
      groupTags: ["default"],
    });

    const invalid = await callV1Route({
      method: "POST",
      pathname: "/api/v1/dashboard/dispatch-simulator:simulate",
      headers,
      body: { clientFormat: "bad" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");
  });

  test("documents dashboard REST paths", async () => {
    const { json } = await callV1Route({ method: "GET", pathname: "/api/v1/openapi.json" });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/dashboard/overview");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/statistics");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/concurrent-sessions");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/realtime");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/provider-slots");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/rate-limit-stats");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/proxy-status");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/client-versions");
    expect(doc.paths).toHaveProperty("/api/v1/dashboard/dispatch-simulator:simulate");
  });
});
