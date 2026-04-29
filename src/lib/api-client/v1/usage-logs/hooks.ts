"use client";

/**
 * /api/v1/usage-logs TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  UsageLogsExportAcceptedResponse,
  UsageLogsExportRequest,
  UsageLogsExportStatusResponse,
  UsageLogsFilterOptionsResponse,
  UsageLogsListResponse,
  UsageLogsSessionIdSuggestionsResponse,
  UsageLogsStatsResponse,
} from "@/lib/api/v1/schemas/usage-logs";
import type { ApiError } from "@/lib/api-client/v1/client";
import { useApiMutation } from "@/lib/hooks/use-api-mutation";

import {
  type SessionIdSuggestionsParams,
  type UsageLogsListParams,
  usageLogsClient,
} from "./index";
import { usageLogsKeys } from "./keys";

// ==================== 查询 ====================

export function useUsageLogsList(
  params?: UsageLogsListParams
): UseQueryResult<UsageLogsListResponse, ApiError | Error> {
  return useQuery<UsageLogsListResponse, ApiError | Error>({
    queryKey: usageLogsKeys.list(params),
    queryFn: () => usageLogsClient.list(params),
  });
}

export function useUsageLogsStats(
  params?: Record<string, string | number | boolean | undefined>
): UseQueryResult<UsageLogsStatsResponse, ApiError | Error> {
  return useQuery<UsageLogsStatsResponse, ApiError | Error>({
    queryKey: usageLogsKeys.stats(params),
    queryFn: () => usageLogsClient.stats(params),
  });
}

export function useUsageLogsFilterOptions(): UseQueryResult<
  UsageLogsFilterOptionsResponse,
  ApiError | Error
> {
  return useQuery<UsageLogsFilterOptionsResponse, ApiError | Error>({
    queryKey: usageLogsKeys.filterOptions(),
    queryFn: () => usageLogsClient.filterOptions(),
  });
}

export function useSessionIdSuggestions(
  params?: SessionIdSuggestionsParams
): UseQueryResult<UsageLogsSessionIdSuggestionsResponse, ApiError | Error> {
  return useQuery<UsageLogsSessionIdSuggestionsResponse, ApiError | Error>({
    queryKey: usageLogsKeys.sessionIdSuggestions(params),
    queryFn: () => usageLogsClient.sessionIdSuggestions(params),
  });
}

export function useUsageLogsExportStatus(
  jobId: string | undefined
): UseQueryResult<UsageLogsExportStatusResponse, ApiError | Error> {
  return useQuery<UsageLogsExportStatusResponse, ApiError | Error>({
    queryKey: usageLogsKeys.exportStatus(jobId ?? ""),
    queryFn: () => usageLogsClient.exportStatus(jobId as string),
    enabled: typeof jobId === "string" && jobId.length > 0,
  });
}

// ==================== 变更 ====================

export interface StartExportInput {
  body: UsageLogsExportRequest;
  async?: boolean;
}

export function useStartUsageLogsExport() {
  return useApiMutation<StartExportInput, UsageLogsExportAcceptedResponse | string>({
    mutationFn: (input) => usageLogsClient.startExport(input.body, { async: input.async ?? false }),
    invalidates: [usageLogsKeys.all],
  });
}

export function useDownloadUsageLogsExport() {
  return useApiMutation<string, string>({
    mutationFn: (jobId) => usageLogsClient.downloadExport(jobId),
    invalidates: [],
  });
}
