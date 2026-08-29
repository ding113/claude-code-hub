import "server-only";

import { logger } from "@/lib/logger";
import {
  CHANNEL_PROVIDER_GROUPS_UPDATED,
  publishCacheInvalidation,
  subscribeCacheInvalidation,
} from "@/lib/redis/pubsub";

const CACHE_TTL_MS = 60_000;
const MAX_CACHE_ENTRIES = 10_000;
const SUBSCRIPTION_RETRY_MS = 60_000;

interface CacheEntry {
  value: number;
  expiresAt: number;
}

interface GroupMultiplierCacheState {
  entries: Map<string, CacheEntry>;
  version: number;
  subscriptionInitialized: boolean;
  subscriptionInitPromise: Promise<boolean> | null;
  subscriptionCleanup: (() => void) | null;
  subscriptionNextAttemptAt: number;
}

const runtimeState = globalThis as typeof globalThis & {
  __CCH_PROVIDER_GROUP_MULTIPLIER_CACHE__?: GroupMultiplierCacheState;
};

const state =
  runtimeState.__CCH_PROVIDER_GROUP_MULTIPLIER_CACHE__ ??
  (runtimeState.__CCH_PROVIDER_GROUP_MULTIPLIER_CACHE__ = {
    entries: new Map<string, CacheEntry>(),
    version: 0,
    subscriptionInitialized: false,
    subscriptionInitPromise: null,
    subscriptionCleanup: null,
    subscriptionNextAttemptAt: 0,
  });

export function invalidateGroupMultiplierCache(): void {
  state.entries.clear();
  state.version++;
}

export function readCachedGroupMultiplier(rawGroupString: string): number | undefined {
  const cached = state.entries.get(rawGroupString);
  if (!cached) return undefined;
  if (cached.expiresAt > Date.now()) return cached.value;

  state.entries.delete(rawGroupString);
  return undefined;
}

export function getGroupMultiplierCacheVersion(): number {
  return state.version;
}

export function writeCachedGroupMultiplier(
  rawGroupString: string,
  value: number,
  expectedVersion: number
): boolean {
  if (state.version !== expectedVersion) return false;

  if (!state.entries.has(rawGroupString) && state.entries.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = state.entries.keys().next().value;
    if (oldestKey !== undefined) state.entries.delete(oldestKey);
  }

  state.entries.set(rawGroupString, {
    value,
    expiresAt: Date.now() + CACHE_TTL_MS,
  });
  return true;
}

/**
 * 为当前进程建立倍率缓存失效订阅。Redis 暂时不可用时返回 false，热路径会在
 * 后续请求中重试，并继续以 60 秒 TTL 作为降级上界。
 */
export async function ensureGroupMultiplierCacheSubscription(): Promise<boolean> {
  if (state.subscriptionInitialized) return true;
  if (state.subscriptionInitPromise) return state.subscriptionInitPromise;
  if (Date.now() < (state.subscriptionNextAttemptAt ?? 0)) return false;

  state.subscriptionInitPromise = (async () => {
    try {
      const cleanup = await subscribeCacheInvalidation(CHANNEL_PROVIDER_GROUPS_UPDATED, () => {
        invalidateGroupMultiplierCache();
        logger.debug("[ProviderGroupMultiplierCache] Cache invalidated via pub/sub");
      });
      if (!cleanup) {
        state.subscriptionNextAttemptAt = Date.now() + SUBSCRIPTION_RETRY_MS;
        return false;
      }

      state.subscriptionCleanup = cleanup;
      state.subscriptionInitialized = true;
      state.subscriptionNextAttemptAt = 0;
      logger.info("[ProviderGroupMultiplierCache] Cross-process invalidation enabled");
      return true;
    } catch (error) {
      logger.warn("[ProviderGroupMultiplierCache] Failed to subscribe to invalidation", {
        error: error instanceof Error ? error.message : String(error),
      });
      state.subscriptionNextAttemptAt = Date.now() + SUBSCRIPTION_RETRY_MS;
      return false;
    }
  })().finally(() => {
    state.subscriptionInitPromise = null;
  });

  return state.subscriptionInitPromise;
}

/** 热路径使用的无 Promise 快速入口；仅首次初始化或退避到期时创建异步任务。 */
export function startGroupMultiplierCacheSubscription(): void {
  if (
    state.subscriptionInitialized ||
    state.subscriptionInitPromise ||
    Date.now() < (state.subscriptionNextAttemptAt ?? 0)
  ) {
    return;
  }
  void ensureGroupMultiplierCacheSubscription();
}

/** 数据库提交后调用：先同步清空本进程，再广播微小的失效通知。 */
export async function publishGroupMultiplierCacheInvalidation(): Promise<void> {
  invalidateGroupMultiplierCache();
  await publishCacheInvalidation(CHANNEL_PROVIDER_GROUPS_UPDATED);
}

/** 供进程关闭和隔离测试释放订阅；不会触碰 Redis 中的数据。 */
export function disposeGroupMultiplierCache(): void {
  state.subscriptionCleanup?.();
  state.subscriptionCleanup = null;
  state.subscriptionInitialized = false;
  state.subscriptionInitPromise = null;
  state.subscriptionNextAttemptAt = 0;
  invalidateGroupMultiplierCache();
}

export const GROUP_MULTIPLIER_CACHE_MAX_ENTRIES = MAX_CACHE_ENTRIES;
