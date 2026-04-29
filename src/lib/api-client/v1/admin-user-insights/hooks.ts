"use client";

/**
 * /api/v1/admin/users/{id}/insights TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  InsightsKeyTrendResponse,
  InsightsModelBreakdownResponse,
  InsightsOverviewResponse,
  InsightsProviderBreakdownResponse,
} from "@/lib/api/v1/schemas/admin-user-insights";
import type { ApiError } from "@/lib/api-client/v1/client";

import { adminUserInsightsClient } from "./index";
import { adminUserInsightsKeys } from "./keys";

export function useUserInsightsOverview(
  userId: number,
  params?: { startDate?: string; endDate?: string }
): UseQueryResult<InsightsOverviewResponse, ApiError | Error> {
  return useQuery<InsightsOverviewResponse, ApiError | Error>({
    queryKey: adminUserInsightsKeys.overview(userId, params?.startDate, params?.endDate),
    queryFn: () => adminUserInsightsClient.overview(userId, params),
    enabled: Number.isInteger(userId) && userId > 0,
  });
}

export function useUserInsightsKeyTrend(
  userId: number,
  timeRange: string
): UseQueryResult<InsightsKeyTrendResponse, ApiError | Error> {
  return useQuery<InsightsKeyTrendResponse, ApiError | Error>({
    queryKey: adminUserInsightsKeys.keyTrend(userId, timeRange),
    queryFn: () => adminUserInsightsClient.keyTrend(userId, timeRange),
    enabled: Number.isInteger(userId) && userId > 0 && !!timeRange,
  });
}

export function useUserInsightsModelBreakdown(
  userId: number,
  params?: { startDate?: string; endDate?: string; keyId?: number; providerId?: number }
): UseQueryResult<InsightsModelBreakdownResponse, ApiError | Error> {
  return useQuery<InsightsModelBreakdownResponse, ApiError | Error>({
    queryKey: adminUserInsightsKeys.modelBreakdown(userId, params),
    queryFn: () => adminUserInsightsClient.modelBreakdown(userId, params),
    enabled: Number.isInteger(userId) && userId > 0,
  });
}

export function useUserInsightsProviderBreakdown(
  userId: number,
  params?: { startDate?: string; endDate?: string; keyId?: number; model?: string }
): UseQueryResult<InsightsProviderBreakdownResponse, ApiError | Error> {
  return useQuery<InsightsProviderBreakdownResponse, ApiError | Error>({
    queryKey: adminUserInsightsKeys.providerBreakdown(userId, params),
    queryFn: () => adminUserInsightsClient.providerBreakdown(userId, params),
    enabled: Number.isInteger(userId) && userId > 0,
  });
}
