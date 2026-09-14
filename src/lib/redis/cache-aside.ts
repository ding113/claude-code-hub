import type Redis from "ioredis";
import { logger } from "@/lib/logger";

/**
 * Redis cache-aside with a computation lock (thundering herd protection).
 *
 * 1. Cache hit: return the parsed value
 * 2. Miss: take `SET lockKey NX EX lockTtlSeconds`
 *    - acquired: compute, write the cache (best effort), release the lock
 *    - not acquired: poll the cache every pollIntervalMs until waitTimeoutMs elapses, then compute
 *      directly
 * 3. Redis unavailable or failing: compute directly (fail-open)
 */
export interface CacheAsideOptions<T> {
  /** Log prefix, e.g. "OverviewCache". */
  name: string;
  cacheKey: string;
  ttlSeconds: number;
  lockTtlSeconds: number;
  waitTimeoutMs: number;
  pollIntervalMs: number;
  compute: () => Promise<T>;
  /** Extra fields for log lines. */
  logContext?: Record<string, unknown>;
}

type CacheAsideRedis = Pick<Redis, "get" | "set" | "setex" | "del">;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function getOrComputeWithRedisLock<T>(
  redis: CacheAsideRedis | null | undefined,
  options: CacheAsideOptions<T>
): Promise<T> {
  const { name, cacheKey, compute } = options;
  if (!redis) {
    return compute();
  }

  const lockKey = `${cacheKey}:lock`;
  let lockAcquired = false;
  let computed: { value: T } | undefined;

  try {
    const cached = await redis.get(cacheKey);
    if (cached) {
      logger.debug(`[${name}] Cache hit`, { cacheKey, ...options.logContext });
      return JSON.parse(cached) as T;
    }

    lockAcquired = (await redis.set(lockKey, "1", "EX", options.lockTtlSeconds, "NX")) === "OK";

    if (lockAcquired) {
      computed = { value: await compute() };
      try {
        await redis.setex(cacheKey, options.ttlSeconds, JSON.stringify(computed.value));
      } catch (writeError) {
        logger.warn(`[${name}] Failed to write cache`, { cacheKey, error: writeError });
      }
      return computed.value;
    }

    const attempts = Math.max(1, Math.floor(options.waitTimeoutMs / options.pollIntervalMs));
    for (let attempt = 0; attempt < attempts; attempt++) {
      await sleep(options.pollIntervalMs);
      const retried = await redis.get(cacheKey);
      if (retried) {
        logger.debug(`[${name}] Cache hit after retry`, {
          cacheKey,
          retries: attempt + 1,
          ...options.logContext,
        });
        return JSON.parse(retried) as T;
      }
    }

    logger.warn(`[${name}] Retry timeout, fallback to direct query`, {
      cacheKey,
      ...options.logContext,
    });
    return await compute();
  } catch (error) {
    logger.warn(`[${name}] Redis error, fallback to direct query`, {
      cacheKey,
      error,
      ...options.logContext,
    });
    return computed ? computed.value : await compute();
  } finally {
    if (lockAcquired) {
      await Promise.resolve()
        .then(() => redis.del(lockKey))
        .catch((error: unknown) => {
          logger.warn(`[${name}] Failed to release lock`, { lockKey, error });
        });
    }
  }
}
