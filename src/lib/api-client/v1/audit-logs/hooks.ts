"use client";

import { useQuery } from "@tanstack/react-query";
import type { AuditLogListQuery } from "@/lib/api/v1/schemas/audit-logs";
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

export function useAuditLogs(params?: AuditLogListQuery) {
  return useQuery({
    queryKey: v1Keys.auditLogs.list(params),
    queryFn: () => apiClient.get(`/api/v1/audit-logs${toQuery(params)}`),
  });
}

export function useAuditLog(id: number, enabled = true) {
  return useQuery({
    queryKey: v1Keys.auditLogs.detail(id),
    queryFn: () => apiClient.get(`/api/v1/audit-logs/${id}`),
    enabled,
  });
}
