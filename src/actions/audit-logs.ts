"use server";

import { getTranslations } from "next-intl/server";
import { getSession } from "@/lib/auth";
import { logger } from "@/lib/logger";
import { ERROR_CODES } from "@/lib/utils/error-messages";
import { type AuditLogCursor, getAuditLog, listAuditLogs } from "@/repository/audit-log";
import type { AuditCategory, AuditLogFilter, AuditLogRow } from "@/types/audit-log";
import type { ActionResult } from "./types";

// `satisfies` lets TypeScript check that every literal is a valid
// AuditCategory AND preserves the narrow tuple type. If a future category is
// added to `AuditCategory` without being listed here, the exhaustiveness
// check below fails compilation — see `_EXHAUSTIVE_CHECK`.
const AUDIT_CATEGORY_VALUES = [
  "auth",
  "user",
  "provider",
  "provider_group",
  "system_settings",
  "key",
  "notification",
  "sensitive_word",
  "model_price",
] as const satisfies readonly AuditCategory[];

// If a new variant is added to `AuditCategory` without also being appended
// to AUDIT_CATEGORY_VALUES, `UncoveredCategory` becomes non-never and this
// assertion fails to compile.
type UncoveredCategory = Exclude<AuditCategory, (typeof AUDIT_CATEGORY_VALUES)[number]>;
const _EXHAUSTIVE_CHECK: UncoveredCategory extends never ? true : false = true;
void _EXHAUSTIVE_CHECK;

function isAuditCategory(value: string): value is AuditCategory {
  return (AUDIT_CATEGORY_VALUES as readonly string[]).includes(value);
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
  const tAudit = await getTranslations("auditLogs");
  const tErrors = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: tErrors("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
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
    // Never expose raw error.message — a pg error could carry SQL fragments
    // or user input. Surface a stable localized string instead.
    return {
      ok: false,
      error: tAudit("errors.listFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}

/**
 * 获取审计日志详情（管理员）
 */
export async function getAuditLogDetail(id: number): Promise<ActionResult<AuditLogRow | null>> {
  const tAudit = await getTranslations("auditLogs");
  const tErrors = await getTranslations("errors");
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {
        ok: false,
        error: tErrors("PERMISSION_DENIED"),
        errorCode: ERROR_CODES.PERMISSION_DENIED,
      };
    }

    const row = await getAuditLog(id);
    return { ok: true, data: row };
  } catch (error) {
    logger.error("[AuditLogsAction] Failed to get audit log detail:", error);
    return {
      ok: false,
      error: tAudit("errors.detailFailed"),
      errorCode: ERROR_CODES.OPERATION_FAILED,
    };
  }
}
