"use client";

/**
 * /api/v1/audit-logs TanStack Query hooks
 */

import { type UseQueryResult, useQuery } from "@tanstack/react-query";
import type {
  AuditLogDetailResponse,
  AuditLogsListResponse,
} from "@/lib/api/v1/schemas/audit-logs";
import type { ApiError } from "@/lib/api-client/v1/client";

import { type AuditLogsListParams, auditLogsClient } from "./index";
import { auditLogsKeys } from "./keys";

export function useAuditLogsList(
  params?: AuditLogsListParams
): UseQueryResult<AuditLogsListResponse, ApiError | Error> {
  return useQuery<AuditLogsListResponse, ApiError | Error>({
    queryKey: auditLogsKeys.list(params),
    queryFn: () => auditLogsClient.list(params),
  });
}

export function useAuditLogDetail(
  id: number
): UseQueryResult<AuditLogDetailResponse, ApiError | Error> {
  return useQuery<AuditLogDetailResponse, ApiError | Error>({
    queryKey: auditLogsKeys.detail(id),
    queryFn: () => auditLogsClient.detail(id),
    enabled: Number.isInteger(id) && id > 0,
  });
}
