"use server";

import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { providers } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import type { CreateProviderData, Provider, UpdateProviderData } from "@/types/provider";
import { toProvider } from "./_shared/transformers";

export async function createProvider(providerData: CreateProviderData): Promise<Provider> {
  const dbData = {
    name: providerData.name,
    url: providerData.url,
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
    codexInstructionsStrategy: providerData.codex_instructions_strategy ?? "auto",
    mcpPassthroughType: providerData.mcp_passthrough_type ?? "none",
    mcpPassthroughUrl: providerData.mcp_passthrough_url ?? null,
    limit5hUsd: providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null,
    limitDailyUsd:
      providerData.limit_daily_usd != null ? providerData.limit_daily_usd.toString() : null,
    dailyResetMode: providerData.daily_reset_mode ?? "fixed",
    dailyResetTime: providerData.daily_reset_time ?? "00:00",
    limitWeeklyUsd:
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null,
    limitMonthlyUsd:
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null,
    limitConcurrentSessions: providerData.limit_concurrent_sessions,
    maxRetryAttempts: providerData.max_retry_attempts ?? null,
    circuitBreakerFailureThreshold: providerData.circuit_breaker_failure_threshold ?? 5,
    circuitBreakerOpenDuration: providerData.circuit_breaker_open_duration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold:
      providerData.circuit_breaker_half_open_success_threshold ?? 2,
    proxyUrl: providerData.proxy_url ?? null,
    proxyFallbackToDirect: providerData.proxy_fallback_to_direct ?? false,
    firstByteTimeoutStreamingMs: providerData.first_byte_timeout_streaming_ms ?? 30000,
    streamingIdleTimeoutMs: providerData.streaming_idle_timeout_ms ?? 10000,
    requestTimeoutNonStreamingMs: providerData.request_timeout_non_streaming_ms ?? 600000,
    websiteUrl: providerData.website_url ?? null,
    faviconUrl: providerData.favicon_url ?? null,
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
    providerType: providers.providerType,
    modelRedirects: providers.modelRedirects,
    allowedModels: providers.allowedModels,
    joinClaudePool: providers.joinClaudePool,
    codexInstructionsStrategy: providers.codexInstructionsStrategy,
    mcpPassthroughType: providers.mcpPassthroughType,
    mcpPassthroughUrl: providers.mcpPassthroughUrl,
    limit5hUsd: providers.limit5hUsd,
    limitDailyUsd: providers.limitDailyUsd,
    dailyResetMode: providers.dailyResetMode,
    dailyResetTime: providers.dailyResetTime,
    limitWeeklyUsd: providers.limitWeeklyUsd,
    limitMonthlyUsd: providers.limitMonthlyUsd,
    limitConcurrentSessions: providers.limitConcurrentSessions,
    maxRetryAttempts: providers.maxRetryAttempts,
    circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
    circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
    circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
    proxyUrl: providers.proxyUrl,
    proxyFallbackToDirect: providers.proxyFallbackToDirect,
    firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
    streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
    requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
    websiteUrl: providers.websiteUrl,
    faviconUrl: providers.faviconUrl,
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
      providerType: providers.providerType,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      joinClaudePool: providers.joinClaudePool,
      codexInstructionsStrategy: providers.codexInstructionsStrategy,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
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

/**
 * Fetch all providers without pagination limits.
 * Use this when you need the complete provider list (e.g., for selection, health status).
 */
export async function findAllProviders(): Promise<Provider[]> {
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
      providerType: providers.providerType,
      modelRedirects: providers.modelRedirects,
      allowedModels: providers.allowedModels,
      joinClaudePool: providers.joinClaudePool,
      codexInstructionsStrategy: providers.codexInstructionsStrategy,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
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
    .orderBy(desc(providers.createdAt));

  logger.trace("findAllProviders:query_result", {
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
      codexInstructionsStrategy: providers.codexInstructionsStrategy,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
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
  if (providerData.codex_instructions_strategy !== undefined)
    dbData.codexInstructionsStrategy = providerData.codex_instructions_strategy;
  if (providerData.mcp_passthrough_type !== undefined)
    dbData.mcpPassthroughType = providerData.mcp_passthrough_type;
  if (providerData.mcp_passthrough_url !== undefined)
    dbData.mcpPassthroughUrl = providerData.mcp_passthrough_url;
  if (providerData.limit_5h_usd !== undefined)
    dbData.limit5hUsd =
      providerData.limit_5h_usd != null ? providerData.limit_5h_usd.toString() : null;
  if (providerData.limit_daily_usd !== undefined)
    dbData.limitDailyUsd =
      providerData.limit_daily_usd != null ? providerData.limit_daily_usd.toString() : null;
  if (providerData.daily_reset_mode !== undefined)
    dbData.dailyResetMode = providerData.daily_reset_mode;
  if (providerData.daily_reset_time !== undefined)
    dbData.dailyResetTime = providerData.daily_reset_time;
  if (providerData.limit_weekly_usd !== undefined)
    dbData.limitWeeklyUsd =
      providerData.limit_weekly_usd != null ? providerData.limit_weekly_usd.toString() : null;
  if (providerData.limit_monthly_usd !== undefined)
    dbData.limitMonthlyUsd =
      providerData.limit_monthly_usd != null ? providerData.limit_monthly_usd.toString() : null;
  if (providerData.limit_concurrent_sessions !== undefined)
    dbData.limitConcurrentSessions = providerData.limit_concurrent_sessions;
  if (providerData.max_retry_attempts !== undefined)
    dbData.maxRetryAttempts = providerData.max_retry_attempts;
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
  if (providerData.first_byte_timeout_streaming_ms !== undefined)
    dbData.firstByteTimeoutStreamingMs = providerData.first_byte_timeout_streaming_ms;
  if (providerData.streaming_idle_timeout_ms !== undefined)
    dbData.streamingIdleTimeoutMs = providerData.streaming_idle_timeout_ms;
  if (providerData.request_timeout_non_streaming_ms !== undefined)
    dbData.requestTimeoutNonStreamingMs = providerData.request_timeout_non_streaming_ms;
  if (providerData.website_url !== undefined) dbData.websiteUrl = providerData.website_url;
  if (providerData.favicon_url !== undefined) dbData.faviconUrl = providerData.favicon_url;
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
      codexInstructionsStrategy: providers.codexInstructionsStrategy,
      mcpPassthroughType: providers.mcpPassthroughType,
      mcpPassthroughUrl: providers.mcpPassthroughUrl,
      limit5hUsd: providers.limit5hUsd,
      limitDailyUsd: providers.limitDailyUsd,
      dailyResetMode: providers.dailyResetMode,
      dailyResetTime: providers.dailyResetTime,
      limitWeeklyUsd: providers.limitWeeklyUsd,
      limitMonthlyUsd: providers.limitMonthlyUsd,
      limitConcurrentSessions: providers.limitConcurrentSessions,
      maxRetryAttempts: providers.maxRetryAttempts,
      circuitBreakerFailureThreshold: providers.circuitBreakerFailureThreshold,
      circuitBreakerOpenDuration: providers.circuitBreakerOpenDuration,
      circuitBreakerHalfOpenSuccessThreshold: providers.circuitBreakerHalfOpenSuccessThreshold,
      proxyUrl: providers.proxyUrl,
      proxyFallbackToDirect: providers.proxyFallbackToDirect,
      firstByteTimeoutStreamingMs: providers.firstByteTimeoutStreamingMs,
      streamingIdleTimeoutMs: providers.streamingIdleTimeoutMs,
      requestTimeoutNonStreamingMs: providers.requestTimeoutNonStreamingMs,
      websiteUrl: providers.websiteUrl,
      faviconUrl: providers.faviconUrl,
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
 * 获取所有不同的供应商分组标签
 * 用于用户表单中的供应商分组选择建议
 *
 * 注意：groupTag 字段以逗号分隔存储多个标签（如 "cli,chat"），
 * 此函数会拆分并去重，返回单个标签的数组（如 ["chat", "cli"]）
 */
export async function getDistinctProviderGroups(): Promise<string[]> {
  const result = await db
    .selectDistinct({ groupTag: providers.groupTag })
    .from(providers)
    .where(
      and(
        isNull(providers.deletedAt),
        sql`${providers.groupTag} IS NOT NULL AND ${providers.groupTag} != ''`
      )
    )
    .orderBy(providers.groupTag);

  // 拆分逗号分隔的标签并去重
  const allTags = result
    .map((r) => r.groupTag)
    .filter((tag): tag is string => tag !== null)
    .flatMap((tag) =>
      tag
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean)
    );

  return [...new Set(allTags)].sort();
}

/**
 * 获取所有供应商的统计信息
 * 包括：今天的总金额、今天的调用次数、最近一次调用时间和模型
 *
 * 性能优化：
 * - provider_stats CTE: LEFT JOIN 添加日期过滤，仅扫描今日数据（避免全表扫描）
 * - latest_call CTE: 添加 7 天时间范围限制（避免扫描历史数据）
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
    // 统一的时区处理：使用 PostgreSQL AT TIME ZONE + 环境变量 TZ
    // 参考 getUserStatisticsFromDB 的实现，避免 Node.js Date 带来的时区偏移
    const timezone = getEnvConfig().TZ;

    // ⭐ 使用 providerChain 最后一项的 providerId 来确定最终供应商（兼容重试切换）
    // 如果 provider_chain 为空（无重试），则使用 provider_id 字段
    const query = sql`
      WITH provider_stats AS (
        SELECT
          p.id,
          COALESCE(
            SUM(CASE
              WHEN (mr.created_at AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date
                AND (
                  -- 情况1：无重试（provider_chain 为 NULL 或空数组），使用 provider_id
                  (mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id
                  OR
                  -- 情况2：有重试，使用 providerChain 最后一项的 id
                  (mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
                   AND (mr.provider_chain->-1->>'id')::int = p.id)
                )
              THEN mr.cost_usd ELSE 0 END),
            0
          ) AS today_cost,
          COUNT(CASE
            WHEN (mr.created_at AT TIME ZONE ${timezone})::date = (CURRENT_TIMESTAMP AT TIME ZONE ${timezone})::date
              AND (
                (mr.provider_chain IS NULL OR jsonb_array_length(mr.provider_chain) = 0) AND mr.provider_id = p.id
                OR
                (mr.provider_chain IS NOT NULL AND jsonb_array_length(mr.provider_chain) > 0
                 AND (mr.provider_chain->-1->>'id')::int = p.id)
              )
            THEN 1 END)::integer AS today_calls
        FROM providers p
        -- 性能优化：添加日期过滤条件，仅扫描今日数据（避免全表扫描）
        LEFT JOIN message_request mr ON mr.deleted_at IS NULL
          AND mr.created_at >= (CURRENT_DATE AT TIME ZONE ${timezone})
        WHERE p.deleted_at IS NULL
        GROUP BY p.id
      ),
      latest_call AS (
        SELECT DISTINCT ON (final_provider_id)
          -- 计算最终供应商ID：优先使用 providerChain 最后一项的 id
          CASE
            WHEN provider_chain IS NULL OR jsonb_array_length(provider_chain) = 0 THEN provider_id
            ELSE (provider_chain->-1->>'id')::int
          END AS final_provider_id,
          created_at AS last_call_time,
          model AS last_call_model
        FROM message_request
        -- 性能优化：添加 7 天时间范围限制（避免扫描历史数据）
        WHERE deleted_at IS NULL
          AND created_at >= (CURRENT_DATE AT TIME ZONE ${timezone} - INTERVAL '7 days')
        ORDER BY final_provider_id, created_at DESC
      )
      SELECT
        ps.id,
        ps.today_cost,
        ps.today_calls,
        lc.last_call_time,
        lc.last_call_model
      FROM provider_stats ps
      LEFT JOIN latest_call lc ON ps.id = lc.final_provider_id
      ORDER BY ps.id ASC
    `;

    logger.trace("getProviderStatistics:executing_query");

    const result = await db.execute(query);

    logger.trace("getProviderStatistics:result", {
      count: Array.isArray(result) ? result.length : 0,
    });

    // 注意：返回结果中的 today_cost 为 numeric，使用字符串表示；
    // last_call_time 由数据库返回为时间戳（UTC）。
    // 这里保持原样，交由上层进行展示格式化。
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
