import { and, between, gte, inArray, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { logger } from "@/lib/logger";

/**
 * 日志清理条件
 */
export interface CleanupConditions {
  // 时间范围
  beforeDate?: Date;
  afterDate?: Date;

  // 用户维度
  userIds?: number[];

  // 供应商维度
  providerIds?: number[];

  // 状态维度
  statusCodes?: number[]; // 精确匹配状态码
  statusCodeRange?: {
    // 状态码范围 (如 400-499)
    min: number;
    max: number;
  };
  onlyBlocked?: boolean; // 仅被拦截的请求
}

/**
 * 清理选项
 */
export interface CleanupOptions {
  batchSize?: number; // 批量删除大小（默认 10000）
  dryRun?: boolean; // 仅预览，不实际删除
}

/**
 * 清理结果
 */
export interface CleanupResult {
  totalDeleted: number;
  batchCount: number;
  durationMs: number;
  error?: string;
}

/**
 * 触发信息
 */
export interface TriggerInfo {
  type: "manual" | "scheduled";
  user?: string;
}

/**
 * 执行日志清理
 *
 * @param conditions 清理条件
 * @param options 清理选项
 * @param triggerInfo 触发信息
 * @returns 清理结果
 */
export async function cleanupLogs(
  conditions: CleanupConditions,
  options: CleanupOptions = {},
  triggerInfo: TriggerInfo
): Promise<CleanupResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 10000;
  let totalDeleted = 0;
  let batchCount = 0;

  try {
    // 1. 构建 WHERE 条件
    const whereConditions = buildWhereConditions(conditions);

    if (whereConditions.length === 0) {
      logger.warn({
        action: "log_cleanup_no_conditions",
        triggerType: triggerInfo.type,
      });
      return {
        totalDeleted: 0,
        batchCount: 0,
        durationMs: Date.now() - startTime,
        error: "未指定任何清理条件",
      };
    }

    if (options.dryRun) {
      // 仅统计数量
      const result = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messageRequest)
        .where(and(...whereConditions));

      logger.info({
        action: "log_cleanup_dry_run",
        estimatedCount: result[0]?.count || 0,
        conditions,
      });

      return {
        totalDeleted: result[0]?.count || 0,
        batchCount: 0,
        durationMs: Date.now() - startTime,
      };
    }

    // 2. 分批删除
    while (true) {
      const deleted = await deleteBatch(whereConditions, batchSize);

      if (deleted === 0) break;

      totalDeleted += deleted;
      batchCount++;

      logger.info({
        action: "log_cleanup_batch",
        batchNumber: batchCount,
        deletedInBatch: deleted,
        totalDeleted,
      });

      // 避免长时间锁表，短暂休息
      if (deleted === batchSize) {
        await sleep(100);
      }
    }

    const durationMs = Date.now() - startTime;

    logger.info({
      action: "log_cleanup_complete",
      totalDeleted,
      batchCount,
      durationMs,
      triggerType: triggerInfo.type,
      user: triggerInfo.user,
    });

    return { totalDeleted, batchCount, durationMs };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error({
      action: "log_cleanup_error",
      error: errorMessage,
      conditions,
      totalDeleted,
      triggerType: triggerInfo.type,
    });

    return {
      totalDeleted,
      batchCount,
      durationMs: Date.now() - startTime,
      error: errorMessage,
    };
  }
}

/**
 * 构建 WHERE 条件
 */
function buildWhereConditions(conditions: CleanupConditions): SQL[] {
  const where: SQL[] = [];

  // 排除软删除的记录（已经被软删除的不再处理）
  where.push(sql`${messageRequest.deletedAt} IS NULL`);

  // 时间范围
  if (conditions.beforeDate) {
    where.push(lte(messageRequest.createdAt, conditions.beforeDate));
  }
  if (conditions.afterDate) {
    where.push(gte(messageRequest.createdAt, conditions.afterDate));
  }

  // 用户维度
  if (conditions.userIds && conditions.userIds.length > 0) {
    where.push(inArray(messageRequest.userId, conditions.userIds));
  }

  // 供应商维度
  if (conditions.providerIds && conditions.providerIds.length > 0) {
    where.push(inArray(messageRequest.providerId, conditions.providerIds));
  }

  // 状态维度
  if (conditions.statusCodes && conditions.statusCodes.length > 0) {
    where.push(inArray(messageRequest.statusCode, conditions.statusCodes));
  }
  if (conditions.statusCodeRange) {
    where.push(
      between(
        messageRequest.statusCode,
        conditions.statusCodeRange.min,
        conditions.statusCodeRange.max
      )
    );
  }
  if (conditions.onlyBlocked) {
    where.push(isNotNull(messageRequest.blockedBy));
  }

  return where;
}

/**
 * 批量删除
 *
 * 使用 CTE (Common Table Expression) + DELETE 实现原子删除
 * 避免两步操作的竞态条件，性能更好
 */
async function deleteBatch(whereConditions: SQL[], batchSize: number): Promise<number> {
  // 使用 CTE 实现原子批量删除
  const result = await db.execute(sql`
    WITH ids_to_delete AS (
      SELECT id FROM message_request
      WHERE ${and(...whereConditions)}
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    )
    DELETE FROM message_request
    WHERE id IN (SELECT id FROM ids_to_delete)
  `);

  // Drizzle execute 返回的 result 包含 rowCount 属性
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (result as any).rowCount || 0;
}

/**
 * 休眠函数
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
