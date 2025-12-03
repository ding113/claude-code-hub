"use server";

import { and, eq, gte, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config";
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

/**
 * 根据时间范围获取用户消费和API调用统计
 * 注意：这个函数使用原生SQL，因为涉及到PostgreSQL特定的generate_series函数
 */
export async function getUserStatisticsFromDB(timeRange: TimeRange): Promise<DatabaseStatRow[]> {
  const timezone = getEnvConfig().TZ;
  let query;

  switch (timeRange) {
    case "today":
      // 今天（小时分辨率）
      query = sql`
        WITH hour_range AS (
          SELECT generate_series(
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
            '1 hour'::interval
          ) AS hour
        ),
        hourly_stats AS (
          SELECT
            u.id AS user_id,
            u.name AS user_name,
            hr.hour,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM users u
          CROSS JOIN hour_range hr
          LEFT JOIN message_request mr ON u.id = mr.user_id
            AND DATE_TRUNC('hour', mr.created_at AT TIME ZONE ${timezone}) = hr.hour
            AND mr.deleted_at IS NULL
          WHERE u.deleted_at IS NULL
          GROUP BY u.id, u.name, hr.hour
        )
        SELECT
          user_id,
          user_name,
          hour AS date,
          api_calls::integer,
          total_cost::numeric
        FROM hourly_stats
        ORDER BY hour ASC, user_name ASC
      `;
      break;

    case "7days":
      // 过去7天（天分辨率）
      query = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        daily_stats AS (
          SELECT
            u.id AS user_id,
            u.name AS user_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM users u
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON u.id = mr.user_id
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          WHERE u.deleted_at IS NULL
          GROUP BY u.id, u.name, dr.date
        )
        SELECT
          user_id,
          user_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, user_name ASC
      `;
      break;

    case "30days":
      // 过去 30 天（天分辨率）
      query = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '29 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        daily_stats AS (
          SELECT
            u.id AS user_id,
            u.name AS user_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM users u
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON u.id = mr.user_id
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          WHERE u.deleted_at IS NULL
          GROUP BY u.id, u.name, dr.date
        )
        SELECT
          user_id,
          user_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, user_name ASC
      `;
      break;

    case "thisMonth":
      // 本月（天分辨率，从本月第一天到今天）
      query = sql`
        WITH date_range AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        daily_stats AS (
          SELECT
            u.id AS user_id,
            u.name AS user_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM users u
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON u.id = mr.user_id
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          WHERE u.deleted_at IS NULL
          GROUP BY u.id, u.name, dr.date
        )
        SELECT
          user_id,
          user_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, user_name ASC
      `;
      break;

    default:
      throw new Error(`Unsupported time range: ${timeRange}`);
  }

  const result = await db.execute(query);
  return Array.from(result) as unknown as DatabaseStatRow[];
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
  const timezone = getEnvConfig().TZ;
  let query;

  switch (timeRange) {
    case "today":
      query = sql`
        WITH hour_range AS (
          SELECT generate_series(
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
            '1 hour'::interval
          ) AS hour
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        hourly_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            hr.hour,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN hour_range hr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND DATE_TRUNC('hour', mr.created_at AT TIME ZONE ${timezone}) = hr.hour
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, hr.hour
        )
        SELECT
          key_id,
          key_name,
          hour AS date,
          api_calls::integer,
          total_cost::numeric
        FROM hourly_stats
        ORDER BY hour ASC, key_name ASC
      `;
      break;

    case "7days":
      query = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        daily_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, dr.date
        )
        SELECT
          key_id,
          key_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, key_name ASC
      `;
      break;

    case "30days":
      query = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '29 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        daily_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, dr.date
        )
        SELECT
          key_id,
          key_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, key_name ASC
      `;
      break;

    case "thisMonth":
      query = sql`
        WITH date_range AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        daily_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, dr.date
        )
        SELECT
          key_id,
          key_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, key_name ASC
      `;
      break;

    default:
      throw new Error(`Unsupported time range: ${timeRange}`);
  }

  const result = await db.execute(query);
  return Array.from(result) as unknown as DatabaseKeyStatRow[];
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
  const timezone = getEnvConfig().TZ;
  let ownKeysQuery;
  let othersQuery;

  switch (timeRange) {
    case "today":
      // 自己的密钥明细（小时分辨率）
      ownKeysQuery = sql`
        WITH hour_range AS (
          SELECT generate_series(
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
            '1 hour'::interval
          ) AS hour
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        hourly_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            hr.hour,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN hour_range hr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND DATE_TRUNC('hour', mr.created_at AT TIME ZONE ${timezone}) = hr.hour
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, hr.hour
        )
        SELECT
          key_id,
          key_name,
          hour AS date,
          api_calls::integer,
          total_cost::numeric
        FROM hourly_stats
        ORDER BY hour ASC, key_name ASC
      `;

      // 其他用户汇总（小时分辨率）
      othersQuery = sql`
        WITH hour_range AS (
          SELECT generate_series(
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())),
            DATE_TRUNC('day', TIMEZONE(${timezone}, NOW())) + INTERVAL '23 hours',
            '1 hour'::interval
          ) AS hour
        ),
        hourly_stats AS (
          SELECT
            hr.hour,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM hour_range hr
          LEFT JOIN message_request mr ON DATE_TRUNC('hour', mr.created_at AT TIME ZONE ${timezone}) = hr.hour
            AND mr.user_id != ${userId}
            AND mr.deleted_at IS NULL
          GROUP BY hr.hour
        )
        SELECT
          -1 AS user_id,
          '其他用户' AS user_name,
          hour AS date,
          api_calls::integer,
          total_cost::numeric
        FROM hourly_stats
        ORDER BY hour ASC
      `;
      break;

    case "7days":
      // 自己的密钥明细（天分辨率）
      ownKeysQuery = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        daily_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, dr.date
        )
        SELECT
          key_id,
          key_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, key_name ASC
      `;

      // 其他用户汇总（天分辨率）
      othersQuery = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '6 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        daily_stats AS (
          SELECT
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM date_range dr
          LEFT JOIN message_request mr ON (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.user_id != ${userId}
            AND mr.deleted_at IS NULL
          GROUP BY dr.date
        )
        SELECT
          -1 AS user_id,
          '其他用户' AS user_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC
      `;
      break;

    case "30days":
      // 自己的密钥明细（天分辨率）
      ownKeysQuery = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '29 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        daily_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, dr.date
        )
        SELECT
          key_id,
          key_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, key_name ASC
      `;

      // 其他用户汇总（天分辨率）
      othersQuery = sql`
        WITH date_range AS (
          SELECT generate_series(
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date - INTERVAL '29 days',
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        daily_stats AS (
          SELECT
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM date_range dr
          LEFT JOIN message_request mr ON (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.user_id != ${userId}
            AND mr.deleted_at IS NULL
          GROUP BY dr.date
        )
        SELECT
          -1 AS user_id,
          '其他用户' AS user_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC
      `;
      break;

    case "thisMonth":
      // 自己的密钥明细（天分辨率，本月）
      ownKeysQuery = sql`
        WITH date_range AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        user_keys AS (
          SELECT id, name, key
          FROM keys
          WHERE user_id = ${userId}
            AND deleted_at IS NULL
        ),
        daily_stats AS (
          SELECT
            k.id AS key_id,
            k.name AS key_name,
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM user_keys k
          CROSS JOIN date_range dr
          LEFT JOIN message_request mr ON mr.key = k.key
            AND mr.user_id = ${userId}
            AND (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.deleted_at IS NULL
          GROUP BY k.id, k.name, dr.date
        )
        SELECT
          key_id,
          key_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC, key_name ASC
      `;

      // 其他用户汇总（天分辨率，本月）
      othersQuery = sql`
        WITH date_range AS (
          SELECT generate_series(
            DATE_TRUNC('month', CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date,
            '1 day'::interval
          )::date AS date
        ),
        daily_stats AS (
          SELECT
            dr.date,
            COUNT(mr.id) AS api_calls,
            COALESCE(SUM(mr.cost_usd), 0) AS total_cost
          FROM date_range dr
          LEFT JOIN message_request mr ON (mr.created_at AT TIME ZONE ${timezone})::date = dr.date
            AND mr.user_id != ${userId}
            AND mr.deleted_at IS NULL
          GROUP BY dr.date
        )
        SELECT
          -1 AS user_id,
          '其他用户' AS user_name,
          date,
          api_calls::integer,
          total_cost::numeric
        FROM daily_stats
        ORDER BY date ASC
      `;
      break;

    default:
      throw new Error(`Unsupported time range: ${timeRange}`);
  }

  const [ownKeysResult, othersResult] = await Promise.all([
    db.execute(ownKeysQuery),
    db.execute(othersQuery),
  ]);

  return {
    ownKeys: Array.from(ownKeysResult) as unknown as DatabaseKeyStatRow[],
    othersAggregate: Array.from(othersResult) as unknown as DatabaseStatRow[],
  };
}

/**
 * 查询用户今日总消费（所有 Key 的消费总和）
 * 用于用户层每日限额检查（Redis 降级）
 */
export async function sumUserCostToday(userId: number): Promise<number> {
  const timezone = getEnvConfig().TZ;

  const query = sql`
    SELECT COALESCE(SUM(mr.cost_usd), 0) AS total_cost
    FROM message_request mr
    INNER JOIN keys k ON mr.key = k.key
    WHERE k.user_id = ${userId}
      AND (mr.created_at AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date
      AND mr.deleted_at IS NULL
      AND k.deleted_at IS NULL
  `;

  const result = await db.execute(query);
  const row = Array.from(result)[0] as { total_cost?: string | number } | undefined;
  return Number(row?.total_cost || 0);
}

/**
 * 查询 Key 历史总消费（通过 Key ID）
 * 用于显示 Key 的历史总消费统计
 * @param keyId - Key 的数据库 ID
 * @param maxAgeDays - 最大查询天数，默认 365 天（避免全表扫描）
 */
export async function sumKeyTotalCostById(
  keyId: number,
  maxAgeDays: number = 365
): Promise<number> {
  // 先查询 key 字符串
  const keyRecord = await db
    .select({ key: keys.key })
    .from(keys)
    .where(eq(keys.id, keyId))
    .limit(1);

  if (!keyRecord || keyRecord.length === 0) return 0;

  return sumKeyTotalCost(keyRecord[0].key, maxAgeDays);
}

/**
 * 查询 Key 历史总消费（带时间边界优化）
 * 用于总消费限额检查
 * @param keyHash - API Key 的哈希值
 * @param maxAgeDays - 最大查询天数，默认 365 天（避免全表扫描）
 */
export async function sumKeyTotalCost(keyHash: string, maxAgeDays: number = 365): Promise<number> {
  // Validate maxAgeDays - use default 365 for invalid values
  const validMaxAgeDays =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? Math.floor(maxAgeDays) : 365;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - validMaxAgeDays);

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.key, keyHash),
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, cutoffDate)
      )
    );

  return Number(result[0]?.total || 0);
}

/**
 * 查询用户历史总消费（所有 Key 累计，带时间边界优化）
 * 用于总消费限额检查
 * @param userId - 用户 ID
 * @param maxAgeDays - 最大查询天数，默认 365 天（避免全表扫描）
 */
export async function sumUserTotalCost(userId: number, maxAgeDays: number = 365): Promise<number> {
  // Validate maxAgeDays - use default 365 for invalid values
  const validMaxAgeDays =
    Number.isFinite(maxAgeDays) && maxAgeDays > 0 ? Math.floor(maxAgeDays) : 365;

  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - validMaxAgeDays);

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.userId, userId),
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, cutoffDate)
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
  // 注意：message_request.key 存储的是 API key 字符串，需要先查询 keys 表获取 key 值
  const keyRecord = await db
    .select({ key: keys.key })
    .from(keys)
    .where(eq(keys.id, keyId))
    .limit(1);

  if (!keyRecord || keyRecord.length === 0) return 0;

  const keyString = keyRecord[0].key;

  const result = await db
    .select({ total: sql<number>`COALESCE(SUM(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.key, keyString), // 使用 key 字符串而非 ID
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt)
      )
    );

  return Number(result[0]?.total || 0);
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
  const timezone = getEnvConfig().TZ;
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
    const keyRecord = await db
      .select({ key: keys.key })
      .from(keys)
      .where(eq(keys.id, key_id))
      .limit(1);

    if (keyRecord && keyRecord.length > 0) {
      keyString = keyRecord[0].key;
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
    .select({ total: sql<number>`COALESCE(SUM(${messageRequest.costUsd}), 0)` })
    .from(messageRequest)
    .where(
      and(
        eq(messageRequest.providerId, providerId),
        gte(messageRequest.createdAt, startTime),
        lt(messageRequest.createdAt, endTime),
        isNull(messageRequest.deletedAt)
      )
    );

  return Number(result[0]?.total || 0);
}
