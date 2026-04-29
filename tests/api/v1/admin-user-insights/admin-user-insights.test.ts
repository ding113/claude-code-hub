import type { AuthSession } from "@/lib/auth";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getUserInsightsOverviewMock = vi.hoisted(() => vi.fn());
const getUserInsightsKeyTrendMock = vi.hoisted(() => vi.fn());
const getUserInsightsModelBreakdownMock = vi.hoisted(() => vi.fn());
const getUserInsightsProviderBreakdownMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/admin-user-insights", () => ({
  getUserInsightsOverview: getUserInsightsOverviewMock,
  getUserInsightsKeyTrend: getUserInsightsKeyTrendMock,
  getUserInsightsModelBreakdown: getUserInsightsModelBreakdownMock,
  getUserInsightsProviderBreakdown: getUserInsightsProviderBreakdownMock,
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

describe("v1 admin user insights endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getUserInsightsOverviewMock.mockResolvedValue({
      ok: true,
      data: {
        user: {
          id: 10,
          name: "Ada",
          role: "user",
          description: "analyst",
          providerGroup: "default",
          tags: ["team-a"],
          isEnabled: true,
          createdAt: new Date("2026-04-28T00:00:00.000Z"),
          updatedAt: new Date("2026-04-28T00:00:00.000Z"),
        },
        overview: { requestCount: 12, totalCost: 1.25, avgResponseTime: 240, errorRate: 1.5 },
        currencyCode: "USD",
      },
    });
    getUserInsightsKeyTrendMock.mockResolvedValue({
      ok: true,
      data: [
        {
          key_id: 2,
          key_name: "prod",
          date: "2026-04-28T00:00:00.000Z",
          api_calls: 5,
          total_cost: "0.50",
        },
      ],
    });
    getUserInsightsModelBreakdownMock.mockResolvedValue({
      ok: true,
      data: {
        breakdown: [
          {
            model: "claude-sonnet-4-5",
            requests: 3,
            cost: 0.3,
            inputTokens: 100,
            outputTokens: 50,
            cacheCreationTokens: 10,
            cacheReadTokens: 20,
          },
        ],
        currencyCode: "USD",
      },
    });
    getUserInsightsProviderBreakdownMock.mockResolvedValue({
      ok: true,
      data: {
        breakdown: [
          {
            providerId: 7,
            providerName: "primary",
            requests: 4,
            cost: 0.4,
            inputTokens: 120,
            outputTokens: 60,
            cacheCreationTokens: 12,
            cacheReadTokens: 24,
          },
        ],
        currencyCode: "USD",
      },
    });
  });

  test("reads admin user insight endpoints with REST query parameters", async () => {
    const headers = { Authorization: "Bearer admin-token" };
    const overview = await callV1Route({
      method: "GET",
      pathname: "/api/v1/admin/users/10/insights/overview?startDate=2026-04-01&endDate=2026-04-28",
      headers,
    });
    expect(overview.response.status).toBe(200);
    expect(overview.json).toMatchObject({
      user: { id: 10, name: "Ada", createdAt: "2026-04-28T00:00:00.000Z" },
      overview: { requestCount: 12, totalCost: 1.25 },
      currencyCode: "USD",
    });
    expect(getUserInsightsOverviewMock).toHaveBeenCalledWith(10, "2026-04-01", "2026-04-28");

    const keyTrend = await callV1Route({
      method: "GET",
      pathname: "/api/v1/admin/users/10/insights/key-trend?timeRange=7days",
      headers,
    });
    expect(keyTrend.response.status).toBe(200);
    expect(keyTrend.json).toMatchObject({ items: [{ key_id: 2, key_name: "prod" }] });
    expect(getUserInsightsKeyTrendMock).toHaveBeenCalledWith(10, "7days");

    const modelBreakdown = await callV1Route({
      method: "GET",
      pathname:
        "/api/v1/admin/users/10/insights/model-breakdown?startDate=2026-04-01&endDate=2026-04-28&keyId=2&providerId=7",
      headers,
    });
    expect(modelBreakdown.response.status).toBe(200);
    expect(getUserInsightsModelBreakdownMock).toHaveBeenCalledWith(10, "2026-04-01", "2026-04-28", {
      keyId: 2,
      providerId: 7,
    });

    const providerBreakdown = await callV1Route({
      method: "GET",
      pathname: "/api/v1/admin/users/10/insights/provider-breakdown?keyId=2&model=sonnet",
      headers,
    });
    expect(providerBreakdown.response.status).toBe(200);
    expect(getUserInsightsProviderBreakdownMock).toHaveBeenCalledWith(10, undefined, undefined, {
      keyId: 2,
      model: "sonnet",
    });
  });

  test("returns problem+json for invalid requests and not-found action failures", async () => {
    const invalid = await callV1Route({
      method: "GET",
      pathname: "/api/v1/admin/users/10/insights/key-trend?timeRange=bad-range",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(invalid.response.status).toBe(400);
    expect(invalid.response.headers.get("content-type")).toContain("application/problem+json");

    getUserInsightsOverviewMock.mockResolvedValueOnce({
      ok: false,
      error: "User not found",
    });
    const missing = await callV1Route({
      method: "GET",
      pathname: "/api/v1/admin/users/404/insights/overview",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(missing.response.status).toBe(404);
    expect(missing.json).toMatchObject({ errorCode: "admin_user_insights.not_found" });
  });

  test("documents admin user insight REST paths", async () => {
    const { json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/openapi.json",
    });
    const doc = json as { paths: Record<string, unknown> };

    expect(doc.paths).toHaveProperty("/api/v1/admin/users/{userId}/insights/overview");
    expect(doc.paths).toHaveProperty("/api/v1/admin/users/{userId}/insights/key-trend");
    expect(doc.paths).toHaveProperty("/api/v1/admin/users/{userId}/insights/model-breakdown");
    expect(doc.paths).toHaveProperty("/api/v1/admin/users/{userId}/insights/provider-breakdown");
  });
});
