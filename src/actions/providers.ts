"use server";

import {
  findProviderList,
  createProvider,
  updateProvider,
  deleteProvider,
  getProviderStatistics,
  findProviderById,
} from "@/repository/provider";
import { revalidatePath } from "next/cache";
import { logger } from "@/lib/logger";
import { type ProviderDisplay, type ProviderType } from "@/types/provider";
import { maskKey } from "@/lib/utils/validation";
import { getSession } from "@/lib/auth";
import { CreateProviderSchema, UpdateProviderSchema } from "@/lib/validation/schemas";
import type { ActionResult } from "./types";
import { getAllHealthStatus, resetCircuit, clearConfigCache } from "@/lib/circuit-breaker";
import {
  saveProviderCircuitConfig,
  deleteProviderCircuitConfig,
} from "@/lib/redis/circuit-breaker-config";
import { isValidProxyUrl } from "@/lib/proxy-agent";

// 获取服务商数据
export async function getProviders(): Promise<ProviderDisplay[]> {
  try {
    const session = await getSession();
    logger.trace("getProviders:session", { hasSession: !!session, role: session?.user.role });

    if (!session || session.user.role !== "admin") {
      logger.trace("getProviders:unauthorized", {
        hasSession: !!session,
        role: session?.user.role,
      });
      return [];
    }

    // 并行获取供应商列表和统计数据
    const [providers, statistics] = await Promise.all([
      findProviderList(),
      getProviderStatistics().catch((error) => {
        logger.trace("getProviders:statistics_error", {
          message: error.message,
          stack: error.stack,
          name: error.name,
        });
        logger.error("获取供应商统计数据失败:", error);
        return []; // 统计查询失败时返回空数组，不影响供应商列表显示
      }),
    ]);

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
            if (!isNaN(date.getTime())) {
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
        officialSiteUrl: provider.officialSiteUrl,
        maskedKey: maskKey(provider.key),
        isEnabled: provider.isEnabled,
        weight: provider.weight,
        priority: provider.priority,
        costMultiplier: provider.costMultiplier,
        groupTag: provider.groupTag,
        providerType: provider.providerType,
        modelRedirects: provider.modelRedirects,
        allowedModels: provider.allowedModels,
        joinClaudePool: provider.joinClaudePool,
        limit5hUsd: provider.limit5hUsd,
        limitWeeklyUsd: provider.limitWeeklyUsd,
        limitMonthlyUsd: provider.limitMonthlyUsd,
        limitConcurrentSessions: provider.limitConcurrentSessions,
        circuitBreakerFailureThreshold: provider.circuitBreakerFailureThreshold,
        circuitBreakerOpenDuration: provider.circuitBreakerOpenDuration,
        circuitBreakerHalfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
        proxyUrl: provider.proxyUrl,
        proxyFallbackToDirect: provider.proxyFallbackToDirect,
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

// 添加服务商
export async function addProvider(data: {
  name: string;
  url: string;
  official_site_url?: string | null;
  key: string;
  is_enabled?: boolean;
  weight?: number;
  priority?: number;
  cost_multiplier?: number;
  group_tag?: string | null;
  provider_type?: ProviderType;
  model_redirects?: Record<string, string> | null;
  allowed_models?: string[] | null;
  join_claude_pool?: boolean;
  limit_5h_usd?: number | null;
  limit_weekly_usd?: number | null;
  limit_monthly_usd?: number | null;
  limit_concurrent_sessions?: number | null;
  circuit_breaker_failure_threshold?: number;
  circuit_breaker_open_duration?: number;
  circuit_breaker_half_open_success_threshold?: number;
  proxy_url?: string | null;
  proxy_fallback_to_direct?: boolean;
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
      proxy_url: data.proxy_url ? "***" : null,
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

    const payload = {
      ...validated,
      official_site_url: validated.official_site_url ?? null,
      limit_5h_usd: validated.limit_5h_usd ?? null,
      limit_weekly_usd: validated.limit_weekly_usd ?? null,
      limit_monthly_usd: validated.limit_monthly_usd ?? null,
      limit_concurrent_sessions: validated.limit_concurrent_sessions ?? 0,
      circuit_breaker_failure_threshold: validated.circuit_breaker_failure_threshold ?? 5,
      circuit_breaker_open_duration: validated.circuit_breaker_open_duration ?? 1800000,
      circuit_breaker_half_open_success_threshold:
        validated.circuit_breaker_half_open_success_threshold ?? 2,
      proxy_url: validated.proxy_url ?? null,
      proxy_fallback_to_direct: validated.proxy_fallback_to_direct ?? false,
      tpm: validated.tpm ?? null,
      rpm: validated.rpm ?? null,
      rpd: validated.rpd ?? null,
      cc: validated.cc ?? null,
    };

    const provider = await createProvider(payload);
    logger.trace("addProvider:created_success", { name: validated.name, providerId: provider.id });

    // 同步熔断器配置到 Redis
    try {
      await saveProviderCircuitConfig(provider.id, {
        failureThreshold: provider.circuitBreakerFailureThreshold,
        openDuration: provider.circuitBreakerOpenDuration,
        halfOpenSuccessThreshold: provider.circuitBreakerHalfOpenSuccessThreshold,
      });
      logger.debug("addProvider:config_synced_to_redis", { providerId: provider.id });
    } catch (error) {
      logger.warn("addProvider:redis_sync_failed", {
        providerId: provider.id,
        error: error instanceof Error ? error.message : String(error),
      });
      // 不影响主流程，仅记录警告
    }

    revalidatePath("/settings/providers");
    logger.trace("addProvider:revalidated", { path: "/settings/providers" });

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
    official_site_url?: string | null;
    key?: string;
    is_enabled?: boolean;
    weight?: number;
    priority?: number;
    cost_multiplier?: number;
    group_tag?: string | null;
    provider_type?: ProviderType;
    model_redirects?: Record<string, string> | null;
    allowed_models?: string[] | null;
    join_claude_pool?: boolean;
    limit_5h_usd?: number | null;
    limit_weekly_usd?: number | null;
    limit_monthly_usd?: number | null;
    limit_concurrent_sessions?: number | null;
    circuit_breaker_failure_threshold?: number;
    circuit_breaker_open_duration?: number;
    circuit_breaker_half_open_success_threshold?: number;
    proxy_url?: string | null;
    proxy_fallback_to_direct?: boolean;
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
    const provider = await updateProvider(providerId, validated);

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

    revalidatePath("/settings/providers");
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

    await deleteProvider(providerId);

    // 删除 Redis 缓存
    try {
      await deleteProviderCircuitConfig(providerId);
      // 清除内存缓存
      clearConfigCache(providerId);
      logger.debug("removeProvider:cache_cleared", { providerId });
    } catch (error) {
      logger.warn("removeProvider:cache_clear_failed", {
        providerId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    revalidatePath("/settings/providers");
    return { ok: true };
  } catch (error) {
    logger.error("删除服务商失败:", error);
    const message = error instanceof Error ? error.message : "删除服务商失败";
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

    const healthStatus = getAllHealthStatus();

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
    revalidatePath("/settings/providers");

    return { ok: true };
  } catch (error) {
    logger.error("重置熔断器失败:", error);
    const message = error instanceof Error ? error.message : "重置熔断器失败";
    return { ok: false, error: message };
  }
}

/**
 * 获取供应商限额使用情况
 */
export async function getProviderLimitUsage(providerId: number): Promise<
  ActionResult<{
    cost5h: { current: number; limit: number | null; resetInfo: string };
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
    const { RateLimitService } = await import("@/lib/rate-limit");
    const { SessionTracker } = await import("@/lib/session-tracker");
    const { getResetInfo } = await import("@/lib/rate-limit/time-utils");

    // 获取金额消费（优先 Redis，降级数据库）
    const [cost5h, costWeekly, costMonthly, concurrentSessions] = await Promise.all([
      RateLimitService.getCurrentCost(providerId, "provider", "5h"),
      RateLimitService.getCurrentCost(providerId, "provider", "weekly"),
      RateLimitService.getCurrentCost(providerId, "provider", "monthly"),
      SessionTracker.getProviderSessionCount(providerId),
    ]);

    // 获取重置时间信息
    const reset5h = getResetInfo("5h");
    const resetWeekly = getResetInfo("weekly");
    const resetMonthly = getResetInfo("monthly");

    return {
      ok: true,
      data: {
        cost5h: {
          current: cost5h,
          limit: provider.limit5hUsd,
          resetInfo: reset5h.type === "rolling" ? `滚动窗口（${reset5h.period}）` : "自然时间窗口",
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

    // 导入代理工厂函数
    const { createProxyAgentForProvider } = await import("@/lib/proxy-agent");

    // 构造临时 Provider 对象（用于创建代理 agent）
    const tempProvider = {
      id: -1,
      proxyUrl: data.proxyUrl,
      proxyFallbackToDirect: data.proxyFallbackToDirect ?? false,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    try {
      // 创建代理配置
      const proxyConfig = createProxyAgentForProvider(tempProvider, data.providerUrl);

      // 扩展 RequestInit 类型
      interface UndiciFetchOptions extends RequestInit {
        dispatcher?: unknown;
      }

      const init: UndiciFetchOptions = {
        method: "HEAD", // 使用 HEAD 请求，减少流量
        signal: AbortSignal.timeout(5000), // 5 秒超时
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

      const errorType =
        err.name === "AbortError" ? "Timeout" : isProxyError ? "ProxyError" : "NetworkError";

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
