/**
 * /api/v1/me 类型化客户端方法
 */

import type { z } from "@hono/zod-openapi";
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
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

type MyMetadataResponse = z.infer<typeof MyMetadataResponseSchema>;
type MyQuotaResponse = z.infer<typeof MyQuotaResponseSchema>;
type MyTodayStatsResponse = z.infer<typeof MyTodayStatsResponseSchema>;
type MyUsageLogsListResponse = z.infer<typeof MyUsageLogsListResponseSchema>;
type MyUsageLogsFullResponse = z.infer<typeof MyUsageLogsFullResponseSchema>;
type MyUsageLogsModelsResponse = z.infer<typeof MyUsageLogsModelsResponseSchema>;
type MyUsageLogsEndpointsResponse = z.infer<typeof MyUsageLogsEndpointsResponseSchema>;
type MyStatsSummaryResponse = z.infer<typeof MyStatsSummaryResponseSchema>;
type MyIpGeoResponse = z.infer<typeof MyIpGeoResponseSchema>;

const BASE_PATH = "/api/v1/me";

export interface MyUsageLogsParams {
  cursor?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface MyStatsSummaryParams {
  startDate?: string;
  endDate?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface MeClient {
  metadata(): Promise<MyMetadataResponse>;
  quota(): Promise<MyQuotaResponse>;
  today(): Promise<MyTodayStatsResponse>;
  usageLogs(params?: MyUsageLogsParams): Promise<MyUsageLogsListResponse>;
  usageLogsFull(
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<MyUsageLogsFullResponse>;
  models(): Promise<MyUsageLogsModelsResponse>;
  endpoints(): Promise<MyUsageLogsEndpointsResponse>;
  statsSummary(params?: MyStatsSummaryParams): Promise<MyStatsSummaryResponse>;
  ipGeo(ip: string, lang?: string): Promise<MyIpGeoResponse>;
}

function buildQuery(params?: Record<string, string | number | boolean | undefined>): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function metadata(): Promise<MyMetadataResponse> {
  const r = await fetchApi(`${BASE_PATH}/metadata`, { method: "GET" });
  return (await r.json()) as MyMetadataResponse;
}

async function quota(): Promise<MyQuotaResponse> {
  const r = await fetchApi(`${BASE_PATH}/quota`, { method: "GET" });
  return (await r.json()) as MyQuotaResponse;
}

async function today(): Promise<MyTodayStatsResponse> {
  const r = await fetchApi(`${BASE_PATH}/today`, { method: "GET" });
  return (await r.json()) as MyTodayStatsResponse;
}

async function usageLogs(params?: MyUsageLogsParams): Promise<MyUsageLogsListResponse> {
  const r = await fetchApi(`${BASE_PATH}/usage-logs${buildQuery(params)}`, { method: "GET" });
  return (await r.json()) as MyUsageLogsListResponse;
}

async function usageLogsFull(
  params?: Record<string, string | number | boolean | undefined>
): Promise<MyUsageLogsFullResponse> {
  const r = await fetchApi(`${BASE_PATH}/usage-logs/full${buildQuery(params)}`, {
    method: "GET",
  });
  return (await r.json()) as MyUsageLogsFullResponse;
}

async function models(): Promise<MyUsageLogsModelsResponse> {
  const r = await fetchApi(`${BASE_PATH}/usage-logs/models`, { method: "GET" });
  return (await r.json()) as MyUsageLogsModelsResponse;
}

async function endpoints(): Promise<MyUsageLogsEndpointsResponse> {
  const r = await fetchApi(`${BASE_PATH}/usage-logs/endpoints`, { method: "GET" });
  return (await r.json()) as MyUsageLogsEndpointsResponse;
}

async function statsSummary(params?: MyStatsSummaryParams): Promise<MyStatsSummaryResponse> {
  const r = await fetchApi(`${BASE_PATH}/usage-logs/stats-summary${buildQuery(params)}`, {
    method: "GET",
  });
  return (await r.json()) as MyStatsSummaryResponse;
}

async function ipGeo(ip: string, lang?: string): Promise<MyIpGeoResponse> {
  const query = lang ? `?lang=${encodeURIComponent(lang)}` : "";
  const r = await fetchApi(`${BASE_PATH}/ip-geo/${encodeURIComponent(ip)}${query}`, {
    method: "GET",
  });
  return (await r.json()) as MyIpGeoResponse;
}

export const meClient: MeClient = {
  metadata,
  quota,
  today,
  usageLogs,
  usageLogsFull,
  models,
  endpoints,
  statsSummary,
  ipGeo,
};

Object.assign(apiClient, { me: meClient });
