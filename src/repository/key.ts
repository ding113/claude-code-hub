"use server";

import { and, count, desc, eq, gt, gte, inArray, isNull, lt, or, sql, sum } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, providers, users } from "@/drizzle/schema";
import { Decimal, toCostDecimal } from "@/lib/utils/currency";
import type { CreateKeyData, Key, UpdateKeyData } from "@/types/key";
import type { User } from "@/types/user";
import { toKey, toUser } from "./_shared/transformers";

export async function findKeyById(id: number): Promise<Key | null> {
  const [key] = await db
    .select({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      name: keys.name,
      isEnabled: keys.isEnabled,
      expiresAt: keys.expiresAt,
      canLoginWebUi: keys.canLoginWebUi,
      limit5hUsd: keys.limit5hUsd,
      limitDailyUsd: keys.limitDailyUsd,
      dailyResetMode: keys.dailyResetMode,
      dailyResetTime: keys.dailyResetTime,
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitTotalUsd: keys.limitTotalUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      providerGroup: keys.providerGroup,
      cacheTtlPreference: keys.cacheTtlPreference,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    })
    .from(keys)
    .where(and(eq(keys.id, id), isNull(keys.deletedAt)));

  if (!key) return null;
  return toKey(key);
}

export async function findKeyList(userId: number): Promise<Key[]> {
  const result = await db
    .select({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      name: keys.name,
      isEnabled: keys.isEnabled,
      expiresAt: keys.expiresAt,
      canLoginWebUi: keys.canLoginWebUi,
      limit5hUsd: keys.limit5hUsd,
      limitDailyUsd: keys.limitDailyUsd,
      dailyResetMode: keys.dailyResetMode,
      dailyResetTime: keys.dailyResetTime,
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitTotalUsd: keys.limitTotalUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      providerGroup: keys.providerGroup,
      cacheTtlPreference: keys.cacheTtlPreference,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    })
    .from(keys)
    .where(and(eq(keys.userId, userId), isNull(keys.deletedAt)))
    .orderBy(keys.createdAt);

  return result.map(toKey);
}

/**
 * Batch version of findKeyList - fetches keys for multiple users in a single query
 * Returns a Map<userId, Key[]> for efficient lookup
 */
export async function findKeyListBatch(userIds: number[]): Promise<Map<number, Key[]>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const result = await db
    .select({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      name: keys.name,
      isEnabled: keys.isEnabled,
      expiresAt: keys.expiresAt,
      canLoginWebUi: keys.canLoginWebUi,
      limit5hUsd: keys.limit5hUsd,
      limitDailyUsd: keys.limitDailyUsd,
      dailyResetMode: keys.dailyResetMode,
      dailyResetTime: keys.dailyResetTime,
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitTotalUsd: keys.limitTotalUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      providerGroup: keys.providerGroup,
      cacheTtlPreference: keys.cacheTtlPreference,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    })
    .from(keys)
    .where(and(inArray(keys.userId, userIds), isNull(keys.deletedAt)))
    .orderBy(keys.userId, keys.createdAt);

  const keyMap = new Map<number, Key[]>();
  for (const userId of userIds) {
    keyMap.set(userId, []);
  }

  for (const row of result) {
    const key = toKey(row);
    const userKeys = keyMap.get(row.userId);
    if (userKeys) {
      userKeys.push(key);
    }
  }

  return keyMap;
}

export async function createKey(keyData: CreateKeyData): Promise<Key> {
  const dbData = {
    userId: keyData.user_id,
    key: keyData.key,
    name: keyData.name,
    isEnabled: keyData.is_enabled,
    expiresAt: keyData.expires_at,
    canLoginWebUi: keyData.can_login_web_ui ?? true,
    limit5hUsd: keyData.limit_5h_usd != null ? keyData.limit_5h_usd.toString() : null,
    limitDailyUsd: keyData.limit_daily_usd != null ? keyData.limit_daily_usd.toString() : null,
    dailyResetMode: keyData.daily_reset_mode ?? "fixed",
    dailyResetTime: keyData.daily_reset_time ?? "00:00",
    limitWeeklyUsd: keyData.limit_weekly_usd != null ? keyData.limit_weekly_usd.toString() : null,
    limitMonthlyUsd:
      keyData.limit_monthly_usd != null ? keyData.limit_monthly_usd.toString() : null,
    limitTotalUsd: keyData.limit_total_usd != null ? keyData.limit_total_usd.toString() : null,
    limitConcurrentSessions: keyData.limit_concurrent_sessions,
    providerGroup: keyData.provider_group ?? null,
    cacheTtlPreference: keyData.cache_ttl_preference ?? null,
  };

  const [key] = await db.insert(keys).values(dbData).returning({
    id: keys.id,
    userId: keys.userId,
    key: keys.key,
    name: keys.name,
    isEnabled: keys.isEnabled,
    expiresAt: keys.expiresAt,
    canLoginWebUi: keys.canLoginWebUi,
    limit5hUsd: keys.limit5hUsd,
    limitDailyUsd: keys.limitDailyUsd,
    dailyResetMode: keys.dailyResetMode,
    dailyResetTime: keys.dailyResetTime,
    limitWeeklyUsd: keys.limitWeeklyUsd,
    limitMonthlyUsd: keys.limitMonthlyUsd,
    limitTotalUsd: keys.limitTotalUsd,
    limitConcurrentSessions: keys.limitConcurrentSessions,
    providerGroup: keys.providerGroup,
    createdAt: keys.createdAt,
    updatedAt: keys.updatedAt,
    deletedAt: keys.deletedAt,
  });

  return toKey(key);
}

export async function updateKey(id: number, keyData: UpdateKeyData): Promise<Key | null> {
  if (Object.keys(keyData).length === 0) {
    return findKeyById(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };
  if (keyData.name !== undefined) dbData.name = keyData.name;
  if (keyData.is_enabled !== undefined) dbData.isEnabled = keyData.is_enabled;
  if (keyData.expires_at !== undefined) dbData.expiresAt = keyData.expires_at;
  if (keyData.can_login_web_ui !== undefined) dbData.canLoginWebUi = keyData.can_login_web_ui;
  if (keyData.limit_5h_usd !== undefined)
    dbData.limit5hUsd = keyData.limit_5h_usd != null ? keyData.limit_5h_usd.toString() : null;
  if (keyData.limit_daily_usd !== undefined)
    dbData.limitDailyUsd =
      keyData.limit_daily_usd != null ? keyData.limit_daily_usd.toString() : null;
  if (keyData.daily_reset_mode !== undefined) dbData.dailyResetMode = keyData.daily_reset_mode;
  if (keyData.daily_reset_time !== undefined) dbData.dailyResetTime = keyData.daily_reset_time;
  if (keyData.limit_weekly_usd !== undefined)
    dbData.limitWeeklyUsd =
      keyData.limit_weekly_usd != null ? keyData.limit_weekly_usd.toString() : null;
  if (keyData.limit_monthly_usd !== undefined)
    dbData.limitMonthlyUsd =
      keyData.limit_monthly_usd != null ? keyData.limit_monthly_usd.toString() : null;
  if (keyData.limit_total_usd !== undefined)
    dbData.limitTotalUsd =
      keyData.limit_total_usd != null ? keyData.limit_total_usd.toString() : null;
  if (keyData.limit_concurrent_sessions !== undefined)
    dbData.limitConcurrentSessions = keyData.limit_concurrent_sessions;
  if (keyData.provider_group !== undefined) dbData.providerGroup = keyData.provider_group;
  if (keyData.cache_ttl_preference !== undefined)
    dbData.cacheTtlPreference = keyData.cache_ttl_preference ?? null;

  const [key] = await db
    .update(keys)
    .set(dbData)
    .where(and(eq(keys.id, id), isNull(keys.deletedAt)))
    .returning({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      name: keys.name,
      isEnabled: keys.isEnabled,
      expiresAt: keys.expiresAt,
      canLoginWebUi: keys.canLoginWebUi,
      limit5hUsd: keys.limit5hUsd,
      limitDailyUsd: keys.limitDailyUsd,
      dailyResetMode: keys.dailyResetMode,
      dailyResetTime: keys.dailyResetTime,
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitTotalUsd: keys.limitTotalUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      providerGroup: keys.providerGroup,
      cacheTtlPreference: keys.cacheTtlPreference,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    });

  if (!key) return null;
  return toKey(key);
}

export async function findActiveKeyByUserIdAndName(
  userId: number,
  name: string
): Promise<Key | null> {
  const [key] = await db
    .select({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      name: keys.name,
      isEnabled: keys.isEnabled,
      expiresAt: keys.expiresAt,
      canLoginWebUi: keys.canLoginWebUi,
      limit5hUsd: keys.limit5hUsd,
      limitDailyUsd: keys.limitDailyUsd,
      dailyResetMode: keys.dailyResetMode,
      dailyResetTime: keys.dailyResetTime,
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitTotalUsd: keys.limitTotalUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      providerGroup: keys.providerGroup,
      cacheTtlPreference: keys.cacheTtlPreference,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    })
    .from(keys)
    .where(
      and(
        eq(keys.userId, userId),
        eq(keys.name, name),
        isNull(keys.deletedAt),
        eq(keys.isEnabled, true),
        or(isNull(keys.expiresAt), gt(keys.expiresAt, new Date()))
      )
    );

  if (!key) return null;
  return toKey(key);
}

export async function findKeyUsageToday(
  userId: number
): Promise<Array<{ keyId: number; totalCost: number }>> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const rows = await db
    .select({
      keyId: keys.id,
      totalCost: sum(messageRequest.costUsd),
    })
    .from(keys)
    .leftJoin(
      messageRequest,
      and(
        eq(messageRequest.key, keys.key),
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, today),
        lt(messageRequest.createdAt, tomorrow)
      )
    )
    .where(and(eq(keys.userId, userId), isNull(keys.deletedAt)))
    .groupBy(keys.id);

  return rows.map((row) => ({
    keyId: row.keyId,
    totalCost: (() => {
      const costDecimal = toCostDecimal(row.totalCost) ?? new Decimal(0);
      return costDecimal.toDecimalPlaces(6).toNumber();
    })(),
  }));
}

/**
 * Batch version of findKeyUsageToday - fetches today's usage for multiple users in a single query
 * Returns a Map<userId, Array<{keyId, totalCost}>> for efficient lookup
 */
export async function findKeyUsageTodayBatch(
  userIds: number[]
): Promise<Map<number, Array<{ keyId: number; totalCost: number }>>> {
  if (userIds.length === 0) {
    return new Map();
  }

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const rows = await db
    .select({
      userId: keys.userId,
      keyId: keys.id,
      totalCost: sum(messageRequest.costUsd),
    })
    .from(keys)
    .leftJoin(
      messageRequest,
      and(
        eq(messageRequest.key, keys.key),
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, today),
        lt(messageRequest.createdAt, tomorrow)
      )
    )
    .where(and(inArray(keys.userId, userIds), isNull(keys.deletedAt)))
    .groupBy(keys.userId, keys.id);

  const usageMap = new Map<number, Array<{ keyId: number; totalCost: number }>>();
  for (const userId of userIds) {
    usageMap.set(userId, []);
  }

  for (const row of rows) {
    const userUsage = usageMap.get(row.userId);
    if (userUsage) {
      userUsage.push({
        keyId: row.keyId,
        totalCost: (() => {
          const costDecimal = toCostDecimal(row.totalCost) ?? new Decimal(0);
          return costDecimal.toDecimalPlaces(6).toNumber();
        })(),
      });
    }
  }

  return usageMap;
}

export async function countActiveKeysByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(keys)
    .where(and(eq(keys.userId, userId), eq(keys.isEnabled, true), isNull(keys.deletedAt)));

  return Number(row?.count || 0);
}

export async function deleteKey(id: number): Promise<boolean> {
  const result = await db
    .update(keys)
    .set({ deletedAt: new Date() })
    .where(and(eq(keys.id, id), isNull(keys.deletedAt)))
    .returning({ id: keys.id });

  return result.length > 0;
}

export async function findActiveKeyByKeyString(keyString: string): Promise<Key | null> {
  const [key] = await db
    .select({
      id: keys.id,
      userId: keys.userId,
      key: keys.key,
      name: keys.name,
      isEnabled: keys.isEnabled,
      expiresAt: keys.expiresAt,
      canLoginWebUi: keys.canLoginWebUi,
      limit5hUsd: keys.limit5hUsd,
      limitDailyUsd: keys.limitDailyUsd,
      dailyResetMode: keys.dailyResetMode,
      dailyResetTime: keys.dailyResetTime,
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitTotalUsd: keys.limitTotalUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      providerGroup: keys.providerGroup,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    })
    .from(keys)
    .where(
      and(
        eq(keys.key, keyString),
        isNull(keys.deletedAt),
        eq(keys.isEnabled, true),
        or(isNull(keys.expiresAt), gt(keys.expiresAt, new Date()))
      )
    );

  if (!key) return null;
  return toKey(key);
}

// 验证 API Key 并返回用户信息
export async function validateApiKeyAndGetUser(
  keyString: string
): Promise<{ user: User; key: Key } | null> {
  const result = await db
    .select({
      // Key fields
      keyId: keys.id,
      keyUserId: keys.userId,
      keyString: keys.key,
      keyName: keys.name,
      keyIsEnabled: keys.isEnabled,
      keyExpiresAt: keys.expiresAt,
      keyCanLoginWebUi: keys.canLoginWebUi,
      keyLimit5hUsd: keys.limit5hUsd,
      keyLimitDailyUsd: keys.limitDailyUsd,
      keyDailyResetMode: keys.dailyResetMode,
      keyDailyResetTime: keys.dailyResetTime,
      keyLimitWeeklyUsd: keys.limitWeeklyUsd,
      keyLimitMonthlyUsd: keys.limitMonthlyUsd,
      keyLimitTotalUsd: keys.limitTotalUsd,
      keyLimitConcurrentSessions: keys.limitConcurrentSessions,
      keyProviderGroup: keys.providerGroup,
      keyCacheTtlPreference: keys.cacheTtlPreference,
      keyCreatedAt: keys.createdAt,
      keyUpdatedAt: keys.updatedAt,
      keyDeletedAt: keys.deletedAt,
      // User fields
      userId: users.id,
      userName: users.name,
      userDescription: users.description,
      userRole: users.role,
      userRpm: users.rpmLimit,
      userDailyQuota: users.dailyLimitUsd,
      userProviderGroup: users.providerGroup,
      userLimitTotalUsd: users.limitTotalUsd,
      userIsEnabled: users.isEnabled,
      userExpiresAt: users.expiresAt,
      userAllowedClients: users.allowedClients,
      userAllowedModels: users.allowedModels,
      userCreatedAt: users.createdAt,
      userUpdatedAt: users.updatedAt,
      userDeletedAt: users.deletedAt,
    })
    .from(keys)
    .innerJoin(users, eq(keys.userId, users.id))
    .where(
      and(
        eq(keys.key, keyString),
        isNull(keys.deletedAt),
        eq(keys.isEnabled, true),
        or(isNull(keys.expiresAt), gt(keys.expiresAt, new Date())),
        isNull(users.deletedAt)
      )
    );

  if (result.length === 0) {
    return null;
  }

  const row = result[0];

  const user: User = toUser({
    id: row.userId,
    name: row.userName,
    description: row.userDescription,
    role: row.userRole,
    rpm: row.userRpm,
    dailyQuota: row.userDailyQuota,
    providerGroup: row.userProviderGroup,
    limitTotalUsd: row.userLimitTotalUsd,
    isEnabled: row.userIsEnabled,
    expiresAt: row.userExpiresAt,
    allowedClients: row.userAllowedClients,
    allowedModels: row.userAllowedModels,
    createdAt: row.userCreatedAt,
    updatedAt: row.userUpdatedAt,
    deletedAt: row.userDeletedAt,
  });

  const key: Key = toKey({
    id: row.keyId,
    userId: row.keyUserId,
    key: row.keyString,
    name: row.keyName,
    isEnabled: row.keyIsEnabled,
    expiresAt: row.keyExpiresAt,
    canLoginWebUi: row.keyCanLoginWebUi,
    limit5hUsd: row.keyLimit5hUsd,
    limitDailyUsd: row.keyLimitDailyUsd,
    dailyResetMode: row.keyDailyResetMode,
    dailyResetTime: row.keyDailyResetTime,
    limitWeeklyUsd: row.keyLimitWeeklyUsd,
    limitMonthlyUsd: row.keyLimitMonthlyUsd,
    limitTotalUsd: row.keyLimitTotalUsd,
    limitConcurrentSessions: row.keyLimitConcurrentSessions,
    providerGroup: row.keyProviderGroup,
    cacheTtlPreference: row.keyCacheTtlPreference,
    createdAt: row.keyCreatedAt,
    updatedAt: row.keyUpdatedAt,
    deletedAt: row.keyDeletedAt,
  });

  return { user, key };
}

/**
 * 获取密钥的统计信息（用于首页展示）
 */
export interface KeyStatistics {
  keyId: number;
  todayCallCount: number;
  lastUsedAt: Date | null;
  lastProviderName: string | null;
  modelStats: Array<{
    model: string;
    callCount: number;
    totalCost: number;
  }>;
}

export async function findKeysWithStatistics(userId: number): Promise<KeyStatistics[]> {
  const userKeys = await findKeyList(userId);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const stats: KeyStatistics[] = [];

  for (const key of userKeys) {
    // 查询今日调用次数
    const [todayCount] = await db
      .select({ count: count() })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.key, key.key),
          isNull(messageRequest.deletedAt),
          gte(messageRequest.createdAt, today),
          lt(messageRequest.createdAt, tomorrow)
        )
      );

    // 查询最后使用时间和供应商
    const [lastUsage] = await db
      .select({
        createdAt: messageRequest.createdAt,
        providerName: providers.name,
      })
      .from(messageRequest)
      .innerJoin(providers, eq(messageRequest.providerId, providers.id))
      .where(and(eq(messageRequest.key, key.key), isNull(messageRequest.deletedAt)))
      .orderBy(desc(messageRequest.createdAt))
      .limit(1);

    // 查询分模型统计（仅统计当天）
    const modelStatsRows = await db
      .select({
        model: messageRequest.model,
        callCount: sql<number>`count(*)::int`,
        totalCost: sum(messageRequest.costUsd),
      })
      .from(messageRequest)
      .where(
        and(
          eq(messageRequest.key, key.key),
          isNull(messageRequest.deletedAt),
          gte(messageRequest.createdAt, today),
          lt(messageRequest.createdAt, tomorrow),
          sql`${messageRequest.model} IS NOT NULL`
        )
      )
      .groupBy(messageRequest.model)
      .orderBy(desc(sql`count(*)`));

    const modelStats = modelStatsRows.map((row) => ({
      model: row.model || "unknown",
      callCount: row.callCount,
      totalCost: (() => {
        const costDecimal = toCostDecimal(row.totalCost) ?? new Decimal(0);
        return costDecimal.toDecimalPlaces(6).toNumber();
      })(),
    }));

    stats.push({
      keyId: key.id,
      todayCallCount: Number(todayCount?.count || 0),
      lastUsedAt: lastUsage?.createdAt || null,
      lastProviderName: lastUsage?.providerName || null,
      modelStats,
    });
  }

  return stats;
}

/**
 * Batch version of findKeysWithStatistics - fetches statistics for multiple users in optimized queries
 * Returns a Map<userId, KeyStatistics[]> for efficient lookup
 *
 * Optimization: Instead of N*3 queries per user, this does:
 * - 1 query for all keys (via findKeyListBatch)
 * - 1 query for today's call counts
 * - 1 query for last usage times
 * - 1 query for model statistics
 */
export async function findKeysWithStatisticsBatch(
  userIds: number[]
): Promise<Map<number, KeyStatistics[]>> {
  if (userIds.length === 0) {
    return new Map();
  }

  // Step 1: Get all keys for all users
  const keyMap = await findKeyListBatch(userIds);

  // Collect all keys and create a keyString -> (userId, keyId) lookup
  const allKeys: Key[] = [];
  const keyStringToInfo = new Map<string, { userId: number; keyId: number }>();

  for (const [userId, userKeys] of keyMap) {
    for (const key of userKeys) {
      allKeys.push(key);
      keyStringToInfo.set(key.key, { userId, keyId: key.id });
    }
  }

  if (allKeys.length === 0) {
    const resultMap = new Map<number, KeyStatistics[]>();
    for (const userId of userIds) {
      resultMap.set(userId, []);
    }
    return resultMap;
  }

  const keyStrings = allKeys.map((k) => k.key);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  // Step 2: Query today's call counts for all keys at once
  const todayCountRows = await db
    .select({
      key: messageRequest.key,
      count: count(),
    })
    .from(messageRequest)
    .where(
      and(
        inArray(messageRequest.key, keyStrings),
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, today),
        lt(messageRequest.createdAt, tomorrow)
      )
    )
    .groupBy(messageRequest.key);

  const todayCountMap = new Map<string, number>();
  for (const row of todayCountRows) {
    if (row.key) {
      todayCountMap.set(row.key, Number(row.count));
    }
  }

  // Step 3: Query last usage for all keys at once using DISTINCT ON
  const lastUsageRows = await db
    .selectDistinctOn([messageRequest.key], {
      key: messageRequest.key,
      createdAt: messageRequest.createdAt,
      providerName: providers.name,
    })
    .from(messageRequest)
    .innerJoin(providers, eq(messageRequest.providerId, providers.id))
    .where(and(inArray(messageRequest.key, keyStrings), isNull(messageRequest.deletedAt)))
    .orderBy(messageRequest.key, desc(messageRequest.createdAt));

  const lastUsageMap = new Map<string, { createdAt: Date | null; providerName: string | null }>();
  for (const row of lastUsageRows) {
    if (row.key) {
      lastUsageMap.set(row.key, {
        createdAt: row.createdAt,
        providerName: row.providerName,
      });
    }
  }

  // Step 4: Query model statistics for all keys at once
  const modelStatsRows = await db
    .select({
      key: messageRequest.key,
      model: messageRequest.model,
      callCount: sql<number>`count(*)::int`,
      totalCost: sum(messageRequest.costUsd),
    })
    .from(messageRequest)
    .where(
      and(
        inArray(messageRequest.key, keyStrings),
        isNull(messageRequest.deletedAt),
        gte(messageRequest.createdAt, today),
        lt(messageRequest.createdAt, tomorrow),
        sql`${messageRequest.model} IS NOT NULL`
      )
    )
    .groupBy(messageRequest.key, messageRequest.model)
    .orderBy(messageRequest.key, desc(sql`count(*)`));

  // Group model stats by key
  const modelStatsMap = new Map<
    string,
    Array<{ model: string; callCount: number; totalCost: number }>
  >();
  for (const row of modelStatsRows) {
    if (row.key) {
      if (!modelStatsMap.has(row.key)) {
        modelStatsMap.set(row.key, []);
      }
      modelStatsMap.get(row.key)!.push({
        model: row.model || "unknown",
        callCount: row.callCount,
        totalCost: (() => {
          const costDecimal = toCostDecimal(row.totalCost) ?? new Decimal(0);
          return costDecimal.toDecimalPlaces(6).toNumber();
        })(),
      });
    }
  }

  // Step 5: Assemble results by userId
  const resultMap = new Map<number, KeyStatistics[]>();
  for (const userId of userIds) {
    resultMap.set(userId, []);
  }

  for (const key of allKeys) {
    const info = keyStringToInfo.get(key.key);
    if (!info) continue;

    const lastUsage = lastUsageMap.get(key.key);
    const stats: KeyStatistics = {
      keyId: key.id,
      todayCallCount: todayCountMap.get(key.key) || 0,
      lastUsedAt: lastUsage?.createdAt || null,
      lastProviderName: lastUsage?.providerName || null,
      modelStats: modelStatsMap.get(key.key) || [],
    };

    const userStats = resultMap.get(info.userId);
    if (userStats) {
      userStats.push(stats);
    }
  }

  return resultMap;
}
