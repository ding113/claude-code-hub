/**
 * Provider 进程级缓存
 *
 * 特性：
 * - 30s TTL 自动过期
 * - Redis Pub/Sub 失效通知（跨实例即时同步）
 * - 降级策略：Redis 不可用时依赖 TTL 自动过期
 * - 版本号防止并发刷新竞态
 * - 请求级快照支持（保证故障迁移期间数据一致性）
 */

import "server-only";

import { getEnvConfig } from "@/lib/config";
import { logger } from "@/lib/logger";
import { publishCacheInvalidation, subscribeCacheInvalidation } from "@/lib/redis/pubsub";
import type { Provider } from "@/types/provider";

// 模块级别读取配置，避免热路径函数中频繁调用
const { ENABLE_PROVIDER_CACHE } = getEnvConfig();

export const CHANNEL_PROVIDERS_UPDATED = "cch:cache:providers:updated";

const CACHE_TTL_MS = 30_000; // 30 seconds

interface ProviderCacheState {
  data: Provider[] | null;
  expiresAt: number;
  version: number; // 防止并发刷新竞态
  refreshPromise: Promise<Provider[]> | null; // 防止并发请求同时刷新
}

const cache: ProviderCacheState = {
  data: null,
  expiresAt: 0,
  version: 0,
  refreshPromise: null,
};

let subscriptionInitialized = false;

/**
 * 初始化 Redis 订阅
 *
 * 使用失效通知模式：收到通知后清除本地缓存，下次请求时从 DB 刷新
 * pubsub.ts 订阅：静默降级
 */
async function ensureSubscription(): Promise<void> {
  if (subscriptionInitialized) return;

  // CI/build 阶段跳过
  if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
    subscriptionInitialized = true;
    return;
  }

  subscriptionInitialized = true;
  // pubsub.ts 订阅机制
  await subscribeCacheInvalidation(CHANNEL_PROVIDERS_UPDATED, () => {
    invalidateCache();
    logger.debug("[ProviderCache] Cache invalidated via pub/sub");
  });
}

/**
 * 失效缓存（本地）
 */
export function invalidateCache(): void {
  cache.data = null;
  cache.expiresAt = 0;
  cache.version++;
  cache.refreshPromise = null;
}

/**
 * 发布缓存失效通知（跨实例）
 *
 * CRUD 操作后调用，通知所有实例清除缓存。
 * 各实例在下次请求时自行从 DB 刷新，保证：
 * - 类型安全：Date 等类型从 DB 正确构造
 * - 数据安全：不通过 Redis 传输敏感数据（如 provider.key）
 */
export async function publishProviderCacheInvalidation(): Promise<void> {
  invalidateCache();
  await publishCacheInvalidation(CHANNEL_PROVIDERS_UPDATED);
  logger.debug("[ProviderCache] Published cache invalidation");
}

/**
 * 获取缓存的 Provider 列表（带自动刷新）
 *
 * @param fetcher - 数据库查询函数（依赖注入，便于测试）
 * @returns Provider 列表
 */
export async function getCachedProviders(fetcher: () => Promise<Provider[]>): Promise<Provider[]> {
  // 检查是否启用缓存（默认启用）
  if (!ENABLE_PROVIDER_CACHE) {
    logger.debug("[ProviderCache] Cache disabled, fetching from DB");
    return fetcher();
  }

  // 确保订阅已初始化（异步，不阻塞）
  void ensureSubscription();

  const now = Date.now();

  // 1. 缓存命中且未过期
  if (cache.data && cache.expiresAt > now) {
    return cache.data;
  }

  // 2. 已有刷新任务在进行中，等待它完成（防止并发刷新）
  if (cache.refreshPromise) {
    return cache.refreshPromise;
  }

  // 3. 需要刷新，创建新的刷新任务
  const currentVersion = cache.version;
  cache.refreshPromise = (async () => {
    try {
      const data = await fetcher();

      // 检查版本号，防止被更新的失效事件覆盖
      if (cache.version === currentVersion) {
        cache.data = data;
        cache.expiresAt = Date.now() + CACHE_TTL_MS;
        logger.debug("[ProviderCache] Cache refreshed from DB", {
          count: data.length,
          ttlMs: CACHE_TTL_MS,
        });
      }

      return data;
    } finally {
      // 清除 refreshPromise（允许下次刷新）
      if (cache.version === currentVersion) {
        cache.refreshPromise = null;
      }
    }
  })();

  return cache.refreshPromise;
}

/**
 * 预热缓存（启动时调用）
 */
export async function warmupProviderCache(fetcher: () => Promise<Provider[]>): Promise<void> {
  try {
    await getCachedProviders(fetcher);
    logger.info("[ProviderCache] Cache warmed up successfully");
  } catch (error) {
    logger.warn("[ProviderCache] Cache warmup failed", { error });
  }
}

/**
 * 获取缓存统计信息（用于监控/调试）
 */
export function getProviderCacheStats(): {
  hasData: boolean;
  count: number;
  expiresIn: number;
  version: number;
  isRefreshing: boolean;
} {
  const now = Date.now();
  return {
    hasData: cache.data !== null,
    count: cache.data?.length ?? 0,
    expiresIn: Math.max(0, cache.expiresAt - now),
    version: cache.version,
    isRefreshing: cache.refreshPromise !== null,
  };
}
