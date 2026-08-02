import "server-only";

import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, users } from "@/drizzle/schema";
import { clearUserCostCache } from "@/lib/redis/cost-cache-cleanup";
import { invalidateCachedUser } from "@/lib/security/api-key-auth-cache";

const RESET_BATCH_SIZE = 1000;

export class UserStatisticsResetError extends Error {
  constructor(
    readonly code: string,
    readonly progress: {
      deletedMessageRequests: number;
      deletedUsageLedger: number;
    } = { deletedMessageRequests: 0, deletedUsageLedger: 0 }
  ) {
    super(code);
    this.name = "UserStatisticsResetError";
  }
}

function affectedRows(result: unknown): number {
  if (Array.isArray(result)) return result.length;
  if (!result || typeof result !== "object") return 0;
  const count =
    (result as { count?: unknown; rowCount?: unknown }).count ??
    (result as { rowCount?: unknown }).rowCount;
  return count === undefined ? 0 : Number(count);
}

function firstRow(result: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(result)) return result[0] as Record<string, unknown> | undefined;
  if (result && typeof result === "object" && Symbol.iterator in result) {
    return Array.from(result as Iterable<Record<string, unknown>>)[0];
  }
  return undefined;
}

async function deleteMessageRequestBatch(userId: number, cutoff: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      WITH doomed AS (
        SELECT id
        FROM message_request
        WHERE user_id = ${userId}
          AND (created_at IS NULL OR created_at <= ${cutoff})
        LIMIT ${RESET_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM message_request mr
      USING doomed
      WHERE mr.id = doomed.id
      RETURNING 1
    `);
    return affectedRows(result);
  });
}

async function deleteUsageLedgerBatch(userId: number, cutoff: Date): Promise<number> {
  return db.transaction(async (tx) => {
    const result = await tx.execute(sql`
      WITH doomed AS (
        SELECT id
        FROM usage_ledger
        WHERE user_id = ${userId}
          AND created_at <= ${cutoff}
        LIMIT ${RESET_BATCH_SIZE}
        FOR UPDATE SKIP LOCKED
      )
      DELETE FROM usage_ledger ul
      USING doomed
      WHERE ul.id = doomed.id
      RETURNING 1
    `);
    return affectedRows(result);
  });
}

async function hasRemainingRows(
  table: "message_request" | "usage_ledger",
  userId: number,
  cutoff: Date
): Promise<boolean> {
  const tableName =
    table === "message_request" ? sql.raw("message_request") : sql.raw("usage_ledger");
  const cutoffPredicate =
    table === "message_request"
      ? sql`(created_at IS NULL OR created_at <= ${cutoff})`
      : sql`created_at <= ${cutoff}`;
  const result = await db.execute(sql`
    SELECT EXISTS (
      SELECT 1 FROM ${tableName}
      WHERE user_id = ${userId}
        AND ${cutoffPredicate}
    ) AS "exists"
  `);
  return firstRow(result)?.exists === true;
}

async function drainTable(input: {
  table: "message_request" | "usage_ledger";
  userId: number;
  cutoff: Date;
}): Promise<number> {
  let deleted = 0;
  try {
    while (true) {
      const batchDeleted =
        input.table === "message_request"
          ? await deleteMessageRequestBatch(input.userId, input.cutoff)
          : await deleteUsageLedgerBatch(input.userId, input.cutoff);
      deleted += batchDeleted;
      if (batchDeleted < RESET_BATCH_SIZE) break;
    }

    if (!(await hasRemainingRows(input.table, input.userId, input.cutoff))) {
      return deleted;
    }
    throw new UserStatisticsResetError(
      "USER_STATISTICS_RESET_ROWS_LOCKED",
      input.table === "message_request"
        ? { deletedMessageRequests: deleted, deletedUsageLedger: 0 }
        : { deletedMessageRequests: 0, deletedUsageLedger: deleted }
    );
  } catch (error) {
    if (error instanceof UserStatisticsResetError) throw error;
    throw new UserStatisticsResetError(
      "USER_STATISTICS_RESET_OPERATION_FAILED",
      input.table === "message_request"
        ? { deletedMessageRequests: deleted, deletedUsageLedger: 0 }
        : { deletedMessageRequests: 0, deletedUsageLedger: deleted }
    );
  }
}

export async function executeUserStatisticsReset(input: {
  userId: number;
  requestedAt: string;
}): Promise<{ deletedMessageRequests: number; deletedUsageLedger: number }> {
  const cutoff = new Date(input.requestedAt);
  if (!Number.isFinite(cutoff.getTime())) {
    throw new UserStatisticsResetError("USER_STATISTICS_RESET_INVALID_CUTOFF");
  }

  let deletedMessageRequests = 0;
  let deletedUsageLedger = 0;
  try {
    deletedMessageRequests = await drainTable({
      table: "message_request",
      userId: input.userId,
      cutoff,
    });
    deletedUsageLedger = await drainTable({
      table: "usage_ledger",
      userId: input.userId,
      cutoff,
    });
  } catch (error) {
    if (error instanceof UserStatisticsResetError) {
      throw new UserStatisticsResetError(error.code, {
        deletedMessageRequests: deletedMessageRequests + error.progress.deletedMessageRequests,
        deletedUsageLedger: deletedUsageLedger + error.progress.deletedUsageLedger,
      });
    }
    if (deletedMessageRequests > 0 || deletedUsageLedger > 0) {
      throw new UserStatisticsResetError("USER_STATISTICS_RESET_OPERATION_FAILED", {
        deletedMessageRequests,
        deletedUsageLedger,
      });
    }
    throw error;
  }

  try {
    const userKeys = await db
      .select({ id: keys.id, key: keys.key })
      .from(keys)
      .where(and(eq(keys.userId, input.userId), isNull(keys.deletedAt)));

    await db
      .update(users)
      .set({
        costResetAt: sql`CASE WHEN ${users.costResetAt} IS NULL OR ${users.costResetAt} <= ${cutoff} THEN NULL ELSE ${users.costResetAt} END`,
        limit5hCostResetAt: sql`CASE WHEN ${users.limit5hCostResetAt} IS NULL OR ${users.limit5hCostResetAt} <= ${cutoff} THEN NULL ELSE ${users.limit5hCostResetAt} END`,
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, input.userId), isNull(users.deletedAt)));
    await invalidateCachedUser(input.userId);

    const cacheResult = await clearUserCostCache({
      userId: input.userId,
      keyIds: userKeys.map((key) => key.id),
      keyHashes: userKeys.map((key) => key.key),
      includeActiveSessions: false,
      allowWhenRateLimitDisabled: true,
    });
    if (!cacheResult || cacheResult.cleanupFailed) {
      throw new UserStatisticsResetError("USER_STATISTICS_RESET_CACHE_CLEANUP_FAILED");
    }
  } catch (error) {
    throw new UserStatisticsResetError(
      error instanceof UserStatisticsResetError
        ? error.code
        : "USER_STATISTICS_RESET_OPERATION_FAILED",
      {
        deletedMessageRequests,
        deletedUsageLedger,
      }
    );
  }

  return { deletedMessageRequests, deletedUsageLedger };
}
