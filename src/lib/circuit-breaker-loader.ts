/**
 * 应用启动初始化加载器
 *
 * 功能：
 * 1. 预加载所有供应商的熔断器配置到 Redis
 * 2. 在应用启动时调用，提升首次请求性能
 */

import { logger } from "@/lib/logger";
import { loadAllProvidersCircuitConfig } from "@/lib/redis/circuit-breaker-config";

/**
 * 初始化所有供应商的熔断器配置
 * 应在应用启动时调用
 */
export async function initializeCircuitBreakerConfigs(): Promise<void> {
  try {
    logger.info("[Initializer] Starting circuit breaker config preload");
    await loadAllProvidersCircuitConfig();
    logger.info("[Initializer] Circuit breaker config preload completed");
  } catch (error) {
    logger.error("[Initializer] Failed to preload circuit breaker configs", {
      error: error instanceof Error ? error.message : String(error),
    });
    // 不抛出错误，应用仍可启动，配置会按需加载
  }
}
