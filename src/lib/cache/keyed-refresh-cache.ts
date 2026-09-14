import "server-only";

import { logger } from "@/lib/logger";
import { subscribeCacheInvalidation } from "@/lib/redis/pubsub";
import { TTLMap } from "./ttl-map";

/**
 * Process-level keyed read-through cache for hot-path reference data.
 *
 * Properties:
 * - TTL + LRU bounded storage (TTLMap)
 * - Per-key single-flight: concurrent misses for the same key share one fetch
 * - Version fence: a fetch that started before an invalidation never repopulates the cache
 * - Cross-process invalidation through Redis pub/sub channels (any message, including the
 *   synthetic RESYNC message, clears the whole cache); TTL is the convergence bound when
 *   Redis is unavailable
 * - Fetch errors are propagated to the caller and never cached
 */
export interface KeyedRefreshCacheOptions {
  /** Log prefix, e.g. "ProviderEndpointCache". */
  name: string;
  ttlMs: number;
  maxSize: number;
  /** Pub/sub channels whose messages invalidate the whole cache. */
  invalidationChannels: readonly string[];
  /** Evaluated per call; when false every call goes straight to the fetcher. */
  isEnabled: () => boolean;
}

export interface KeyedRefreshCacheStats {
  size: number;
  inFlight: number;
  version: number;
  subscribed: boolean;
}

export interface KeyedRefreshCache<V> {
  get(key: string, fetcher: () => Promise<V>): Promise<V>;
  invalidate(): void;
  getStats(): KeyedRefreshCacheStats;
  /** Test helper: clears data and subscription state. */
  resetForTests(): void;
}

export function createKeyedRefreshCache<V>(
  options: KeyedRefreshCacheOptions
): KeyedRefreshCache<V> {
  const store = new TTLMap<string, V>({ ttlMs: options.ttlMs, maxSize: options.maxSize });
  const inFlight = new Map<string, Promise<V>>();
  let version = 0;
  let subscribed = false;
  let subscriptionPromise: Promise<void> | null = null;

  const invalidate = (): void => {
    store.clear();
    inFlight.clear();
    version++;
  };

  const ensureSubscription = (): void => {
    if (subscribed || subscriptionPromise) return;
    if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") {
      subscribed = true;
      return;
    }

    subscriptionPromise = (async () => {
      try {
        const results = await Promise.all(
          options.invalidationChannels.map((channel) =>
            subscribeCacheInvalidation(channel, () => {
              invalidate();
              logger.debug(`[${options.name}] Cache invalidated via pub/sub`, { channel });
            })
          )
        );
        // null means Redis is not configured: rely on TTL and do not retry on every call.
        subscribed = true;
        if (results.some((cleanup) => cleanup === null)) {
          logger.debug(`[${options.name}] Redis pub/sub unavailable, relying on TTL`);
        }
      } catch (error) {
        logger.warn(`[${options.name}] Failed to subscribe to cache invalidation`, {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    })().finally(() => {
      subscriptionPromise = null;
    });
  };

  const get = async (key: string, fetcher: () => Promise<V>): Promise<V> => {
    if (!options.isEnabled()) {
      return fetcher();
    }

    ensureSubscription();

    if (store.has(key)) {
      return store.get(key) as V;
    }

    const pending = inFlight.get(key);
    if (pending) {
      return pending;
    }

    const startedVersion = version;
    // Defer the fetcher by one microtask so the promise is registered in inFlight before any
    // (even synchronous) failure can settle it and trigger the cleanup below.
    const promise = Promise.resolve()
      .then(fetcher)
      .then((value) => {
        if (version === startedVersion) {
          store.set(key, value);
        }
        return value;
      })
      .finally(() => {
        if (inFlight.get(key) === promise) {
          inFlight.delete(key);
        }
      });
    inFlight.set(key, promise);
    return promise;
  };

  return {
    get,
    invalidate,
    getStats: () => ({
      size: store.size,
      inFlight: inFlight.size,
      version,
      subscribed,
    }),
    resetForTests: () => {
      invalidate();
      subscribed = false;
      subscriptionPromise = null;
    },
  };
}
