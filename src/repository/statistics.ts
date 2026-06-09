import "server-only";

import type { SQL } from "drizzle-orm";
import { and, asc, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, providers, usageLedger } from "@/drizzle/schema";
import { TTLMap } from "@/lib/cache/ttl-map";
import { resolveSystemTimezone } from "@/lib/utils/timezone";
import type {
  DatabaseKey,
  DatabaseKeyStatRow,
  DatabaseStatRow,
  DatabaseUser,
  RateLimitEventFilters,
  RateLimitEventStats,
  RateLimitType,
  TimeRange,
} from "@/types/statistics";
import { LEDGER_BILLING_CONDITION } from "./_shared/ledger-conditions";
import { EXCLUDE_WARMUP_CONDITION } from "./_shared/message-request-conditions";

/**
 * Key ID -> key string cache
 *
 * Short TTL allows slight staleness (keys rarely change).
 * Size-bounded to avoid unbounded growth in multi-tenant scenarios.
 */
const keyStringByIdCache = new TTLMap<number, string>({ ttlMs: 5 * 60 * 1000, maxSize: 1000 });

async function getKeyStringByIdCached(keyId: number): Promise<string | null> {
  const cached = keyStringByIdCache.get(keyId);
  if (cached !== undefined) return cached;

  const keyRecord = await db
    .select({ key: keys.key })
    .from(keys)
    .where(eq(keys.id, keyId))
    .limit(1);

  const keyString = keyRecord?.[0]?.key ?? null;
  if (!keyString) return null;

  keyStringByIdCache.set(keyId, keyString);
  return keyString;
}

type SqlTimeRangeConfig = {
  startTs: ReturnType<typeof sql>;
  endTs: ReturnType<typeof sql>;
  bucketExpr: ReturnType<typeof sql>;
  bucketSeriesQuery: ReturnType<typeof sql>;
};

type TimeBucketValue = Date | string | null;

type UserBucketStatsRow = {
  user_id: number;
  user_name: string;
  bucket: TimeBucketValue;
  api_calls: number | string | null;
  total_cost: string | number | null;
};

type KeyBucketStatsRow = {
  key_id: number;
  key_name: string;
  bucket: TimeBucketValue;
  api_calls: number | string | null;
  total_cost: string | number | null;
};

type MixedOthersBucketStatsRow = {
  bucket: TimeBucketValue;
  api_calls: number | string | null;
  total_cost: string | number | null;
};

type RuntimeDatabaseStatRow = Omit<DatabaseStatRow, "date"> & { date: Date };
type RuntimeDatabaseKeyStatRow = Omit<DatabaseKeyStatRow, "date"> & { date: Date };

function getTimeRangeSqlConfig(timeRange: TimeRange, timezone: string): SqlTimeRangeConfig {
  switch (timeRange) {
    case "today":
      return {
        startTs: sql`(DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) AT TIME ZONE ${timezone})`,
        endTs: sql`((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone})`,
        bucketExpr: sql`DATE_TRUNC('hour', usage_ledger.created_at AT TIME ZONE ${timezone})`,
        bucketSeriesQuery: sql`
          SELECT generate_series(
            DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}),
            DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '23 hours',
            '1 hour'::interval
          ) AS bucket
        `,
      };
    case "7days":
      return {
        startTs: sql`((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) - INTERVAL '6 days') AT TIME ZONE ${timezone})`,
        endTs: sql`((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone})`,
        bucketExpr: sql`DATE_TRUNC('day', usage_ledger.created_at AT TIME ZONE ${timezone})`,
        bucketSeriesQuery: sql`
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          ) AS bucket
        `,
      };
    case "30days":
      return {
        startTs: sql`((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) - INTERVAL '29 days') AT TIME ZONE ${timezone})`,
        endTs: sql`((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone})`,
        bucketExpr: sql`DATE_TRUNC('day', usage_ledger.created_at AT TIME ZONE ${timezone})`,
        bucketSeriesQuery: sql`
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '29 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          ) AS bucket
        `,
      };
    case "thisMonth":
      return {
        startTs: sql`((DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})) AT TIME ZONE ${timezone})`,
        endTs: sql`((DATE_TRUNC('day', CURRENT_TIMESTAMP AT TIME ZONE ${timezone}) + INTERVAL '1 day') AT TIME ZONE ${timezone})`,
        bucketExpr: sql`DATE_TRUNC('day', usage_ledger.created_at AT TIME ZONE ${timezone})`,
        bucketSeriesQuery: sql`
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          ) AS bucket
        `,
      };
    default:
      throw new Error(`Unsupported time range: ${timeRange}`);
  }
}

function normalizeBucketDate(value: TimeBucketValue): Date | null {
  if (!value) return null;
  const parsed = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeApiCalls(value: number | string | null): number {
  const normalized = Number(value ?? 0);
  return Number.isFinite(normalized) ? normalized : 0;
}

function normalizeTotalCost(value: string | number | null): string | number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  return value;
}

async function getTimeBuckets(timeRange: TimeRange, timezone: string): Promise<Date[]> {
  const { bucketSeriesQuery } = getTimeRangeSqlConfig(timeRange, timezone);
  const result = await db.execute(bucketSeriesQuery);
  return (Array.from(result) as Array<{ bucket: TimeBucketValue }>)
    .map((row) => normalizeBucketDate(row.bucket))
    .filter((bucket): bucket is Date => bucket !== null)
    .sort((a, b) => a.getTime() - b.getTime());
}

function zeroFillUserStats(
  dbRows: UserBucketStatsRow[],
  allUsers: Array<{ id: number; name: string }>,
  buckets: Date[]
): RuntimeDatabaseStatRow[] {
  const rowMap = new Map<string, { api_calls: number; total_cost: string | number }>();
  for (const row of dbRows) {
    const bucket = normalizeBucketDate(row.bucket);
    if (!bucket) continue;

    rowMap.set(`${row.user_id}:${bucket.getTime()}`, {
      api_calls: normalizeApiCalls(row.api_calls),
      total_cost: normalizeTotalCost(row.total_cost),
    });
  }

  const sortedUsers = [...allUsers].sort((a, b) => a.name.localeCompare(b.name));
  const filledRows: RuntimeDatabaseStatRow[] = [];

  for (const bucket of buckets) {
    const bucketTime = bucket.getTime();
    for (const user of sortedUsers) {
      const row = rowMap.get(`${user.id}:${bucketTime}`);
      filledRows.push({
        user_id: user.id,
        user_name: user.name,
        date: new Date(bucketTime),
        api_calls: row?.api_calls ?? 0,
        total_cost: row?.total_cost ?? 0,
      });
    }
  }

  return filledRows;
}

function zeroFillKeyStats(
  dbRows: KeyBucketStatsRow[],
  allKeys: Array<{ id: number; name: string }>,
  buckets: Date[]
): RuntimeDatabaseKeyStatRow[] {
  const rowMap = new Map<string, { api_calls: number; total_cost: string | number }>();
  for (const row of dbRows) {
    const bucket = normalizeBucketDate(row.bucket);
    if (!bucket) continue;

    rowMap.set(`${row.key_id}:${bucket.getTime()}`, {
      api_calls: normalizeApiCalls(row.api_calls),
      total_cost: normalizeTotalCost(row.total_cost),
    });
  }

  const sortedKeys = [...allKeys].sort((a, b) => a.name.localeCompare(b.name));
  const filledRows: RuntimeDatabaseKeyStatRow[] = [];

  for (const bucket of buckets) {
    const bucketTime = bucket.getTime();
    for (const key of sortedKeys) {
      const row = rowMap.get(`${key.id}:${bucketTime}`);
      filledRows.push({
        key_id: key.id,
        key_name: key.name,
        date: new Date(bucketTime),
        api_calls: row?.api_calls ?? 0,
        total_cost: row?.total_cost ?? 0,
      });
    }
  }

  return filledRows;
}

function zeroFillMixedOthersStats(
  dbRows: MixedOthersBucketStatsRow[],
  buckets: Date[]
): RuntimeDatabaseStatRow[] {
  const rowMap = new Map<number, { api_calls: number; total_cost: string | number }>();
  for (const row of dbRows) {
    const bucket = normalizeBucketDate(row.bucket);
    if (!bucket) continue;

    rowMap.set(bucket.getTime(), {
      api_calls: normalizeApiCalls(row.api_calls),
      total_cost: normalizeTotalCost(row.total_cost),
    });
  }

  return buckets.map((bucket) => {
    const row = rowMap.get(bucket.getTime());
    return {
      user_id: -1,
      user_name: "__others__",
      date: new Date(bucket.getTime()),
      api_calls: row?.api_calls ?? 0,
      total_cost: row?.total_cost ?? 0,
    };
  });
}

/**
 * 根据时间范围获取用户消费和API调用统计
 */
export async function getUserStatisticsFromDB(timeRange: TimeRange): Promise<DatabaseStatRow[]> {
  const timezone = await resolveSystemTimezone();
  const { startTs, endTs, bucketExpr } = getTimeRangeSqlConfig(timeRange, timezone);

  const statsQuery = sql`
    SELECT
      u.id AS user_id,
      u.name AS user_name,
      ${bucketExpr} AS bucket,
      COUNT(usage_ledger.id) AS api_calls,
      COALESCE(SUM(usage_ledger.cost_usd), 0) AS total_cost
    FROM users u
    LEFT JOIN usage_ledger ON u.id = usage_ledger.user_id
      AND usage_ledger.created_at >= ${startTs}
      AND usage_ledger.created_at < ${endTs}
      AND ${LEDGER_BILLING_CONDITION}
    WHERE u.deleted_at IS NULL
    GROUP BY u.id, u.name, bucket
    ORDER BY bucket ASC, u.name ASC
  `;

  const [users, buckets, statsResult] = await Promise.all([
    getActiveUsersFromDB(),
    getTimeBuckets(timeRange, timezone),
    db.execute(statsQuery),
  ]);

  const rows = Array.from(statsResult) as UserBucketStatsRow[];
  return zeroFillUserStats(rows, users, buckets) as unknown as DatabaseStatRow[];
}

/**
 * 获取所有活跃用户列表
 */
export async function getActiveUsersFromDB(): Promise<DatabaseUser[]> {
  const query = sql`
    SELECT id, name
    FROM users
    WHERE deleted_at IS NULL
    ORDER BY name ASC
  `;

  const result = await db.execute(query);
  return Array.from(result) as unknown as DatabaseUser[];
}

/**
 * 获取指定用户的密钥使用统计
 */
export async function getKeyStatisticsFromDB(
  userId: number,
  timeRange: TimeRange
): Promise<DatabaseKeyStatRow[]> {
  const timezone = await resolveSystemTimezone();
  const { startTs, endTs, bucketExpr } = getTimeRangeSqlConfig(timeRange, timezone);

  const statsQuery = sql`
    SELECT
      k.id AS key_id,
      k.name AS key_name,
      ${bucketExpr} AS bucket,
      COUNT(usage_ledger.id) AS api_calls,
      COALESCE(SUM(usage_ledger.cost_usd), 0) AS total_cost
    FROM keys k
    LEFT JOIN usage_ledger ON usage_ledger.key = k.key
      AND usage_ledger.user_id = ${userId}
      AND usage_ledger.created_at >= ${startTs}
      AND usage_ledger.created_at < ${endTs}
      AND ${LEDGER_BILLING_CONDITION}
    WHERE k.user_id = ${userId}
      AND k.deleted_at IS NULL
    GROUP BY k.id, k.name, bucket
    ORDER BY bucket ASC, k.name ASC
  `;

  const [activeKeys, buckets, statsResult] = await Promise.all([
    getActiveKeysForUserFromDB(userId),
    getTimeBuckets(timeRange, timezone),
    db.execute(statsQuery),
  ]);

  const rows = Array.from(statsResult) as KeyBucketStatsRow[];
  return zeroFillKeyStats(rows, activeKeys, buckets) as unknown as DatabaseKeyStatRow[];
}

/**
 * 获取指定用户的有效密钥列表
 */
export async function getActiveKeysForUserFromDB(userId: number): Promise<DatabaseKey[]> {
  const query = sql`
    SELECT id, name
    FROM keys
    WHERE user_id = ${userId}
      AND deleted_at IS NULL
    ORDER BY name ASC
  `;

  const result = await db.execute(query);
  return Array.from(result) as unknown as DatabaseKey[];
}

/**
 * 获取混合统计数据：当前用户的密钥明细 + 其他用户的汇总
 * 用于非 admin 用户在 allowGlobalUsageView=true 时的数据展示
 */
export async function getMixedStatisticsFromDB(
  userId: number,
  timeRange: TimeRange
): Promise<{
  ownKeys: DatabaseKeyStatRow[];
  othersAggregate: DatabaseStatRow[];
}> {
  const timezone = await resolveSystemTimezone();
  const { startTs, endTs, bucketExpr } = getTimeRangeSqlConfig(timeRange, timezone);

  const ownKeysQuery = sql`
    SELECT
      k.id AS key_id,
      k.name AS key_name,
      ${bucketExpr} AS bucket,
      COUNT(usage_ledger.id) AS api_calls,
      COALESCE(SUM(usage_ledger.cost_usd), 0) AS total_cost
    FROM keys k
    LEFT JOIN usage_ledger ON usage_ledger.key = k.key
      AND usage_ledger.user_id = ${userId}
      AND usage_ledger.created_at >= ${startTs}
      AND usage_ledger.created_at < ${endTs}
      AND ${LEDGER_BILLING_CONDITION}
    WHERE k.user_id = ${userId}
      AND k.deleted_at IS NULL
    GROUP BY k.id, k.name, bucket
    ORDER BY bucket ASC, k.name ASC
  `;

  const othersQuery = sql`
    SELECT
      ${bucketExpr} AS bucket,
      COUNT(usage_ledger.id) AS api_calls,
      COALESCE(SUM(usage_ledger.cost_usd), 0) AS total_cost
    FROM usage_ledger
    WHERE usage_ledger.user_id <> ${userId}
      AND usage_ledger.created_at >= ${startTs}
      AND usage_ledger.created_at < ${endTs}
      AND ${LEDGER_BILLING_CONDITION}
    GROUP BY bucket
    ORDER BY bucket ASC
  `;

  const [activeKeys, buckets, ownKeysResult, othersResult] = await Promise.all([
    getActiveKeysForUserFromDB(userId),
    getTimeBuckets(timeRange, timezone),
    db.execute(ownKeysQuery),
    db.execute(othersQuery),
  ]);

  return {
    ownKeys: zeroFillKeyStats(
      Array.from(ownKeysResult) as KeyBucketStatsRow[],
      activeKeys,
      buckets
    ) as unknown as DatabaseKeyStatRow[],
    othersAggregate: zeroFillMixedOthersStats(
      Array.from(othersResult) as MixedOthersBucketStatsRow[],
      buckets
    ) as unknown as DatabaseStatRow[],
  };
}

/**
 * 查询用户今日总消费（所有 Key 的消费总和）
 * 用于用户层每日限额检查（Redis 降级）
 *
 * DEPRECATED: 该函数使用简单的日期比较，不考虑用户的 dailyResetTime 配置。
 * 请使用 sumUserCostInTimeRange() 配合 getTimeRangeForPeriodWithMode() 来获取正确的时间范围。
 *
 * @deprecated 使用 sumUserCostInTimeRange() 替代
 */
export async function sumUserCostToday(userId: number): Promise<number> {
  const timezone = await resolveSystemTimezone();

  const query = sql`
    SELECT COALESCE(SUM(usage_ledger.cost_usd), 0) AS total_cost
    FROM usage_ledger
    WHERE usage_ledger.user_id = ${userId}
      AND (usage_ledger.created_at AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date
      AND ${LEDGER_BILLING_CONDITION}
  `;

  const result = await db.execute(query);
  const row = Array.from(result)[0] as { total_cost?: string | number } | undefined;
  return Number(row?.total_cost || 0);
}

/**
 * Query Key total cost (with optional time boundary)
 * @param keyHash - API Key hash
 * @param maxAgeDays - Max query days (default 365). Use Infinity for all-time.
 */
export async function sumKeyTotalCost(
  keyHash: string,
  maxAgeDays: number = 365,
  resetAt?: Date | null,
  // group-rate-limit (§6.1): limit-check callers pass true to count only the key's
  // global-counted spend. Default false -> byte-identical to mainline (display/alerts).
  countedInGlobalOnly = false
): Promise<number> {
  const conditions = [eq(usageLedger.key, keyHash), LEDGER_BILLING_CONDITION];
  if (countedInGlobalOnly) conditions.push(eq(usageLedger.countedInKeyGlobal, true));

  // Use the more recent of resetAt and maxAgeDays cutoff
  const maxAgeCutoff =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;
  let cutoff = maxAgeCutoff;
  if (resetAt instanceof Date && !Number.isNaN(resetAt.getTime())) {
    cutoff = maxAgeCutoff && maxAgeCutoff > resetAt ? maxAgeCutoff : resetAt;
  }
  if (cutoff) {
    conditions.push(gte(usageLedger.createdAt, cutoff));
  }

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(and(...conditions));

  return Number(result[0]?.total || 0);
}

/**
 * Query user total cost across all keys (with optional time boundary)
 * @param userId - User ID
 * @param maxAgeDays - Max query days (default 365). Use Infinity for all-time.
 */
export async function sumUserTotalCost(
  userId: number,
  maxAgeDays: number = 365,
  resetAt?: Date | null,
  // group-rate-limit (§6.1): limit-check callers pass true to count only the user's
  // global-counted spend. Default false -> byte-identical to mainline (display/alerts).
  countedInGlobalOnly = false
): Promise<number> {
  const conditions = [eq(usageLedger.userId, userId), LEDGER_BILLING_CONDITION];
  if (countedInGlobalOnly) conditions.push(eq(usageLedger.countedInUserGlobal, true));

  // Use the more recent of resetAt and maxAgeDays cutoff
  const maxAgeCutoff =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;
  let cutoff = maxAgeCutoff;
  if (resetAt instanceof Date && !Number.isNaN(resetAt.getTime())) {
    cutoff = maxAgeCutoff && maxAgeCutoff > resetAt ? maxAgeCutoff : resetAt;
  }
  if (cutoff) {
    conditions.push(gte(usageLedger.createdAt, cutoff));
  }

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(and(...conditions));

  return Number(result[0]?.total || 0);
}

/**
 * group-rate-limit (§5.3 / §10): total-cost split variants (see CostGlobalSplit). Mirror
 * sumUser/KeyTotalCost cutoff handling but additionally compute the global-counted sum in
 * the same query, so the all-time quota card can show "counted-in-global / model-group-only".
 */
function resolveTotalCostCutoff(maxAgeDays: number, resetAt?: Date | null): Date | null {
  const maxAgeCutoff =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;
  let cutoff = maxAgeCutoff;
  if (resetAt instanceof Date && !Number.isNaN(resetAt.getTime())) {
    cutoff = maxAgeCutoff && maxAgeCutoff > resetAt ? maxAgeCutoff : resetAt;
  }
  return cutoff;
}

export async function sumUserTotalCostSplit(
  userId: number,
  maxAgeDays: number = 365,
  resetAt?: Date | null
): Promise<CostGlobalSplit> {
  const conditions = [eq(usageLedger.userId, userId), LEDGER_BILLING_CONDITION];
  const cutoff = resolveTotalCostCutoff(maxAgeDays, resetAt);
  if (cutoff) conditions.push(gte(usageLedger.createdAt, cutoff));

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      counted: sql<number>`COALESCE(SUM(CASE WHEN ${usageLedger.countedInUserGlobal} THEN ${usageLedger.costUsd} ELSE 0 END), 0)`,
    })
    .from(usageLedger)
    .where(and(...conditions));

  return {
    total: Number(result[0]?.total || 0),
    countedInGlobal: Number(result[0]?.counted || 0),
  };
}

export async function sumKeyTotalCostSplit(
  keyHash: string,
  maxAgeDays: number = 365,
  resetAt?: Date | null
): Promise<CostGlobalSplit> {
  const conditions = [eq(usageLedger.key, keyHash), LEDGER_BILLING_CONDITION];
  const cutoff = resolveTotalCostCutoff(maxAgeDays, resetAt);
  if (cutoff) conditions.push(gte(usageLedger.createdAt, cutoff));

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      counted: sql<number>`COALESCE(SUM(CASE WHEN ${usageLedger.countedInKeyGlobal} THEN ${usageLedger.costUsd} ELSE 0 END), 0)`,
    })
    .from(usageLedger)
    .where(and(...conditions));

  return {
    total: Number(result[0]?.total || 0),
    countedInGlobal: Number(result[0]?.counted || 0),
  };
}

/**
 * Batch query: total cost grouped by user_id (single SQL query)
 * @param userIds - Array of user IDs
 * @param maxAgeDays - Only include records newer than this many days (default 365, use Infinity to include all)
 * @returns Map of userId -> totalCost
 */
export async function sumUserTotalCostBatch(
  userIds: number[],
  maxAgeDays: number = 365,
  resetAtMap?: Map<number, Date>
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (userIds.length === 0) return result;
  for (const id of userIds) result.set(id, 0);

  // Split users: those with costResetAt need individual queries
  const resetUserIds: number[] = [];
  const batchUserIds: number[] = [];
  for (const id of userIds) {
    if (resetAtMap?.has(id)) {
      resetUserIds.push(id);
    } else {
      batchUserIds.push(id);
    }
  }

  // Individual queries for users with costResetAt
  if (resetUserIds.length > 0) {
    const resetResults = await Promise.all(
      resetUserIds.map(async (id) => ({
        id,
        total: await sumUserTotalCost(id, maxAgeDays, resetAtMap!.get(id)),
      }))
    );
    for (const { id, total } of resetResults) result.set(id, total);
  }

  // Batch query for users without costResetAt
  if (batchUserIds.length > 0) {
    const conditions: SQL[] = [inArray(usageLedger.userId, batchUserIds), LEDGER_BILLING_CONDITION];
    if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
      const cutoffDate = new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000);
      conditions.push(gte(usageLedger.createdAt, cutoffDate));
    }

    const rows = await db
      .select({
        userId: usageLedger.userId,
        total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      })
      .from(usageLedger)
      .where(and(...conditions))
      .groupBy(usageLedger.userId);

    for (const row of rows) result.set(row.userId, Number(row.total || 0));
  }

  return result;
}

/**
 * Batch query: total cost grouped by key_id using a two-step PK lookup then aggregate.
 * Avoids varchar LEFT JOIN by first resolving key strings via PK, then aggregating on
 * usage_ledger directly (hits idx_usage_ledger_key_cost index).
 * @param keyIds - Array of key IDs
 * @param maxAgeDays - Only include records newer than this many days (default 365, use Infinity to include all)
 * @returns Map of keyId -> totalCost
 */
export async function sumKeyTotalCostBatchByIds(
  keyIds: number[],
  maxAgeDays: number = 365,
  resetAtMap?: Map<number, Date>
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (keyIds.length === 0) return result;
  for (const id of keyIds) result.set(id, 0);

  // Step 1: PK lookup -> key strings
  const keyMappings = await db
    .select({ id: keys.id, key: keys.key })
    .from(keys)
    .where(inArray(keys.id, keyIds));

  const keyStringToId = new Map(keyMappings.map((k) => [k.key, k.id]));
  const idToKeyString = new Map(keyMappings.map((k) => [k.id, k.key]));
  const keyStrings = keyMappings.map((k) => k.key);
  if (keyStrings.length === 0) return result;

  // Split keys: those with costResetAt need individual queries
  const resetKeyIds: number[] = [];
  const batchKeyStrings: string[] = [];
  for (const mapping of keyMappings) {
    if (resetAtMap?.has(mapping.id)) {
      resetKeyIds.push(mapping.id);
    } else {
      batchKeyStrings.push(mapping.key);
    }
  }

  // Individual queries for keys with costResetAt
  if (resetKeyIds.length > 0) {
    const resetResults = await Promise.all(
      resetKeyIds.map(async (id) => {
        const keyString = idToKeyString.get(id);
        if (!keyString) return { id, total: 0 };
        return {
          id,
          total: await sumKeyTotalCost(keyString, maxAgeDays, resetAtMap!.get(id)),
        };
      })
    );
    for (const { id, total } of resetResults) result.set(id, total);
  }

  // Step 2: Batch aggregate for keys without costResetAt
  if (batchKeyStrings.length > 0) {
    const conditions: SQL[] = [inArray(usageLedger.key, batchKeyStrings), LEDGER_BILLING_CONDITION];
    if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
      const cutoffDate = new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000);
      conditions.push(gte(usageLedger.createdAt, cutoffDate));
    }

    const rows = await db
      .select({
        key: usageLedger.key,
        total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      })
      .from(usageLedger)
      .where(and(...conditions))
      .groupBy(usageLedger.key);

    for (const row of rows) {
      const keyId = keyStringToId.get(row.key);
      if (keyId !== undefined) result.set(keyId, Number(row.total || 0));
    }
  }

  return result;
}

/**
 * 用于供应商总消费限额检查（limit_total_usd）。
 *
 * 重要语义：
 * - 总限额必须是“从 resetAt 起累计到现在”的结果；resetAt 为空时表示从历史最早记录开始累计。
 * - 这里不再做 365 天时间截断，否则会导致达到总限额后“过期自动恢复”，违背禁用语义。
 *
 * @param providerId - 供应商 ID
 * @param resetAt - 手动重置时间（用于实现“从 0 重新累计”）
 */
export async function sumProviderTotalCost(
  providerId: number,
  resetAt?: Date | null
): Promise<number> {
  const effectiveStart =
    resetAt instanceof Date && !Number.isNaN(resetAt.getTime()) ? resetAt : null;

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.finalProviderId, providerId),
        LEDGER_BILLING_CONDITION,
        ...(effectiveStart ? [gte(usageLedger.createdAt, effectiveStart)] : [])
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * 查询用户在指定时间范围内的消费总和
 * 用于用户层限额百分比显示
 */
export async function sumUserCostInTimeRange(
  userId: number,
  startTime: Date,
  endTime: Date,
  // group-rate-limit (§6.1): lease seeding passes true so a split axis's spend is
  // excluded from the user global window. Default false -> mainline parity.
  countedInGlobalOnly = false
): Promise<number> {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, userId),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION,
        ...(countedInGlobalOnly ? [eq(usageLedger.countedInUserGlobal, true)] : [])
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * 查询 Key 在指定时间范围内的消费总和
 * 用于 Key 层限额检查（Redis 降级）
 */
export async function sumKeyCostInTimeRange(
  keyId: number,
  startTime: Date,
  endTime: Date,
  // group-rate-limit (§6.1): lease seeding passes true so a split axis's spend is
  // excluded from the key global window. Default false -> mainline parity.
  countedInGlobalOnly = false
): Promise<number> {
  const keyString = await getKeyStringByIdCached(keyId);
  if (!keyString) return 0;

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.key, keyString), // 使用 key 字符串而非 ID
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION,
        ...(countedInGlobalOnly ? [eq(usageLedger.countedInKeyGlobal, true)] : [])
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * group-rate-limit (§5.3 / §10): a single-query split of spend into the portion that
 * counts toward the mainline global gate (`countedInGlobal`) and the full total. The
 * model-group-only portion shown in the UI is `total - countedInGlobal`. Used by the
 * display surfaces (quota cards, my-usage) so the gauge reflects what the gate enforces
 * while still surfacing the split-off spend.
 */
export type CostGlobalSplit = { total: number; countedInGlobal: number };

export async function sumUserCostSplitInTimeRange(
  userId: number,
  startTime: Date,
  endTime: Date
): Promise<CostGlobalSplit> {
  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      counted: sql<number>`COALESCE(SUM(CASE WHEN ${usageLedger.countedInUserGlobal} THEN ${usageLedger.costUsd} ELSE 0 END), 0)`,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, userId),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );

  return {
    total: Number(result[0]?.total || 0),
    countedInGlobal: Number(result[0]?.counted || 0),
  };
}

export async function sumKeyCostSplitInTimeRange(
  keyId: number,
  startTime: Date,
  endTime: Date
): Promise<CostGlobalSplit> {
  const keyString = await getKeyStringByIdCached(keyId);
  if (!keyString) return { total: 0, countedInGlobal: 0 };

  const result = await db
    .select({
      total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      counted: sql<number>`COALESCE(SUM(CASE WHEN ${usageLedger.countedInKeyGlobal} THEN ${usageLedger.costUsd} ELSE 0 END), 0)`,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.key, keyString),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );

  return {
    total: Number(result[0]?.total || 0),
    countedInGlobal: Number(result[0]?.counted || 0),
  };
}

/**
 * 查询用户在指定时间范围内、按模型维度的消费总和
 * 用于 per-model 限额的 DB 权威聚合（lease 切片重建）
 */
export async function sumUserCostByModelInTimeRange(
  userId: number,
  model: string,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, userId),
        eq(usageLedger.model, model),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * 查询 Key 在指定时间范围内、按模型维度的消费总和
 * 用于 per-model 限额的 DB 权威聚合（lease 切片重建）
 */
export async function sumKeyCostByModelInTimeRange(
  keyId: number,
  model: string,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const keyString = await getKeyStringByIdCached(keyId);
  if (!keyString) return 0;

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.key, keyString),
        eq(usageLedger.model, model),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * 查询某主体（user 或 key）在指定时间范围内、跨一组模型（model IN (...)）的消费总和。
 * 用于「模型组」维度限额的 DB 权威聚合（lease 切片重建 / total 兜底）。
 * 模型桶统计组成员上的全部消费，与全局额是否旁路无关，故不按 counted_in_*_global 过滤。
 */
export async function sumScopeCostByModelsInTimeRange(
  scope: "user" | "key",
  scopeId: number,
  models: string[],
  startTime: Date,
  endTime: Date
): Promise<number> {
  if (models.length === 0) return 0;

  let scopeCondition: SQL;
  if (scope === "user") {
    scopeCondition = eq(usageLedger.userId, scopeId);
  } else {
    const keyString = await getKeyStringByIdCached(scopeId);
    if (!keyString) return 0;
    scopeCondition = eq(usageLedger.key, keyString);
  }

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        scopeCondition,
        inArray(usageLedger.model, models),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );

  return Number(result[0]?.total || 0);
}

export interface QuotaCostRanges {
  range5h: { startTime: Date; endTime: Date };
  rangeDaily: { startTime: Date; endTime: Date };
  rangeWeekly: { startTime: Date; endTime: Date };
  rangeMonthly: { startTime: Date; endTime: Date };
}

interface QuotaCostSummary {
  cost5h: number;
  costDaily: number;
  costWeekly: number;
  costMonthly: number;
  costTotal: number;
  // group-rate-limit (§5.3 / §10): per-window portion counted toward the mainline global
  // gate. The model-group-only portion shown in the UI is `cost* - cost*Counted`.
  cost5hCounted: number;
  costDailyCounted: number;
  costWeeklyCounted: number;
  costMonthlyCounted: number;
  costTotalCounted: number;
}

/**
 * 合并查询：一次 SQL 返回用户各周期消费与总消费
 *
 * 说明：
 * - 通过 FILTER 子句避免多次往返/重复扫描
 * - scanStart/scanEnd 仅用于缩小扫描范围（不改变语义）
 * - total 使用 maxAgeDays 做时间截断（与 sumUserTotalCost 语义一致）
 */
export async function sumUserQuotaCosts(
  userId: number,
  ranges: QuotaCostRanges,
  maxAgeDays: number = 365,
  resetAt?: Date | null
): Promise<QuotaCostSummary> {
  const maxAgeCutoff =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;
  // Use the more recent of maxAgeCutoff and resetAt
  let cutoffDate = maxAgeCutoff;
  if (resetAt instanceof Date && !Number.isNaN(resetAt.getTime())) {
    cutoffDate = maxAgeCutoff && maxAgeCutoff > resetAt ? maxAgeCutoff : resetAt;
  }

  const scanStart = cutoffDate
    ? new Date(
        Math.min(
          ranges.range5h.startTime.getTime(),
          ranges.rangeDaily.startTime.getTime(),
          ranges.rangeWeekly.startTime.getTime(),
          ranges.rangeMonthly.startTime.getTime(),
          cutoffDate.getTime()
        )
      )
    : null;
  const scanEnd = new Date(
    Math.max(
      ranges.range5h.endTime.getTime(),
      ranges.rangeDaily.endTime.getTime(),
      ranges.rangeWeekly.endTime.getTime(),
      ranges.rangeMonthly.endTime.getTime(),
      Date.now()
    )
  );

  const costTotal = cutoffDate
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate.toISOString()}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}), 0)`;
  const costTotalCounted = cutoffDate
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate.toISOString()} AND ${usageLedger.countedInUserGlobal}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.countedInUserGlobal}), 0)`;

  const [row] = await db
    .select({
      cost5h: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime.toISOString()}), 0)`,
      costDaily: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime.toISOString()}), 0)`,
      costWeekly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime.toISOString()}), 0)`,
      costMonthly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime.toISOString()}), 0)`,
      costTotal,
      cost5hCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime.toISOString()} AND ${usageLedger.countedInUserGlobal}), 0)`,
      costDailyCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime.toISOString()} AND ${usageLedger.countedInUserGlobal}), 0)`,
      costWeeklyCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime.toISOString()} AND ${usageLedger.countedInUserGlobal}), 0)`,
      costMonthlyCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime.toISOString()} AND ${usageLedger.countedInUserGlobal}), 0)`,
      costTotalCounted,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, userId),
        LEDGER_BILLING_CONDITION,
        ...(scanStart ? [gte(usageLedger.createdAt, scanStart)] : []),
        lt(usageLedger.createdAt, scanEnd)
      )
    );

  return {
    cost5h: Number(row?.cost5h ?? 0),
    costDaily: Number(row?.costDaily ?? 0),
    costWeekly: Number(row?.costWeekly ?? 0),
    costMonthly: Number(row?.costMonthly ?? 0),
    costTotal: Number(row?.costTotal ?? 0),
    cost5hCounted: Number(row?.cost5hCounted ?? 0),
    costDailyCounted: Number(row?.costDailyCounted ?? 0),
    costWeeklyCounted: Number(row?.costWeeklyCounted ?? 0),
    costMonthlyCounted: Number(row?.costMonthlyCounted ?? 0),
    costTotalCounted: Number(row?.costTotalCounted ?? 0),
  };
}

/**
 * 合并查询：一次 SQL 返回 Key 各周期消费与总消费（通过 keyId）
 */
export async function sumKeyQuotaCostsById(
  keyId: number,
  ranges: QuotaCostRanges,
  maxAgeDays: number = 365,
  resetAt?: Date | null
): Promise<QuotaCostSummary> {
  const keyString = await getKeyStringByIdCached(keyId);
  if (!keyString) {
    return {
      cost5h: 0,
      costDaily: 0,
      costWeekly: 0,
      costMonthly: 0,
      costTotal: 0,
      cost5hCounted: 0,
      costDailyCounted: 0,
      costWeeklyCounted: 0,
      costMonthlyCounted: 0,
      costTotalCounted: 0,
    };
  }

  const maxAgeCutoff =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;
  // Use the more recent of maxAgeCutoff and resetAt
  let cutoffDate = maxAgeCutoff;
  if (resetAt instanceof Date && !Number.isNaN(resetAt.getTime())) {
    cutoffDate = maxAgeCutoff && maxAgeCutoff > resetAt ? maxAgeCutoff : resetAt;
  }

  const scanStart = cutoffDate
    ? new Date(
        Math.min(
          ranges.range5h.startTime.getTime(),
          ranges.rangeDaily.startTime.getTime(),
          ranges.rangeWeekly.startTime.getTime(),
          ranges.rangeMonthly.startTime.getTime(),
          cutoffDate.getTime()
        )
      )
    : null;
  const scanEnd = new Date(
    Math.max(
      ranges.range5h.endTime.getTime(),
      ranges.rangeDaily.endTime.getTime(),
      ranges.rangeWeekly.endTime.getTime(),
      ranges.rangeMonthly.endTime.getTime(),
      Date.now()
    )
  );

  const costTotal = cutoffDate
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate.toISOString()}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}), 0)`;
  const costTotalCounted = cutoffDate
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate.toISOString()} AND ${usageLedger.countedInKeyGlobal}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.countedInKeyGlobal}), 0)`;

  const [row] = await db
    .select({
      cost5h: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime.toISOString()}), 0)`,
      costDaily: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime.toISOString()}), 0)`,
      costWeekly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime.toISOString()}), 0)`,
      costMonthly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime.toISOString()}), 0)`,
      costTotal,
      cost5hCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime.toISOString()} AND ${usageLedger.countedInKeyGlobal}), 0)`,
      costDailyCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime.toISOString()} AND ${usageLedger.countedInKeyGlobal}), 0)`,
      costWeeklyCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime.toISOString()} AND ${usageLedger.countedInKeyGlobal}), 0)`,
      costMonthlyCounted: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime.toISOString()} AND ${usageLedger.countedInKeyGlobal}), 0)`,
      costTotalCounted,
    })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.key, keyString),
        LEDGER_BILLING_CONDITION,
        ...(scanStart ? [gte(usageLedger.createdAt, scanStart)] : []),
        lt(usageLedger.createdAt, scanEnd)
      )
    );

  return {
    cost5h: Number(row?.cost5h ?? 0),
    costDaily: Number(row?.costDaily ?? 0),
    costWeekly: Number(row?.costWeekly ?? 0),
    costMonthly: Number(row?.costMonthly ?? 0),
    costTotal: Number(row?.costTotal ?? 0),
    cost5hCounted: Number(row?.cost5hCounted ?? 0),
    costDailyCounted: Number(row?.costDailyCounted ?? 0),
    costWeeklyCounted: Number(row?.costWeeklyCounted ?? 0),
    costMonthlyCounted: Number(row?.costMonthlyCounted ?? 0),
    costTotalCounted: Number(row?.costTotalCounted ?? 0),
  };
}

export interface ModelGroupCostSummary {
  cost5h: number;
  costDaily: number;
  costWeekly: number;
  costMonthly: number;
  costTotal: number;
}

const EMPTY_MODEL_GROUP_COST_SUMMARY: ModelGroupCostSummary = {
  cost5h: 0,
  costDaily: 0,
  costWeekly: 0,
  costMonthly: 0,
  costTotal: 0,
};

/**
 * 合并查询：一次 SQL 返回某主体（user 或 key）在「一组模型」上各周期的消费与总消费。
 * 用于 my-usage 的模型组配额展示。模型桶是独立预算，统计组成员上的全部消费，
 * 不按 counted_in_*_global 过滤（与 sumScopeCostByModelsInTimeRange 口径一致）。
 * total 为全时（可选 resetAt 下限），与 BucketRateLimitService 的 total 口径一致。
 */
export async function sumScopeQuotaCostsByModels(
  scope: "user" | "key",
  scopeId: number,
  models: string[],
  ranges: QuotaCostRanges,
  resetAt?: Date | null
): Promise<ModelGroupCostSummary> {
  if (models.length === 0) return EMPTY_MODEL_GROUP_COST_SUMMARY;

  let scopeCondition: SQL;
  if (scope === "user") {
    scopeCondition = eq(usageLedger.userId, scopeId);
  } else {
    const keyString = await getKeyStringByIdCached(scopeId);
    if (!keyString) return EMPTY_MODEL_GROUP_COST_SUMMARY;
    scopeCondition = eq(usageLedger.key, keyString);
  }

  const cutoffDate = resetAt instanceof Date && !Number.isNaN(resetAt.getTime()) ? resetAt : null;

  const scanStart = cutoffDate
    ? new Date(
        Math.min(
          ranges.range5h.startTime.getTime(),
          ranges.rangeDaily.startTime.getTime(),
          ranges.rangeWeekly.startTime.getTime(),
          ranges.rangeMonthly.startTime.getTime(),
          cutoffDate.getTime()
        )
      )
    : null;
  const scanEnd = new Date(
    Math.max(
      ranges.range5h.endTime.getTime(),
      ranges.rangeDaily.endTime.getTime(),
      ranges.rangeWeekly.endTime.getTime(),
      ranges.rangeMonthly.endTime.getTime(),
      Date.now()
    )
  );

  const costTotal = cutoffDate
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate.toISOString()}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}), 0)`;

  const [row] = await db
    .select({
      cost5h: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime.toISOString()}), 0)`,
      costDaily: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime.toISOString()}), 0)`,
      costWeekly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime.toISOString()}), 0)`,
      costMonthly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime.toISOString()} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime.toISOString()}), 0)`,
      costTotal,
    })
    .from(usageLedger)
    .where(
      and(
        scopeCondition,
        inArray(usageLedger.model, models),
        LEDGER_BILLING_CONDITION,
        ...(scanStart ? [gte(usageLedger.createdAt, scanStart)] : []),
        lt(usageLedger.createdAt, scanEnd)
      )
    );

  return {
    cost5h: Number(row?.cost5h ?? 0),
    costDaily: Number(row?.costDaily ?? 0),
    costWeekly: Number(row?.costWeekly ?? 0),
    costMonthly: Number(row?.costMonthly ?? 0),
    costTotal: Number(row?.costTotal ?? 0),
  };
}

export interface CostEntryInTimeRange {
  id: number;
  createdAt: Date;
  costUsd: number;
}

/**
 * 查询用户在指定时间范围内的消费明细（用于滚动窗口 Redis 恢复）
 */
export async function findUserCostEntriesInTimeRange(
  userId: number,
  startTime: Date,
  endTime: Date
): Promise<CostEntryInTimeRange[]> {
  const rows = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      costUsd: messageRequest.costUsd,
    })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.userId, userId),
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION
      )
    );

  return rows
    .map((row) => {
      if (!row.createdAt) return null;
      const costUsd = Number(row.costUsd || 0);
      if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
      return { id: row.id, createdAt: row.createdAt, costUsd };
    })
    .filter((row): row is CostEntryInTimeRange => row !== null);
}

/**
 * 查询供应商在指定时间范围内的消费明细（用于滚动窗口 Redis 恢复）
 */
export async function findProviderCostEntriesInTimeRange(
  providerId: number,
  startTime: Date,
  endTime: Date
): Promise<CostEntryInTimeRange[]> {
  const rows = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      costUsd: messageRequest.costUsd,
    })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.providerId, providerId),
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION
      )
    );

  return rows
    .map((row) => {
      if (!row.createdAt) return null;
      const costUsd = Number(row.costUsd || 0);
      if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
      return { id: row.id, createdAt: row.createdAt, costUsd };
    })
    .filter((row): row is CostEntryInTimeRange => row !== null);
}

/**
 * 查询 Key 在指定时间范围内的消费明细（用于滚动窗口 Redis 恢复）
 */
export async function findKeyCostEntriesInTimeRange(
  keyId: number,
  startTime: Date,
  endTime: Date
): Promise<CostEntryInTimeRange[]> {
  const keyString = await getKeyStringByIdCached(keyId);
  if (!keyString) return [];

  const rows = await db
    .select({
      id: messageRequest.id,
      createdAt: messageRequest.createdAt,
      costUsd: messageRequest.costUsd,
    })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.key, keyString), // 使用 key 字符串而非 ID
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt),
        EXCLUDE_WARMUP_CONDITION
      )
    );

  return rows
    .map((row) => {
      if (!row.createdAt) return null;
      const costUsd = Number(row.costUsd || 0);
      if (!Number.isFinite(costUsd) || costUsd <= 0) return null;
      return { id: row.id, createdAt: row.createdAt, costUsd };
    })
    .filter((row): row is CostEntryInTimeRange => row !== null);
}

/**
 * 获取限流事件统计数据
 * 查询 message_request 表中包含 rate_limit_metadata 的错误记录
 *
 * @param filters - 过滤条件
 * @returns 聚合统计数据，包含 6 个维度的指标
 */
export async function getRateLimitEventStats(
  filters: RateLimitEventFilters = {}
): Promise<RateLimitEventStats> {
  const timezone = await resolveSystemTimezone();
  const { user_id, provider_id, limit_type, start_time, end_time, key_id } = filters;

  const conditions: SQL[] = [
    sql`${messageRequest.errorMessage} LIKE ${"%rate_limit_metadata%"}`,
    isNull(messageRequest.deletedAt),
  ];

  if (user_id !== undefined) {
    conditions.push(eq(messageRequest.userId, user_id));
  }

  if (provider_id !== undefined) {
    conditions.push(eq(messageRequest.providerId, provider_id));
  }

  const startIso = start_time?.toISOString();
  const endIso = end_time?.toISOString();

  if (startIso) {
    conditions.push(sql`${messageRequest.createdAt} >= ${startIso}::timestamptz`);
  }

  if (endIso) {
    conditions.push(sql`${messageRequest.createdAt} <= ${endIso}::timestamptz`);
  }

  // Key ID 过滤需要先查询 key 字符串
  let keyString: string | null = null;
  if (key_id !== undefined) {
    keyString = await getKeyStringByIdCached(key_id);
    if (keyString) {
      conditions.push(eq(messageRequest.key, keyString));
    } else {
      // Key 不存在，返回空统计
      return {
        total_events: 0,
        events_by_type: {} as Record<RateLimitType, number>,
        events_by_user: {},
        events_by_provider: {},
        events_timeline: [],
        avg_current_usage: 0,
      };
    }
  }

  // 查询所有符合条件的限流事件
  const query = sql`
    SELECT
      ${messageRequest.id},
      ${messageRequest.userId},
      ${messageRequest.providerId},
      ${messageRequest.errorMessage},
      DATE_TRUNC('hour', ${messageRequest.createdAt} AT TIME ZONE ${timezone}) AS hour
    FROM ${messageRequest}
    WHERE ${and(...conditions)}
    ORDER BY ${messageRequest.createdAt}
  `;

  const result = await db.execute(query);
  const rows = Array.from(result) as Array<{
    id: number;
    user_id: number;
    provider_id: number;
    error_message: string;
    hour: Date;
  }>;

  // 初始化聚合数据
  const eventsByType: Record<string, number> = {};
  const eventsByUser: Record<number, number> = {};
  const eventsByProvider: Record<number, number> = {};
  const eventsByHour: Record<string, number> = {};
  let totalCurrentUsage = 0;
  let usageCount = 0;

  // 处理每条记录
  for (const row of rows) {
    // 解析 rate_limit_metadata JSON
    const metadataMatch = row.error_message.match(/rate_limit_metadata:\s*(\{[^}]+\})/);
    if (!metadataMatch) {
      continue;
    }

    let metadata: { limit_type?: string; current?: number };
    try {
      metadata = JSON.parse(metadataMatch[1]);
    } catch {
      continue;
    }

    const rowLimitType = metadata.limit_type;
    const currentUsage = metadata.current;

    // 如果指定了 limit_type 过滤，跳过不匹配的记录
    if (limit_type && rowLimitType !== limit_type) {
      continue;
    }

    // 按类型统计
    if (rowLimitType) {
      eventsByType[rowLimitType] = (eventsByType[rowLimitType] || 0) + 1;
    }

    // 按用户统计
    eventsByUser[row.user_id] = (eventsByUser[row.user_id] || 0) + 1;

    // 按供应商统计
    eventsByProvider[row.provider_id] = (eventsByProvider[row.provider_id] || 0) + 1;

    // 按小时统计
    const hourKey = row.hour.toISOString();
    eventsByHour[hourKey] = (eventsByHour[hourKey] || 0) + 1;

    // 累计当前使用量
    if (typeof currentUsage === "number") {
      totalCurrentUsage += currentUsage;
      usageCount++;
    }
  }

  // 计算平均当前使用量
  const avgCurrentUsage = usageCount > 0 ? totalCurrentUsage / usageCount : 0;

  // 构建时间线数组（按时间排序）
  const eventsTimeline = Object.entries(eventsByHour)
    .map(([hour, count]) => ({ hour, count }))
    .sort((a, b) => a.hour.localeCompare(b.hour));

  return {
    total_events: rows.length,
    events_by_type: eventsByType as Record<RateLimitType, number>,
    events_by_user: eventsByUser,
    events_by_provider: eventsByProvider,
    events_timeline: eventsTimeline,
    avg_current_usage: Number(avgCurrentUsage.toFixed(2)),
  };
}

/**
 * 查询 Provider 在指定时间范围内的消费总和
 * 用于 Provider 层限额检查（Redis 降级）
 */
export async function sumProviderCostInTimeRange(
  providerId: number,
  startTime: Date,
  endTime: Date
): Promise<number> {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.finalProviderId, providerId),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * bugfix #09: locate the earliest billable ledger row inside [startTime, endTime)
 * for a given entity. The display cache uses this to clamp its TTL to the next
 * boundary crossing — without it, "limit reached" can persist in cache for the
 * full configured TTL after the oldest row has slid out of the rolling window.
 *
 * Returns the createdAt ms timestamp, or null if no rows match.
 *
 * For provider, `countedInGlobalOnly` is a no-op (no counted_in_provider_global
 * column) but the parameter is kept for API parity with key/user.
 */
export async function findEarliestLedgerCreatedAtInWindow(
  type: "key" | "user" | "provider",
  id: number,
  startTime: Date,
  endTime: Date,
  countedInGlobalOnly = false
): Promise<number | null> {
  const baseConditions: SQL[] = [
    gte(usageLedger.createdAt, startTime),
    lt(usageLedger.createdAt, endTime),
    LEDGER_BILLING_CONDITION as SQL,
  ];

  let entityCondition: SQL | undefined;
  if (type === "user") {
    entityCondition = eq(usageLedger.userId, id);
    if (countedInGlobalOnly) baseConditions.push(eq(usageLedger.countedInUserGlobal, true));
  } else if (type === "provider") {
    entityCondition = eq(usageLedger.finalProviderId, id);
  } else {
    const keyString = await getKeyStringByIdCached(id);
    if (!keyString) return null;
    entityCondition = eq(usageLedger.key, keyString);
    if (countedInGlobalOnly) baseConditions.push(eq(usageLedger.countedInKeyGlobal, true));
  }

  const rows = await db
    .select({ createdAt: usageLedger.createdAt })
    .from(usageLedger)
    .where(and(entityCondition, ...baseConditions))
    .orderBy(asc(usageLedger.createdAt))
    .limit(1);

  const first = rows[0]?.createdAt;
  if (!first) return null;
  const ms = first instanceof Date ? first.getTime() : new Date(first).getTime();
  return Number.isFinite(ms) ? ms : null;
}

/**
 * bugfix #07: batch-load provider cost reset timestamps so the caller can
 * clip the window per provider (mirrors `clipStartByResetAt` semantics from
 * the single-provider path).
 */
export async function getProviderCostResetAtMap(
  providerIds: number[]
): Promise<Map<number, Date | null>> {
  const result = new Map<number, Date | null>();
  if (providerIds.length === 0) return result;

  const rows = await db
    .select({
      id: providers.id,
      resetAt: providers.totalCostResetAt,
    })
    .from(providers)
    .where(inArray(providers.id, providerIds));

  for (const row of rows) {
    result.set(row.id, row.resetAt ?? null);
  }
  return result;
}

/**
 * bugfix #07: per-provider start time so each provider's costResetAt is honored.
 * The legacy signature `(providerIds, startTime, endTime)` shares one window for
 * every provider, which silently ignores admin-pushed reset boundaries.
 */
export interface ProviderCostBatchParam {
  providerId: number;
  startTime: Date;
}

// review L1: keep each chunk's bind-parameter count well under PostgreSQL's
// 65535 ceiling. The object overload binds 2 parameters per provider
// (id + start_at), so the practical cap is ~30k providers per statement.
// 1000 leaves ample headroom for future schema growth without forcing
// callers to think about chunking themselves.
const PROVIDER_BATCH_CHUNK_SIZE = 1000;

function mergeSumRows(
  rows: Array<{ providerId: number; total: unknown }>,
  into: Map<number, number>
): void {
  for (const row of rows) {
    const parsed = Number(row.total ?? 0);
    into.set(row.providerId, Number.isFinite(parsed) ? parsed : 0);
  }
}

export function sumProviderCostBatchInTimeRange(
  providerIds: number[],
  startTime: Date,
  endTime: Date
): Promise<Map<number, number>>;
export function sumProviderCostBatchInTimeRange(
  params: ProviderCostBatchParam[],
  endTime: Date
): Promise<Map<number, number>>;
/**
 * 批量查询多个 Provider 在指定时间范围内的消费总和。
 *
 * - 旧重载：`(providerIds, startTime, endTime)` 所有 provider 共用同一窗口。
 * - 新重载：`(params, endTime)` 每个 provider 独立窗口，调用方先 `clipStartByResetAt`。
 *
 * 新重载使用 `WITH params(provider_id, start_at) AS (VALUES ...)` 单次 SQL 完成
 * per-provider 裁剪，仍走 idx_usage_ledger_provider_cost_cover 的覆盖索引。
 *
 * 两个重载都会按 `PROVIDER_BATCH_CHUNK_SIZE` 自动切片，单一调用即可承载任意 N。
 * provider 维度不存在 `counted_in_provider_global` 列，因此与 sumKey/UserCost
 * 不同，没有 `countedInGlobalOnly` 参数 — 调用方若需要这种过滤要走 key/user 维度。
 */
export async function sumProviderCostBatchInTimeRange(
  arg1: number[] | ProviderCostBatchParam[],
  arg2: Date,
  arg3?: Date
): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (arg1.length === 0) return result;

  // review L2: positive `number` discriminator instead of `typeof "object"`.
  // The previous check treated `null` (typeof null === "object") as the new
  // overload and NPE'd on `.providerId`. Anchoring on `"number"` makes the
  // legacy branch a strict subset and routes any bad input through the safer
  // object branch where the existing `.providerId` access surfaces immediately.
  const isLegacyOverload = typeof arg1[0] === "number";

  if (!isLegacyOverload) {
    const allParams = (arg1 as ProviderCostBatchParam[]).filter(
      (p): p is ProviderCostBatchParam =>
        p !== null && p !== undefined && typeof p.providerId === "number"
    );
    if (allParams.length === 0) return result;
    const endTime = arg2;

    for (let i = 0; i < allParams.length; i += PROVIDER_BATCH_CHUNK_SIZE) {
      const params = allParams.slice(i, i + PROVIDER_BATCH_CHUNK_SIZE);
      const providerIds = params.map((p) => p.providerId);

      // Single SQL with CTE per chunk: each provider gets its own start_at.
      // VALUES ($1::int, $2::timestamp), ($3::int, $4::timestamp), ...
      const valuesSql = sql.join(
        params.map(
          (p) => sql`(${p.providerId}::int, ${p.startTime.toISOString()}::timestamp with time zone)`
        ),
        sql`, `
      );

      const rows = await db
        .select({
          providerId: usageLedger.finalProviderId,
          total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
        })
        .from(usageLedger)
        .innerJoin(
          sql`(VALUES ${valuesSql}) AS reset_params(provider_id, start_at)`,
          sql`reset_params.provider_id = ${usageLedger.finalProviderId} AND ${usageLedger.createdAt} >= reset_params.start_at`
        )
        .where(
          and(
            inArray(usageLedger.finalProviderId, providerIds),
            lt(usageLedger.createdAt, endTime),
            LEDGER_BILLING_CONDITION
          )
        )
        .groupBy(usageLedger.finalProviderId);

      mergeSumRows(rows, result);
    }
    return result;
  }

  const allProviderIds = arg1 as number[];
  const startTime = arg2;
  const endTime = arg3 as Date;

  for (let i = 0; i < allProviderIds.length; i += PROVIDER_BATCH_CHUNK_SIZE) {
    const providerIds = allProviderIds.slice(i, i + PROVIDER_BATCH_CHUNK_SIZE);

    const rows = await db
      .select({
        providerId: usageLedger.finalProviderId,
        total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
      })
      .from(usageLedger)
      .where(
        and(
          inArray(usageLedger.finalProviderId, providerIds),
          gte(usageLedger.createdAt, startTime),
          lt(usageLedger.createdAt, endTime),
          LEDGER_BILLING_CONDITION
        )
      )
      .groupBy(usageLedger.finalProviderId);

    mergeSumRows(rows, result);
  }
  return result;
}
