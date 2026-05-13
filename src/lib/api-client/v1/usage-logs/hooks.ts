"use client";

import { useQuery } from "@tanstack/react-query";
import type {
  UsageLogsExportCreateInput,
  UsageLogsQueryInput,
} from "@/lib/api/v1/schemas/usage-logs";
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

export function useUsageLogs(params?: UsageLogsQueryInput) {
  return useQuery({
    queryKey: v1Keys.usageLogs.list(params),
    queryFn: () => apiClient.get(`/api/v1/usage-logs${toQuery(params)}`),
  });
}

export function useUsageLogStats(params?: UsageLogsQueryInput) {
  return useQuery({
    queryKey: v1Keys.usageLogs.stats(params),
    queryFn: () => apiClient.get(`/api/v1/usage-logs/stats${toQuery(params)}`),
  });
}

export function useUsageLogFilterOptions() {
  return useQuery({
    queryKey: v1Keys.usageLogs.filterOptions(),
    queryFn: () => apiClient.get("/api/v1/usage-logs/filter-options"),
  });
}

export function useUsageLogSessionSuggestions(params?: Record<string, unknown>) {
  return useQuery({
    queryKey: v1Keys.usageLogs.sessionSuggestions(params),
    queryFn: () => apiClient.get(`/api/v1/usage-logs/session-id-suggestions${toQuery(params)}`),
  });
}

export function useCreateUsageLogsExport(preferAsync = true) {
  return useApiMutation({
    mutationFn: (input: UsageLogsExportCreateInput) =>
      apiClient.post("/api/v1/usage-logs/exports", input, {
        headers: preferAsync ? { Prefer: "respond-async" } : undefined,
      }),
  });
}

export function useUsageLogsExportStatus(jobId: string, enabled = true) {
  return useQuery({
    queryKey: v1Keys.usageLogs.exportStatus(jobId),
    queryFn: () => apiClient.get(`/api/v1/usage-logs/exports/${jobId}`),
    enabled: enabled && jobId.length > 0,
  });
}
