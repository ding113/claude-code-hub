"use server";

import { eq } from "drizzle-orm";
import { GeminiAuth } from "@/app/v1/_lib/gemini/auth";
import { isClientAbortError } from "@/app/v1/_lib/proxy/errors";
import { buildProxyUrl } from "@/app/v1/_lib/url";
import { db } from "@/drizzle/db";
import { providers as providersTable } from "@/drizzle/schema";
import { getSession } from "@/lib/auth";
import { publishProviderCacheInvalidation } from "@/lib/cache/provider-cache";
import {
  clearConfigCache,
  clearProviderState,
  getAllHealthStatusAsync,
  resetCircuit,
} from "@/lib/circuit-breaker";
import { PROVIDER_GROUP, PROVIDER_TIMEOUT_DEFAULTS } from "@/lib/constants/provider.constants";
import { logger } from "@/lib/logger";
import {
  executeProviderTest,
  type ProviderTestConfig,
  type TestStatus,
  type TestSubStatus,
} from "@/lib/provider-testing";
import { getPresetsForProvider } from "@/lib/provider-testing/presets";
import {
  createProxyAgentForProvider,
  isValidProxyUrl,
  type ProviderProxyConfig,
} from "@/lib/proxy-agent";
import {
  deleteProviderCircuitConfig,
  saveProviderCircuitConfig,
} from "@/lib/redis/circuit-breaker-config";
import type { Context1mPreference } from "@/lib/special-attributes";
import { maskKey } from "@/lib/utils/validation";
import { validateProviderUrlForConnectivity } from "@/lib/validation/provider-url";
import { CreateProviderSchema, UpdateProviderSchema } from "@/lib/validation/schemas";
import {
  createProvider,
  deleteProvider,
  findAllProviders,
  findAllProvidersFresh,
  findProviderById,
  getProviderStatistics,
  resetProviderTotalCostResetAt,
  updateProvider,
  updateProviderPrioritiesBatch,
} from "@/repository/provider";
import {
  backfillProviderEndpointsFromProviders,
  computeVendorKey,
  findProviderVendorById,
  getOrCreateProviderVendorIdFromUrls,
  tryDeleteProviderVendorIfEmpty,
} from "@/repository/provider-endpoints";
import type { CacheTtlPreference } from "@/types/cache";
import type {
  CodexParallelToolCallsPreference,
  CodexReasoningEffortPreference,
  CodexReasoningSummaryPreference,
  CodexTextVerbosityPreference,
  ProviderDisplay,
  ProviderStatisticsMap,
  ProviderType,
} from "@/types/provider";
import type { ActionResult } from "./types";

type AutoSortResult = {
  groups: Array<{
    costMultiplier: number;
    priority: number;
    providers: Array<{ id: number; name: string }>;
  }>;
  changes: Array<{
    providerId: number;
    name: string;
    oldPriority: number;
    newPriority: number;
    costMultiplier: number;
  }>;
  summary: {
    totalProviders: number;
    changedCount: number;
    groupCount: number;
  };
  applied: boolean;
};

const API_TEST_TIMEOUT_LIMITS = {
  DEFAULT: 15000,
  MIN: 5000,
  MAX: 120000,
} as const;

function resolveApiTestTimeoutMs(): number {
  const rawValue = process.env.API_TEST_TIMEOUT_MS?.trim();
  if (!rawValue) {
    return API_TEST_TIMEOUT_LIMITS.DEFAULT;
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isFinite(parsed)) {
    logger.warn("API test timeout env is invalid, falling back to default", {
      envValue: rawValue,
      defaultTimeout: API_TEST_TIMEOUT_LIMITS.DEFAULT,
    });
    return API_TEST_TIMEOUT_LIMITS.DEFAULT;
  }

  if (parsed < API_TEST_TIMEOUT_LIMITS.MIN || parsed > API_TEST_TIMEOUT_LIMITS.MAX) {
    logger.warn("API test timeout env is out of supported range", {
      envValue: parsed,
      min: API_TEST_TIMEOUT_LIMITS.MIN,
      max: API_TEST_TIMEOUT_LIMITS.MAX,
      defaultTimeout: API_TEST_TIMEOUT_LIMITS.DEFAULT,
    });
    return API_TEST_TIMEOUT_LIMITS.DEFAULT;
  }

  return parsed;
}

// API 测试配置常量
const API_TEST_CONFIG = {
  TIMEOUT_MS: resolveApiTestTimeoutMs(),
  GEMINI_TIMEOUT_MS: 60000, // Gemini 3 有 thinking 功能，需要更长超时
  MAX_RESPONSE_PREVIEW_LENGTH: 500, // 响应内容预览最大长度（增加到 500 字符以显示更多内容）
  TEST_MAX_TOKENS: 100, // 测试请求的最大 token 数
  TEST_PROMPT: "Hello", // 测试请求的默认提示词
  // 流式响应资源限制（防止 DoS 攻击）
  MAX_STREAM_CHUNKS: 1000, // 最大数据块数量
  MAX_STREAM_BUFFER_SIZE: 10 * 1024 * 1024, // 10MB 最大缓冲区大小
  MAX_STREAM_ITERATIONS: 10000, // 最大迭代次数（防止无限循环）
} as const;

const PROXY_RETRY_STATUS_CODES = new Set([502, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);
const CLOUDFLARE_ERROR_STATUS_CODES = new Set([520, 521, 522, 523, 524, 525, 526, 527, 530]);

/**
 * 广播 Provider 缓存失效通知（跨实例）
 *
 * CRUD 操作后调用，通知所有实例清除缓存。
 * 失败时不影响主流程，其他实例将依赖 TTL 过期后刷新。
 */
async function broadcastProviderCacheInvalidation(context: {
  operation: "add" | "edit" | "remove";
  providerId: number;
}): Promise<void> {
  try {
    await publishProviderCacheInvalidation();
    logger.debug(`${context.operation} Provider:cache_invalidation_success`, {
      providerId: context.providerId,
    });
  } catch (error) {
    logger.warn(`${context.operation} Provider:cache_invalidation_failed`, {
      providerId: context.providerId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// 获取服务商数据
export async function getProviders(): Promise<ProviderDisplay[]> {
  try {
    const session = await getSession();
    logger.trace("getProviders:session", {
      hasSession: !!session,
      role: session?.user.role,
    });

    if (!session || session.user.role !== "admin") {
      logger.trace("getProviders:unauthorized", {
        hasSession: !!session,
        role: session?.user.role,
      });
      return [];
    }

    // 仅获取供应商列表，统计数据由前端异步获取
    const providers = await findAllProvidersFresh();
    // 空统计数组，保持后续合并逻辑兼容
    const statistics: Awaited<ReturnType<typeof getProviderStatistics>> = [];

    logger.trace("getProviders:raw_data", {
      providerCount: providers.length,
      statisticsCount: statistics.length,
      providerIds: providers.map((p) => p.id),
    });

    // 将统计数据按 provider_id 索引
    const statsMap = new Map(statistics.map((stat) => [stat.id, stat]));

    const result = providers.map((provider) => {
      const stats = statsMap.get(provider.id);

      // 安全处理 last_call_time: 可能是 Date 对象、字符串或其他类型
      let lastCallTimeStr: string | null = null;
      try {
        if (stats?.last_call_time) {
          if (stats.last_call_time instanceof Date) {
            lastCallTimeStr = stats.last_call_time.toISOString();
          } else if (typeof stats.last_call_time === "string") {
            // 原生 SQL 查询返回的是字符串,直接使用
            lastCallTimeStr = stats.last_call_time;
          } else {
            // 尝试将其他类型转换为 Date
            const date = new Date(stats.last_call_time as string | number);
            if (!Number.isNaN(date.getTime())) {
              lastCallTimeStr = date.toISOString();
            }
          }
        }
      } catch (error) {
        logger.trace("getProviders:last_call_time_conversion_error", {
          providerId: provider.id,
          rawValue: stats?.last_call_time,
          error: error instanceof Error ? error.message : String(error),
        });
        // 转换失败时保持 null,不影响整体数据返回
        lastCallTimeStr = null;
      }

      // 安全处理 createdAt 和 updatedAt
      let createdAtStr: string;
      let updatedAtStr: string;
      try {
        createdAtStr = provider.createdAt.toISOString().split("T")[0];
        updatedAtStr = provider.updatedAt.toISOString().split("T")[0];
      } catch (error) {
        logger.trace("getProviders:date_conversion_error", {
          providerId: provider.id,
          error: error instanceof Error ? error.message : String(error),
        });
        createdAtStr = new Date().toISOString().split("T")[0];
        updatedAtStr = createdAtStr;
      }

      return {
        id: provider.id,
        name: provider.name,
        url: provider.url,
        maskedKey: maskKey(provider.key),
        isEnabled: provider.isEnabled,
        weight: provider.weight,
        priority: provider.priority,
        costMultiplier: provider.costMultiplier,
        groupTag: provider.groupTag,
        providerType: provider.providerType,
        providerVendorId: provider.providerVendorId,
        preserveClientIp: provider.preserveClientIp,
        modelRedirects: provider.modelRedirects,
        allowedModels: provider.allowedModels,
        mcpPassthroughType: provider.mcpPassthroughType,
        mcpPassthroughUrl: provider.mcpPassthroughUrl,
        limit5hUsd: provider.limit5hUsd,
        limitDailyUsd: provider.limitDailyUsd,
        dailyResetMode: provider.dailyResetMode,
        dailyResetTime: provider.dailyResetTime,
        limitWeeklyUsd: provider.limitWeeklyUsd,
        limitMonthlyUsd: provider.limitMonthlyUsd,
        limitTotalUsd: provider.limitTotalUsd,
        limitConcurrentSessions: provider.limitConcurrentSessions,
        maxRetryAttempts: provider.maxRetryAttempts,
        circuitBreakerFailureThreshold: provider.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: provider.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: provider.proxyUrl,
        proxyFallbackToDirect: provider.proxyFallbackToDirect,
        firstByteTimeoutStreamingMs: provider.firstByteTimeoutStreamingMs,
        streamingIdleTimeoutMs: provider.streamingIdleTimeoutMs,
        requestTimeoutNonStreamingMs: provider.requestTimeoutNonStreamingMs,
        websiteUrl: provider.websiteUrl,
        faviconUrl: provider.faviconUrl,
        cacheTtlPreference: provider.cacheTtlPreference,
        context1mPreference: provider.context1mPreference,
        codexReasoningEffortPreference: provider.codexReasoningEffortPreference,
        codexReasoningSummaryPreference: provider.codexReasoningSummaryPreference,
        codexTextVerbosityPreference: provider.codexTextVerbosityPreference,
        codexParallelToolCallsPreference: provider.codexParallelToolCallsPreference,
        anthropicMaxTokensPreference: provider.anthropicMaxTokensPreference,
        anthropicThinkingBudgetPreference: provider.anthropicThinkingBudgetPreference,
        tpm: provider.tpm,
        rpm: provider.rpm,
        rpd: provider.rpd,
        cc: provider.cc,
        createdAt: createdAtStr,
        updatedAt: updatedAtStr,
        // 统计数据（可能为空）
        todayTotalCostUsd: stats?.today_cost ?? "0",
        todayCallCount: stats?.today_calls ?? 0,
        lastCallTime: lastCallTimeStr,
        lastCallModel: stats?.last_call_model ?? null,
      };
    });

    logger.trace("getProviders:final_result", { count: result.length });
    return result;
  } catch (error) {
    logger.trace("getProviders:catch_error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("获取服务商数据失败:", error);
    return [];
  }
}

/**
 * Async get provider statistics data (today cost, call count, last call info)
 * Called independently by frontend, does not block main list loading
 */
export async function getProviderStatisticsAsync(): Promise<ProviderStatisticsMap> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") return {};

    const statistics = await getProviderStatistics();

    // Transform to Record<providerId, stats> format
    const result: ProviderStatisticsMap = {};

    for (const s of statistics) {
      let lastCallTimeStr: string | null = null;
      if (s.last_call_time) {
        if (s.last_call_time instanceof Date) {
          lastCallTimeStr = s.last_call_time.toISOString();
        } else if (typeof s.last_call_time === "string") {
          lastCallTimeStr = s.last_call_time;
        } else {
          const date = new Date(s.last_call_time as string | number);
          if (!Number.isNaN(date.getTime())) {
            lastCallTimeStr = date.toISOString();
          }
        }
      }

      result[s.id] = {
        todayCost: s.today_cost,
        todayCalls: s.today_calls,
        lastCallTime: lastCallTimeStr,
        lastCallModel: s.last_call_model,
      };
    }

    return result;
  } catch (error) {
    logger.error("Failed to get provider statistics async:", error);
    return {};
  }
}

/**
 * 获取所有可用的供应商分组标签（用于用户表单中的下拉建议）
 */
/**
 * 获取所有可用的供应商分组列表
 * @param userId - 可选的用户ID，用于过滤用户可用的分组
 * @returns 供应商分组列表
 */
export async function getAvailableProviderGroups(userId?: number): Promise<string[]> {
  try {
    const { getDistinctProviderGroups } = await import("@/repository/provider");
    const allGroups = await getDistinctProviderGroups();
    const allGroupsWithDefault = [
      PROVIDER_GROUP.DEFAULT,
      ...allGroups.filter((group) => group !== PROVIDER_GROUP.DEFAULT),
    ];

    // 如果没有提供 userId，返回所有分组（向后兼容）
    if (!userId) {
      return allGroupsWithDefault;
    }

    // 查询用户配置的 providerGroup
    const { findUserById } = await import("@/repository/user");
    const user = await findUserById(userId);

    const userGroups = (user?.providerGroup || PROVIDER_GROUP.DEFAULT)
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);

    // 管理员通配符：可访问所有分组
    if (userGroups.includes(PROVIDER_GROUP.ALL)) {
      return allGroupsWithDefault;
    }

    // 过滤：只返回用户配置的分组（但始终包含 default）
    const filtered = allGroupsWithDefault.filter((group) => userGroups.includes(group));
    return [PROVIDER_GROUP.DEFAULT, ...filtered.filter((g) => g !== PROVIDER_GROUP.DEFAULT)];
  } catch (error) {
    logger.error("获取供应商分组失败:", error);
    return [PROVIDER_GROUP.DEFAULT];
  }
}

/**
 * 获取所有分组及每个分组的供应商数量
 * @returns 分组列表及每个分组的供应商数量
 */
export async function getProviderGroupsWithCount(): Promise<
  ActionResult<Array<{ group: string; providerCount: number }>>
> {
  try {
    const providers = await findAllProvidersFresh();
    const groupCounts = new Map<string, number>();

    for (const provider of providers) {
      const groupTag = provider.groupTag?.trim();
      if (!groupTag) {
        groupCounts.set(PROVIDER_GROUP.DEFAULT, (groupCounts.get(PROVIDER_GROUP.DEFAULT) || 0) + 1);
        continue;
      }

      const groups = groupTag
        .split(",")
        .map((g) => g.trim())
        .filter(Boolean);

      for (const group of groups) {
        groupCounts.set(group, (groupCounts.get(group) || 0) + 1);
      }
    }

    const result = Array.from(groupCounts.entries())
      .map(([group, providerCount]) => ({ group, providerCount }))
      .sort((a, b) => {
        if (a.group === PROVIDER_GROUP.DEFAULT) return -1;
        if (b.group === PROVIDER_GROUP.DEFAULT) return 1;
        return a.group.localeCompare(b.group);
      });

    return { ok: true, data: result };
  } catch (error) {
    logger.error("获取供应商分组统计失败:", error);
    return { ok: false, error: "获取供应商分组统计失败" };
  }
}

// 添加服务商
export async function addProvider(data: {
  name: string;
  url: string;
  key: string;
  is_enabled?: boolean;
  weight?: number;
  priority?: number;
  cost_multiplier?: number;
  group_tag?: string | null;
  provider_type?: ProviderType;
  preserve_client_ip?: boolean;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
  limit_5h_usd?: number | null;
  limit_daily_usd?: number | null;
  daily_reset_mode?: "fixed" | "rolling";
  daily_reset_time?: string;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_total_usd?: number | null;
  limit_concurrent_sessions?: number | null;
  cache_ttl_preference?: CacheTtlPreference | null;
  context_1m_preference?: Context1mPreference | null;
  codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
  codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
  codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
  codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
  max_retry_attempts?: number | null;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number;
  circuit_breaker_half_open_success_threshold?: number;
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;
  first_byte_timeout_streaming_ms?: number;
  streaming_idle_timeout_ms?: number;
  request_timeout_non_streaming_ms?: number;
  website_url?: string | null;
  mcp_passthrough_type?: "none" | "minimax" | "glm" | "custom";
  mcp_passthrough_url?: string | null;
  tpm: number | null;
  rpm: number | null;
  rpd: number | null;
  cc: number | null;
}): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    logger.trace("addProvider:input", {
      name: data.name,
      url: data.url,
      provider_type: data.provider_type,
      proxy_url: data.proxy_url ? data.proxy_url.replace(/:\/\/[^@]*@/, "://***@") : null,
    });

    // 验证代理 URL 格式
    if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
      return {
        ok: false,
        error: "代理地址格式无效，支持格式: http://, https://, socks5://, socks4://",
      };
    }

    const validated = CreateProviderSchema.parse(data);
    logger.trace("addProvider:validated", { name: validated.name });

    // 获取 favicon URL
    let faviconUrl: string | null = null;
    if (validated.website_url) {
      try {
        const url = new URL(validated.website_url);
        const domain = url.hostname;
        faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
        logger.trace("addProvider:favicon_generated", { domain, faviconUrl });
      } catch (error) {
        logger.warn("addProvider:favicon_fetch_failed", {
          websiteUrl: validated.website_url,
          error: error instanceof Error ? error.message : String(error),
        });
        // Favicon 获取失败不影响主流程
      }
    }

    const payload = {
      ...validated,
      limit_5h_usd: validated.limit_5h_usd ?? null,
      limit_daily_usd: validated.limit_daily_usd ?? null,
      daily_reset_mode: validated.daily_reset_mode ?? "fixed",
      daily_reset_time: validated.daily_reset_time ?? "00:00",
      limit_weekly_usd: validated.limit_weekly_usd ?? null,
      limit_monthly_usd: validated.limit_monthly_usd ?? null,
      limit_total_usd: validated.limit_total_usd ?? null,
      limit_concurrent_sessions: validated.limit_concurrent_sessions ?? 0,
      max_retry_attempts: validated.max_retry_attempts ?? null,
      circuit_breaker_failure_threshold: validated.circuit_breaker_failure_threshold ?? 5,
      circuit_breaker_open_duration: validated.circuit_breaker_open_duration ?? 1800000,
      circuit_breaker_half_open_success_threshold:
        validated.circuit_breaker_half_open_success_threshold ?? 2,
      proxy_url: validated.proxy_url ?? null,
      proxy_fallback_to_direct: validated.proxy_fallback_to_direct ?? false,
      first_byte_timeout_streaming_ms:
        validated.first_byte_timeout_streaming_ms ??
        PROVIDER_TIMEOUT_DEFAULTS.FIRST_BYTE_TIMEOUT_STREAMING_MS,
      streaming_idle_timeout_ms:
        validated.streaming_idle_timeout_ms ?? PROVIDER_TIMEOUT_DEFAULTS.STREAMING_IDLE_TIMEOUT_MS,
      request_timeout_non_streaming_ms:
        validated.request_timeout_non_streaming_ms ??
        PROVIDER_TIMEOUT_DEFAULTS.REQUEST_TIMEOUT_NON_STREAMING_MS,
      cache_ttl_preference: validated.cache_ttl_preference ?? "inherit",
      context_1m_preference: validated.context_1m_preference ?? "inherit",
      codex_reasoning_effort_preference: validated.codex_reasoning_effort_preference ?? "inherit",
      codex_reasoning_summary_preference: validated.codex_reasoning_summary_preference ?? "inherit",
      codex_text_verbosity_preference: validated.codex_text_verbosity_preference ?? "inherit",
      codex_parallel_tool_calls_preference:
        validated.codex_parallel_tool_calls_preference ?? "inherit",
      website_url: validated.website_url ?? null,
      favicon_url: faviconUrl,
      tpm: validated.tpm ?? null,
      rpm: validated.rpm ?? null,
      rpd: validated.rpd ?? null,
      cc: validated.cc ?? null,
    };

    const provider = await createProvider(payload);
    logger.trace("addProvider:created_success", {
      name: validated.name,
      providerId: provider.id,
    });

    // 同步熔断器配置到 Redis
    try {
      await saveProviderCircuitConfig(provider.id, {
        failureThreshold: provider.circuitBreakerFailureThreshold,
        openDuration: provider.circuitBreakerOpenDuration,
        halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
      });
      logger.debug("addProvider:config_synced_to_redis", {
        providerId: provider.id,
      });
    } catch (error) {
      logger.warn("addProvider:redis_sync_failed", {
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // 不影响主流程，仅记录警告
    }

    // 广播缓存更新（跨实例即时生效）
    await broadcastProviderCacheInvalidation({ operation: "add", providerId: provider.id });

    return { ok: true };
  } catch (error) {
    logger.trace("addProvider:error", {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    logger.error("创建服务商失败:", error);
    const message = error instanceof Error ? error.message : "创建服务商失败";
    return { ok: false, error: message };
  }
}

// 更新服务商
export async function editProvider(
  providerId: number,
  data: {
    name?: string;
    url?: string;
    key?: string;
    is_enabled?: boolean;
    weight?: number;
    priority?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
    provider_type?: ProviderType;
    preserve_client_ip?: boolean;
    model_redirects?: Record<string, string> | null;
    allowed_models?: string[] | null;
    limit_5h_usd?: number | null;
    limit_daily_usd?: number | null;
    daily_reset_time?: string;
    limit_weekly_usd?: number | null;
    limit_monthly_usd?: number | null;
    limit_total_usd?: number | null;
    limit_concurrent_sessions?: number | null;
    cache_ttl_preference?: "inherit" | "5m" | "1h";
    context_1m_preference?: Context1mPreference | null;
    codex_reasoning_effort_preference?: CodexReasoningEffortPreference | null;
    codex_reasoning_summary_preference?: CodexReasoningSummaryPreference | null;
    codex_text_verbosity_preference?: CodexTextVerbosityPreference | null;
    codex_parallel_tool_calls_preference?: CodexParallelToolCallsPreference | null;
    max_retry_attempts?: number | null;
    circuit_breaker_failure_threshold?: number;
    circuit_breaker_open_duration?: number;
    circuit_breaker_half_open_success_threshold?: number;
    proxy_url?: string | null;
    proxy_fallback_to_direct?: boolean;
    first_byte_timeout_streaming_ms?: number;
    streaming_idle_timeout_ms?: number;
    request_timeout_non_streaming_ms?: number;
    website_url?: string | null;
    mcp_passthrough_type?: "none" | "minimax" | "glm" | "custom";
    mcp_passthrough_url?: string | null;
    tpm?: number | null;
    rpm?: number | null;
    rpd?: number | null;
    cc?: number | null;
  }
): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 验证代理 URL 格式
    if (data.proxy_url && !isValidProxyUrl(data.proxy_url)) {
      return {
        ok: false,
        error: "代理地址格式无效，支持格式: http://, https://, socks5://, socks4://",
      };
    }

    const validated = UpdateProviderSchema.parse(data);

    // 如果 website_url 被更新，重新生成 favicon URL
    let faviconUrl: string | null | undefined; // undefined 表示不更新
    if (validated.website_url !== undefined) {
      if (validated.website_url) {
        try {
          const url = new URL(validated.website_url);
          const domain = url.hostname;
          faviconUrl = `https://www.google.com/s2/favicons?domain=${domain}&sz=32`;
          logger.trace("editProvider:favicon_generated", {
            domain,
            faviconUrl,
          });
        } catch (error) {
          logger.warn("editProvider:favicon_fetch_failed", {
            websiteUrl: validated.website_url,
            error: error instanceof Error ? error.message : String(error),
          });
          faviconUrl = null;
        }
      } else {
        faviconUrl = null; // website_url 被清空时也清空 favicon
      }
    }

    const payload = {
      ...validated,
      ...(faviconUrl !== undefined && { favicon_url: faviconUrl }),
    };

    const provider = await updateProvider(providerId, payload);

    if (!provider) {
      return { ok: false, error: "供应商不存在" };
    }

    // 同步熔断器配置到 Redis（如果配置有变化）
    const hasCircuitConfigChange =
      validated.circuit_breaker_failure_threshold !== undefined ||
      validated.circuit_breaker_open_duration !== undefined ||
      validated.circuit_breaker_half_open_success_threshold !== undefined;

    if (hasCircuitConfigChange) {
      try {
        await saveProviderCircuitConfig(providerId, {
          failureThreshold: provider.circuitBreakerFailureThreshold,
          openDuration: provider.circuitBreakerOpenDuration,
          halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
        });
        // 清除内存缓存，强制下次读取最新配置
        clearConfigCache(providerId);
        logger.debug("editProvider:config_synced_to_redis", { providerId });
      } catch (error) {
        logger.warn("editProvider:redis_sync_failed", {
          providerId,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    // 广播缓存更新（跨实例即时生效）
    await broadcastProviderCacheInvalidation({ operation: "edit", providerId });

    return { ok: true };
  } catch (error) {
    logger.error("更新服务商失败:", error);
    const message = error instanceof Error ? error.message : "更新服务商失败";
    return { ok: false, error: message };
  }
}

// 删除服务商
export async function removeProvider(providerId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const provider = await findProviderById(providerId);
    await deleteProvider(providerId);

    // 清除内存缓存（无论 Redis 是否成功都要执行）
    clearConfigCache(providerId);
    await clearProviderState(providerId);

    // 删除 Redis 缓存（非关键路径，失败时记录警告）
    try {
      await deleteProviderCircuitConfig(providerId);
      logger.debug("removeProvider:cache_cleared", { providerId });
    } catch (error) {
      logger.warn("removeProvider:redis_cache_clear_failed", {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    // Auto cleanup: delete vendor if it has no active providers/endpoints.
    if (provider?.providerVendorId) {
      await tryDeleteProviderVendorIfEmpty(provider.providerVendorId);
    }

    // 广播缓存更新（跨实例即时生效）
    await broadcastProviderCacheInvalidation({ operation: "remove", providerId });

    return { ok: true };
  } catch (error) {
    logger.error("删除服务商失败:", error);
    const message = error instanceof Error ? error.message : "删除服务商失败";
    return { ok: false, error: message };
  }
}

export async function autoSortProviderPriority(args: {
  confirm: boolean;
}): Promise<ActionResult<AutoSortResult>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const providers = await findAllProvidersFresh();
    if (providers.length === 0) {
      return {
        ok: true,
        data: {
          groups: [],
          changes: [],
          summary: {
            totalProviders: 0,
            changedCount: 0,
            groupCount: 0,
          },
          applied: args.confirm,
        },
      };
    }

    const groupsByCostMultiplier = new Map<number, typeof providers>();
    for (const provider of providers) {
      const rawCostMultiplier = Number(provider.costMultiplier);
      const costMultiplier = Number.isFinite(rawCostMultiplier) ? rawCostMultiplier : 0;

      if (!Number.isFinite(rawCostMultiplier)) {
        logger.warn("autoSortProviderPriority:invalid_cost_multiplier", {
          providerId: provider.id,
          providerName: provider.name,
          costMultiplier: provider.costMultiplier,
          fallback: costMultiplier,
        });
      }

      const bucket = groupsByCostMultiplier.get(costMultiplier);
      if (bucket) {
        bucket.push(provider);
      } else {
        groupsByCostMultiplier.set(costMultiplier, [provider]);
      }
    }

    const sortedCostMultipliers = Array.from(groupsByCostMultiplier.keys()).sort((a, b) => a - b);
    const groups: AutoSortResult["groups"] = [];
    const changes: AutoSortResult["changes"] = [];

    for (const [priority, costMultiplier] of sortedCostMultipliers.entries()) {
      const groupProviders = groupsByCostMultiplier.get(costMultiplier) ?? [];
      groups.push({
        costMultiplier,
        priority,
        providers: groupProviders
          .slice()
          .sort((a, b) => a.id - b.id)
          .map((provider) => ({ id: provider.id, name: provider.name })),
      });

      for (const provider of groupProviders) {
        const oldPriority = provider.priority ?? 0;
        const newPriority = priority;
        if (oldPriority !== newPriority) {
          changes.push({
            providerId: provider.id,
            name: provider.name,
            oldPriority,
            newPriority,
            costMultiplier,
          });
        }
      }
    }

    const summary: AutoSortResult["summary"] = {
      totalProviders: providers.length,
      changedCount: changes.length,
      groupCount: groups.length,
    };

    if (!args.confirm) {
      return {
        ok: true,
        data: {
          groups,
          changes,
          summary,
          applied: false,
        },
      };
    }

    if (changes.length > 0) {
      await updateProviderPrioritiesBatch(
        changes.map((change) => ({ id: change.providerId, priority: change.newPriority }))
      );
      try {
        await publishProviderCacheInvalidation();
      } catch (error) {
        logger.warn("autoSortProviderPriority:cache_invalidation_failed", {
          changedCount: changes.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: true,
      data: {
        groups,
        changes,
        summary,
        applied: true,
      },
    };
  } catch (error) {
    logger.error("autoSortProviderPriority:error", error);
    const message = error instanceof Error ? error.message : "自动排序供应商优先级失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取所有供应商的熔断器健康状态
 * 返回格式：{ providerId: { circuitState, failureCount, circuitOpenUntil, ... } }
 */
export async function getProvidersHealthStatus() {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return {};
    }

    const providerIds = await findAllProvidersFresh().then((providers) =>
      providers.map((p) => p.id)
    );
    const healthStatus = await getAllHealthStatusAsync(providerIds, {
      forceRefresh: true,
    });

    // 转换为前端友好的格式
    const enrichedStatus: Record<
      number,
      {
        circuitState: "closed" | "open" | "half-open";
        failureCount: number;
        lastFailureTime: number | null;
        circuitOpenUntil: number | null;
        recoveryMinutes: number | null; // 距离恢复的分钟数
      }
    > = {};

    Object.entries(healthStatus).forEach(([providerId, health]) => {
      enrichedStatus[Number(providerId)] = {
        circuitState: health.circuitState,
        failureCount: health.failureCount,
        lastFailureTime: health.lastFailureTime,
        circuitOpenUntil: health.circuitOpenUntil,
        recoveryMinutes: health.circuitOpenUntil
          ? Math.ceil((health.circuitOpenUntil - Date.now()) / 60000)
          : null,
      };
    });

    return enrichedStatus;
  } catch (error) {
    logger.error("获取熔断器状态失败:", error);
    return {};
  }
}

/**
 * 手动重置供应商的熔断器状态
 */
export async function resetProviderCircuit(providerId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    resetCircuit(providerId);

    return { ok: true };
  } catch (error) {
    logger.error("重置熔断器失败:", error);
    const message = error instanceof Error ? error.message : "重置熔断器失败";
    return { ok: false, error: message };
  }
}

/**
 * 手动重置供应商“总用量”（用于总消费上限 limit_total_usd）
 *
 * 说明：
 * - 不删除历史请求日志，仅更新 providers.total_cost_reset_at 作为聚合下限。
 */
export async function resetProviderTotalUsage(providerId: number): Promise<ActionResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const ok = await resetProviderTotalCostResetAt(providerId, new Date());
    if (!ok) {
      return { ok: false, error: "供应商不存在" };
    }

    return { ok: true };
  } catch (error) {
    logger.error("重置供应商总用量失败:", error);
    const message = error instanceof Error ? error.message : "重置供应商总用量失败";
    return { ok: false, error: message };
  }
}

const BATCH_OPERATION_MAX_SIZE = 500;

export interface BatchUpdateProvidersParams {
  providerIds: number[];
  updates: {
    is_enabled?: boolean;
    priority?: number;
    weight?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
  };
}

export async function batchUpdateProviders(
  params: BatchUpdateProvidersParams
): Promise<ActionResult<{ updatedCount: number }>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const { providerIds, updates } = params;

    if (!providerIds || providerIds.length === 0) {
      return { ok: false, error: "请选择要更新的供应商" };
    }

    if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
      return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
    }

    const hasUpdates = Object.values(updates).some((v) => v !== undefined);
    if (!hasUpdates) {
      return { ok: false, error: "请指定要更新的字段" };
    }

    const { updateProvidersBatch } = await import("@/repository/provider");

    const repositoryUpdates: Parameters<typeof updateProvidersBatch>[1] = {};
    if (updates.is_enabled !== undefined) repositoryUpdates.isEnabled = updates.is_enabled;
    if (updates.priority !== undefined) repositoryUpdates.priority = updates.priority;
    if (updates.weight !== undefined) repositoryUpdates.weight = updates.weight;
    if (updates.cost_multiplier !== undefined) {
      repositoryUpdates.costMultiplier = updates.cost_multiplier.toString();
    }
    if (updates.group_tag !== undefined) repositoryUpdates.groupTag = updates.group_tag;

    const updatedCount = await updateProvidersBatch(providerIds, repositoryUpdates);

    await broadcastProviderCacheInvalidation({
      operation: "edit",
      providerId: providerIds[0],
    });

    logger.info("batchUpdateProviders:completed", {
      requestedCount: providerIds.length,
      updatedCount,
      fields: Object.keys(updates).filter((k) => updates[k as keyof typeof updates] !== undefined),
    });

    return { ok: true, data: { updatedCount } };
  } catch (error) {
    logger.error("批量更新供应商失败:", error);
    const message = error instanceof Error ? error.message : "批量更新供应商失败";
    return { ok: false, error: message };
  }
}

export interface BatchDeleteProvidersParams {
  providerIds: number[];
}

export async function batchDeleteProviders(
  params: BatchDeleteProvidersParams
): Promise<ActionResult<{ deletedCount: number }>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const { providerIds } = params;

    if (!providerIds || providerIds.length === 0) {
      return { ok: false, error: "请选择要删除的供应商" };
    }

    if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
      return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
    }

    const { deleteProvidersBatch } = await import("@/repository/provider");

    const deletedCount = await deleteProvidersBatch(providerIds);

    for (const id of providerIds) {
      clearProviderState(id);
      clearConfigCache(id);
    }

    await broadcastProviderCacheInvalidation({
      operation: "remove",
      providerId: providerIds[0],
    });

    logger.info("batchDeleteProviders:completed", {
      requestedCount: providerIds.length,
      deletedCount,
    });

    return { ok: true, data: { deletedCount } };
  } catch (error) {
    logger.error("批量删除供应商失败:", error);
    const message = error instanceof Error ? error.message : "批量删除供应商失败";
    return { ok: false, error: message };
  }
}

export interface BatchResetCircuitParams {
  providerIds: number[];
}

export async function batchResetProviderCircuits(
  params: BatchResetCircuitParams
): Promise<ActionResult<{ resetCount: number }>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const { providerIds } = params;

    if (!providerIds || providerIds.length === 0) {
      return { ok: false, error: "请选择要重置的供应商" };
    }

    if (providerIds.length > BATCH_OPERATION_MAX_SIZE) {
      return { ok: false, error: `单次批量操作最多支持 ${BATCH_OPERATION_MAX_SIZE} 个供应商` };
    }

    let resetCount = 0;
    for (const id of providerIds) {
      resetCircuit(id);
      clearConfigCache(id);
      resetCount++;
    }

    logger.info("batchResetProviderCircuits:completed", {
      requestedCount: providerIds.length,
      resetCount,
    });

    return { ok: true, data: { resetCount } };
  } catch (error) {
    logger.error("批量重置熔断器失败:", error);
    const message = error instanceof Error ? error.message : "批量重置熔断器失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取供应商限额使用情况
 */
export async function getProviderLimitUsage(providerId: number): Promise<
  ActionResult<{
    cost5h: { current: number; limit: number | null; resetInfo: string };
    costDaily: { current: number; limit: number | null; resetAt?: Date };
    costWeekly: { current: number; limit: number | null; resetAt: Date };
    costMonthly: { current: number; limit: number | null; resetAt: Date };
    concurrentSessions: { current: number; limit: number };
  }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const provider = await findProviderById(providerId);
    if (!provider) {
      return { ok: false, error: "供应商不存在" };
    }

    // 动态导入避免循环依赖
    const { SessionTracker } = await import("@/lib/session-tracker");
    const {
      getResetInfo,
      getResetInfoWithMode,
      getTimeRangeForPeriod,
      getTimeRangeForPeriodWithMode,
    } = await import("@/lib/rate-limit/time-utils");
    const { sumProviderCostInTimeRange } = await import("@/repository/statistics");

    // 计算各周期的时间范围
    const [range5h, rangeDaily, rangeWeekly, rangeMonthly] = await Promise.all([
      getTimeRangeForPeriod("5h"),
      getTimeRangeForPeriodWithMode(
        "daily",
        provider.dailyResetTime ?? undefined,
        (provider.dailyResetMode ?? "fixed") as "fixed" | "rolling"
      ),
      getTimeRangeForPeriod("weekly"),
      getTimeRangeForPeriod("monthly"),
    ]);

    // 获取金额消费（直接查询数据库，确保配额显示与 DB 一致）
    const [cost5h, costDaily, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
      sumProviderCostInTimeRange(providerId, range5h.startTime, range5h.endTime),
      sumProviderCostInTimeRange(providerId, rangeDaily.startTime, rangeDaily.endTime),
      sumProviderCostInTimeRange(providerId, rangeWeekly.startTime, rangeWeekly.endTime),
      sumProviderCostInTimeRange(providerId, rangeMonthly.startTime, rangeMonthly.endTime),
      SessionTracker.getProviderSessionCount(providerId),
    ]);

    // 获取重置时间信息
    const reset5h = await getResetInfo("5h");
    const resetDaily = await getResetInfoWithMode(
      "daily",
      provider.dailyResetTime,
      provider.dailyResetMode ?? "fixed"
    );
    const resetWeekly = await getResetInfo("weekly");
    const resetMonthly = await getResetInfo("monthly");

    return {
      ok: true,
      data: {
        cost5h: {
          current: cost5h,
          limit: provider.limit5hUsd,
          resetInfo: reset5h.type === "rolling" ? `滚动窗口（${reset5h.period}）` : "自然时间窗口",
        },
        costDaily: {
          current: costDaily,
          limit: provider.limitDailyUsd,
          resetAt: resetDaily.type === "rolling" ? undefined : resetDaily.resetAt!,
        },
        costWeekly: {
          current: costWeekly,
          limit: provider.limitWeeklyUsd,
          resetAt: resetWeekly.resetAt!,
        },
        costMonthly: {
          current: costMonthly,
          limit: provider.limitMonthlyUsd,
          resetAt: resetMonthly.resetAt!,
        },
        concurrentSessions: {
          current: concurrentSessions,
          limit: provider.limitConcurrentSessions || 0,
        },
      },
    };
  } catch (error) {
    logger.error("获取供应商限额使用情况失败:", error);
    const message = error instanceof Error ? error.message : "获取供应商限额使用情况失败";
    return { ok: false, error: message };
  }
}

/**
 * 供应商限额使用情况数据结构
 */
export type ProviderLimitUsageData = {
  cost5h: { current: number; limit: number | null; resetInfo: string };
  costDaily: { current: number; limit: number | null; resetAt?: Date };
  costWeekly: { current: number; limit: number | null; resetAt: Date };
  costMonthly: { current: number; limit: number | null; resetAt: Date };
  concurrentSessions: { current: number; limit: number };
};

/**
 * 批量获取多个供应商的限额使用情况
 * 使用 Redis Pipeline 避免 N+1 查询问题
 *
 * @param providers - 供应商数据数组（必须包含限额相关字段）
 * @returns Map<providerId, ProviderLimitUsageData>
 */
export async function getProviderLimitUsageBatch(
  providers: Array<{
    id: number;
    dailyResetTime?: string | null;
    dailyResetMode?: string | null;
    limit5hUsd?: number | null;
    limitDailyUsd?: number | null;
    limitWeeklyUsd?: number | null;
    limitMonthlyUsd?: number | null;
    limitConcurrentSessions?: number | null;
  }>
): Promise<Map<number, ProviderLimitUsageData>> {
  const result = new Map<number, ProviderLimitUsageData>();

  if (providers.length === 0) {
    return result;
  }

  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      logger.warn("getProviderLimitUsageBatch: 无权限执行此操作");
      return result;
    }

    // 动态导入避免循环依赖
    const { SessionTracker } = await import("@/lib/session-tracker");
    const {
      getResetInfo,
      getResetInfoWithMode,
      getTimeRangeForPeriod,
      getTimeRangeForPeriodWithMode,
    } = await import("@/lib/rate-limit/time-utils");
    const { sumProviderCostInTimeRange } = await import("@/repository/statistics");

    const providerIds = providers.map((p) => p.id);

    // 获取并发 session 计数（仍使用 Redis，这是实时数据）
    const sessionCountMap = await SessionTracker.getProviderSessionCountBatch(providerIds);

    // 获取各周期的时间范围（这些范围对所有供应商是相同的，除了 daily 需要根据每个供应商的配置）
    const [range5h, rangeWeekly, rangeMonthly] = await Promise.all([
      getTimeRangeForPeriod("5h"),
      getTimeRangeForPeriod("weekly"),
      getTimeRangeForPeriod("monthly"),
    ]);

    // 组装结果
    for (const provider of providers) {
      // 获取该供应商的 daily 时间范围（根据其 dailyResetMode 配置）
      const dailyResetMode = (provider.dailyResetMode ?? "fixed") as "fixed" | "rolling";
      const rangeDaily = await getTimeRangeForPeriodWithMode(
        "daily",
        provider.dailyResetTime ?? undefined,
        dailyResetMode
      );

      // 并行查询该供应商的各周期消费（直接查询数据库）
      const [cost5h, costDaily, costWeekly, costMonthly] = await Promise.all([
        sumProviderCostInTimeRange(provider.id, range5h.startTime, range5h.endTime),
        sumProviderCostInTimeRange(provider.id, rangeDaily.startTime, rangeDaily.endTime),
        sumProviderCostInTimeRange(provider.id, rangeWeekly.startTime, rangeWeekly.endTime),
        sumProviderCostInTimeRange(provider.id, rangeMonthly.startTime, rangeMonthly.endTime),
      ]);

      const sessionCount = sessionCountMap.get(provider.id) || 0;

      // 获取重置时间信息
      const reset5h = await getResetInfo("5h");
      const resetDaily = await getResetInfoWithMode(
        "daily",
        provider.dailyResetTime ?? undefined,
        dailyResetMode
      );
      const resetWeekly = await getResetInfo("weekly");
      const resetMonthly = await getResetInfo("monthly");

      result.set(provider.id, {
        cost5h: {
          current: cost5h,
          limit: provider.limit5hUsd ?? null,
          resetInfo: reset5h.type === "rolling" ? `滚动窗口（${reset5h.period}）` : "自然时间窗口",
        },
        costDaily: {
          current: costDaily,
          limit: provider.limitDailyUsd ?? null,
          resetAt: resetDaily.type === "rolling" ? undefined : resetDaily.resetAt!,
        },
        costWeekly: {
          current: costWeekly,
          limit: provider.limitWeeklyUsd ?? null,
          resetAt: resetWeekly.resetAt!,
        },
        costMonthly: {
          current: costMonthly,
          limit: provider.limitMonthlyUsd ?? null,
          resetAt: resetMonthly.resetAt!,
        },
        concurrentSessions: {
          current: sessionCount,
          limit: provider.limitConcurrentSessions || 0,
        },
      });
    }

    logger.debug(`getProviderLimitUsageBatch: 批量获取 ${providers.length} 个供应商限额数据完成`);
    return result;
  } catch (error) {
    logger.error("批量获取供应商限额使用情况失败:", error);
    return result;
  }
}

/**
 * 测试代理连接
 * 通过代理访问供应商 URL，验证代理配置是否正确
 */
export async function testProviderProxy(data: {
  providerUrl: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
}): Promise<
  ActionResult<{
    success: boolean;
    message: string;
    details?: {
      statusCode?: number;
      responseTime?: number;
      usedProxy?: boolean;
      proxyUrl?: string;
      error?: string;
      errorType?: string;
    };
  }>
> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    const providerUrlValidation = validateProviderUrlForConnectivity(data.providerUrl);
    if (!providerUrlValidation.valid) {
      return {
        ok: true,
        data: {
          success: false,
          message: providerUrlValidation.error.message,
          details: providerUrlValidation.error.details,
        },
      };
    }

    // 验证代理 URL 格式
    if (data.proxyUrl && !isValidProxyUrl(data.proxyUrl)) {
      return {
        ok: true,
        data: {
          success: false,
          message: "代理地址格式无效",
          details: {
            error: "支持格式: http://, https://, socks5://, socks4://",
            errorType: "InvalidProxyUrl",
          },
        },
      };
    }

    const startTime = Date.now();

    // 构造临时 Provider 对象（用于创建代理 agent）
    // 使用类型安全的 ProviderProxyConfig 接口，避免 any
    const tempProvider: ProviderProxyConfig = {
      id: -1,
      name: "test-connection",
      proxyUrl: data.proxyUrl ?? null,
      proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
    };

    try {
      // 创建代理配置
      const proxyConfig = createProxyAgentForProvider(tempProvider, data.providerUrl);

      // 扩展 RequestInit 类型
      interface UndiciFetchOptions extends RequestInit {
        dispatcher?: unknown;
      }

      const init: UndiciFetchOptions = {
        method: "HEAD", // 使用 HEAD 请求，减少流量
        signal: AbortSignal.timeout(API_TEST_CONFIG.TIMEOUT_MS),
      };

      // 应用代理配置
      if (proxyConfig) {
        init.dispatcher = proxyConfig.agent;
      }

      // 发起测试请求
      const response = await fetch(data.providerUrl, init);
      const responseTime = Date.now() - startTime;

      return {
        ok: true,
        data: {
          success: true,
          message: `成功连接到 ${new URL(data.providerUrl).hostname}`,
          details: {
            statusCode: response.status,
            responseTime,
            usedProxy: !!proxyConfig,
            proxyUrl: proxyConfig?.proxyUrl,
          },
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const err = error as Error & { code?: string };

      // 判断错误类型
      const isProxyError =
        err.message.includes("proxy") ||
        err.message.includes("ECONNREFUSED") ||
        err.message.includes("ENOTFOUND") ||
        err.message.includes("ETIMEDOUT");

      const errorType = isClientAbortError(err)
        ? "Timeout"
        : isProxyError
          ? "ProxyError"
          : "NetworkError";

      return {
        ok: true,
        data: {
          success: false,
          message: `连接失败: ${err.message}`,
          details: {
            responseTime,
            usedProxy: !!data.proxyUrl,
            proxyUrl: data.proxyUrl ?? undefined,
            error: err.message,
            errorType,
          },
        },
      };
    }
  } catch (error) {
    logger.error("测试代理连接失败:", error);
    const message = error instanceof Error ? error.message : "测试代理连接失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取供应商的未脱敏密钥（仅管理员）
 * 用于安全展示和复制完整 API Key
 */
export async function getUnmaskedProviderKey(id: number): Promise<ActionResult<{ key: string }>> {
  "use server";

  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "权限不足：仅管理员可查看完整密钥" };
    }

    const provider = await findProviderById(id);
    if (!provider) {
      return { ok: false, error: "供应商不存在" };
    }

    // 记录查看行为（不记录密钥内容）
    logger.info("Admin viewed provider key", {
      userId: session.user.id,
      providerId: id,
      providerName: provider.name,
    });

    return { ok: true, data: { key: provider.key } };
  } catch (error) {
    logger.error("获取供应商密钥失败:", error);
    const message = error instanceof Error ? error.message : "获取供应商密钥失败";
    return { ok: false, error: message };
  }
}

type ProviderApiTestArgs = {
  providerUrl: string;
  apiKey: string;
  model?: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  timeoutMs?: number; // 自定义超时时间（毫秒）
};

type ProviderApiTestResult = ActionResult<
  | {
      success: true;
      message: string;
      details?: {
        responseTime?: number;
        model?: string;
        usage?: Record<string, unknown>;
        content?: string;
        streamInfo?: {
          chunksReceived: number;
          format: "sse" | "ndjson";
        };
      };
    }
  | {
      success: false;
      message: string;
      details?: {
        responseTime?: number;
        error?: string;
      };
    }
>;

// Anthropic Messages API 响应类型
type AnthropicMessagesResponse = {
  id: string;
  type: "message";
  role: "assistant";
  model: string;
  content: Array<{ type: "text"; text: string }>;
  stop_reason: string;
  usage: {
    input_tokens: number;
    output_tokens: number;
    cache_creation_input_tokens?: number;
    cache_read_input_tokens?: number;
  };
};

// OpenAI Chat Completions API 响应类型
type OpenAIChatResponse = {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: "assistant";
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    reasoning_tokens?: number;
  };
};

// OpenAI Responses API 响应类型
type OpenAIResponsesResponse = {
  id: string;
  object: "response";
  created_at: number;
  model: string;
  output: Array<{
    type: "message";
    id: string;
    status: string;
    role: "assistant";
    content: Array<{
      type: "output_text";
      text: string;
      annotations?: unknown[];
    }>;
  }>;
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
  };
};

// Gemini API 响应类型
type GeminiResponse = {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
    finishReason?: string;
  }>;
  usageMetadata?: {
    promptTokenCount?: number;
    candidatesTokenCount?: number;
    totalTokenCount?: number;
  };
  error?: {
    code: number;
    message: string;
    status: string;
  };
};

// 联合类型：所有支持的 API 响应格式
type ProviderApiResponse =
  | AnthropicMessagesResponse
  | OpenAIChatResponse
  | OpenAIResponsesResponse
  | GeminiResponse;

function extractFirstTextSnippet(
  response: ProviderApiResponse,
  maxLength?: number
): string | undefined {
  const limit = maxLength ?? API_TEST_CONFIG.MAX_RESPONSE_PREVIEW_LENGTH;

  // Anthropic Messages API
  if ("content" in response && Array.isArray(response.content)) {
    const firstText = response.content.find((item) => item.type === "text");
    if (firstText && "text" in firstText) {
      return firstText.text.substring(0, limit);
    }
  }

  // OpenAI Chat Completions API
  if ("choices" in response && Array.isArray(response.choices)) {
    const firstChoice = response.choices[0];
    if (firstChoice?.message?.content) {
      return firstChoice.message.content.substring(0, limit);
    }
  }

  // OpenAI Responses API
  if ("output" in response && Array.isArray(response.output)) {
    const firstOutput = response.output[0];
    if (firstOutput?.type === "message" && Array.isArray(firstOutput.content)) {
      const textContent = firstOutput.content.find((c) => c.type === "output_text");
      if (textContent && "text" in textContent) {
        return textContent.text.substring(0, limit);
      }
    }
  }

  // Gemini API
  if ("candidates" in response && Array.isArray(response.candidates)) {
    const firstCandidate = response.candidates[0];
    if (firstCandidate?.content?.parts?.[0]?.text) {
      return firstCandidate.content.parts[0].text.substring(0, limit);
    }
  }

  return undefined;
}

function clipText(value: unknown, maxLength = 500): string | undefined {
  const limit = maxLength ?? API_TEST_CONFIG.MAX_RESPONSE_PREVIEW_LENGTH;
  return typeof value === "string" ? value.substring(0, limit) : undefined;
}

function sanitizeErrorTextForLogging(text: string, maxLength = 500): string {
  if (!text) {
    return text;
  }

  let sanitized = text;
  sanitized = sanitized.replace(/\b(?:sk|rk|pk)-[a-zA-Z0-9]{16,}\b/giu, "[REDACTED_KEY]");
  sanitized = sanitized.replace(/\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, "[EMAIL]");
  sanitized = sanitized.replace(/Bearer\s+[A-Za-z0-9._-]+/gi, "Bearer [REDACTED]");
  sanitized = sanitized.replace(/(password|token|secret)\s*[:=]\s*['"]?[^'"\s]+['"]?/gi, "$1:***");
  sanitized = sanitized.replace(/\/[\w.-]+\.(?:env|ya?ml|json|conf|ini)/gi, "[PATH]");

  if (sanitized.length > maxLength) {
    return `${sanitized.slice(0, maxLength)}... (truncated)`;
  }

  return sanitized;
}

function extractErrorMessage(errorJson: unknown): string | undefined {
  if (!errorJson || typeof errorJson !== "object") {
    return undefined;
  }

  const obj = errorJson as Record<string, unknown>;

  // 优先提取 upstream_error 中的错误信息（针对中转服务的嵌套错误）
  const upstreamError = (obj.error as { upstream_error?: unknown } | undefined)?.upstream_error;

  if (upstreamError && typeof upstreamError === "object") {
    const upstreamErrorObj = upstreamError as Record<string, unknown>;

    // 尝试从 upstream_error.error.message 提取
    const nestedMessage = normalizeErrorValue(
      (upstreamErrorObj.error as Record<string, unknown> | undefined)?.message
    );
    if (nestedMessage) {
      return nestedMessage;
    }

    // 尝试从 upstream_error.message 提取
    const directMessage = normalizeErrorValue(upstreamErrorObj.message);
    if (directMessage) {
      return directMessage;
    }
  }

  // 常规错误提取逻辑（保持原有优先级）
  const candidates: Array<(obj: Record<string, unknown>) => unknown> = [
    (obj) => (obj.error as Record<string, unknown> | undefined)?.message,
    (obj) => obj.message,
    (obj) => (obj as { error_message?: unknown }).error_message,
    (obj) => obj.detail,
    (obj) => (obj.error as Record<string, unknown> | undefined)?.error,
    (obj) => obj.error,
  ];

  for (const getter of candidates) {
    let value: unknown;
    try {
      value = getter(obj);
    } catch {
      continue;
    }

    const normalized = normalizeErrorValue(value);
    if (normalized) {
      return normalized;
    }
  }

  return undefined;
}

function normalizeErrorValue(value: unknown): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }

  if (value && typeof value === "object") {
    try {
      const serialized = JSON.stringify(value);
      const trimmed = serialized.trim();
      return trimmed === "{}" || trimmed === "[]" ? undefined : trimmed;
    } catch {
      return undefined;
    }
  }

  return undefined;
}

function detectCloudflareGatewayError(response: Response): boolean {
  const cfRay = response.headers.get("cf-ray");
  const cfCacheStatus = response.headers.get("cf-cache-status");
  const server = response.headers.get("server");
  const via = response.headers.get("via");

  const headerIndicatesCloudflare = Boolean(
    cfRay ||
      cfCacheStatus ||
      server?.toLowerCase().includes("cloudflare") ||
      via?.toLowerCase().includes("cloudflare")
  );

  return headerIndicatesCloudflare && CLOUDFLARE_ERROR_STATUS_CODES.has(response.status);
}

/**
 * 流式响应解析结果
 */
type StreamParseResult = {
  data: ProviderApiResponse;
  chunksReceived: number;
  format: "sse" | "ndjson";
};

/**
 * 解析 SSE 文本格式的流式响应
 */
function parseSSEText(text: string): StreamParseResult {
  // 验证输入大小（防止 DoS）
  if (text.length > API_TEST_CONFIG.MAX_STREAM_BUFFER_SIZE) {
    throw new Error(`SSE 文本超过最大大小 (${API_TEST_CONFIG.MAX_STREAM_BUFFER_SIZE} 字节)`);
  }

  const lines = text.split("\n");

  // 防止过多行数（防止 DoS）
  if (lines.length > API_TEST_CONFIG.MAX_STREAM_ITERATIONS) {
    throw new Error(`SSE 超过最大行数 (${API_TEST_CONFIG.MAX_STREAM_ITERATIONS})`);
  }

  const chunks: ProviderApiResponse[] = [];
  let currentData = "";
  let skippedChunks = 0;

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.startsWith("data:")) {
      const dataContent = trimmed.slice(5).trim();

      // 跳过 [DONE] 标记
      if (dataContent === "[DONE]") {
        continue;
      }

      if (dataContent) {
        currentData = dataContent;
      }
    } else if (trimmed === "" && currentData) {
      // 防止过多数据块（防止 DoS）
      if (chunks.length >= API_TEST_CONFIG.MAX_STREAM_CHUNKS) {
        logger.warn("SSE 解析达到最大数据块限制", {
          maxChunks: API_TEST_CONFIG.MAX_STREAM_CHUNKS,
          skipped: skippedChunks,
        });
        break;
      }

      // 空行表示一个完整的 SSE 事件结束
      try {
        const parsed = JSON.parse(currentData) as ProviderApiResponse;
        chunks.push(parsed);
        currentData = "";
      } catch (parseError) {
        // 记录解析失败的 chunk（用于调试）
        skippedChunks++;
        logger.warn("SSE chunk 解析失败", {
          chunkPreview: clipText(currentData, 100),
          error: parseError instanceof Error ? parseError.message : "Unknown",
        });
        currentData = "";
      }
    }
  }

  // 处理最后一个未结束的 data
  if (currentData && chunks.length < API_TEST_CONFIG.MAX_STREAM_CHUNKS) {
    try {
      const parsed = JSON.parse(currentData) as ProviderApiResponse;
      chunks.push(parsed);
    } catch (parseError) {
      skippedChunks++;
      logger.warn("SSE 最后一个 chunk 解析失败", {
        chunkPreview: clipText(currentData, 100),
        error: parseError instanceof Error ? parseError.message : "Unknown",
      });
    }
  }

  if (chunks.length === 0) {
    throw new Error(
      `未能从 SSE 响应中解析出有效数据${skippedChunks > 0 ? `（跳过 ${skippedChunks} 个无效 chunk）` : ""}`
    );
  }

  logger.info("SSE 文本解析完成", {
    totalChunks: chunks.length,
    skippedChunks,
    textLength: text.length,
  });

  // 合并所有 chunks 为完整响应
  const mergedResponse = mergeStreamChunks(chunks);

  return {
    data: mergedResponse,
    chunksReceived: chunks.length,
    format: "sse",
  };
}

/**
 * 解析流式响应（从 Response 对象读取）
 */
async function parseStreamResponse(response: Response): Promise<StreamParseResult> {
  if (!response.body) {
    throw new Error("响应体为空");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: ProviderApiResponse[] = [];

  let buffer = "";
  let currentData = "";
  let skippedChunks = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");

      // 保留最后一行（可能不完整）
      buffer = lines.pop() || "";

      for (const line of lines) {
        const trimmed = line.trim();

        if (trimmed.startsWith("data:")) {
          const dataContent = trimmed.slice(5).trim();

          // 跳过 [DONE] 标记
          if (dataContent === "[DONE]") {
            continue;
          }

          if (dataContent) {
            currentData = dataContent;
          }
        } else if (trimmed === "" && currentData) {
          // 空行表示一个完整的 SSE 事件结束
          try {
            const parsed = JSON.parse(currentData) as ProviderApiResponse;
            chunks.push(parsed);
            currentData = "";
          } catch (parseError) {
            // 记录解析失败的 chunk
            skippedChunks++;
            logger.warn("流式响应 chunk 解析失败", {
              chunkPreview: clipText(currentData, 100),
              error: parseError instanceof Error ? parseError.message : "Unknown",
            });
            currentData = "";
          }
        }
      }
    }

    // 处理剩余的 buffer
    if (buffer.trim()) {
      const trimmed = buffer.trim();
      if (trimmed.startsWith("data:")) {
        const dataContent = trimmed.slice(5).trim();
        if (dataContent && dataContent !== "[DONE]") {
          try {
            const parsed = JSON.parse(dataContent) as ProviderApiResponse;
            chunks.push(parsed);
          } catch (parseError) {
            skippedChunks++;
            logger.warn("流式响应剩余 buffer 解析失败", {
              chunkPreview: clipText(dataContent, 100),
              error: parseError instanceof Error ? parseError.message : "Unknown",
            });
          }
        }
      }
    }

    // 处理最后一个未结束的 data
    if (currentData) {
      try {
        const parsed = JSON.parse(currentData) as ProviderApiResponse;
        chunks.push(parsed);
      } catch (parseError) {
        skippedChunks++;
        logger.warn("流式响应最后一个 chunk 解析失败", {
          chunkPreview: clipText(currentData, 100),
          error: parseError instanceof Error ? parseError.message : "Unknown",
        });
      }
    }
  } catch (error) {
    // 在错误路径中取消 reader，防止资源泄漏
    await reader.cancel();
    throw error;
  } finally {
    reader.releaseLock();
  }

  if (chunks.length === 0) {
    throw new Error(
      `未能从流式响应中解析出有效数据${skippedChunks > 0 ? `（跳过 ${skippedChunks} 个无效 chunk）` : ""}`
    );
  }

  logger.info("流式响应解析完成", {
    totalChunks: chunks.length,
    skippedChunks,
  });

  // 合并所有 chunks 为完整响应
  const mergedResponse = mergeStreamChunks(chunks);

  return {
    data: mergedResponse,
    chunksReceived: chunks.length,
    format: "sse",
  };
}

/**
 * 合并流式 chunks 为完整响应
 */
function mergeStreamChunks(chunks: ProviderApiResponse[]): ProviderApiResponse {
  if (chunks.length === 0) {
    throw new Error("没有可合并的 chunks");
  }

  // 使用第一个 chunk 作为基础
  const base = { ...chunks[0] };

  // 合并 usage 信息（取最后一个非空的）
  for (let i = chunks.length - 1; i >= 0; i--) {
    const chunk = chunks[i];
    // Anthropic/OpenAI Chat/OpenAI Responses
    if ("usage" in chunk && chunk.usage) {
      if ("usage" in base) {
        (base as AnthropicMessagesResponse | OpenAIChatResponse | OpenAIResponsesResponse).usage =
          chunk.usage as (
            | AnthropicMessagesResponse
            | OpenAIChatResponse
            | OpenAIResponsesResponse
          )["usage"];
      }
      break;
    }
    // Gemini
    if ("usageMetadata" in chunk && chunk.usageMetadata) {
      (base as GeminiResponse).usageMetadata = chunk.usageMetadata;
      break;
    }
  }

  // 合并文本内容
  let mergedText = "";

  for (const chunk of chunks) {
    // Anthropic Messages API
    if ("content" in chunk && Array.isArray(chunk.content)) {
      for (const content of chunk.content) {
        if (content.type === "text" && "text" in content) {
          mergedText += content.text;
        }
      }
    }

    // OpenAI Chat Completions API (流式响应有 delta 字段)
    if ("choices" in chunk && Array.isArray(chunk.choices)) {
      const firstChoice = chunk.choices[0];
      // 流式响应使用 delta
      if (firstChoice && "delta" in firstChoice) {
        const delta = firstChoice.delta as { content?: string };
        if (delta.content) {
          mergedText += delta.content;
        }
      }
      // 非流式响应使用 message
      else if (firstChoice?.message?.content) {
        mergedText += firstChoice.message.content;
      }
    }

    // OpenAI Responses API
    if ("output" in chunk && Array.isArray(chunk.output)) {
      const firstOutput = chunk.output[0];
      if (firstOutput?.type === "message" && Array.isArray(firstOutput.content)) {
        for (const content of firstOutput.content) {
          if (content.type === "output_text" && "text" in content) {
            mergedText += content.text;
          }
        }
      }
    }

    // Gemini API
    if ("candidates" in chunk && Array.isArray(chunk.candidates)) {
      const firstCandidate = chunk.candidates[0];
      if (firstCandidate?.content?.parts) {
        for (const part of firstCandidate.content.parts) {
          if (part.text) {
            mergedText += part.text;
          }
        }
      }
    }
  }

  // 将合并后的文本写回到响应对象
  if (mergedText) {
    // Anthropic Messages API
    if ("content" in base && Array.isArray(base.content)) {
      base.content = [{ type: "text", text: mergedText }];
    }

    // OpenAI Chat Completions API
    if ("choices" in base && Array.isArray(base.choices)) {
      // 类型守卫：确保 base.choices[0] 存在
      const firstChoice = base.choices[0];
      if (firstChoice) {
        base.choices = [
          {
            ...firstChoice,
            message: { role: "assistant", content: mergedText },
            finish_reason: "stop",
          },
        ];
      } else {
        // 如果没有 choices，创建一个默认的
        base.choices = [
          {
            index: 0,
            message: { role: "assistant", content: mergedText },
            finish_reason: "stop",
          },
        ];
      }
    }

    // OpenAI Responses API
    if ("output" in base && Array.isArray(base.output)) {
      const firstOutput = base.output[0];
      // 类型守卫：确保这是 OpenAI Responses 格式
      if (
        "id" in base &&
        typeof base.id === "string" &&
        "type" in base &&
        base.type === "response"
      ) {
        (base as OpenAIResponsesResponse).output = [
          {
            type: "message",
            id: firstOutput?.id || `msg_${Date.now()}`,
            status: firstOutput?.status || "completed",
            role: "assistant",
            content: [{ type: "output_text", text: mergedText }],
          },
        ];
      }
    }

    // Gemini API
    if ("candidates" in base && Array.isArray(base.candidates)) {
      const firstCandidate = base.candidates[0];
      // 类型守卫：确保这是 Gemini 格式
      if (firstCandidate && "content" in firstCandidate) {
        (base as GeminiResponse).candidates = [
          {
            ...firstCandidate,
            content: {
              parts: [{ text: mergedText }],
            },
            finishReason: "STOP",
          },
        ];
      } else {
        // 如果没有 candidates，创建一个默认的
        (base as GeminiResponse).candidates = [
          {
            content: {
              parts: [{ text: mergedText }],
            },
            finishReason: "STOP",
          },
        ];
      }
    }
  }

  return base;
}

async function executeProviderApiTest(
  data: ProviderApiTestArgs,
  options: {
    path: string | ((model: string, apiKey: string) => string);
    defaultModel: string;
    headers: (apiKey: string, context: { providerUrl: string }) => Record<string, string>;
    body: (model: string) => unknown;
    successMessage: string;
    userAgent: string; // 渠道特定的 User-Agent
    timeoutMs?: number; // 自定义超时时间（毫秒）
    extract: (result: ProviderApiResponse) => {
      model?: string;
      usage?: Record<string, unknown>;
      content?: string;
    };
  }
): Promise<ProviderApiTestResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    if (data.proxyUrl && !isValidProxyUrl(data.proxyUrl)) {
      return {
        ok: true,
        data: {
          success: false,
          message: "代理地址格式无效",
          details: {
            error: "支持格式: http://, https://, socks5://, socks4://",
          },
        },
      };
    }

    const providerUrlValidation = validateProviderUrlForConnectivity(data.providerUrl);
    if (!providerUrlValidation.valid) {
      return {
        ok: true,
        data: {
          success: false,
          message: providerUrlValidation.error.message,
          details: providerUrlValidation.error.details,
        },
      };
    }

    const normalizedProviderUrl = providerUrlValidation.normalizedUrl.replace(/\/$/, "");

    const startTime = Date.now();

    const tempProvider: ProviderProxyConfig = {
      id: -1,
      name: "api-test",
      proxyUrl: data.proxyUrl ?? null,
      proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
    };

    const model = data.model || options.defaultModel;
    const path =
      typeof options.path === "function" ? options.path(model, data.apiKey) : options.path;
    const url = buildProxyUrl(normalizedProviderUrl, new URL(`https://dummy.com${path}`));

    try {
      const proxyConfig = createProxyAgentForProvider(tempProvider, url);

      interface UndiciFetchOptions extends RequestInit {
        dispatcher?: unknown;
      }

      const timeoutMs = options.timeoutMs ?? API_TEST_CONFIG.TIMEOUT_MS;
      const init: UndiciFetchOptions = {
        method: "POST",
        headers: {
          ...options.headers(data.apiKey, {
            providerUrl: normalizedProviderUrl,
          }),
          // 使用渠道特定的 User-Agent，避免被 Cloudflare Bot 检测拦截
          "User-Agent": options.userAgent,
          Accept: "application/json, text/event-stream",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
          Connection: "keep-alive",
        },
        body: JSON.stringify(options.body(model)),
        signal: AbortSignal.timeout(timeoutMs),
      };

      if (proxyConfig) {
        init.dispatcher = proxyConfig.agent;
      }

      let response = await fetch(url, init);
      let responseTime = Date.now() - startTime;

      const shouldAttemptDirectRetry =
        Boolean(proxyConfig?.fallbackToDirect) && PROXY_RETRY_STATUS_CODES.has(response.status);

      if (shouldAttemptDirectRetry) {
        const isCloudflareError = detectCloudflareGatewayError(response);

        logger.warn("Provider API test: Proxy returned error, falling back to direct connection", {
          providerId: tempProvider.id,
          providerName: tempProvider.name,
          proxyStatus: response.status,
          proxyUrl: proxyConfig?.proxyUrl,
          fallbackReason: isCloudflareError ? "cloudflare" : "proxy-error",
        });

        const fallbackInit = { ...init };
        delete fallbackInit.dispatcher;

        const fallbackStartTime = Date.now();
        try {
          response = await fetch(url, fallbackInit);
          responseTime = Date.now() - fallbackStartTime;

          logger.info("Provider API test: Direct connection succeeded after proxy failure", {
            providerId: tempProvider.id,
            providerName: tempProvider.name,
            directStatus: response.status,
            directResponseTime: responseTime,
            fallbackReason: isCloudflareError ? "cloudflare" : "proxy-error",
          });
        } catch (directError) {
          const directResponseTime = Date.now() - fallbackStartTime;
          logger.error("Provider API test: Direct connection also failed", {
            providerId: tempProvider.id,
            error: directError,
            fallbackReason: isCloudflareError ? "cloudflare" : "proxy-error",
          });

          return {
            ok: true,
            data: {
              success: false,
              message: `代理和直连均失败`,
              details: {
                responseTime: directResponseTime,
                error: `代理错误: HTTP ${response.status} (${isCloudflareError ? "Cloudflare" : "Proxy"})\n直连错误: ${
                  directError instanceof Error ? directError.message : String(directError)
                }`,
              },
            },
          };
        }
      }

      if (!response.ok) {
        const errorText = await response.text();
        const sanitizedErrorText = sanitizeErrorTextForLogging(errorText);

        // 添加 trace 日志记录原始错误响应
        logger.trace("Provider API test raw error response", {
          providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
          status: response.status,
          rawErrorText: sanitizedErrorText,
          rawErrorLength: errorText.length,
        });

        let errorDetail: string | undefined;
        try {
          const errorJson = JSON.parse(errorText);
          errorDetail = extractErrorMessage(errorJson);

          logger.trace("Provider API test parsed error", {
            providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
            extractedDetail: errorDetail,
            errorJsonKeys:
              errorJson && typeof errorJson === "object" ? Object.keys(errorJson) : undefined,
          });
        } catch (parseError) {
          logger.trace("Provider API test failed to parse error JSON", {
            providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
            parseError: parseError instanceof Error ? parseError.message : "Unknown parse error",
          });
          errorDetail = undefined;
        }

        // 使用 errorDetail 或 errorText 的前 200 字符作为错误详情
        // 添加防御性检查,避免空字符串产生误导性错误消息
        const finalErrorDetail =
          errorDetail ?? (errorText ? clipText(errorText, 200) : "No error details available");

        logger.error("Provider API test failed", {
          providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
          path: typeof options.path === "string" ? options.path : "dynamic",
          status: response.status,
          errorDetail: finalErrorDetail,
        });

        return {
          ok: true,
          data: {
            success: false,
            message: `API 返回错误: HTTP ${response.status}`,
            details: {
              responseTime,
              error: finalErrorDetail,
            },
          },
        };
      }

      // 检查响应是否为流式响应（SSE）
      const contentType = response.headers.get("content-type") || "";
      const isStreamResponse =
        contentType.includes("text/event-stream") || contentType.includes("application/x-ndjson");

      if (isStreamResponse) {
        // 流式响应：读取并解析流式数据
        logger.info("Provider API test received streaming response", {
          providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
          contentType,
        });

        try {
          const streamResult = await parseStreamResponse(response);
          const extracted = options.extract(streamResult.data);

          return {
            ok: true,
            data: {
              success: true,
              message: `${options.successMessage}（流式响应）`,
              details: {
                responseTime,
                ...extracted,
                streamInfo: {
                  chunksReceived: streamResult.chunksReceived,
                  format: streamResult.format,
                },
              },
            },
          };
        } catch (streamError) {
          logger.error("Provider API test stream parsing failed", {
            providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
            error: streamError instanceof Error ? streamError.message : String(streamError),
          });

          return {
            ok: true,
            data: {
              success: false,
              message: "流式响应解析失败",
              details: {
                responseTime,
                error: streamError instanceof Error ? streamError.message : "无法解析流式响应数据",
              },
            },
          };
        }
      }

      // 先读取响应文本，然后尝试解析 JSON
      const responseText = await response.text();

      // 检查是否为 SSE 格式（即使 Content-Type 未正确设置）
      // 使用正则表达式进行更健壮的检测
      const ssePattern = /^(event:|data:)|\n\n(event:|data:)/;
      const isLikelySSE = ssePattern.test(responseText);

      if (isLikelySSE) {
        logger.info("Provider API test received SSE response without proper Content-Type", {
          providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
          contentType,
          responsePreview: clipText(responseText, 100),
        });

        try {
          const streamResult = parseSSEText(responseText);
          const extracted = options.extract(streamResult.data);

          return {
            ok: true,
            data: {
              success: true,
              message: `${options.successMessage}（流式响应，Content-Type 未正确设置）`,
              details: {
                responseTime,
                ...extracted,
                streamInfo: {
                  chunksReceived: streamResult.chunksReceived,
                  format: streamResult.format,
                },
              },
            },
          };
        } catch (streamError) {
          logger.error("Provider API test SSE text parsing failed", {
            providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
            error: streamError instanceof Error ? streamError.message : String(streamError),
          });

          return {
            ok: true,
            data: {
              success: false,
              message: "流式响应解析失败",
              details: {
                responseTime,
                error: streamError instanceof Error ? streamError.message : "无法解析 SSE 格式数据",
              },
            },
          };
        }
      }

      // 尝试解析 JSON
      let result: ProviderApiResponse;
      try {
        result = JSON.parse(responseText) as ProviderApiResponse;
      } catch (jsonError) {
        logger.error("Provider API test JSON parse failed", {
          providerUrl: normalizedProviderUrl.replace(/:\/\/[^@]*@/, "://***@"),
          contentType,
          responsePreview: clipText(responseText, 100),
          jsonError: jsonError instanceof Error ? jsonError.message : String(jsonError),
        });

        return {
          ok: true,
          data: {
            success: false,
            message: "响应格式无效: 无法解析 JSON",
            details: {
              responseTime,
              error: `JSON 解析失败: ${jsonError instanceof Error ? jsonError.message : "未知错误"}`,
            },
          },
        };
      }

      const extracted = options.extract(result);

      return {
        ok: true,
        data: {
          success: true,
          message: options.successMessage,
          details: {
            responseTime,
            ...extracted,
          },
        },
      };
    } catch (error) {
      const responseTime = Date.now() - startTime;
      const err = error as Error & { code?: string };

      return {
        ok: true,
        data: {
          success: false,
          message: `连接失败: ${err.message}`,
          details: {
            responseTime,
            error: err.message,
          },
        },
      };
    }
  } catch (error) {
    logger.error("测试供应商 API 失败:", error);
    const message = error instanceof Error ? error.message : "测试失败";
    return { ok: false, error: message };
  }
}

/**
 * 测试 Anthropic Messages API 连通性
 */
function getHostnameFromUrl(url: string): string | null {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function resolveAnthropicAuthHeaders(apiKey: string, providerUrl: string): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "anthropic-version": "2023-06-01",
  };

  const hostname = getHostnameFromUrl(providerUrl);
  const isOfficialAnthropic = hostname
    ? hostname.endsWith("anthropic.com") || hostname.endsWith("claude.ai")
    : false;
  const looksLikeProxy = hostname
    ? /proxy|relay|gateway|router|openai|api2d|openrouter|worker|gpt/i.test(hostname)
    : false;

  if (isOfficialAnthropic) {
    headers["x-api-key"] = apiKey;
    return headers;
  }

  if (looksLikeProxy) {
    headers.Authorization = `Bearer ${apiKey}`;
    return headers;
  }

  headers["x-api-key"] = apiKey;
  headers.Authorization = `Bearer ${apiKey}`;
  return headers;
}

export async function testProviderAnthropicMessages(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  return executeProviderApiTest(data, {
    path: "/v1/messages",
    defaultModel: "claude-sonnet-4-5-20250929",
    headers: (apiKey, context) => resolveAnthropicAuthHeaders(apiKey, context.providerUrl),
    body: (model) => ({
      model,
      max_tokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
      stream: false, // 显式禁用流式响应，避免 Cloudflare 520 错误
      messages: [{ role: "user", content: API_TEST_CONFIG.TEST_PROMPT }],
    }),
    userAgent: "claude-cli/2.0.50 (external, cli)",
    successMessage: "Anthropic Messages API 测试成功",
    extract: (result) => ({
      model: "model" in result ? result.model : undefined,
      usage: "usage" in result ? (result.usage as Record<string, unknown>) : undefined,
      content: extractFirstTextSnippet(result),
    }),
  });
}

/**
 * 测试 OpenAI Chat Completions API 连通性
 */
export async function testProviderOpenAIChatCompletions(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  return executeProviderApiTest(data, {
    path: "/v1/chat/completions",
    defaultModel: "gpt-5.1-codex",
    headers: (apiKey, context) => {
      void context;
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
    },
    body: (model) => ({
      model,
      max_tokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
      messages: [
        { role: "developer", content: "你是一个有帮助的助手。" },
        { role: "user", content: "你好" },
      ],
    }),
    userAgent: "OpenAI/NodeJS/3.2.1",
    successMessage: "OpenAI Chat Completions API 测试成功",
    extract: (result) => ({
      model: "model" in result ? result.model : undefined,
      usage: "usage" in result ? (result.usage as Record<string, unknown>) : undefined,
      content: extractFirstTextSnippet(result),
    }),
  });
}

/**
 * 测试 OpenAI Responses API 连通性
 */
export async function testProviderOpenAIResponses(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  return executeProviderApiTest(data, {
    path: "/v1/responses",
    defaultModel: "gpt-5.1-codex",
    headers: (apiKey, context) => {
      void context;
      return {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      };
    },
    body: (model) => ({
      model,
      // 注意：不包含 max_output_tokens，因为某些中转服务不支持此参数
      // input 必须是数组格式，符合 OpenAI Responses API 规范
      input: [
        {
          type: "message", // ⭐ 修复 #189: Response API 要求 input 数组中的每个元素必须包含 type 字段
          role: "user",
          content: [
            {
              type: "input_text",
              text: API_TEST_CONFIG.TEST_PROMPT,
            },
          ],
        },
      ],
    }),
    userAgent: "codex_cli_rs/0.63.0",
    successMessage: "OpenAI Responses API 测试成功",
    extract: (result) => ({
      model: "model" in result ? result.model : undefined,
      usage: "usage" in result ? (result.usage as Record<string, unknown>) : undefined,
      content: extractFirstTextSnippet(result),
    }),
  });
}

/**
 * 测试 Gemini API 连通性
 */
export async function testProviderGemini(
  data: ProviderApiTestArgs
): Promise<ProviderApiTestResult> {
  // 校验超时范围（防止资源占用）
  if (data.timeoutMs !== undefined) {
    if (
      data.timeoutMs < API_TEST_TIMEOUT_LIMITS.MIN ||
      data.timeoutMs > API_TEST_TIMEOUT_LIMITS.MAX
    ) {
      return {
        ok: true,
        data: {
          success: false,
          message: `超时时间必须在 ${API_TEST_TIMEOUT_LIMITS.MIN / 1000}-${API_TEST_TIMEOUT_LIMITS.MAX / 1000} 秒之间`,
        },
      };
    }
  }

  logger.debug("testProviderGemini: Starting test", {
    providerUrl: data.providerUrl,
    model: data.model,
    hasApiKey: !!data.apiKey,
    apiKeyLength: data.apiKey?.length,
  });

  // 预处理 Auth，如果是 API Key 保持原样，如果是 JSON 则解析 Access Token
  let processedApiKey = data.apiKey;
  let isJsonCreds = false;

  try {
    // 使用 GeminiAuth 获取 token (如果是 json 凭证)
    processedApiKey = await GeminiAuth.getAccessToken(data.apiKey);
    isJsonCreds = GeminiAuth.isJson(data.apiKey);
  } catch (e) {
    // 忽略错误，让后续请求失败
    logger.warn("testProviderGemini:auth_process_failed", { error: e });
  }

  // 第一次尝试：仅使用 header 认证（适合代理服务如 co.yes.vg）
  const firstResult = await executeProviderApiTest(
    { ...data, apiKey: processedApiKey },
    {
      path: (model) => {
        // 不在 URL 中放 key，仅用 header 认证
        return `/v1beta/models/${model}:streamGenerateContent?alt=sse`;
      },
      defaultModel: "gemini-2.5-pro",
      headers: (apiKey) => {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          "x-goog-api-client": "google-genai-sdk/1.30.0 gl-node/v24.11.0",
        };
        if (isJsonCreds) {
          headers.Authorization = `Bearer ${apiKey}`;
        } else {
          headers["x-goog-api-key"] = apiKey;
        }
        return headers;
      },
      body: (model) => {
        void model;
        return {
          contents: [{ parts: [{ text: API_TEST_CONFIG.TEST_PROMPT }] }],
          generationConfig: {
            maxOutputTokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
          },
        };
      },
      userAgent: "GeminiCLI/v24.11.0 (linux; x64)",
      timeoutMs: data.timeoutMs ?? API_TEST_CONFIG.GEMINI_TIMEOUT_MS,
      successMessage: "Gemini API 测试成功",
      extract: (result) => {
        const geminiResult = result as GeminiResponse;
        return {
          model: undefined,
          usage: geminiResult.usageMetadata as Record<string, unknown>,
          content: extractFirstTextSnippet(geminiResult),
        };
      },
    }
  );

  // 检查实际测试结果（注意：ok: true 只表示函数执行成功，data.success 才表示测试结果）
  const resultData = (
    firstResult as {
      ok: boolean;
      data?: { success?: boolean; message?: string };
    }
  ).data;
  const testSuccess = resultData?.success === true;

  // 如果测试成功，直接返回
  if (testSuccess) {
    return firstResult;
  }

  // JSON 凭证只支持 Bearer，不尝试 URL 认证
  if (isJsonCreds) {
    return firstResult;
  }

  // 检查是否是认证错误（401/403）
  // 从 message 中解析 HTTP 状态码（格式："API 返回错误: HTTP 401"）
  const message = resultData?.message;
  const isAuthError = message?.includes("HTTP 401") || message?.includes("HTTP 403");
  if (!isAuthError) {
    return firstResult;
  }

  // 第二次尝试：同时使用 URL query 参数 + header（兼容官方 Gemini API）
  logger.debug("testProviderGemini: Header-only auth failed, retrying with URL param + header", {
    firstMessage: message,
  });

  const secondResult = await executeProviderApiTest(
    { ...data, apiKey: processedApiKey },
    {
      path: (model, apiKey) =>
        `/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${encodeURIComponent(apiKey)}`,
      defaultModel: "gemini-2.5-pro",
      headers: (apiKey) => ({
        "Content-Type": "application/json",
        "x-goog-api-client": "google-genai-sdk/1.30.0 gl-node/v24.11.0",
        "x-goog-api-key": apiKey,
      }),
      body: (model) => {
        void model;
        return {
          contents: [{ parts: [{ text: API_TEST_CONFIG.TEST_PROMPT }] }],
          generationConfig: {
            maxOutputTokens: API_TEST_CONFIG.TEST_MAX_TOKENS,
          },
        };
      },
      userAgent: "GeminiCLI/v24.11.0 (linux; x64)",
      timeoutMs: data.timeoutMs ?? API_TEST_CONFIG.GEMINI_TIMEOUT_MS,
      successMessage: "Gemini API 测试成功 (URL 认证)",
      extract: (result) => {
        const geminiResult = result as GeminiResponse;
        return {
          model: undefined,
          usage: geminiResult.usageMetadata as Record<string, unknown>,
          content: extractFirstTextSnippet(geminiResult),
        };
      },
    }
  );

  // 如果第二次尝试成功，在 message 中添加提示
  if (secondResult.ok && secondResult.data?.success) {
    return {
      ok: true,
      data: {
        ...secondResult.data,
        message: `${secondResult.data.message} [FALLBACK:URL_PARAM]`,
      },
    };
  }

  return secondResult;
}

// ============================================================================
// Unified Provider Testing (relay-pulse style three-tier validation)
// ============================================================================

/**
 * Arguments for unified provider testing
 */
export type UnifiedTestArgs = {
  providerUrl: string;
  apiKey: string;
  providerType: ProviderType;
  model?: string;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  /** Latency threshold in ms for YELLOW status (default: 5000) */
  latencyThresholdMs?: number;
  /** String that must be present in response (default: type-specific) */
  successContains?: string;
  /** Request timeout in ms (default: 10000) */
  timeoutMs?: number;
  /** Preset configuration ID (e.g., 'cc_base', 'cx_base') */
  preset?: string;
  /** Custom JSON payload (overrides preset and default body) */
  customPayload?: string;
  /** Custom headers to merge with default headers */
  customHeaders?: Record<string, string>;
};

/**
 * Result type for unified provider testing
 * Includes three-tier validation details
 */
export type UnifiedTestResult = ActionResult<{
  success: boolean;
  status: TestStatus;
  subStatus: TestSubStatus;
  message: string;
  latencyMs: number;
  firstByteMs?: number;
  httpStatusCode?: number;
  httpStatusText?: string;
  model?: string;
  content?: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens?: number;
    cacheReadInputTokens?: number;
  };
  streamInfo?: {
    isStreaming: boolean;
    chunksReceived?: number;
  };
  errorMessage?: string;
  errorType?: string;
  testedAt: string;
  validationDetails: {
    httpPassed: boolean;
    httpStatusCode?: number;
    latencyPassed: boolean;
    latencyMs?: number;
    contentPassed: boolean;
    contentTarget?: string;
  };
}>;

/**
 * Human-readable messages for sub-status
 */
const SUB_STATUS_MESSAGES: Record<TestSubStatus, string> = {
  success: "所有检查通过",
  slow_latency: "响应成功但较慢",
  rate_limit: "请求被限流 (429)",
  server_error: "服务器错误 (5xx)",
  client_error: "客户端错误 (4xx)",
  auth_error: "认证失败 (401/403)",
  invalid_request: "无效请求 (400)",
  network_error: "网络连接失败",
  content_mismatch: "响应内容验证失败",
};

/**
 * 检查 URL 是否可用于 API 测试（仅做基础格式校验）
 * 对 validateProviderUrlForConnectivity 的薄封装
 */
async function isUrlSafeForApiTest(
  providerUrl: string
): Promise<{ safe: boolean; reason?: string }> {
  const validation = validateProviderUrlForConnectivity(providerUrl);
  if (validation.valid) {
    return { safe: true };
  }
  return { safe: false, reason: validation.error.message };
}

/**
 * Unified provider testing with three-tier validation
 *
 * Validation tiers (from relay-pulse):
 * 1. HTTP Status Code - 2xx/3xx = pass, 4xx/5xx = fail
 * 2. Latency Threshold - Below threshold = GREEN, above = YELLOW
 * 3. Content Validation - Response contains expected string
 *
 * Status meanings:
 * - green: All validations passed
 * - yellow: HTTP OK but slow (degraded)
 * - red: Any validation failed
 */
export async function testProviderUnified(data: UnifiedTestArgs): Promise<UnifiedTestResult> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {
      ok: false,
      error: "未授权",
    };
  }

  // Validate URL
  const urlValidation = await isUrlSafeForApiTest(data.providerUrl);
  if (!urlValidation.safe) {
    return {
      ok: false,
      error: urlValidation.reason ?? "无效的 URL",
    };
  }

  try {
    // Build test configuration
    const config: ProviderTestConfig = {
      providerUrl: data.providerUrl,
      apiKey: data.apiKey,
      providerType: data.providerType,
      model: data.model,
      proxyUrl: data.proxyUrl ?? undefined,
      proxyFallbackToDirect: data.proxyFallbackToDirect,
      latencyThresholdMs: data.latencyThresholdMs,
      successContains: data.successContains,
      timeoutMs: data.timeoutMs,
      // Custom configuration fields
      preset: data.preset,
      customPayload: data.customPayload,
      customHeaders: data.customHeaders,
    };

    // Execute test
    const result = await executeProviderTest(config);

    // Build response message
    const statusText =
      result.status === "green" ? "可用" : result.status === "yellow" ? "波动" : "不可用";

    const message = `供应商 ${statusText}: ${SUB_STATUS_MESSAGES[result.subStatus]}`;

    return {
      ok: true,
      data: {
        success: result.success,
        status: result.status,
        subStatus: result.subStatus,
        message,
        latencyMs: result.latencyMs,
        firstByteMs: result.firstByteMs,
        httpStatusCode: result.httpStatusCode,
        httpStatusText: result.httpStatusText,
        model: result.model,
        content: result.content,
        usage: result.usage,
        streamInfo: result.streamInfo,
        errorMessage: result.errorMessage,
        errorType: result.errorType,
        testedAt: result.testedAt.toISOString(),
        validationDetails: result.validationDetails,
      },
    };
  } catch (error) {
    logger.error("testProviderUnified error", { error });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "测试执行失败",
    };
  }
}

// ============================================================================
// Provider Test Presets
// ============================================================================

/**
 * Preset configuration for frontend display
 */
export type PresetConfigResponse = {
  id: string;
  description: string;
  defaultSuccessContains: string;
  defaultModel: string;
};

/**
 * Get available test presets for a provider type
 *
 * @description Returns list of preset configurations compatible with the given provider type.
 * Presets provide authentic CLI request patterns that pass relay service verification.
 */
export async function getProviderTestPresets(
  providerType: ProviderType
): Promise<ActionResult<PresetConfigResponse[]>> {
  const session = await getSession();
  if (!session || session.user.role !== "admin") {
    return {
      ok: false,
      error: "未授权",
    };
  }

  try {
    const presets = getPresetsForProvider(providerType);
    const response: PresetConfigResponse[] = presets.map((preset) => ({
      id: preset.id,
      description: preset.description,
      defaultSuccessContains: preset.defaultSuccessContains,
      defaultModel: preset.defaultModel,
    }));

    return {
      ok: true,
      data: response,
    };
  } catch (error) {
    logger.error("getProviderTestPresets error", { error, providerType });
    return {
      ok: false,
      error: "获取预置配置失败",
    };
  }
}

// ============================================================================
// Fetch Upstream Models
// ============================================================================

/**
 * 上游模型列表获取参数
 */
export type FetchUpstreamModelsArgs = {
  providerUrl: string;
  apiKey: string;
  providerType: ProviderType;
  proxyUrl?: string | null;
  proxyFallbackToDirect?: boolean;
  /** 超时时间（毫秒），默认 10000 */
  timeoutMs?: number;
};

/**
 * 上游模型列表获取结果
 */
export type FetchUpstreamModelsResult = ActionResult<{
  models: string[];
  source: "upstream";
}>;

// OpenAI /v1/models 响应类型
type OpenAIModelsResponse = {
  object: "list";
  data: Array<{
    id: string;
    object: "model";
    created?: number;
    owned_by?: string;
  }>;
};

// Gemini /v1beta/models 响应类型
type GeminiModelsResponse = {
  models: Array<{
    name: string;
    displayName?: string;
    description?: string;
    supportedGenerationMethods?: string[];
  }>;
  nextPageToken?: string;
};

// Anthropic /v1/models 响应类型
type AnthropicModelsResponse = {
  data: Array<{
    id: string;
    created_at: string;
    display_name: string;
    type: "model";
  }>;
  first_id: string;
  has_more: boolean;
  last_id: string;
};

const UPSTREAM_FETCH_TIMEOUT_MS = 10000;

// 通用 fetch 选项类型（undici 兼容）
interface UndiciFetchOptions extends RequestInit {
  dispatcher?: unknown;
}

/**
 * 执行带代理的 fetch 请求（通用函数）
 */
async function executeProxiedFetch(
  proxyConfig: { proxyUrl: string | null; proxyFallbackToDirect: boolean },
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<Response> {
  const tempProvider: ProviderProxyConfig = {
    id: -1,
    name: "fetch-models",
    proxyUrl: proxyConfig.proxyUrl,
    proxyFallbackToDirect: proxyConfig.proxyFallbackToDirect,
  };

  const proxy = createProxyAgentForProvider(tempProvider, url);

  const init: UndiciFetchOptions = {
    method: "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  };

  if (proxy) {
    init.dispatcher = proxy.agent;
  }

  return fetch(url, init);
}

/**
 * 处理 HTTP 错误响应
 */
function handleHttpError(
  response: Response,
  errorText: string,
  logPrefix: string
): FetchUpstreamModelsResult {
  logger.warn(`${logPrefix}: API returned error`, {
    status: response.status,
    errorPreview: errorText.substring(0, 200),
  });
  return { ok: false, error: `API 返回错误: HTTP ${response.status}` };
}

/**
 * 处理 fetch 异常
 */
function handleFetchException(error: unknown, logPrefix: string): FetchUpstreamModelsResult {
  const err = error as Error & { code?: string };
  logger.warn(`${logPrefix}: request failed`, {
    error: err.message,
    code: err.code,
  });
  return { ok: false, error: `请求失败: ${err.message}` };
}

/**
 * 构建成功响应
 */
function buildSuccessResult(models: string[], logPrefix: string): FetchUpstreamModelsResult {
  logger.debug(`${logPrefix}: success`, { modelCount: models.length });
  return { ok: true, data: { models, source: "upstream" } };
}

/**
 * 从上游服务商获取模型列表
 *
 * 支持的服务商类型：
 * - claude / claude-auth: 调用 /v1/models (Anthropic API)
 * - codex / openai-compatible: 调用 /v1/models (OpenAI 兼容 API)
 * - gemini / gemini-cli: 调用 /v1beta/models (Google AI API)
 *
 * @returns 模型列表或错误
 */
export async function fetchUpstreamModels(
  data: FetchUpstreamModelsArgs
): Promise<FetchUpstreamModelsResult> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "无权限执行此操作" };
    }

    // 验证 URL
    const urlValidation = validateProviderUrlForConnectivity(data.providerUrl);
    if (!urlValidation.valid) {
      return { ok: false, error: urlValidation.error.message };
    }

    // 验证代理 URL
    if (data.proxyUrl && !isValidProxyUrl(data.proxyUrl)) {
      return { ok: false, error: "代理地址格式无效" };
    }

    const normalizedUrl = urlValidation.normalizedUrl.replace(/\/$/, "");
    const timeoutMs = data.timeoutMs ?? UPSTREAM_FETCH_TIMEOUT_MS;

    // 根据供应商类型选择不同的 API
    if (data.providerType === "claude" || data.providerType === "claude-auth") {
      return await fetchAnthropicModels(data, normalizedUrl, timeoutMs);
    }

    if (data.providerType === "gemini" || data.providerType === "gemini-cli") {
      return await fetchGeminiModels(data, normalizedUrl, timeoutMs);
    }

    // OpenAI 兼容 API (codex, openai-compatible)
    return await fetchOpenAIModels(data, normalizedUrl, timeoutMs);
  } catch (error) {
    logger.error("fetchUpstreamModels error", { error, providerType: data.providerType });
    return {
      ok: false,
      error: error instanceof Error ? error.message : "获取上游模型列表失败",
    };
  }
}

/**
 * 从 OpenAI 兼容 API 获取模型列表
 */
async function fetchOpenAIModels(
  data: FetchUpstreamModelsArgs,
  normalizedUrl: string,
  timeoutMs: number
): Promise<FetchUpstreamModelsResult> {
  const url = `${normalizedUrl}/v1/models`;

  try {
    const response = await executeProxiedFetch(
      {
        proxyUrl: data.proxyUrl ?? null,
        proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
      },
      url,
      { Authorization: `Bearer ${data.apiKey}` },
      timeoutMs
    );

    if (!response.ok) {
      return handleHttpError(response, await response.text(), "fetchOpenAIModels");
    }

    const result = (await response.json()) as OpenAIModelsResponse;

    if (!result.data || !Array.isArray(result.data)) {
      return { ok: false, error: "响应格式无效：缺少 data 数组" };
    }

    return buildSuccessResult(result.data.map((m) => m.id).sort(), "fetchOpenAIModels");
  } catch (error) {
    return handleFetchException(error, "fetchOpenAIModels");
  }
}

/**
 * 从 Gemini API 获取模型列表
 * 注意：保留了 401/403 重试逻辑，因为 Gemini 支持多种认证方式
 */
async function fetchGeminiModels(
  data: FetchUpstreamModelsArgs,
  normalizedUrl: string,
  timeoutMs: number
): Promise<FetchUpstreamModelsResult> {
  const proxyConfig = {
    proxyUrl: data.proxyUrl ?? null,
    proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
  };

  // Gemini 认证处理
  let processedApiKey = data.apiKey;
  let isJsonCreds = false;

  try {
    processedApiKey = await GeminiAuth.getAccessToken(data.apiKey);
    isJsonCreds = GeminiAuth.isJson(data.apiKey);
  } catch (e) {
    logger.warn("fetchGeminiModels: auth process failed", { error: e });
  }

  const url = `${normalizedUrl}/v1beta/models?pageSize=100`;
  const headers: Record<string, string> = isJsonCreds
    ? { Authorization: `Bearer ${processedApiKey}` }
    : { "x-goog-api-key": processedApiKey };

  try {
    let response = await executeProxiedFetch(proxyConfig, url, headers, timeoutMs);

    // 如果 header 认证失败（401/403），尝试 URL 参数认证（不动此逻辑）
    if (!isJsonCreds && (response.status === 401 || response.status === 403)) {
      logger.debug("fetchGeminiModels: header auth failed, trying URL param auth");
      const urlWithKey = `${normalizedUrl}/v1beta/models?pageSize=100&key=${encodeURIComponent(processedApiKey)}`;
      response = await executeProxiedFetch(
        proxyConfig,
        urlWithKey,
        { "x-goog-api-key": processedApiKey },
        timeoutMs
      );
    }

    if (!response.ok) {
      return handleHttpError(response, await response.text(), "fetchGeminiModels");
    }

    const result = (await response.json()) as GeminiModelsResponse;

    if (!result.models || !Array.isArray(result.models)) {
      return { ok: false, error: "响应格式无效：缺少 models 数组" };
    }

    // Gemini 模型名称格式: "models/gemini-pro" -> "gemini-pro"
    // 注意：部分代理返回 supportedGenerationMethods 为 null，此时不过滤
    const models = result.models
      .filter(
        (m) =>
          !m.supportedGenerationMethods || m.supportedGenerationMethods.includes("generateContent")
      )
      .map((m) => m.name.replace(/^models\//, ""))
      .sort();

    return buildSuccessResult(models, "fetchGeminiModels");
  } catch (error) {
    return handleFetchException(error, "fetchGeminiModels");
  }
}

/**
 * 从 Anthropic API 获取模型列表
 */
async function fetchAnthropicModels(
  data: FetchUpstreamModelsArgs,
  normalizedUrl: string,
  timeoutMs: number
): Promise<FetchUpstreamModelsResult> {
  const url = `${normalizedUrl}/v1/models`;

  // 复用认证逻辑：官方 API 用 x-api-key，代理用 Bearer token
  const authHeaders = resolveAnthropicAuthHeaders(data.apiKey, normalizedUrl);

  try {
    const response = await executeProxiedFetch(
      {
        proxyUrl: data.proxyUrl ?? null,
        proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
      },
      url,
      authHeaders,
      timeoutMs
    );

    if (!response.ok) {
      return handleHttpError(response, await response.text(), "fetchAnthropicModels");
    }

    const result = (await response.json()) as AnthropicModelsResponse;

    if (!result.data || !Array.isArray(result.data)) {
      return { ok: false, error: "响应格式无效：缺少 data 数组" };
    }

    return buildSuccessResult(result.data.map((m) => m.id).sort(), "fetchAnthropicModels");
  } catch (error) {
    return handleFetchException(error, "fetchAnthropicModels");
  }
}

/**
 * 解析分组字符串为数组
 */
function parseGroupString(groupString: string): string[] {
  return groupString
    .split(",")
    .map((g) => g.trim())
    .filter(Boolean);
}

/**
 * 检查供应商分组是否匹配用户分组
 */
function checkProviderGroupMatch(providerGroupTag: string | null, userGroups: string[]): boolean {
  if (userGroups.includes(PROVIDER_GROUP.ALL)) {
    return true;
  }

  const providerTags = providerGroupTag
    ? parseGroupString(providerGroupTag)
    : [PROVIDER_GROUP.DEFAULT];

  return providerTags.some((tag) => userGroups.includes(tag));
}

/**
 * 根据供应商分组获取模型建议列表
 *
 * 用于用户/密钥编辑时的模型限制下拉建议。
 * 从匹配分组的启用供应商中收集 allowedModels 并去重。
 *
 * @param providerGroup - 可选的供应商分组（逗号分隔），默认为 "default"
 * @returns 去重后的模型列表
 */
export async function getModelSuggestionsByProviderGroup(
  providerGroup?: string | null
): Promise<ActionResult<string[]>> {
  try {
    const session = await getSession();
    if (!session) {
      return { ok: false, error: "未登录" };
    }

    // 获取所有启用的供应商
    const providers = await findAllProviders();
    const enabledProviders = providers.filter((p) => p.isEnabled);

    // 解析用户分组
    const userGroups = providerGroup ? parseGroupString(providerGroup) : [PROVIDER_GROUP.DEFAULT];

    // 过滤匹配分组的供应商并收集 allowedModels
    const modelSet = new Set<string>();

    for (const provider of enabledProviders) {
      if (checkProviderGroupMatch(provider.groupTag, userGroups)) {
        const models = provider.allowedModels;
        if (models && Array.isArray(models)) {
          for (const model of models) {
            if (model) {
              modelSet.add(model);
            }
          }
        }
      }
    }

    // 转换为数组并排序
    const sortedModels = Array.from(modelSet).sort();

    return { ok: true, data: sortedModels };
  } catch (error) {
    logger.error("获取模型建议列表失败:", error);
    return { ok: false, error: "获取模型建议列表失败" };
  }
}

// ============================================================================
// Recluster Provider Vendors
// ============================================================================

type ReclusterChange = {
  providerId: number;
  providerName: string;
  oldVendorId: number;
  oldVendorDomain: string;
  newVendorDomain: string;
};

type ReclusterResult = {
  preview: {
    providersMoved: number;
    vendorsCreated: number;
    vendorsToDelete: number;
    skippedInvalidUrl: number;
  };
  changes: ReclusterChange[];
  applied: boolean;
};

/**
 * Recluster provider vendors based on updated clustering rules.
 * When websiteUrl is empty, uses host:port as vendor key instead of just hostname.
 *
 * @param confirm - false=preview mode (calculate changes only), true=apply mode (execute changes)
 */
export async function reclusterProviderVendors(args: {
  confirm: boolean;
}): Promise<ActionResult<ReclusterResult>> {
  try {
    const session = await getSession();
    if (!session || session.user.role !== "admin") {
      return { ok: false, error: "NO_PERMISSION" };
    }

    const allProviders = await findAllProvidersFresh();

    if (allProviders.length === 0) {
      return {
        ok: true,
        data: {
          preview: {
            providersMoved: 0,
            vendorsCreated: 0,
            vendorsToDelete: 0,
            skippedInvalidUrl: 0,
          },
          changes: [],
          applied: args.confirm,
        },
      };
    }

    const changes: ReclusterChange[] = [];
    const newVendorKeys = new Set<string>();
    const oldVendorIds = new Set<number>();
    let skippedInvalidUrl = 0;

    // Batch load all vendor data upfront to avoid N+1 queries
    const uniqueVendorIds = [
      ...new Set(
        allProviders
          .map((p) => p.providerVendorId)
          .filter((id): id is number => id !== null && id !== undefined && id > 0)
      ),
    ];
    const vendors = await Promise.all(uniqueVendorIds.map((id) => findProviderVendorById(id)));
    const vendorMap = new Map(
      vendors.filter((v): v is NonNullable<typeof v> => v !== null).map((v) => [v.id, v])
    );

    // Build provider map for quick lookup in transaction
    const providerMap = new Map(allProviders.map((p) => [p.id, p]));

    // Calculate new vendor key for each provider
    for (const provider of allProviders) {
      const newVendorKey = await computeVendorKey({
        providerUrl: provider.url,
        websiteUrl: provider.websiteUrl,
      });

      if (!newVendorKey) {
        skippedInvalidUrl++;
        continue;
      }

      // Get current vendor domain from pre-loaded map
      const currentVendor = provider.providerVendorId
        ? vendorMap.get(provider.providerVendorId)
        : null;
      const currentDomain = currentVendor?.websiteDomain ?? "";

      // If key changed, record the change
      if (currentDomain !== newVendorKey) {
        newVendorKeys.add(newVendorKey);
        if (provider.providerVendorId) {
          oldVendorIds.add(provider.providerVendorId);
        }
        changes.push({
          providerId: provider.id,
          providerName: provider.name,
          oldVendorId: provider.providerVendorId ?? 0,
          oldVendorDomain: currentDomain,
          newVendorDomain: newVendorKey,
        });
      }
    }

    const preview = {
      providersMoved: changes.length,
      vendorsCreated: newVendorKeys.size,
      vendorsToDelete: oldVendorIds.size,
      skippedInvalidUrl,
    };

    // Preview mode: return without modifying DB
    if (!args.confirm) {
      return {
        ok: true,
        data: {
          preview,
          changes,
          applied: false,
        },
      };
    }

    // Apply mode: execute changes in transaction
    if (changes.length > 0) {
      await db.transaction(async (tx) => {
        for (const change of changes) {
          // Use pre-built map for O(1) lookup instead of O(N) find()
          const provider = providerMap.get(change.providerId);
          if (!provider) continue;

          // Get or create new vendor
          const newVendorId = await getOrCreateProviderVendorIdFromUrls({
            providerUrl: provider.url,
            websiteUrl: provider.websiteUrl ?? null,
          });

          // Update provider's vendorId
          await tx
            .update(providersTable)
            .set({ providerVendorId: newVendorId, updatedAt: new Date() })
            .where(eq(providersTable.id, change.providerId));
        }
      });

      // Backfill provider_endpoints
      await backfillProviderEndpointsFromProviders();

      // Cleanup empty vendors
      for (const oldVendorId of oldVendorIds) {
        await tryDeleteProviderVendorIfEmpty(oldVendorId);
      }

      // Publish cache invalidation
      try {
        await publishProviderCacheInvalidation();
      } catch (error) {
        logger.warn("reclusterProviderVendors:cache_invalidation_failed", {
          changedCount: changes.length,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }

    return {
      ok: true,
      data: {
        preview,
        changes,
        applied: true,
      },
    };
  } catch (error) {
    logger.error("reclusterProviderVendors:error", error);
    const message = error instanceof Error ? error.message : "Recluster failed";
    return { ok: false, error: message };
  }
}
