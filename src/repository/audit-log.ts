"use server";

import { and, desc, eq, gte, lt, lte, or, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { auditLog } from "@/drizzle/schema";
import { logger } from "@/lib/logger";
import type { AuditCategory, AuditLogFilter, AuditLogInput, AuditLogRow } from "@/types/audit-log";

function toRow(row: typeof auditLog.$inferSelect): AuditLogRow {
  return {
    id: row.id,
    actionCategory: row.actionCategory as AuditCategory,
    actionType: row.actionType,
    targetType: row.targetType,
    targetId: row.targetId,
    targetName: row.targetName,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    operatorUserId: row.operatorUserId,
    operatorUserName: row.operatorUserName,
    operatorKeyId: row.operatorKeyId,
    operatorKeyName: row.operatorKeyName,
    operatorIp: row.operatorIp,
    userAgent: row.userAgent,
    success: row.success,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt ?? new Date(0),
  };
}

async function insertAuditLog(entry: AuditLogInput): Promise<void> {
  const userAgent =
    entry.userAgent && entry.userAgent.length > 512
      ? entry.userAgent.slice(0, 512)
      : entry.userAgent;
  await db.insert(auditLog).values({
    actionCategory: entry.actionCategory,
    actionType: entry.actionType,
    targetType: entry.targetType ?? null,
    targetId: entry.targetId ?? null,
    targetName: entry.targetName ?? null,
    beforeValue: entry.beforeValue ?? null,
    afterValue: entry.afterValue ?? null,
    operatorUserId: entry.operatorUserId ?? null,
    operatorUserName: entry.operatorUserName ?? null,
    operatorKeyId: entry.operatorKeyId ?? null,
    operatorKeyName: entry.operatorKeyName ?? null,
    operatorIp: entry.operatorIp ?? null,
    userAgent: userAgent ?? null,
    success: entry.success,
    errorMessage: entry.errorMessage ?? null,
  });
}

/**
 * Fire-and-forget audit log insert.
 *
 * Audit writes must never block the hot path (login, mutation actions), so
 * errors are caught and logged but not propagated. If the audit write fails
 * (DB down, table missing on fresh install, etc.) the original request
 * succeeds without blocking. Returned promise resolves once the insert
 * completes (or fails silently) — callers should `void` the result, not await.
 *
 * Declared `async` (rather than plain sync fire-and-forget) so this file
 * satisfies Next.js's "use server" constraint that every export is async.
 */
export async function createAuditLogAsync(entry: AuditLogInput): Promise<void> {
  try {
    await insertAuditLog(entry);
  } catch (error) {
    logger.warn("[AuditLog] failed to persist audit entry", {
      category: entry.actionCategory,
      action: entry.actionType,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export interface AuditLogCursor {
  createdAt: string; // ISO
  id: number;
}

export interface ListAuditLogsOptions {
  filter?: AuditLogFilter;
  cursor?: AuditLogCursor | null;
  pageSize?: number;
}

export async function listAuditLogs(
  options: ListAuditLogsOptions = {}
): Promise<{ rows: AuditLogRow[]; nextCursor: AuditLogCursor | null }> {
  const pageSize = Math.min(Math.max(options.pageSize ?? 50, 1), 500);
  const filter = options.filter ?? {};

  const conditions = [];

  if (filter.category) conditions.push(eq(auditLog.actionCategory, filter.category));
  if (filter.actionType) conditions.push(eq(auditLog.actionType, filter.actionType));
  if (filter.operatorUserId !== undefined) {
    conditions.push(eq(auditLog.operatorUserId, filter.operatorUserId));
  }
  if (filter.operatorIp) conditions.push(eq(auditLog.operatorIp, filter.operatorIp));
  if (filter.targetType) conditions.push(eq(auditLog.targetType, filter.targetType));
  if (filter.targetId) conditions.push(eq(auditLog.targetId, filter.targetId));
  if (filter.success !== undefined) conditions.push(eq(auditLog.success, filter.success));
  if (filter.from) conditions.push(gte(auditLog.createdAt, filter.from));
  if (filter.to) conditions.push(lte(auditLog.createdAt, filter.to));

  if (options.cursor) {
    const cursorCreatedAt = new Date(options.cursor.createdAt);
    conditions.push(
      or(
        lt(auditLog.createdAt, cursorCreatedAt),
        and(eq(auditLog.createdAt, cursorCreatedAt), lt(auditLog.id, options.cursor.id))
      )!
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select()
    .from(auditLog)
    .where(where)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(pageSize + 1);

  const hasMore = rows.length > pageSize;
  const trimmed = hasMore ? rows.slice(0, pageSize) : rows;
  const nextCursor: AuditLogCursor | null =
    hasMore && trimmed.length > 0
      ? {
          createdAt: trimmed[trimmed.length - 1].createdAt!.toISOString(),
          id: trimmed[trimmed.length - 1].id,
        }
      : null;

  return { rows: trimmed.map(toRow), nextCursor };
}

export async function getAuditLog(id: number): Promise<AuditLogRow | null> {
  const [row] = await db.select().from(auditLog).where(eq(auditLog.id, id)).limit(1);
  return row ? toRow(row) : null;
}

export async function countAuditLogs(filter: AuditLogFilter = {}): Promise<number> {
  const conditions = [];
  if (filter.category) conditions.push(eq(auditLog.actionCategory, filter.category));
  if (filter.success !== undefined) conditions.push(eq(auditLog.success, filter.success));
  if (filter.from) conditions.push(gte(auditLog.createdAt, filter.from));
  if (filter.to) conditions.push(lte(auditLog.createdAt, filter.to));

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const [row] = await db.select({ count: sql<number>`count(*)::int` }).from(auditLog).where(where);
  return row?.count ?? 0;
}
