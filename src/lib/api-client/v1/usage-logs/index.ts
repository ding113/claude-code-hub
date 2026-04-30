/**
 * /api/v1/usage-logs 类型化客户端方法
 */

import type {
  UsageLogsExportAcceptedResponse,
  UsageLogsExportRequest,
  UsageLogsExportStatusResponse,
  UsageLogsFilterOptionsResponse,
  UsageLogsListResponse,
  UsageLogsSessionIdSuggestionsResponse,
  UsageLogsStatsResponse,
} from "@/lib/api/v1/schemas/usage-logs";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/usage-logs";

export interface UsageLogsListParams {
  cursor?: string;
  limit?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface SessionIdSuggestionsParams {
  q?: string;
  userId?: number;
  keyId?: number;
  providerId?: number;
  [key: string]: string | number | boolean | undefined;
}

export interface UsageLogsClient {
  list(params?: UsageLogsListParams): Promise<UsageLogsListResponse>;
  stats(
    params?: Record<string, string | number | boolean | undefined>
  ): Promise<UsageLogsStatsResponse>;
  filterOptions(): Promise<UsageLogsFilterOptionsResponse>;
  sessionIdSuggestions(
    params?: SessionIdSuggestionsParams
  ): Promise<UsageLogsSessionIdSuggestionsResponse>;
  startExport(
    body: UsageLogsExportRequest,
    options?: { async?: boolean }
  ): Promise<UsageLogsExportAcceptedResponse | string>;
  exportStatus(jobId: string): Promise<UsageLogsExportStatusResponse>;
  downloadExport(jobId: string): Promise<string>;
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

async function list(params?: UsageLogsListParams): Promise<UsageLogsListResponse> {
  const response = await fetchApi(`${BASE_PATH}${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as UsageLogsListResponse;
}

async function stats(
  params?: Record<string, string | number | boolean | undefined>
): Promise<UsageLogsStatsResponse> {
  const response = await fetchApi(`${BASE_PATH}/stats${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as UsageLogsStatsResponse;
}

async function filterOptions(): Promise<UsageLogsFilterOptionsResponse> {
  const response = await fetchApi(`${BASE_PATH}/filter-options`, { method: "GET" });
  return (await response.json()) as UsageLogsFilterOptionsResponse;
}

async function sessionIdSuggestions(
  params?: SessionIdSuggestionsParams
): Promise<UsageLogsSessionIdSuggestionsResponse> {
  const response = await fetchApi(`${BASE_PATH}/session-id-suggestions${buildQuery(params)}`, {
    method: "GET",
  });
  return (await response.json()) as UsageLogsSessionIdSuggestionsResponse;
}

async function startExport(
  body: UsageLogsExportRequest,
  options?: { async?: boolean }
): Promise<UsageLogsExportAcceptedResponse | string> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (options?.async) {
    headers.Prefer = "respond-async";
  }
  const response = await fetchApi(`${BASE_PATH}/exports`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
  if (options?.async) {
    return (await response.json()) as UsageLogsExportAcceptedResponse;
  }
  return await response.text();
}

async function exportStatus(jobId: string): Promise<UsageLogsExportStatusResponse> {
  const response = await fetchApi(`${BASE_PATH}/exports/${encodeURIComponent(jobId)}`, {
    method: "GET",
  });
  return (await response.json()) as UsageLogsExportStatusResponse;
}

async function downloadExport(jobId: string): Promise<string> {
  const response = await fetchApi(`${BASE_PATH}/exports/${encodeURIComponent(jobId)}/download`, {
    method: "GET",
  });
  return await response.text();
}

export const usageLogsClient: UsageLogsClient = {
  list,
  stats,
  filterOptions,
  sessionIdSuggestions,
  startExport,
  exportStatus,
  downloadExport,
};

Object.assign(apiClient, { usageLogs: usageLogsClient });
