import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis";
import { getKeyActiveSessionsKey, getUserActiveSessionsKey } from "@/lib/redis/active-session-keys";
import { scanPattern } from "@/lib/redis/scan-helper";

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
    scanPattern(redis, `user:${userId}:cost_*`).catch((err) => {
      logger.warn("Failed to scan user cost pattern", { userId, error: err });
      return [];
    }),
    // Total cost cache keys (with optional resetAt suffix)
    scanPattern(redis, `total_cost:user:${userId}`).catch(() => []),
    scanPattern(redis, `total_cost:user:${userId}:*`).catch(() => []),
    ...keyHashes.map((keyHash) => scanPattern(redis, `total_cost:key:${keyHash}`).catch(() => [])),
    ...keyHashes.map((keyHash) =>
      scanPattern(redis, `total_cost:key:${keyHash}:*`).catch(() => [])
    ),
    // Lease cache keys (budget slices cached by LeaseService)
    ...keyIds.map((keyId) => scanPattern(redis, `lease:key:${keyId}:*`).catch(() => [])),
    scanPattern(redis, `lease:user:${userId}:*`).catch(() => []),
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
  };
}
