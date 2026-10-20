import { logger } from "@/lib/logger";
import { buildLeaseKey } from "@/lib/rate-limit/lease";
import { getRedisClient } from "@/lib/redis";
import { getKeyActiveSessionsKey, getUserActiveSessionsKey } from "@/lib/redis/active-session-keys";
import { scanPattern } from "@/lib/redis/scan-helper";

export interface ClearUserCostCacheOptions {
  userId: number;
  keyIds: number[];
  keyHashes: string[];
  includeActiveSessions?: boolean;
  allowWhenRateLimitDisabled?: boolean;
  preserveFixed5hCostKeys?: boolean;
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

const STATISTICS_RESET_PREPARE_TTL_SECONDS = 7 * 24 * 60 * 60;
const PREPARE_FIXED_5H_RESET_LUA = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return redis.call('GET', KEYS[1])
end
local now = redis.call('TIME')
local cutoff_ms = (tonumber(now[1]) * 1000) + math.floor(tonumber(now[2]) / 1000)
for index = 2, #KEYS do
  redis.call('DEL', KEYS[index])
end
redis.call('SETEX', KEYS[1], ARGV[1], tostring(cutoff_ms))
return tostring(cutoff_ms)`;

export async function prepareUserStatisticsResetFixed5h(input: {
  resetId: string;
  userId: number;
  keyIds: number[];
}): Promise<string | null> {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (redis?.status !== "ready") return null;

  const keys = [
    `cch:user-statistics-reset:fixed5h:${input.resetId}`,
    `user:${input.userId}:cost_5h_fixed`,
    buildLeaseKey("user", input.userId, "5h", "fixed"),
    ...input.keyIds.flatMap((keyId) => [
      `key:${keyId}:cost_5h_fixed`,
      buildLeaseKey("key", keyId, "5h", "fixed"),
    ]),
  ];

  const cutoffMilliseconds = await redis.eval(
    PREPARE_FIXED_5H_RESET_LUA,
    keys.length,
    ...keys,
    STATISTICS_RESET_PREPARE_TTL_SECONDS
  );
  if (
    (typeof cutoffMilliseconds !== "number" && typeof cutoffMilliseconds !== "string") ||
    cutoffMilliseconds === ""
  ) {
    return null;
  }
  const cutoffValue = Number(cutoffMilliseconds);
  if (!Number.isFinite(cutoffValue) || cutoffValue <= 0) return null;
  const cutoff = new Date(cutoffValue);
  return Number.isFinite(cutoff.getTime()) ? cutoff.toISOString() : null;
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
  const {
    userId,
    keyIds,
    keyHashes,
    includeActiveSessions = false,
    allowWhenRateLimitDisabled = false,
    preserveFixed5hCostKeys = false,
  } = options;

  const redis = getRedisClient({ allowWhenRateLimitDisabled });
  if (redis?.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  let scanErrorCount = 0;

  // Scan all cost patterns in parallel
  const scanResults = await Promise.all([
    ...keyIds.map((keyId) =>
      scanPattern(redis, `key:${keyId}:cost_*`).catch((err) => {
        scanErrorCount += 1;
        logger.warn("Failed to scan key cost pattern", { keyId, error: err });
        return [];
      })
    ),
    scanPattern(redis, `user:${userId}:cost_*`).catch((err) => {
      scanErrorCount += 1;
      logger.warn("Failed to scan user cost pattern", { userId, error: err });
      return [];
    }),
    // Total cost cache keys (with optional resetAt suffix)
    scanPattern(redis, `total_cost:user:${userId}`).catch((err) => {
      scanErrorCount += 1;
      logger.warn("Failed to scan total cost pattern", {
        userId,
        pattern: `total_cost:user:${userId}`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    scanPattern(redis, `total_cost:user:${userId}:*`).catch((err) => {
      scanErrorCount += 1;
      logger.warn("Failed to scan total cost pattern", {
        userId,
        pattern: `total_cost:user:${userId}:*`,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
    ...keyHashes.map((keyHash) =>
      scanPattern(redis, `total_cost:key:${keyHash}`).catch((err) => {
        scanErrorCount += 1;
        logger.warn("Failed to scan total cost key pattern", {
          keyHash,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      })
    ),
    ...keyHashes.map((keyHash) =>
      scanPattern(redis, `total_cost:key:${keyHash}:*`).catch((err) => {
        scanErrorCount += 1;
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
        scanErrorCount += 1;
        logger.warn("Failed to scan lease key pattern", {
          keyId,
          error: err instanceof Error ? err.message : String(err),
        });
        return [];
      })
    ),
    scanPattern(redis, `lease:user:${userId}:*`).catch((err) => {
      scanErrorCount += 1;
      logger.warn("Failed to scan lease user pattern", {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }),
  ]);

  const allCostKeys = scanResults
    .flat()
    .filter((key) => !preserveFixed5hCostKeys || !key.endsWith(":cost_5h_fixed"));
  let activeSessionsDeleted = 0;

  // Only create pipeline if there is work to do
  if (allCostKeys.length === 0 && !includeActiveSessions) {
    return {
      costKeysDeleted: 0,
      activeSessionsDeleted: 0,
      durationMs: Date.now() - startTime,
      cleanupFailed: scanErrorCount > 0,
      errorCount: scanErrorCount,
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
      errorCount: scanErrorCount + 1,
    };
  }

  // Check for pipeline errors
  const errors = results?.filter(([err]) => err);
  const errorCount = scanErrorCount + (errors?.length ?? 0);
  if (errorCount > 0) {
    logger.warn("Some Redis deletes failed during cost cache cleanup", {
      errorCount,
      userId,
    });
  }

  return {
    costKeysDeleted: allCostKeys.length,
    activeSessionsDeleted,
    durationMs: Date.now() - startTime,
    cleanupFailed: errorCount > 0,
    errorCount,
  };
}

export async function clearUser5hCostCache(
  options: ClearUser5hCostCacheOptions
): Promise<ClearUser5hCostCacheResult | null> {
  const { userId, resetMode } = options;

  const redis = getRedisClient();
  if (redis?.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  const costKey = `user:${userId}:cost_5h_${resetMode}`;
  const leaseKey = buildLeaseKey("user", userId, "5h", resetMode);
  const pipeline = redis.pipeline();

  pipeline.del(costKey);
  pipeline.del(leaseKey);

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
  if (redis?.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  const scanResults = await Promise.all([
    scanPattern(redis, `key:${keyId}:cost_*`).catch((err) => {
      logger.warn("Failed to scan key cost pattern", { keyId, error: err });
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
  if (redis?.status !== "ready") {
    return null;
  }

  const startTime = Date.now();
  const scanResults = await Promise.all([
    scanPattern(redis, `provider:${providerId}:cost_*`).catch((err) => {
      logger.warn("Failed to scan provider cost pattern", { providerId, error: err });
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
