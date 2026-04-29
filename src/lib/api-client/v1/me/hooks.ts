"use client";

import { useQuery } from "@tanstack/react-query";
import type { MeUsageLogsQueryInput } from "@/lib/api/v1/schemas/me";
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

export function useMeMetadata() {
  return useQuery({
    queryKey: v1Keys.me.metadata(),
    queryFn: () => apiClient.get("/api/v1/me/metadata"),
  });
}

export function useMeQuota() {
  return useQuery({
    queryKey: v1Keys.me.quota(),
    queryFn: () => apiClient.get("/api/v1/me/quota"),
  });
}

export function useMeToday() {
  return useQuery({
    queryKey: v1Keys.me.today(),
    queryFn: () => apiClient.get("/api/v1/me/today"),
  });
}

export function useMeUsageLogs(params?: MeUsageLogsQueryInput) {
  return useQuery({
    queryKey: v1Keys.me.usageLogs(params),
    queryFn: () => apiClient.get(`/api/v1/me/usage-logs${toQuery(params)}`),
  });
}

export function useMeUsageLogsFull(params?: MeUsageLogsQueryInput) {
  return useQuery({
    queryKey: v1Keys.me.usageLogsFull(params),
    queryFn: () => apiClient.get(`/api/v1/me/usage-logs/full${toQuery(params)}`),
  });
}

export function useMeUsageModels() {
  return useQuery({
    queryKey: v1Keys.me.usageModels(),
    queryFn: () => apiClient.get("/api/v1/me/usage-logs/models"),
  });
}

export function useMeUsageEndpoints() {
  return useQuery({
    queryKey: v1Keys.me.usageEndpoints(),
    queryFn: () => apiClient.get("/api/v1/me/usage-logs/endpoints"),
  });
}

export function useMeStatsSummary(params?: { startDate?: string; endDate?: string }) {
  return useQuery({
    queryKey: v1Keys.me.statsSummary(params),
    queryFn: () => apiClient.get(`/api/v1/me/usage-logs/stats-summary${toQuery(params)}`),
  });
}

export function useMeIpGeo(ip: string, lang?: string, enabled = true) {
  return useQuery({
    queryKey: v1Keys.me.ipGeo(ip, lang),
    queryFn: () => apiClient.get(`/api/v1/me/ip-geo/${encodeURIComponent(ip)}${toQuery({ lang })}`),
    enabled: enabled && ip.length > 0,
  });
}
