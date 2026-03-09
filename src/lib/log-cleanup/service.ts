import { and, between, gte, inArray, isNotNull, lte, type SQL, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { logger } from "@/lib/logger";

/**
 * Log cleanup conditions
 */
export interface CleanupConditions {
  // Time range
  beforeDate?: Date;
  afterDate?: Date;

  // User dimension
  userIds?: number[];

  // Provider dimension
  providerIds?: number[];

  // Status dimension
  statusCodes?: number[];
  statusCodeRange?: {
    min: number;
    max: number;
  };
  onlyBlocked?: boolean;
}

/**
 * Cleanup options
 */
export interface CleanupOptions {
  batchSize?: number;
  dryRun?: boolean;
}

/**
 * Cleanup result
 */
export interface CleanupResult {
  totalDeleted: number;
  batchCount: number;
  durationMs: number;
  softDeletedPurged: number;
  vacuumPerformed: boolean;
  error?: string;
}

/**
 * Trigger info
 */
export interface TriggerInfo {
  type: "manual" | "scheduled";
  user?: string;
}

// NOTE: usage_ledger is intentionally immune to log cleanup.
// Only message_request rows are deleted here.
export async function cleanupLogs(
  conditions: CleanupConditions,
  options: CleanupOptions = {},
  triggerInfo: TriggerInfo
): Promise<CleanupResult> {
  const startTime = Date.now();
  const batchSize = options.batchSize || 10000;
  let totalDeleted = 0;
  let batchCount = 0;
  let softDeletedPurged = 0;
  let vacuumPerformed = false;

  try {
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
        softDeletedPurged: 0,
        vacuumPerformed: false,
        error: "No cleanup conditions specified",
      };
    }

    if (options.dryRun) {
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
        softDeletedPurged: 0,
        vacuumPerformed: false,
      };
    }

    // Main delete loop
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

      if (deleted === batchSize) {
        await sleep(100);
      }
    }

    // Purge soft-deleted records as fallback
    softDeletedPurged = await purgeSoftDeleted(batchSize);

    // VACUUM ANALYZE to reclaim disk space
    if (totalDeleted > 0 || softDeletedPurged > 0) {
      vacuumPerformed = await runVacuum();
    }

    const durationMs = Date.now() - startTime;

    logger.info({
      action: "log_cleanup_complete",
      totalDeleted,
      batchCount,
      softDeletedPurged,
      vacuumPerformed,
      durationMs,
      triggerType: triggerInfo.type,
      user: triggerInfo.user,
    });

    return { totalDeleted, batchCount, durationMs, softDeletedPurged, vacuumPerformed };
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
      softDeletedPurged,
      vacuumPerformed,
      error: errorMessage,
    };
  }
}

/**
 * Build WHERE conditions for cleanup query.
 * No deletedAt filter: cleanup should delete ALL matching records
 * regardless of soft-delete status to actually reclaim space.
 */
export function buildWhereConditions(conditions: CleanupConditions): SQL[] {
  const where: SQL[] = [];

  if (conditions.beforeDate) {
    where.push(lte(messageRequest.createdAt, conditions.beforeDate));
  }
  if (conditions.afterDate) {
    where.push(gte(messageRequest.createdAt, conditions.afterDate));
  }

  if (conditions.userIds && conditions.userIds.length > 0) {
    where.push(inArray(messageRequest.userId, conditions.userIds));
  }

  if (conditions.providerIds && conditions.providerIds.length > 0) {
    where.push(inArray(messageRequest.providerId, conditions.providerIds));
  }

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
 * Batch delete with CTE + RETURNING 1 for driver-agnostic row counting.
 * Uses FOR UPDATE SKIP LOCKED to prevent deadlocks with concurrent jobs.
 */
async function deleteBatch(whereConditions: SQL[], batchSize: number): Promise<number> {
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
    RETURNING 1
  `);

  return getAffectedRows(result);
}

/**
 * Purge all soft-deleted records (deleted_at IS NOT NULL) in batches.
 * Runs as fallback after main cleanup to ensure soft-deleted rows
 * are also physically removed.
 */
async function purgeSoftDeleted(batchSize: number): Promise<number> {
  let totalPurged = 0;

  while (true) {
    const result = await db.execute(sql`
      WITH ids_to_delete AS (
        SELECT id FROM message_request
        WHERE deleted_at IS NOT NULL
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM message_request
      WHERE id IN (SELECT id FROM ids_to_delete)
      RETURNING 1
    `);

    const deleted = getAffectedRows(result);
    if (deleted === 0) break;

    totalPurged += deleted;

    logger.info({
      action: "log_cleanup_soft_delete_purge",
      deletedInBatch: deleted,
      totalPurged,
    });

    if (deleted === batchSize) {
      await sleep(100);
    }
  }

  return totalPurged;
}

/**
 * Run VACUUM ANALYZE to reclaim disk space after deletions.
 * Failure is non-fatal: logged but does not fail the cleanup result.
 */
async function runVacuum(): Promise<boolean> {
  try {
    await db.execute(sql`VACUUM ANALYZE message_request`);
    logger.info({ action: "log_cleanup_vacuum_complete" });
    return true;
  } catch (error) {
    logger.warn({
      action: "log_cleanup_vacuum_failed",
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Extract affected row count from db.execute() result.
 *
 * Priority:
 * 1. Array with length > 0 (RETURNING rows) -> result.length
 * 2. result.count (postgres.js, may be BigInt)
 * 3. result.rowCount (node-postgres)
 * 4. 0
 */
export function getAffectedRows(result: unknown): number {
  if (!result || typeof result !== "object") {
    return 0;
  }

  // RETURNING rows: postgres.js returns array of rows
  if (Array.isArray(result) && result.length > 0) {
    return result.length;
  }

  const r = result as { count?: unknown; rowCount?: unknown; length?: unknown };

  // postgres.js count (may be BigInt)
  if (r.count !== undefined) {
    return Number(r.count);
  }

  // node-postgres rowCount
  if (typeof r.rowCount === "number") {
    return r.rowCount;
  }

  return 0;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
