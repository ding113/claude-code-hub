"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  DashboardRateLimitStatsQuery,
  DashboardStatisticsQuery,
  DispatchSimulatorInput,
} from "@/lib/api/v1/schemas/dashboard";
import { apiClient } from "@/lib/api-client/v1/client";
import { v1Keys } from "@/lib/api-client/v1/keys";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

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

export function useDashboardOverview() {
  return useQuery({
    queryKey: v1Keys.dashboard.overview(),
    queryFn: () => apiClient.get("/api/v1/dashboard/overview"),
  });
}

export function useDashboardStatistics(params?: DashboardStatisticsQuery) {
  return useQuery({
    queryKey: v1Keys.dashboard.statistics(params),
    queryFn: () => apiClient.get(`/api/v1/dashboard/statistics${toQuery(params)}`),
  });
}

export function useDashboardConcurrentSessions() {
  return useQuery({
    queryKey: v1Keys.dashboard.concurrentSessions(),
    queryFn: () => apiClient.get("/api/v1/dashboard/concurrent-sessions"),
  });
}

export function useDashboardRealtime() {
  return useQuery({
    queryKey: v1Keys.dashboard.realtime(),
    queryFn: () => apiClient.get("/api/v1/dashboard/realtime"),
  });
}

export function useDashboardProviderSlots() {
  return useQuery({
    queryKey: v1Keys.dashboard.providerSlots(),
    queryFn: () => apiClient.get("/api/v1/dashboard/provider-slots"),
  });
}

export function useDashboardRateLimitStats(params?: DashboardRateLimitStatsQuery) {
  return useQuery({
    queryKey: v1Keys.dashboard.rateLimitStats(params),
    queryFn: () => apiClient.get(`/api/v1/dashboard/rate-limit-stats${toQuery(params)}`),
  });
}

export function useDashboardProxyStatus() {
  return useQuery({
    queryKey: v1Keys.dashboard.proxyStatus(),
    queryFn: () => apiClient.get("/api/v1/dashboard/proxy-status"),
  });
}

export function useDashboardClientVersions() {
  return useQuery({
    queryKey: v1Keys.dashboard.clientVersions(),
    queryFn: () => apiClient.get("/api/v1/dashboard/client-versions"),
  });
}

export function useDispatchSimulator() {
  return useApiMutation({
    mutationFn: (input: DispatchSimulatorInput) =>
      apiClient.post("/api/v1/dashboard/dispatch-simulator:simulate", input),
  });
}
