"use server";

import { db } from "@/drizzle/db";
import { logger } from "@/lib/logger";
import { providers } from "@/drizzle/schema";
import { eq, isNull, and, desc, sql } from "drizzle-orm";
import type { Provider, CreateProviderData, UpdateProviderData } from "@/types/provider";
import { toProvider } from "./_shared/transformers";
import { getEnvConfig } from "@/lib/config";

export async function createProvider(providerData: CreateProviderData): Promise<Provider> {
  const dbData = {
    name: providerData.name,
    url: providerData.url,
    officialSiteUrl: providerData.official_site_url ?? null,
    key: providerData.key,
    isEnabled: providerData.is_enabled,
    weight: providerData.weight,
    priority: providerData.priority,
    costMultiplier:
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0",
    groupTag: providerData.group_tag,
    providerType: providerData.provider_type,
    modelRedirects: providerData.model_redirects,
    allowedModels: providerData.allowed_models,
    joinClaudePool: providerData.join_claude_pool ?? false,
    limit5hUsd: providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null,
    limitWeeklyUsd:
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null,
    limitMonthlyUsd:
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null,
    limitConcurrentSessions: providerData.limit_concurrent_sessions,
    circuitBreakerFailureThreshold: providerData.circuit_breaker_failure_threshold ?? 5,
    circuitBreakerOpenDuration: providerData.circuit_breaker_open_duration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold:
      providerData.circuit_breaker_half_open_success_threshold ?? 2,
    proxyUrl: providerData.proxy_url ?? null,
    proxyFallbackToDirect: providerData.proxy_fallback_to_direct ?? false,
    tpm: providerData.tpm,
    rpm: providerData.rpm,
    rpd: providerData.rpd,
    cc: providerData.cc,
  };

  const [provider] = await db.insert(providers).values(dbData).returning({
    id: providers.id,
    name: providers.name,
    url: providers.url,
    key: providers.key,
    isEnabled: providers.isEnabled,
    weight: providers.weight,
    priority: providers.priority,
    costMultiplier: providers.costMultiplier,
    groupTag: providers.groupTag,
    officialSiteUrl: providers.officialSiteUrl,
    providerType: providers.providerType,
    modelRedirects: providers.modelRedirects,
    allowedModels: providers.allowedModels,
    joinClaudePool: providers.joinClaudePool,
    limit5hUsd: providers.limit5hUsd,
    limitWeeklyUsd: providers.limitWeeklyUsd,
    limitMonthlyUsd: providers.limitMonthlyUsd,
    limitConcurrentSessions: providers.limitConcurrentSessions,
    circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
    circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
    circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
    proxyUrl: providers.proxyUrl,
    proxyFallbackToDirect: providers.proxyFallbackToDirect,
    tpm: providers.tpm,
    rpm: providers.rpm,
    rpd: providers.rpd,
    cc: providers.cc,
    createdAt: providers.createdAt,
    updatedAt: providers.updatedAt,
    deletedAt: providers.deletedAt,
  });

  return toProvider(provider);
}

export async function findProviderList(
  limit: number = 50,
  offset: number = 0
): Promise<Provider[]> {
  const result = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      key: providers.key,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      officialSiteUrl: providers.officialSiteUrl,
      providerType: providers.providerType,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      joinClaudePool: providers.joinClaudePool,
      limit5hUsd: providers.limit5hUsd,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(isNull(providers.deletedAt))
    .orderBy(desc(providers.createdAt))
    .limit(limit)
    .offset(offset);

  logger.trace("findProviderList:query_result", {
    count: result.length,
    ids: result.map((r) => r.id),
  });

  return result.map(toProvider);
}

export async function findProviderById(id: number): Promise<Provider | null> {
  const [provider] = await db
    .select({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      officialSiteUrl: providers.officialSiteUrl,
      key: providers.key,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      joinClaudePool: providers.joinClaudePool,
      limit5hUsd: providers.limit5hUsd,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    })
    .from(providers)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)));

  if (!provider) return null;
  return toProvider(provider);
}

export async function updateProvider(
  id: number,
  providerData: UpdateProviderData
): Promise<Provider | null> {
  if (Object.keys(providerData).length === 0) {
    return findProviderById(id);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dbData: any = {
    updatedAt: new Date(),
  };
  if (providerData.name !== undefined) dbData.name = providerData.name;
  if (providerData.url !== undefined) dbData.url = providerData.url;
  if (providerData.official_site_url !== undefined)
    dbData.officialSiteUrl = providerData.official_site_url;
  if (providerData.key !== undefined) dbData.key = providerData.key;
  if (providerData.is_enabled !== undefined) dbData.isEnabled = providerData.is_enabled;
  if (providerData.weight !== undefined) dbData.weight = providerData.weight;
  if (providerData.priority !== undefined) dbData.priority = providerData.priority;
  if (providerData.cost_multiplier !== undefined)
    dbData.costMultiplier =
      providerData.cost_multiplier != null ? providerData.cost_multiplier.toString() : "1.0";
  if (providerData.group_tag !== undefined) dbData.groupTag = providerData.group_tag;
  if (providerData.provider_type !== undefined) dbData.providerType = providerData.provider_type;
  if (providerData.model_redirects !== undefined)
    dbData.modelRedirects = providerData.model_redirects;
  if (providerData.allowed_models !== undefined) dbData.allowedModels = providerData.allowed_models;
  if (providerData.join_claude_pool !== undefined)
    dbData.joinClaudePool = providerData.join_claude_pool;
  if (providerData.limit_5h_usd !== undefined)
    dbData.limit5hUsd =
      providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null;
  if (providerData.limit_weekly_usd !== undefined)
    dbData.limitWeeklyUsd =
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null;
  if (providerData.limit_monthly_usd !== undefined)
    dbData.limitMonthlyUsd =
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null;
  if (providerData.limit_concurrent_sessions !== undefined)
    dbData.limitConcurrentSessions = providerData.limit_concurrent_sessions;
  if (providerData.circuit_breaker_failure_threshold !== undefined)
    dbData.circuitBreakerFailureThreshold = providerData.circuit_breaker_failure_threshold;
  if (providerData.circuit_breaker_open_duration !== undefined)
    dbData.circuitBreakerOpenDuration = providerData.circuit_breaker_open_duration;
  if (providerData.circuit_breaker_half_open_success_threshold !== undefined)
    dbData.circuitBreakerHalfOpenSuccessThreshold =
      providerData.circuit_breaker_half_open_success_threshold;
  if (providerData.proxy_url !== undefined) dbData.proxyUrl = providerData.proxy_url;
  if (providerData.proxy_fallback_to_direct !== undefined)
    dbData.proxyFallbackToDirect = providerData.proxy_fallback_to_direct;
  if (providerData.tpm !== undefined) dbData.tpm = providerData.tpm;
  if (providerData.rpm !== undefined) dbData.rpm = providerData.rpm;
  if (providerData.rpd !== undefined) dbData.rpd = providerData.rpd;
  if (providerData.cc !== undefined) dbData.cc = providerData.cc;

  const [provider] = await db
    .update(providers)
    .set(dbData)
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({
      id: providers.id,
      name: providers.name,
      url: providers.url,
      officialSiteUrl: providers.officialSiteUrl,
      key: providers.key,
      isEnabled: providers.isEnabled,
      weight: providers.weight,
      priority: providers.priority,
      costMultiplier: providers.costMultiplier,
      groupTag: providers.groupTag,
      providerType: providers.providerType,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      joinClaudePool: providers.joinClaudePool,
      limit5hUsd: providers.limit5hUsd,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      tpm: providers.tpm,
      rpm: providers.rpm,
      rpd: providers.rpd,
      cc: providers.cc,
      createdAt: providers.createdAt,
      updatedAt: providers.updatedAt,
      deletedAt: providers.deletedAt,
    });

  if (!provider) return null;
  return toProvider(provider);
}

export async function deleteProvider(id: number): Promise<boolean> {
  const result = await db
    .update(providers)
    .set({ deletedAt: new Date() })
    .where(and(eq(providers.id, id), isNull(providers.deletedAt)))
    .returning({ id: providers.id });

  return result.length > 0;
}

/**
 * 获取所有供应商的统计信息
 * 包括：今天的总金额、今天的调用次数、最近一次调用时间和模型
 */
export async function getProviderStatistics(): Promise<
  Array<{
    id: number;
    today_cost: string;
    today_calls: number;
    last_call_time: Date | null;
    last_call_model: string | null;
  }>
> {
  try {
    // 时区感知的时间处理
    // 获取今日时间范围（本地时区）
    const timezone = getEnvConfig().TZ;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const tomorrow = new Date(today);
    tomorrow.setDate(tomorrow.getDate() + 1);

    // 从 Date 对象提取本地时间（不要用 toISOString，那会转换为 UTC）
    const todayYear = today.getFullYear();
    const todayMonth = String(today.getMonth() + 1).padStart(2, "0");
    const todayDay = String(today.getDate()).padStart(2, "0");
    const todayLocalStr = `${todayYear}-${todayMonth}-${todayDay} 00:00:00`;

    const tomorrowYear = tomorrow.getFullYear();
    const tomorrowMonth = String(tomorrow.getMonth() + 1).padStart(2, "0");
    const tomorrowDay = String(tomorrow.getDate()).padStart(2, "0");
    const tomorrowLocalStr = `${tomorrowYear}-${tomorrowMonth}-${tomorrowDay} 00:00:00`;

    const query = sql`
      WITH provider_stats AS (
        SELECT
          p.id,
          COALESCE(
            SUM(CASE WHEN (mr.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp >= ${todayLocalStr}::timestamp
                      AND (mr.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp < ${tomorrowLocalStr}::timestamp
                 THEN mr.cost_usd ELSE 0 END),
            0
          ) AS today_cost,
          COUNT(CASE WHEN (mr.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp >= ${todayLocalStr}::timestamp
                       AND (mr.created_at AT TIME ZONE 'UTC' AT TIME ZONE ${timezone})::timestamp < ${tomorrowLocalStr}::timestamp
                  THEN 1 END)::integer AS today_calls
        FROM providers p
        LEFT JOIN message_request mr ON p.id = mr.provider_id
          AND mr.deleted_at IS NULL
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
      ),
      latest_call AS (
        SELECT DISTINCT ON (provider_id)
          provider_id,
          created_at AS last_call_time,
          model AS last_call_model
        FROM message_request
        WHERE deleted_at IS NULL
        ORDER BY provider_id, created_at DESC
      )
      SELECT
        ps.id,
        ps.today_cost,
        ps.today_calls,
        lc.last_call_time,
        lc.last_call_model
      FROM provider_stats ps
      LEFT JOIN latest_call lc ON ps.id = lc.provider_id
      ORDER BY ps.id ASC
    `;

    logger.trace("getProviderStatistics:executing_query");

    const result = await db.execute(query);

    logger.trace("getProviderStatistics:result", {
      count: Array.isArray(result) ? result.length : 0,
    });

    // postgres-js 返回的结果需要通过 unknown 进行类型断言
    return result as unknown as Array<{
      id: number;
      today_cost: string;
      today_calls: number;
      last_call_time: Date | null;
      last_call_model: string | null;
    }>;
  } catch (error) {
    logger.trace("getProviderStatistics:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    throw error;
  }
}
