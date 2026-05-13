"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  AdminUserInsightDateQuery,
  AdminUserInsightKeyTrendQuery,
  AdminUserInsightModelBreakdownQuery,
  AdminUserInsightProviderBreakdownQuery,
} from "@/lib/api/v1/schemas/admin-user-insights";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";

function toQuery(params?: Record<string, unknown>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  return query ? `?${query}` : "";
}

export function useAdminUserInsightsOverview(userId: number, params?: AdminUserInsightDateQuery) {
  return useQuery({
    queryKey: v1Keys.adminUserInsights.overview(userId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/admin/users/${userId}/insights/overview${toQuery(params)}`),
  });
}

export function useAdminUserInsightsKeyTrend(
  userId: number,
  params?: AdminUserInsightKeyTrendQuery
) {
  return useQuery({
    queryKey: v1Keys.adminUserInsights.keyTrend(userId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/admin/users/${userId}/insights/key-trend${toQuery(params)}`),
  });
}

export function useAdminUserInsightsModelBreakdown(
  userId: number,
  params?: AdminUserInsightModelBreakdownQuery
) {
  return useQuery({
    queryKey: v1Keys.adminUserInsights.modelBreakdown(userId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/admin/users/${userId}/insights/model-breakdown${toQuery(params)}`),
  });
}

export function useAdminUserInsightsProviderBreakdown(
  userId: number,
  params?: AdminUserInsightProviderBreakdownQuery
) {
  return useQuery({
    queryKey: v1Keys.adminUserInsights.providerBreakdown(userId, params),
    queryFn: () =>
      apiClient.get(`/api/v1/admin/users/${userId}/insights/provider-breakdown${toQuery(params)}`),
  });
}
