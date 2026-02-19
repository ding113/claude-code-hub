import "server-only";

import { and, eq, gte, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, usageLedger } from "@/drizzle/schema";
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
export async function sumKeyTotalCost(keyHash: string, maxAgeDays: number = 365): Promise<number> {
  const conditions = [eq(usageLedger.key, keyHash), LEDGER_BILLING_CONDITION];

  // Finite positive maxAgeDays adds a date filter; Infinity/0/negative means all-time
  if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
    const cutoffDate = new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000);
    conditions.push(gte(usageLedger.createdAt, cutoffDate));
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
export async function sumUserTotalCost(userId: number, maxAgeDays: number = 365): Promise<number> {
  const conditions = [eq(usageLedger.userId, userId), LEDGER_BILLING_CONDITION];

  // Finite positive maxAgeDays adds a date filter; Infinity/0/negative means all-time
  if (Number.isFinite(maxAgeDays) && maxAgeDays > 0) {
    const cutoffDate = new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000);
    conditions.push(gte(usageLedger.createdAt, cutoffDate));
  }

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(and(...conditions));

  return Number(result[0]?.total || 0);
}

/**
 * Batch query: all-time total cost grouped by user_id (single SQL query)
 * @param userIds - Array of user IDs
 * @returns Map of userId -> totalCost
 */
export async function sumUserTotalCostBatch(userIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (userIds.length === 0) return result;

  const rows = await db
    .select({
      userId: usageLedger.userId,
      total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
    })
    .from(usageLedger)
    .where(and(inArray(usageLedger.userId, userIds), LEDGER_BILLING_CONDITION))
    .groupBy(usageLedger.userId);

  for (const id of userIds) {
    result.set(id, 0);
  }
  for (const row of rows) {
    result.set(row.userId, Number(row.total || 0));
  }
  return result;
}

/**
 * Batch query: all-time total cost grouped by key_id (single SQL query via JOIN)
 * @param keyIds - Array of key IDs
 * @returns Map of keyId -> totalCost
 */
export async function sumKeyTotalCostBatchByIds(keyIds: number[]): Promise<Map<number, number>> {
  const result = new Map<number, number>();
  if (keyIds.length === 0) return result;

  const rows = await db
    .select({
      keyId: keys.id,
      total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)`,
    })
    .from(keys)
    .leftJoin(usageLedger, and(eq(usageLedger.key, keys.key), LEDGER_BILLING_CONDITION))
    .where(inArray(keys.id, keyIds))
    .groupBy(keys.id);

  for (const id of keyIds) {
    result.set(id, 0);
  }
  for (const row of rows) {
    result.set(row.keyId, Number(row.total || 0));
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
  endTime: Date
): Promise<number> {
  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${usageLedger.costUsd}), 0)` })
    .from(usageLedger)
    .where(
      and(
        eq(usageLedger.userId, userId),
        gte(usageLedger.createdAt, startTime),
        lt(usageLedger.createdAt, endTime),
        LEDGER_BILLING_CONDITION
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
  endTime: Date
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
  maxAgeDays: number = 365
): Promise<QuotaCostSummary> {
  const cutoffDate =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;

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
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}), 0)`;

  const [row] = await db
    .select({
      cost5h: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime}), 0)`,
      costDaily: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime}), 0)`,
      costWeekly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime}), 0)`,
      costMonthly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime}), 0)`,
      costTotal,
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
  };
}

/**
 * 合并查询：一次 SQL 返回 Key 各周期消费与总消费（通过 keyId）
 */
export async function sumKeyQuotaCostsById(
  keyId: number,
  ranges: QuotaCostRanges,
  maxAgeDays: number = 365
): Promise<QuotaCostSummary> {
  const keyString = await getKeyStringByIdCached(keyId);
  if (!keyString) {
    return { cost5h: 0, costDaily: 0, costWeekly: 0, costMonthly: 0, costTotal: 0 };
  }

  const cutoffDate =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0
      ? new Date(Date.now() - Math.floor(maxAgeDays) * 24 * 60 * 60 * 1000)
      : null;

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
    ? sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${cutoffDate}), 0)`
    : sql<string>`COALESCE(SUM(${usageLedger.costUsd}), 0)`;

  const [row] = await db
    .select({
      cost5h: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.range5h.startTime} AND ${usageLedger.createdAt} < ${ranges.range5h.endTime}), 0)`,
      costDaily: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeDaily.startTime} AND ${usageLedger.createdAt} < ${ranges.rangeDaily.endTime}), 0)`,
      costWeekly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeWeekly.startTime} AND ${usageLedger.createdAt} < ${ranges.rangeWeekly.endTime}), 0)`,
      costMonthly: sql<string>`COALESCE(SUM(${usageLedger.costUsd}) FILTER (WHERE ${usageLedger.createdAt} >= ${ranges.rangeMonthly.startTime} AND ${usageLedger.createdAt} < ${ranges.rangeMonthly.endTime}), 0)`,
      costTotal,
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

  // 构建 WHERE 条件
  const conditions: string[] = [
    `${messageRequest.errorMessage.name} LIKE '%rate_limit_metadata%'`,
    `${messageRequest.deletedAt.name} IS NULL`,
  ];

  const params: (string | number | Date)[] = [];
  let paramIndex = 1;

  if (user_id !== undefined) {
    conditions.push(`${messageRequest.userId.name} = $${paramIndex++}`);
    params.push(user_id);
  }

  if (provider_id !== undefined) {
    conditions.push(`${messageRequest.providerId.name} = $${paramIndex++}`);
    params.push(provider_id);
  }

  if (start_time) {
    conditions.push(`${messageRequest.createdAt.name} >= $${paramIndex++}`);
    params.push(start_time);
  }

  if (end_time) {
    conditions.push(`${messageRequest.createdAt.name} <= $${paramIndex++}`);
    params.push(end_time);
  }

  // Key ID 过滤需要先查询 key 字符串
  let keyString: string | null = null;
  if (key_id !== undefined) {
    keyString = await getKeyStringByIdCached(key_id);
    if (keyString) {
      conditions.push(`${messageRequest.key.name} = $${paramIndex++}`);
      params.push(keyString);
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
    WHERE ${sql.raw(conditions.join(" AND "))}
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
