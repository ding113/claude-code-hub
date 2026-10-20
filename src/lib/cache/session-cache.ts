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
    sessionIdentityKind: "session_id" | "prefix_affinity";
    sessionFingerprint: string | null;
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
  requestedSessionIds?: string[];
  sessionIdentityKind: "session_id" | "prefix_affinity";
  sessionFingerprint: string | null;
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
const sessionDetailsAliasesCache = new SessionCache<Set<string>>(1, 10_000);
const sessionDetailsOwnersCache = new SessionCache<Set<string>>(1, 10_000);

function sessionDetailsCacheKey(sessionId: string, userId: number): string {
  return `${userId}:${sessionId}`;
}

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

export function getSessionDetailsCache(sessionId: string, userId: number) {
  return sessionDetailsCache.get(sessionDetailsCacheKey(sessionId, userId));
}

export function setSessionDetailsCache(
  sessionId: string,
  data: Parameters<typeof sessionDetailsCache.set>[1]
) {
  const canonicalKey = sessionDetailsCacheKey(data.sessionId, data.userId);
  const cacheKey = sessionDetailsCacheKey(sessionId, data.userId);
  sessionDetailsCache.set(cacheKey, data);

  const aliases = sessionDetailsAliasesCache.get(canonicalKey) ?? new Set<string>();
  aliases.add(canonicalKey);
  aliases.add(cacheKey);
  sessionDetailsAliasesCache.set(canonicalKey, aliases);

  for (const identity of [data.sessionId, sessionId]) {
    const owners = sessionDetailsOwnersCache.get(identity) ?? new Set<string>();
    owners.add(canonicalKey);
    sessionDetailsOwnersCache.set(identity, owners);
  }
}

export function clearActiveSessionsCache() {
  activeSessionsCache.delete("active_sessions");
}

/**
 * 清空所有 Sessions 的缓存（包括活跃和非活跃）
 */
export function clearAllSessionsQueryCache() {
  activeSessionsCache.delete("all_sessions");
}

export function clearSessionDetailsCache(sessionId: string) {
  const canonicalKeys = sessionDetailsOwnersCache.get(sessionId) ?? new Set<string>();
  for (const canonicalKey of canonicalKeys) {
    const aliases = sessionDetailsAliasesCache.get(canonicalKey) ?? new Set([canonicalKey]);
    for (const alias of aliases) {
      sessionDetailsCache.delete(alias);
      const separatorIndex = alias.indexOf(":");
      if (separatorIndex >= 0) {
        const identity = alias.slice(separatorIndex + 1);
        const owners = sessionDetailsOwnersCache.get(identity);
        if (owners) {
          owners.delete(canonicalKey);
          if (owners.size === 0) {
            sessionDetailsOwnersCache.delete(identity);
          } else {
            sessionDetailsOwnersCache.set(identity, owners);
          }
        }
      }
    }
    sessionDetailsAliasesCache.delete(canonicalKey);
  }
}

/**
 * 清空所有 Session 缓存
 */
export function clearAllCaches() {
  activeSessionsCache.clear();
  sessionDetailsCache.clear();
  sessionDetailsAliasesCache.clear();
  sessionDetailsOwnersCache.clear();
}

export function startCacheCleanup(intervalSeconds: number = 60) {
  if (cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__) {
    return;
  }

  cacheCleanupState.__CCH_CACHE_CLEANUP_INTERVAL_ID__ = setInterval(() => {
    activeSessionsCache.cleanup();
    sessionDetailsCache.cleanup();
    sessionDetailsAliasesCache.cleanup();
    sessionDetailsOwnersCache.cleanup();
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
