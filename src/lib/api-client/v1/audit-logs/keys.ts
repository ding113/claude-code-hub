/**
 * /api/v1/audit-logs 客户端查询键
 */

import { v1Keys } from "@/lib/api-client/v1/keys";

export const auditLogsKeys = {
  all: [...v1Keys.all, "audit-logs"] as const,
  list: (params?: Record<string, unknown>) => [...auditLogsKeys.all, "list", params ?? {}] as const,
  detail: (id: number) => [...auditLogsKeys.all, "detail", id] as const,
};

export type AuditLogsQueryKey = ReturnType<
  (typeof auditLogsKeys)[Exclude<keyof typeof auditLogsKeys, "all">]
>;
