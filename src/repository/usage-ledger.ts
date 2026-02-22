import "server-only";

import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { usageLedger } from "@/drizzle/schema";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";

type EntityType = "user" | "key" | "provider";

function entityCondition(entityType: EntityType, entityId: number | string) {
  if (entityType === "user") {
    return eq(usageLedger.userId, entityId as number);
  } else if (entityType === "key") {
    return eq(usageLedger.key, entityId as string);
  } else {
    return eq(usageLedger.finalProviderId, entityId as number);
  }
}

/**
 * Unified cost sum for quota checks within a time range.
 */
export async function sumLedgerCostInTimeRange(
  entityType: EntityType,
  entityId: number | string,
  startTime: Date,
  endTime: Date
): Promise<string> {
  const result = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageLedger.costUsd}), '0')` })
    .from(usageLedger)
    .where(
      and(
        entityCondition(entityType, entityId),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );
  return result[0]?.total ?? "0";
}

/**
 * Total cost with optional resetAt support (for total-limit quota checks).
 * resetAt=null means all-time; a valid Date means cumulative from that point.
 */
export async function sumLedgerTotalCost(
  entityType: EntityType,
  entityId: number | string,
  resetAt?: Date | null
): Promise<string> {
  const effectiveStart =
    resetAt instanceof Date && !Number.isNaN(resetAt.getTime()) ? resetAt : null;

  const result = await db
    .select({ total: sql<string>`COALESCE(SUM(${usageLedger.costUsd}), '0')` })
    .from(usageLedger)
    .where(
      and(
        entityCondition(entityType, entityId),
        LEDGER_BILLING_CONDITION,
        ...(effectiveStart ? [gte(usageLedger.createdAt, effectiveStart)] : [])
      )
    );
  return result[0]?.total ?? "0";
}

/**
 * Batch total cost grouped by entity (single SQL query).
 * Returns Map of entityId (as string) -> totalCost.
 * @param maxAgeDays - Only include ledger rows created within this many days (default 365).
 *                     Pass Infinity or a non-positive number to include all-time records.
 */
export async function sumLedgerTotalCostBatch(
  entityType: "user" | "key",
  entityIds: number[] | string[],
  maxAgeDays: number = 365
): Promise<Map<string, string>> {
  const result = new Map<string, string>();
  if (entityIds.length === 0) return result;

  for (const id of entityIds) {
    result.set(String(id), "0");
  }

  const timeConditions: ReturnType<typeof gte>[] = [];
  if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
    const cutoffDate = new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000);
    timeConditions.push(gte(usageLedger.createdAt, cutoffDate));
  }

  if (entityType === "user") {
    const ids = entityIds as number[];
    const rows = await db
      .select({
        entityId: usageLedger.userId,
        total: sql<string>`COALESCE(SUM(${usageLedger.costUsd}), '0')`,
      })
      .from(usageLedger)
      .where(and(inArray(usageLedger.userId, ids), LEDGER_BILLING_CONDITION, ...timeConditions))
      .groupBy(usageLedger.userId);
    for (const row of rows) {
      result.set(String(row.entityId), row.total ?? "0");
    }
  } else {
    const ids = entityIds as string[];
    const rows = await db
      .select({
        entityId: usageLedger.key,
        total: sql<string>`COALESCE(SUM(${usageLedger.costUsd}), '0')`,
      })
      .from(usageLedger)
      .where(and(inArray(usageLedger.key, ids), LEDGER_BILLING_CONDITION, ...timeConditions))
      .groupBy(usageLedger.key);
    for (const row of rows) {
      result.set(row.entityId, row.total ?? "0");
    }
  }

  return result;
}

/**
 * Multi-period quota costs in a single query via conditional aggregation.
 * Returns costs in the same order as the input ranges array.
 */
export async function sumLedgerQuotaCosts(
  entityType: "user" | "key",
  entityId: number | string,
  ranges: Array<{ start: Date; end: Date }>
): Promise<string[]> {
  if (ranges.length === 0) return [];

  const caseParts = ranges.map(
    ({ start, end }, i) =>
      sql`COALESCE(SUM(CASE WHEN ${usageLedger.createdAt} >= ${start} AND ${usageLedger.createdAt} < ${end} THEN ${usageLedger.costUsd} ELSE 0 END), '0') AS ${sql.raw(`r${i}`)}`
  );

  const selectExpr = sql.join(caseParts, sql`, `);
  const entityCond = entityCondition(entityType, entityId);
  const query = sql`SELECT ${selectExpr} FROM ${usageLedger} WHERE ${and(entityCond, LEDGER_BILLING_CONDITION)}`;

  const rows = await db.execute(query);
  const row = (rows as unknown as Record<string, string>[])[0] ?? {};
  return ranges.map((_, i) => row[`r${i}`] ?? "0");
}

/**
 * Request count within a time range for rate-limit checks.
 */
export async function countLedgerRequestsInTimeRange(
  entityType: "user" | "key",
  entityId: number | string,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const result = await db
    .select({ count: sql<number>`COUNT(*)` })
    .from(usageLedger)
    .where(
      and(
        entityCondition(entityType, entityId),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );
  return Number(result[0]?.count ?? 0);
}
