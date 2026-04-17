"use server";

import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { type AuditLogCursor, getAuditLog, listAuditLogs } from "@/repository/audit-log";
import type { AuditCategory, AuditLogFilter, AuditLogRow } from "@/types/audit-log";
import type { ActionResult } from "./types";

const AUDIT_CATEGORY_VALUES: AuditCategory[] = [
  "auth",
  "user",
  "provider",
  "provider_group",
  "system_settings",
  "key",
  "notification",
  "sensitive_word",
  "model_price",
];

function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORY_VALUES as string[]).includes(value);
}

export interface GetAuditLogsBatchInput {
  filter?: {
    category?: string;
    success?: boolean;
    from?: string;
    to?: string;
  };
  cursor?: AuditLogCursor | null;
  pageSize?: number;
}

export interface GetAuditLogsBatchResult {
  rows: AuditLogRow[];
  nextCursor: AuditLogCursor | null;
}

/**
 * 分页获取审计日志（管理员）
 */
export async function getAuditLogsBatch(
  input: GetAuditLogsBatchInput = {}
): Promise<ActionResult<GetAuditLogsBatchResult>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "权限不足" };
    }

    const filter: AuditLogFilter = {};
    if (input.filter?.category && isAuditCategory(input.filter.category)) {
      filter.category = input.filter.category;
    }
    if (input.filter?.success !== undefined) {
      filter.success = input.filter.success;
    }
    if (input.filter?.from) {
      const from = new Date(input.filter.from);
      if (!Number.isNaN(from.getTime())) {
        filter.from = from;
      }
    }
    if (input.filter?.to) {
      const to = new Date(input.filter.to);
      if (!Number.isNaN(to.getTime())) {
        filter.to = to;
      }
    }

    const result = await listAuditLogs({
      filter,
      cursor: input.cursor ?? null,
      pageSize: input.pageSize,
    });

    return { ok: true, data: result };
  } catch (error) {
    logger.error("[AuditLogsAction] Failed to list audit logs:", error);
    const message = error instanceof Error ? error.message : "获取审计日志失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取审计日志详情（管理员）
 */
export async function getAuditLogDetail(id: number): Promise<ActionResult<AuditLogRow | null>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "权限不足" };
    }

    const row = await getAuditLog(id);
    return { ok: true, data: row };
  } catch (error) {
    logger.error("[AuditLogsAction] Failed to get audit log detail:", error);
    const message = error instanceof Error ? error.message : "获取审计日志详情失败";
    return { ok: false, error: message };
  }
}
