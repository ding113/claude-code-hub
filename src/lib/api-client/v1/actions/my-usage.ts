import type {
  MyStatsSummary,
  MyTodayStats,
  MyUsageLogsBatchResult,
  MyUsageMetadata,
  MyUsageQuota,
} from "@/actions/my-usage";
import type { UsageLogsBatchResult } from "@/repository/usage-logs";
import { apiGet, searchParams, toActionResult, unwrapItems } from "./_compat";

export type {
  MyStatsSummary,
  MyTodayStats,
  MyUsageLogEntry,
  MyUsageLogsBatchResult,
  MyUsageMetadata,
  MyUsageQuota,
} from "@/actions/my-usage";

export function getMyUsageMetadata() {
  return toActionResult(apiGet<MyUsageMetadata>("/api/v1/me/metadata"));
}

export function getMyQuota() {
  return toActionResult(apiGet<MyUsageQuota>("/api/v1/me/quota"));
}

export function getMyTodayStats() {
  return toActionResult(apiGet<MyTodayStats>("/api/v1/me/today"));
}

export function getMyUsageLogs(params?: object) {
  return toActionResult(
    apiGet(`/api/v1/me/usage-logs${searchParams(toQuery(params))}`).then(toLegacyMyUsageLogsPage)
  );
}

export function getMyUsageLogsBatch(params?: object) {
  return toActionResult(
    apiGet(`/api/v1/me/usage-logs${searchParams(toQuery(params))}`).then(toLegacyMyUsageLogsPage)
  );
}

export function getMyUsageLogsBatchFull(params?: object) {
  return toActionResult(
    apiGet<UsageLogsBatchResult>(`/api/v1/me/usage-logs/full${searchParams(toQuery(params))}`)
  );
}

export function getMyAvailableModels() {
  return toActionResult(
    apiGet<{ items?: string[] }>("/api/v1/me/usage-logs/models").then(unwrapItems)
  );
}

export function getMyAvailableEndpoints() {
  return toActionResult(
    apiGet<{ items?: string[] }>("/api/v1/me/usage-logs/endpoints").then(unwrapItems)
  );
}

export function getMyIpGeoDetails(params: { ip: string; lang?: string }) {
  return toActionResult(
    apiGet(
      `/api/v1/me/ip-geo/${encodeURIComponent(params.ip)}${searchParams({ lang: params.lang })}`
    )
  );
}

export function getMyStatsSummary(
  startDateOrFilters: string | { startDate?: string; endDate?: string },
  endDate?: string
) {
  const startDate =
    typeof startDateOrFilters === "string" ? startDateOrFilters : startDateOrFilters.startDate;
  const resolvedEndDate =
    typeof startDateOrFilters === "string" ? endDate : startDateOrFilters.endDate;
  return toActionResult(
    apiGet<MyStatsSummary>(
      `/api/v1/me/usage-logs/stats-summary${searchParams({
        startDate,
        endDate: resolvedEndDate,
      })}`
    )
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

function toLegacyMyUsageLogsPage(body: unknown): MyUsageLogsBatchResult {
  const page = body as {
    logs?: MyUsageLogsBatchResult["logs"];
    items?: MyUsageLogsBatchResult["logs"];
    pageInfo?: {
      nextCursor?: MyUsageLogsBatchResult["nextCursor"];
      hasMore?: boolean;
      page?: number;
      pageSize?: number;
      total?: number;
      totalPages?: number;
    };
    nextCursor?: MyUsageLogsBatchResult["nextCursor"];
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
  } as MyUsageLogsBatchResult;
}
