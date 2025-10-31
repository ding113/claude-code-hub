"use server";

import { db } from "@/drizzle/db";
import { keys, users, messageRequest, providers } from "@/drizzle/schema";
import { eq, isNull, and, or, gt, gte, lt, count, sum, desc, sql } from "drizzle-orm";
import type { Key, CreateKeyData, UpdateKeyData } from "@/types/key";
import type { User } from "@/types/user";
import { toKey, toUser } from "./_shared/transformers";
import { Decimal, toCostDecimal } from "@/lib/utils/currency";

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
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
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
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
      createdAt: keys.createdAt,
      updatedAt: keys.updatedAt,
      deletedAt: keys.deletedAt,
    })
    .from(keys)
    .where(and(eq(keys.userId, userId), isNull(keys.deletedAt)))
    .orderBy(keys.createdAt);

  return result.map(toKey);
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
    limitWeeklyUsd: keyData.limit_weekly_usd != null ? keyData.limit_weekly_usd.toString() : null,
    limitMonthlyUsd:
      keyData.limit_monthly_usd != null ? keyData.limit_monthly_usd.toString() : null,
    limitConcurrentSessions: keyData.limit_concurrent_sessions,
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
    limitWeeklyUsd: keys.limitWeeklyUsd,
    limitMonthlyUsd: keys.limitMonthlyUsd,
    limitConcurrentSessions: keys.limitConcurrentSessions,
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
  if (keyData.limit_weekly_usd !== undefined)
    dbData.limitWeeklyUsd =
      keyData.limit_weekly_usd != null ? keyData.limit_weekly_usd.toString() : null;
  if (keyData.limit_monthly_usd !== undefined)
    dbData.limitMonthlyUsd =
      keyData.limit_monthly_usd != null ? keyData.limit_monthly_usd.toString() : null;
  if (keyData.limit_concurrent_sessions !== undefined)
    dbData.limitConcurrentSessions = keyData.limit_concurrent_sessions;

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
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
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
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
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

export async function countActiveKeysByUser(userId: number): Promise<number> {
  const [row] = await db
    .select({ count: count() })
    .from(keys)
    .where(and(eq(keys.userId, userId), isNull(keys.deletedAt)));

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
      limitWeeklyUsd: keys.limitWeeklyUsd,
      limitMonthlyUsd: keys.limitMonthlyUsd,
      limitConcurrentSessions: keys.limitConcurrentSessions,
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
      keyLimitWeeklyUsd: keys.limitWeeklyUsd,
      keyLimitMonthlyUsd: keys.limitMonthlyUsd,
      keyLimitConcurrentSessions: keys.limitConcurrentSessions,
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
    limitWeeklyUsd: row.keyLimitWeeklyUsd,
    limitMonthlyUsd: row.keyLimitMonthlyUsd,
    limitConcurrentSessions: row.keyLimitConcurrentSessions,
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
