/**
 * /api/v1/admin/users/{id}/insights 类型化客户端方法
 */

import type {
  InsightsKeyTrendResponse,
  InsightsModelBreakdownResponse,
  InsightsOverviewResponse,
  InsightsProviderBreakdownResponse,
} from "@/lib/api/v1/schemas/admin-user-insights";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/admin/users";

export interface AdminUserInsightsClient {
  overview(
    userId: number,
    params?: { startDate?: string; endDate?: string }
  ): Promise<InsightsOverviewResponse>;
  keyTrend(userId: number, timeRange: string): Promise<InsightsKeyTrendResponse>;
  modelBreakdown(
    userId: number,
    params?: { startDate?: string; endDate?: string; keyId?: number; providerId?: number }
  ): Promise<InsightsModelBreakdownResponse>;
  providerBreakdown(
    userId: number,
    params?: { startDate?: string; endDate?: string; keyId?: number; model?: string }
  ): Promise<InsightsProviderBreakdownResponse>;
}

function buildQuery(params?: Record<string, string | number | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function overview(
  userId: number,
  params?: { startDate?: string; endDate?: string }
): Promise<InsightsOverviewResponse> {
  const response = await fetchApi(`${BASE_PATH}/${userId}/insights/overview${buildQuery(params)}`, {
    method: "GET",
  });
  return (await response.json()) as InsightsOverviewResponse;
}

async function keyTrend(userId: number, timeRange: string): Promise<InsightsKeyTrendResponse> {
  const response = await fetchApi(
    `${BASE_PATH}/${userId}/insights/key-trend?timeRange=${encodeURIComponent(timeRange)}`,
    { method: "GET" }
  );
  return (await response.json()) as InsightsKeyTrendResponse;
}

async function modelBreakdown(
  userId: number,
  params?: { startDate?: string; endDate?: string; keyId?: number; providerId?: number }
): Promise<InsightsModelBreakdownResponse> {
  const response = await fetchApi(
    `${BASE_PATH}/${userId}/insights/model-breakdown${buildQuery(params)}`,
    { method: "GET" }
  );
  return (await response.json()) as InsightsModelBreakdownResponse;
}

async function providerBreakdown(
  userId: number,
  params?: { startDate?: string; endDate?: string; keyId?: number; model?: string }
): Promise<InsightsProviderBreakdownResponse> {
  const response = await fetchApi(
    `${BASE_PATH}/${userId}/insights/provider-breakdown${buildQuery(params)}`,
    { method: "GET" }
  );
  return (await response.json()) as InsightsProviderBreakdownResponse;
}

export const adminUserInsightsClient: AdminUserInsightsClient = {
  overview,
  keyTrend,
  modelBreakdown,
  providerBreakdown,
};

Object.assign(apiClient, { adminUserInsights: adminUserInsightsClient });
