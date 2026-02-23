/**
 * Session data cache layer
 *
 * Uses TTLMap (TTL + LRU eviction) to reduce database query frequency
 * and bound memory usage.
 */

import { TTLMap } from "@/lib/cache/ttl-map";

class SessionCache<T> {
  private cache: TTLMap<string, T>;
  private readonly ttlSeconds: number;

  constructor(ttlSeconds: number = 2, maxSize: number = 1000) {
    this.ttlSeconds = ttlSeconds;
    this.cache = new TTLMap<string, T>({ ttlMs: ttlSeconds * 1000, maxSize });
  }

  get(key: string): T | null {
    return this.cache.get(key) ?? null;
  }

  set(key: string, data: T): void {
    this.cache.set(key, data);
  }

  delete(key: string): void {
    this.cache.delete(key);
  }

  clear(): void {
    this.cache.clear();
  }

  cleanup(): void {
    this.cache.purgeExpired();
  }

  getStats(): { size: number; ttl: number } {
    return {
      size: this.cache.size,
      ttl: this.ttlSeconds,
    };
  }
}

// Active Sessions list cache (2s TTL, max 100 entries)
const activeSessionsCache = new SessionCache<
  Array<{
    sessionId: string;
    requestCount: number;
    totalCostUsd: string;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCacheCreationTokens: number;
    totalCacheReadTokens: number;
    totalDurationMs: number;
    firstRequestAt: Date | null;
    lastRequestAt: Date | null;
    providers: Array<{ id: number; name: string }>;
    models: string[];
    userName: string;
    userId: number;
    keyName: string;
    keyId: number;
    userAgent: string | null;
    apiType: string | null;
    cacheTtlApplied: string | null;
  }>
>(2, 100);

// Session details cache (1s TTL, max 10000 entries)
const sessionDetailsCache = new SessionCache<{
  sessionId: string;
  requestCount: number;
  totalCostUsd: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheCreationTokens: number;
  totalCacheReadTokens: number;
  totalDurationMs: number;
  firstRequestAt: Date | null;
  lastRequestAt: Date | null;
  providers: Array<{ id: number; name: string }>;
  models: string[];
  userName: string;
  userId: number;
  keyName: string;
  keyId: number;
  userAgent: string | null;
  apiType: string | null;
  cacheTtlApplied: string | null;
}>(1, 10_000);

// Store interval ID on globalThis for HMR support
const cacheCleanupState = globalThis as unknown as {
  __CCH_CACHE_CLEANUP_INTERVAL_ID__?: ReturnType<typeof setInterval> | null;
};

export function getActiveSessionsCache(key: string = "active_sessions") {
  return activeSessionsCache.get(key);
}

export function setActiveSessionsCache(
  data: Parameters<typeof activeSessionsCache.set>[1],
  key: string = "active_sessions"
) {
  activeSessionsCache.set(key, data);
}

export function getSessionDetailsCache(sessionId: string) {
  return sessionDetailsCache.get(sessionId);
}

export function setSessionDetailsCache(
  sessionId: string,
  data: Parameters<typeof sessionDetailsCache.set>[1]
) {
  sessionDetailsCache.set(sessionId, data);
}

export function clearActiveSessionsCache() {
  activeSessionsCache.delete("active_sessions");
}

export function clearAllSessionsQueryCache() {
  activeSessionsCache.delete("all_sessions");
}

export function clearSessionDetailsCache(sessionId: string) {
  sessionDetailsCache.delete(sessionId);
}

export function clearAllCaches() {
  activeSessionsCache.clear();
  sessionDetailsCache.clear();
}

export function startCacheCleanup(intervalSeconds: number = 60) {
  if (cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__) {
    return;
  }

  cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    activeSessionsCache.cleanup();
    sessionDetailsCache.cleanup();
  }, intervalSeconds * 1000);
}

export function stopCacheCleanup() {
  if (!cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__) {
    return;
  }

  clearInterval(cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__);
  cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__ = null;
}

export function getCacheStats() {
  return {
    activeSessions: activeSessionsCache.getStats(),
    sessionDetails: sessionDetailsCache.getStats(),
  };
}
