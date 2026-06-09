import type Redis from "ioredis";
import { logger } from "@/lib/logger";
import { buildLeaseKey } from "@/lib/rate-limit/lease";
import { getRedisClient } from "@/lib/redis";
import { getKeyActiveSessionsKey, getUserActiveSessionsKey } from "@/lib/redis/active-session-keys";
import {
  buildCostDisplayCacheKey,
  buildCostDisplayCacheScanPattern,
} from "@/lib/redis/cost-display-cache";
import { scanPattern } from "@/lib/redis/scan-helper";

const LEGACY_ROLLING_ZSET_PATTERNS = ["*:cost_5h_rolling", "*:cost_daily_rolling"] as const;
const LEGACY_CLEANUP_UNLINK_BATCH = 500;

// bugfix #06: fleet-wide sentinel + SETNX lock so a multi-replica rollout
// triggers the legacy ZSET SCAN at most once across the cluster.
const LEGACY_CLEANUP_SENTINEL_KEY = "cleanup:legacy_rolling:v1";
const LEGACY_CLEANUP_LOCK_KEY = `${LEGACY_CLEANUP_SENTINEL_KEY}:lock`;
const LEGACY_CLEANUP_LOCK_TTL_SECONDS = 600;

/**
 * 一次性清理 rolling cost ZSET 历史遗留 key（5h / daily）。
 * 上线后由 Redis 初始化流程异步调用一次；之后随 TTL 6h / 25h 自然过期。
 * UNLINK（异步）替代 DEL，避免大 ZSET 同步释放阻塞 Redis 主线程。
 * 完全幂等：函数本身无状态，重复调用不会有副作用。
 */
export async function cleanupLegacyRollingZsets(redis: Redis): Promise<{
  scanned: number;
  deleted: number;
  durationMs: number;
}> {
  const startedAt = Date.now();
  let scanned = 0;
  let deleted = 0;

  for (const pattern of LEGACY_ROLLING_ZSET_PATTERNS) {
    try {
      const keys = await scanPattern(redis, pattern, 500);
      scanned += keys.length;
      for (let i = 0; i < keys.length; i += LEGACY_CLEANUP_UNLINK_BATCH) {
        const chunk = keys.slice(i, i + LEGACY_CLEANUP_UNLINK_BATCH);
        if (chunk.length === 0) continue;
        await redis.unlink(...chunk);
        deleted += chunk.length;
      }
    } catch (error) {
      logger.warn("[CostCacheCleanup] Failed to clean legacy rolling pattern", {
        pattern,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return { scanned, deleted, durationMs: Date.now() - startedAt };
}

export interface CleanupLegacyRollingZsetsOnceResult {
  scanned: number;
  deleted: number;
  durationMs: number;
  skipped?: "already-done" | "lock-held";
}

/**
 * bugfix #06: fleet-wide single-run wrapper around `cleanupLegacyRollingZsets`.
 *
 * The underlying SCAN is `*:cost_5h_rolling` / `*:cost_daily_rolling` — both
 * patterns start with `*`, forcing Redis to walk the entire keyspace. Without
 * coordination, every rolling restart of every replica re-walks the keyspace
 * even after the legacy ZSETs have long been deleted.
 *
 * This wrapper consults a persistent sentinel in Redis (`cleanup:legacy_rolling:v1`)
 * and a short-lived SETNX lock so only one process in the fleet actually runs
 * the SCAN; everyone else exits in O(1).
 */
export async function cleanupLegacyRollingZsetsOnce(
  redis: Redis
): Promise<CleanupLegacyRollingZsetsOnceResult> {
  const startedAt = Date.now();

  // 1. Already done across the fleet?
  const sentinel = await redis.get(LEGACY_CLEANUP_SENTINEL_KEY);
  if (sentinel === "done") {
    logger.debug("[CostCacheCleanup] legacy rolling ZSETs already cleaned fleet-wide, skip");
    return { scanned: 0, deleted: 0, durationMs: Date.now() - startedAt, skipped: "already-done" };
  }

  // 2. Try to acquire the exclusive lock. Use the documented SET key value EX <ttl> NX form.
  const acquired = await redis.set(
    LEGACY_CLEANUP_LOCK_KEY,
    String(process.pid),
    "EX",
    LEGACY_CLEANUP_LOCK_TTL_SECONDS,
    "NX"
  );
  if (acquired !== "OK") {
    logger.info("[CostCacheCleanup] another replica is running cleanup, skip");
    return { scanned: 0, deleted: 0, durationMs: Date.now() - startedAt, skipped: "lock-held" };
  }

  try {
    const result = await cleanupLegacyRollingZsets(redis);
    // 3. Plant the permanent sentinel so future fleet rollouts short-circuit at step 1.
    await redis.set(LEGACY_CLEANUP_SENTINEL_KEY, "done");
    return { ...result, durationMs: Date.now() - startedAt };
  } finally {
    await redis.del(LEGACY_CLEANUP_LOCK_KEY);
  }
}

export interface ClearUserCostCacheOptions {
  userId: number;
  keyIds: number[];
  keyHashes: string[];
  includeActiveSessions?: boolean;
}

export interface ClearUserCostCacheResult {
  costKeysDeleted: number;
  activeSessionsDeleted: number;
  durationMs: number;
  cleanupFailed?: boolean;
  errorCount?: number;
}

export interface ClearSingleKeyCostCacheOptions {
  keyId: number;
  keyHash: string;
}

export interface ClearSingleProviderCostCacheOptions {
  providerId: number;
}

export interface ClearUser5hCostCacheOptions {
  userId: number;
  resetMode: "fixed" | "rolling";
}

export interface ClearUser5hCostCacheResult {
  costKeysDeleted: number;
  leaseKeysDeleted: number;
  durationMs: number;
  cleanupFailed?: boolean;
  errorCount?: number;
}

/**
 * Scan and delete all Redis cost-cache keys for a user and their API keys.
 *
 * Covers: cost counters, total cost cache, lease budget slices,
 * and optionally active session ZSETs.
 *
 * Returns null if Redis is not ready. Never throws -- logs errors internally.
 */
export async function clearUserCostCache(
  options: ClearUserCostCacheOptions
): Promise<ClearUserCostCacheResult | null> {
  const { userId, keyIds, keyHashes, includeActiveSessions = false } = options;

  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") {
    return null;
  }

  const startTime = Date.now();

  // Scan all cost patterns in parallel
  const scanResults = await Promise.all([
    ...keyIds.map((keyId) =>
      scanPattern(redis, `key:${keyId}:cost_*`).catch((err) => {
        logger.warn("Failed to scan key cost pattern", { keyId, error: err });
        return [];
      })
    ),
    ...keyIds.map((keyId) =>
      scanPattern(redis, buildCostDisplayCacheScanPattern("key", keyId)).catch((err) => {
        logger.warn("Failed to scan key display cache pattern", { keyId, error: err });
        return [];
      })
    ),
    scanPattern(redis, `user:${userId}:cost_*`).catch((err) => {
      logger.warn("Failed to scan user cost pattern", { userId, error: err });
      return [];
    }),
    scanPattern(redis, buildCostDisplayCacheScanPattern("user", userId)).catch((err) => {
      logger.warn("Failed to scan user display cache pattern", { userId, error: err });
      return [];
    }),
    // Total cost cache keys (with optional resetAt suffix)
    scanPattern(redis, `total_cost:user:${userId}`).catch((err) => {
      logger.warn("Failed to scan total cost pattern", {
        userId,
        pattern: `total_cost:user:${userId}`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    scanPattern(redis, `total_cost:user:${userId}:*`).catch((err) => {
      logger.warn("Failed to scan total cost pattern", {
        userId,
        pattern: `total_cost:user:${userId}:*`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    ...keyHashes.map((keyHash) =>
      scanPattern(redis, `total_cost:key:${keyHash}`).catch((err) => {
        logger.warn("Failed to scan total cost key pattern", {
          keyHash,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      })
    ),
    ...keyHashes.map((keyHash) =>
      scanPattern(redis, `total_cost:key:${keyHash}:*`).catch((err) => {
        logger.warn("Failed to scan total cost key pattern", {
          keyHash,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      })
    ),
    // Lease cache keys (budget slices cached by LeaseService)
    ...keyIds.map((keyId) =>
      scanPattern(redis, `lease:key:${keyId}:*`).catch((err) => {
        logger.warn("Failed to scan lease key pattern", {
          keyId,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      })
    ),
    scanPattern(redis, `lease:user:${userId}:*`).catch((err) => {
      logger.warn("Failed to scan lease user pattern", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);

  const allCostKeys = scanResults.flat();
  let activeSessionsDeleted = 0;

  // Only create pipeline if there is work to do
  if (allCostKeys.length === 0 && !includeActiveSessions) {
    return {
      costKeysDeleted: 0,
      activeSessionsDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const pipeline = redis.pipeline();

  // Active sessions (only for full statistics reset)
  if (includeActiveSessions) {
    for (const keyId of keyIds) {
      pipeline.del(getKeyActiveSessionsKey(keyId));
    }
    pipeline.del(getUserActiveSessionsKey(userId));
    activeSessionsDeleted = keyIds.length + 1;
  }

  // Cost keys
  for (const key of allCostKeys) {
    pipeline.del(key);
  }

  let results: Array<[Error | null, unknown]> | null = null;
  try {
    results = await pipeline.exec();
  } catch (error) {
    logger.warn("Redis pipeline.exec() failed during cost cache cleanup", { userId, error });
    return {
      costKeysDeleted: allCostKeys.length,
      activeSessionsDeleted,
      durationMs: Date.now() - startTime,
      cleanupFailed: true,
    };
  }

  // Check for pipeline errors
  const errors = results?.filter(([err]) => err);
  if (errors && errors.length > 0) {
    logger.warn("Some Redis deletes failed during cost cache cleanup", {
      errorCount: errors.length,
      userId,
    });
  }

  return {
    costKeysDeleted: allCostKeys.length,
    activeSessionsDeleted,
    durationMs: Date.now() - startTime,
    cleanupFailed: !!errors && errors.length > 0,
    errorCount: errors?.length || 0,
  };
}

export async function clearUser5hCostCache(
  options: ClearUser5hCostCacheOptions
): Promise<ClearUser5hCostCacheResult | null> {
  const { userId, resetMode } = options;

  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  const costKey = `user:${userId}:cost_5h_${resetMode}`;
  const leaseKey = buildLeaseKey("user", userId, "5h", resetMode);
  const displayCacheKey = buildCostDisplayCacheKey("user", userId, "5h");
  const pipeline = redis.pipeline();

  pipeline.del(costKey);
  pipeline.del(leaseKey);
  if (resetMode === "rolling") {
    pipeline.del(displayCacheKey);
  }

  try {
    const results = await pipeline.exec();
    const errors = results?.filter(([error]) => error);
    if (errors && errors.length > 0) {
      logger.warn("Some Redis deletes failed during user 5h cache cleanup", {
        userId,
        resetMode,
        errorCount: errors.length,
      });
      return {
        costKeysDeleted: 1,
        leaseKeysDeleted: 1,
        durationMs: Date.now() - startTime,
        cleanupFailed: true,
        errorCount: errors.length,
      };
    }
  } catch (error) {
    logger.warn("Redis pipeline.exec() failed during user 5h cache cleanup", {
      userId,
      resetMode,
      error,
    });
    return {
      costKeysDeleted: 1,
      leaseKeysDeleted: 1,
      durationMs: Date.now() - startTime,
      cleanupFailed: true,
      errorCount: 1,
    };
  }

  return {
    costKeysDeleted: 1,
    leaseKeysDeleted: 1,
    durationMs: Date.now() - startTime,
  };
}

export async function clearSingleKeyCostCache(
  options: ClearSingleKeyCostCacheOptions
): Promise<ClearUserCostCacheResult | null> {
  const { keyId, keyHash } = options;

  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  const scanResults = await Promise.all([
    scanPattern(redis, `key:${keyId}:cost_*`).catch((err) => {
      logger.warn("Failed to scan key cost pattern", { keyId, error: err });
      return [];
    }),
    scanPattern(redis, buildCostDisplayCacheScanPattern("key", keyId)).catch((err) => {
      logger.warn("Failed to scan key display cache pattern", { keyId, error: err });
      return [];
    }),
    scanPattern(redis, `total_cost:key:${keyHash}`).catch((err) => {
      logger.warn("Failed to scan total cost key pattern", {
        keyHash,
        pattern: `total_cost:key:${keyHash}`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    scanPattern(redis, `total_cost:key:${keyHash}:*`).catch((err) => {
      logger.warn("Failed to scan total cost key pattern", {
        keyHash,
        pattern: `total_cost:key:${keyHash}:*`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    scanPattern(redis, `lease:key:${keyId}:*`).catch((err) => {
      logger.warn("Failed to scan lease key pattern", {
        keyId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);

  const allCostKeys = scanResults.flat();
  if (allCostKeys.length === 0) {
    return {
      costKeysDeleted: 0,
      activeSessionsDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const pipeline = redis.pipeline();
  for (const key of allCostKeys) {
    pipeline.del(key);
  }

  let results: Array<[Error | null, unknown]> | null = null;
  try {
    results = await pipeline.exec();
  } catch (error) {
    logger.warn("Redis pipeline.exec() failed during single key cost cache cleanup", {
      keyId,
      error,
    });
    return {
      costKeysDeleted: 0,
      activeSessionsDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const errors = results?.filter(([err]) => err);
  if (errors && errors.length > 0) {
    logger.warn("Some Redis deletes failed during single key cost cache cleanup", {
      errorCount: errors.length,
      keyId,
    });
  }

  return {
    costKeysDeleted: allCostKeys.length,
    activeSessionsDeleted: 0,
    durationMs: Date.now() - startTime,
  };
}

export async function clearSingleProviderCostCache(
  options: ClearSingleProviderCostCacheOptions
): Promise<ClearUserCostCacheResult | null> {
  const { providerId } = options;

  const redis = getRedisClient();
  if (!redis || redis.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  const scanResults = await Promise.all([
    scanPattern(redis, `provider:${providerId}:cost_*`).catch((err) => {
      logger.warn("Failed to scan provider cost pattern", { providerId, error: err });
      return [];
    }),
    scanPattern(redis, buildCostDisplayCacheScanPattern("provider", providerId)).catch((err) => {
      logger.warn("Failed to scan provider display cache pattern", { providerId, error: err });
      return [];
    }),
    scanPattern(redis, `total_cost:provider:${providerId}`).catch((err) => {
      logger.warn("Failed to scan total cost provider pattern", {
        providerId,
        pattern: `total_cost:provider:${providerId}`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    scanPattern(redis, `total_cost:provider:${providerId}:*`).catch((err) => {
      logger.warn("Failed to scan total cost provider pattern", {
        providerId,
        pattern: `total_cost:provider:${providerId}:*`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    scanPattern(redis, `lease:provider:${providerId}:*`).catch((err) => {
      logger.warn("Failed to scan provider lease pattern", {
        providerId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);

  const allCostKeys = scanResults.flat();
  if (allCostKeys.length === 0) {
    return {
      costKeysDeleted: 0,
      activeSessionsDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const pipeline = redis.pipeline();
  for (const key of allCostKeys) {
    pipeline.del(key);
  }

  let results: Array<[Error | null, unknown]> | null = null;
  try {
    results = await pipeline.exec();
  } catch (error) {
    logger.warn("Redis pipeline.exec() failed during provider cost cache cleanup", {
      providerId,
      error,
    });
    return {
      costKeysDeleted: 0,
      activeSessionsDeleted: 0,
      durationMs: Date.now() - startTime,
    };
  }

  const errors = results?.filter(([err]) => err);
  if (errors && errors.length > 0) {
    logger.warn("Some Redis deletes failed during provider cost cache cleanup", {
      errorCount: errors.length,
      providerId,
    });
  }

  return {
    costKeysDeleted: allCostKeys.length,
    activeSessionsDeleted: 0,
    durationMs: Date.now() - startTime,
  };
}
