/**
 * /api/v1/audit-logs 类型化客户端方法
 */

import type {
  AuditLogDetailResponse,
  AuditLogsListResponse,
} from "@/lib/api/v1/schemas/audit-logs";
import { apiClient, fetchApi } from "@/lib/api-client/v1/client";

const BASE_PATH = "/api/v1/audit-logs";

export interface AuditLogsListParams {
  cursor?: string;
  limit?: number;
  category?: string;
  success?: boolean;
  from?: string;
  to?: string;
  [key: string]: string | number | boolean | undefined;
}

export interface AuditLogsClient {
  list(params?: AuditLogsListParams): Promise<AuditLogsListResponse>;
  detail(id: number): Promise<AuditLogDetailResponse>;
}

function buildQuery(params?: AuditLogsListParams): string {
  if (!params) return "";
  const search = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === "") continue;
    search.append(k, String(v));
  }
  const s = search.toString();
  return s ? `?${s}` : "";
}

async function list(params?: AuditLogsListParams): Promise<AuditLogsListResponse> {
  const response = await fetchApi(`${BASE_PATH}${buildQuery(params)}`, { method: "GET" });
  return (await response.json()) as AuditLogsListResponse;
}

async function detail(id: number): Promise<AuditLogDetailResponse> {
  const response = await fetchApi(`${BASE_PATH}/${id}`, { method: "GET" });
  return (await response.json()) as AuditLogDetailResponse;
}

export const auditLogsClient: AuditLogsClient = {
  list,
  detail,
};

Object.assign(apiClient, { auditLogs: auditLogsClient });
