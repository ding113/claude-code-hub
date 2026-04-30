import type { AuditLogRow } from "@/types/audit-log";
import { apiGet, searchParams } from "./_compat";

type AuditLogsBatchParams = {
  filter?: {
    category?: string;
    success?: boolean;
    from?: string;
    to?: string;
  };
  cursor?: string | null;
  pageSize?: number;
  limit?: number;
};

type AuditLogsPage = {
  rows: AuditLogRow[];
  nextCursor: string | null;
  hasMore: boolean;
  limit?: number;
};

export function getAuditLogsBatch(params?: AuditLogsBatchParams): Promise<AuditLogsPage> {
  return apiGet(`/api/v1/audit-logs${searchParams(toQuery(params))}`).then(toLegacyAuditPage);
}

function toLegacyAuditPage(body: unknown): AuditLogsPage {
  const page = body as {
    items?: AuditLogRow[];
    rows?: AuditLogRow[];
    pageInfo?: { nextCursor?: string | null; hasMore?: boolean; limit?: number };
    nextCursor?: string | null;
    hasMore?: boolean;
    limit?: number;
  };
  return {
    rows: page.rows ?? page.items ?? [],
    nextCursor: page.nextCursor ?? page.pageInfo?.nextCursor ?? null,
    hasMore: page.hasMore ?? page.pageInfo?.hasMore ?? false,
    limit: page.limit ?? page.pageInfo?.limit,
  };
}

function toQuery(params?: AuditLogsBatchParams): Record<string, string | number | boolean> {
  const query: Record<string, string | number | boolean> = {};
  if (!params) return query;
  if (params.cursor) query.cursor = params.cursor;
  if (params.pageSize ?? params.limit) query.limit = params.pageSize ?? params.limit ?? 50;
  if (params.filter?.category) query.category = params.filter.category;
  if (params.filter?.success !== undefined) query.success = params.filter.success;
  if (params.filter?.from) query.from = params.filter.from;
  if (params.filter?.to) query.to = params.filter.to;
  return query;
}
