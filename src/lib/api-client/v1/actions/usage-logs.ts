import type { UsageLogsExportStatus } from "@/actions/usage-logs";
import type { UsageLogSummary, UsageLogsBatchResult } from "@/repository/usage-logs";
import { apiGet, apiPost, searchParams, toActionResult, unwrapItems } from "./_compat";

export type { UsageLogsExportStatus } from "@/actions/usage-logs";

export function getUsageLogs(params?: object) {
  return toActionResult(
    apiGet(`/api/v1/usage-logs${searchParams(toQuery(params))}`).then(toLegacyUsageLogsPage)
  );
}

export function getUsageLogsBatch(params?: object) {
  return toActionResult(
    apiGet(`/api/v1/usage-logs${searchParams(toQuery(params))}`).then(toLegacyUsageLogsPage)
  );
}

export function getUsageLogsStats(params?: object) {
  return toActionResult(
    apiGet<UsageLogSummary>(`/api/v1/usage-logs/stats${searchParams(toQuery(params))}`)
  );
}

export function getFilterOptions() {
  return toActionResult(apiGet("/api/v1/usage-logs/filter-options"));
}

export function getModelList() {
  return toActionResult(
    apiGet<{ items?: string[] }>("/api/v1/usage-logs/models").then(unwrapItems)
  );
}

export function getStatusCodeList() {
  return toActionResult(
    apiGet<{ items?: number[] }>("/api/v1/usage-logs/status-codes").then(unwrapItems)
  );
}

export function getEndpointList() {
  return toActionResult(
    apiGet<{ items?: string[] }>("/api/v1/usage-logs/endpoints").then(unwrapItems)
  );
}

export function getUsageLogSessionIdSuggestions(params: object) {
  return toActionResult(
    apiGet<{ items?: string[] }>(
      `/api/v1/usage-logs/session-id-suggestions${searchParams(toQuery(params))}`
    ).then(unwrapItems)
  );
}

export function exportUsageLogs(params?: object) {
  return toActionResult(apiPost("/api/v1/usage-logs/exports", params));
}

export function startUsageLogsExport(params?: object) {
  return toActionResult(
    apiPost("/api/v1/usage-logs/exports", params, {
      headers: { Prefer: "respond-async" },
    })
  );
}

export function getUsageLogsExportStatus(jobId: string) {
  return toActionResult(
    apiGet<UsageLogsExportStatus>(`/api/v1/usage-logs/exports/${encodeURIComponent(jobId)}`)
  );
}

export function downloadUsageLogsExport(jobId: string) {
  return toActionResult(
    fetch(`/api/v1/usage-logs/exports/${encodeURIComponent(jobId)}/download`, {
      credentials: "include",
    }).then(async (response) => {
      if (!response.ok) throw new Error(response.statusText || "Export download failed");
      return response.text();
    })
  );
}

function toQuery(params?: object) {
  return Object.fromEntries(
    Object.entries(params ?? {}).flatMap(([key, value]) => {
      if (value instanceof Date) return [[key, value.toISOString()]];
      if (["string", "number", "boolean"].includes(typeof value)) return [[key, value]];
      if (key === "cursor" && value && typeof value === "object") {
        const cursor = value as { createdAt?: string; id?: string | number };
        return [
          ["cursorCreatedAt", cursor.createdAt],
          ["cursorId", cursor.id],
        ];
      }
      return [];
    })
  );
}

function toLegacyUsageLogsPage(body: unknown): UsageLogsBatchResult {
  const page = body as {
    logs?: UsageLogsBatchResult["logs"];
    items?: UsageLogsBatchResult["logs"];
    pageInfo?: {
      nextCursor?: UsageLogsBatchResult["nextCursor"];
      hasMore?: boolean;
      page?: number;
      pageSize?: number;
      total?: number;
      totalPages?: number;
    };
    nextCursor?: UsageLogsBatchResult["nextCursor"];
    hasMore?: boolean;
    total?: number;
    page?: number;
    pageSize?: number;
    totalPages?: number;
  };
  return {
    logs: page.logs ?? page.items ?? [],
    nextCursor: page.nextCursor ?? page.pageInfo?.nextCursor ?? null,
    hasMore: page.hasMore ?? page.pageInfo?.hasMore ?? false,
    ...((page.total ?? page.pageInfo?.total !== undefined)
      ? { total: page.total ?? page.pageInfo?.total }
      : {}),
    ...((page.page ?? page.pageInfo?.page !== undefined)
      ? { page: page.page ?? page.pageInfo?.page }
      : {}),
    ...((page.pageSize ?? page.pageInfo?.pageSize !== undefined)
      ? { pageSize: page.pageSize ?? page.pageInfo?.pageSize }
      : {}),
    ...((page.totalPages ?? page.pageInfo?.totalPages !== undefined)
      ? { totalPages: page.totalPages ?? page.pageInfo?.totalPages }
      : {}),
  } as UsageLogsBatchResult;
}
