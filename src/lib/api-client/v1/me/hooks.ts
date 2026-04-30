"use client";

/**
 * /api/v1/me TanStack Query hooks
 */

import type { z } from "@hono/zod-openapi";
import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  MyIpGeoResponseSchema,
  MyMetadataResponseSchema,
  MyQuotaResponseSchema,
  MyStatsSummaryResponseSchema,
  MyTodayStatsResponseSchema,
  MyUsageLogsEndpointsResponseSchema,
  MyUsageLogsFullResponseSchema,
  MyUsageLogsListResponseSchema,
  MyUsageLogsModelsResponseSchema,
} from "@/lib/api/v1/schemas/me";
import type { ApiError } from "@/lib/api-client/v1/client";

import { type MyStatsSummaryParams, type MyUsageLogsParams, meClient } from "./index";
import { meKeys } from "./keys";

type MyMetadataResponse = z.infer<typeof MyMetadataResponseSchema>;
type MyQuotaResponse = z.infer<typeof MyQuotaResponseSchema>;
type MyTodayStatsResponse = z.infer<typeof MyTodayStatsResponseSchema>;
type MyUsageLogsListResponse = z.infer<typeof MyUsageLogsListResponseSchema>;
type MyUsageLogsFullResponse = z.infer<typeof MyUsageLogsFullResponseSchema>;
type MyUsageLogsModelsResponse = z.infer<typeof MyUsageLogsModelsResponseSchema>;
type MyUsageLogsEndpointsResponse = z.infer<typeof MyUsageLogsEndpointsResponseSchema>;
type MyStatsSummaryResponse = z.infer<typeof MyStatsSummaryResponseSchema>;
type MyIpGeoResponse = z.infer<typeof MyIpGeoResponseSchema>;

export function useMyMetadata(): UseQueryResult<MyMetadataResponse, ApiError | Error> {
  return useQuery<MyMetadataResponse, ApiError | Error>({
    queryKey: meKeys.metadata(),
    queryFn: () => meClient.metadata(),
  });
}

export function useMyQuota(): UseQueryResult<MyQuotaResponse, ApiError | Error> {
  return useQuery<MyQuotaResponse, ApiError | Error>({
    queryKey: meKeys.quota(),
    queryFn: () => meClient.quota(),
  });
}

export function useMyTodayStats(): UseQueryResult<MyTodayStatsResponse, ApiError | Error> {
  return useQuery<MyTodayStatsResponse, ApiError | Error>({
    queryKey: meKeys.today(),
    queryFn: () => meClient.today(),
  });
}

export function useMyUsageLogs(
  params?: MyUsageLogsParams
): UseQueryResult<MyUsageLogsListResponse, ApiError | Error> {
  return useQuery<MyUsageLogsListResponse, ApiError | Error>({
    queryKey: meKeys.usageLogs(params),
    queryFn: () => meClient.usageLogs(params),
  });
}

export function useMyUsageLogsFull(
  params?: Record<string, string | number | boolean | undefined>
): UseQueryResult<MyUsageLogsFullResponse, ApiError | Error> {
  return useQuery<MyUsageLogsFullResponse, ApiError | Error>({
    queryKey: meKeys.usageLogsFull(params),
    queryFn: () => meClient.usageLogsFull(params),
  });
}

export function useMyUsageLogsModels(): UseQueryResult<
  MyUsageLogsModelsResponse,
  ApiError | Error
> {
  return useQuery<MyUsageLogsModelsResponse, ApiError | Error>({
    queryKey: meKeys.models(),
    queryFn: () => meClient.models(),
  });
}

export function useMyUsageLogsEndpoints(): UseQueryResult<
  MyUsageLogsEndpointsResponse,
  ApiError | Error
> {
  return useQuery<MyUsageLogsEndpointsResponse, ApiError | Error>({
    queryKey: meKeys.endpoints(),
    queryFn: () => meClient.endpoints(),
  });
}

export function useMyUsageLogsStatsSummary(
  params?: MyStatsSummaryParams
): UseQueryResult<MyStatsSummaryResponse, ApiError | Error> {
  return useQuery<MyStatsSummaryResponse, ApiError | Error>({
    queryKey: meKeys.statsSummary(params),
    queryFn: () => meClient.statsSummary(params),
  });
}

export function useMyIpGeo(
  ip: string,
  lang?: string
): UseQueryResult<MyIpGeoResponse, ApiError | Error> {
  return useQuery<MyIpGeoResponse, ApiError | Error>({
    queryKey: meKeys.ipGeo(ip, lang),
    queryFn: () => meClient.ipGeo(ip, lang),
    enabled: typeof ip === "string" && ip.length > 0,
  });
}
