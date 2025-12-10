/**
 * Session 数据缓存层
 *
 * 使用内存缓存减少数据库查询频率，适用于高频读取场景
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class SessionCache<T> {
  private cache = new Map<string, CacheEntry<T>>();
  private ttl: number; // TTL in milliseconds

  constructor(ttlSeconds: number = 2) {
    this.ttl = ttlSeconds * 1000;
  }

  /**
   * 获取缓存数据
   */
  get(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) {
      return null;
    }

    const now = Date.now();
    const age = now - entry.timestamp;

    // 检查是否过期
    if (age > this.ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * 设置缓存数据
   */
  set(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * 删除缓存数据
   */
  delete(key: string): void {
    this.cache.delete(key);
  }

  /**
   * 清空所有缓存
   */
  clear(): void {
    this.cache.clear();
  }

  /**
   * 清理过期的缓存条目
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.cache.entries()) {
      const age = now - entry.timestamp;
      if (age > this.ttl) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * 获取缓存统计信息
   */
  getStats(): { size: number; ttl: number } {
    return {
      size: this.cache.size,
      ttl: this.ttl / 1000,
    };
  }
}

// 活跃 Session 列表缓存（2 秒 TTL）
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
>(2);

// Session 详情缓存（1 秒 TTL，更短因为单个 session 的数据变化更频繁）
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
}>(1);

/**
 * 获取活跃 Sessions 的缓存
 */
export function getActiveSessionsCache(key: string = "active_sessions") {
  return activeSessionsCache.get(key);
}

/**
 * 设置活跃 Sessions 的缓存
 */
export function setActiveSessionsCache(
  data: Parameters<typeof activeSessionsCache.set>[1],
  key: string = "active_sessions"
) {
  activeSessionsCache.set(key, data);
}

/**
 * 获取 Session 详情的缓存
 */
export function getSessionDetailsCache(sessionId: string) {
  return sessionDetailsCache.get(sessionId);
}

/**
 * 设置 Session 详情的缓存
 */
export function setSessionDetailsCache(
  sessionId: string,
  data: Parameters<typeof sessionDetailsCache.set>[1]
) {
  sessionDetailsCache.set(sessionId, data);
}

/**
 * 清空活跃 Sessions 的缓存
 */
export function clearActiveSessionsCache() {
  activeSessionsCache.delete("active_sessions");
}

/**
 * 清空所有 Sessions 的缓存（包括活跃和非活跃）
 */
export function clearAllSessionsCache() {
  activeSessionsCache.delete("all_sessions");
}

/**
 * 清空指定 Session 详情的缓存
 */
export function clearSessionDetailsCache(sessionId: string) {
  sessionDetailsCache.delete(sessionId);
}

/**
 * 清空所有 Session 缓存
 */
export function clearAllSessionCache() {
  activeSessionsCache.clear();
  sessionDetailsCache.clear();
}

/**
 * 定期清理过期缓存（可选，用于内存优化）
 */
export function startCacheCleanup(intervalSeconds: number = 60) {
  setInterval(() => {
    activeSessionsCache.cleanup();
    sessionDetailsCache.cleanup();
  }, intervalSeconds * 1000);
}

/**
 * 获取缓存统计信息
 */
export function getCacheStats() {
  return {
    activeSessions: activeSessionsCache.getStats(),
    sessionDetails: sessionDetailsCache.getStats(),
  };
}
