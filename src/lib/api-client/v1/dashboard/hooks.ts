"use client";

/**
 * /api/v1/dashboard TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  DashboardClientVersionsResponseSchema,
  DashboardConcurrentSessionsResponseSchema,
  DashboardOverviewResponseSchema,
  DashboardProviderSlotsResponseSchema,
  DashboardProxyStatusResponseSchema,
  DashboardRateLimitStatsResponseSchema,
  DashboardRealtimeResponseSchema,
  DashboardStatisticsResponseSchema,
  DispatchSimulatorRequestSchema,
  DispatchSimulatorResponseSchema,
} from "@/lib/api/v1/schemas/dashboard";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import { dashboardClient } from "./index";
import { dashboardKeys } from "./keys";

type DashboardOverviewResponse = z.infer<typeof DashboardOverviewResponseSchema>;
type DashboardRealtimeResponse = z.infer<typeof DashboardRealtimeResponseSchema>;
type DashboardStatisticsResponse = z.infer<typeof DashboardStatisticsResponseSchema>;
type DashboardConcurrentSessionsResponse = z.infer<
  typeof DashboardConcurrentSessionsResponseSchema
>;
type DashboardProviderSlotsResponse = z.infer<typeof DashboardProviderSlotsResponseSchema>;
type DashboardRateLimitStatsResponse = z.infer<typeof DashboardRateLimitStatsResponseSchema>;
type DashboardClientVersionsResponse = z.infer<typeof DashboardClientVersionsResponseSchema>;
type DashboardProxyStatusResponse = z.infer<typeof DashboardProxyStatusResponseSchema>;
type DispatchSimulatorRequest = z.infer<typeof DispatchSimulatorRequestSchema>;
type DispatchSimulatorResponse = z.infer<typeof DispatchSimulatorResponseSchema>;

// ==================== 查询 ====================

export function useDashboardOverview(): UseQueryResult<
  DashboardOverviewResponse,
  ApiError | Error
> {
  return useQuery<DashboardOverviewResponse, ApiError | Error>({
    queryKey: dashboardKeys.overview(),
    queryFn: () => dashboardClient.overview(),
  });
}

export function useDashboardRealtime(): UseQueryResult<
  DashboardRealtimeResponse,
  ApiError | Error
> {
  return useQuery<DashboardRealtimeResponse, ApiError | Error>({
    queryKey: dashboardKeys.realtime(),
    queryFn: () => dashboardClient.realtime(),
  });
}

export function useDashboardStatistics(
  timeRange?: string
): UseQueryResult<DashboardStatisticsResponse, ApiError | Error> {
  return useQuery<DashboardStatisticsResponse, ApiError | Error>({
    queryKey: dashboardKeys.statistics(timeRange),
    queryFn: () => dashboardClient.statistics(timeRange),
  });
}

export function useConcurrentSessions(): UseQueryResult<
  DashboardConcurrentSessionsResponse,
  ApiError | Error
> {
  return useQuery<DashboardConcurrentSessionsResponse, ApiError | Error>({
    queryKey: dashboardKeys.concurrentSessions(),
    queryFn: () => dashboardClient.concurrentSessions(),
  });
}

export function useProviderSlots(): UseQueryResult<
  DashboardProviderSlotsResponse,
  ApiError | Error
> {
  return useQuery<DashboardProviderSlotsResponse, ApiError | Error>({
    queryKey: dashboardKeys.providerSlots(),
    queryFn: () => dashboardClient.providerSlots(),
  });
}

export function useRateLimitStats(): UseQueryResult<
  DashboardRateLimitStatsResponse,
  ApiError | Error
> {
  return useQuery<DashboardRateLimitStatsResponse, ApiError | Error>({
    queryKey: dashboardKeys.rateLimitStats(),
    queryFn: () => dashboardClient.rateLimitStats(),
  });
}

export function useClientVersions(): UseQueryResult<
  DashboardClientVersionsResponse,
  ApiError | Error
> {
  return useQuery<DashboardClientVersionsResponse, ApiError | Error>({
    queryKey: dashboardKeys.clientVersions(),
    queryFn: () => dashboardClient.clientVersions(),
  });
}

export function useProxyStatus(): UseQueryResult<DashboardProxyStatusResponse, ApiError | Error> {
  return useQuery<DashboardProxyStatusResponse, ApiError | Error>({
    queryKey: dashboardKeys.proxyStatus(),
    queryFn: () => dashboardClient.proxyStatus(),
  });
}

// ==================== 变更 ====================

export function useDispatchSimulatorDecisionTree() {
  return useApiMutation<DispatchSimulatorRequest, DispatchSimulatorResponse>({
    mutationFn: (input) => dashboardClient.dispatchSimulatorDecisionTree(input),
    invalidates: [],
  });
}

export function useDispatchSimulatorSimulate() {
  return useApiMutation<DispatchSimulatorRequest, DispatchSimulatorResponse>({
    mutationFn: (input) => dashboardClient.dispatchSimulatorSimulate(input),
    invalidates: [],
  });
}
