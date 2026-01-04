import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const CLEANUP_INTERVAL_GLOBAL_KEY = "__CCH_CACHE_CLEANUP_INTERVAL_ID__";

async function loadSessionCache() {
  const mod = await import("@/lib/cache/session-cache");
  return {
    getActiveSessionsCache: mod.getActiveSessionsCache,
    setActiveSessionsCache: mod.setActiveSessionsCache,
    getSessionDetailsCache: mod.getSessionDetailsCache,
    setSessionDetailsCache: mod.setSessionDetailsCache,
    clearActiveSessionsCache: mod.clearActiveSessionsCache,
    clearAllSessionsCache: mod.clearAllSessionsCache,
    clearSessionDetailsCache: mod.clearSessionDetailsCache,
    clearAllSessionCache: mod.clearAllSessionCache,
    startCacheCleanup: mod.startCacheCleanup,
    stopCacheCleanup: mod.stopCacheCleanup,
    getCacheStats: mod.getCacheStats,
  };
}

function getCleanupIntervalId() {
  return (globalThis as any)[CLEANUP_INTERVAL_GLOBAL_KEY] as ReturnType<typeof setInterval> | null;
}

function setCleanupIntervalId(value: ReturnType<typeof setInterval> | null) {
  (globalThis as any)[CLEANUP_INTERVAL_GLOBAL_KEY] = value;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-03T00:00:00.000Z"));
  setCleanupIntervalId(null);
});

afterEach(() => {
  const intervalId = getCleanupIntervalId();
  if (intervalId) {
    clearInterval(intervalId);
  }
  setCleanupIntervalId(null);
  vi.useRealTimers();
});

describe("SessionCache（Session 数据缓存层）", () => {
  test("未写入时应返回 null；写入后 TTL 内应可读取", async () => {
    const { getActiveSessionsCache, setActiveSessionsCache } = await loadSessionCache();

    expect(getActiveSessionsCache()).toBeNull();

    setActiveSessionsCache([
      {
        sessionId: "s_1",
        requestCount: 1,
        totalCostUsd: "0",
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalDurationMs: 0,
        firstRequestAt: null,
        lastRequestAt: null,
        providers: [],
        models: [],
        userName: "u",
        userId: 1,
        keyName: "k",
        keyId: 1,
        userAgent: null,
        apiType: null,
        cacheTtlApplied: null,
      },
    ]);

    expect(getActiveSessionsCache()).toEqual(
      expect.arrayContaining([expect.objectContaining({ sessionId: "s_1" })])
    );
  });

  test("TTL 过期后应返回 null（并清理过期条目）", async () => {
    const { getActiveSessionsCache, setActiveSessionsCache, getCacheStats } =
      await loadSessionCache();

    setActiveSessionsCache(
      [
        {
          sessionId: "s_expired",
          requestCount: 1,
          totalCostUsd: "0",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          totalDurationMs: 0,
          firstRequestAt: null,
          lastRequestAt: null,
          providers: [],
          models: [],
          userName: "u",
          userId: 1,
          keyName: "k",
          keyId: 1,
          userAgent: null,
          apiType: null,
          cacheTtlApplied: null,
        },
      ],
      "active_sessions"
    );

    expect(getCacheStats().activeSessions.size).toBe(1);

    // activeSessionsCache TTL = 2s，且实现为 age > ttl 才过期
    vi.advanceTimersByTime(2001);
    expect(getActiveSessionsCache()).toBeNull();
    expect(getCacheStats().activeSessions.size).toBe(0);
  });

  test("clear* 系列函数应删除对应缓存", async () => {
    const {
      getActiveSessionsCache,
      setActiveSessionsCache,
      getSessionDetailsCache,
      setSessionDetailsCache,
      clearActiveSessionsCache,
      clearAllSessionsCache,
      clearSessionDetailsCache,
      clearAllSessionCache,
    } = await loadSessionCache();

    setActiveSessionsCache(
      [
        {
          sessionId: "s_1",
          requestCount: 1,
          totalCostUsd: "0",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          totalDurationMs: 0,
          firstRequestAt: null,
          lastRequestAt: null,
          providers: [],
          models: [],
          userName: "u",
          userId: 1,
          keyName: "k",
          keyId: 1,
          userAgent: null,
          apiType: null,
          cacheTtlApplied: null,
        },
      ],
      "active_sessions"
    );
    setActiveSessionsCache([], "all_sessions");
    setSessionDetailsCache("s_1", {
      sessionId: "s_1",
      requestCount: 1,
      totalCostUsd: "0",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalDurationMs: 0,
      firstRequestAt: null,
      lastRequestAt: null,
      providers: [],
      models: [],
      userName: "u",
      userId: 1,
      keyName: "k",
      keyId: 1,
      userAgent: null,
      apiType: null,
      cacheTtlApplied: null,
    });

    clearActiveSessionsCache();
    expect(getActiveSessionsCache()).toBeNull();

    clearAllSessionsCache();
    // clearAllSessionsCache 删除 all_sessions，而非 active_sessions
    expect(getActiveSessionsCache("all_sessions")).toBeNull();

    clearSessionDetailsCache("s_1");
    expect(getSessionDetailsCache("s_1")).toBeNull();

    // 再次写入后，clearAllSessionCache 应清空两类缓存
    setActiveSessionsCache([], "active_sessions");
    setSessionDetailsCache("s_2", {
      sessionId: "s_2",
      requestCount: 1,
      totalCostUsd: "0",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalDurationMs: 0,
      firstRequestAt: null,
      lastRequestAt: null,
      providers: [],
      models: [],
      userName: "u",
      userId: 1,
      keyName: "k",
      keyId: 1,
      userAgent: null,
      apiType: null,
      cacheTtlApplied: null,
    });

    clearAllSessionCache();
    expect(getActiveSessionsCache()).toBeNull();
    expect(getSessionDetailsCache("s_2")).toBeNull();
  });

  test("startCacheCleanup/stopCacheCleanup：应幂等且能清理过期条目", async () => {
    const {
      setActiveSessionsCache,
      getActiveSessionsCache,
      getCacheStats,
      startCacheCleanup,
      stopCacheCleanup,
    } = await loadSessionCache();

    // 未启动时 stop 应无副作用
    expect(getCleanupIntervalId()).toBeNull();
    stopCacheCleanup();
    expect(getCleanupIntervalId()).toBeNull();

    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");

    startCacheCleanup(1);
    const firstId = getCleanupIntervalId();
    expect(firstId).not.toBeNull();

    // 重复启动应直接返回，不应创建新的 interval
    startCacheCleanup(1);
    expect(getCleanupIntervalId()).toBe(firstId);
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);

    // 写入一个会过期的条目（activeSessions TTL=2s）
    setActiveSessionsCache(
      [
        {
          sessionId: "s_expired_by_cleanup",
          requestCount: 1,
          totalCostUsd: "0",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          totalCacheCreationTokens: 0,
          totalCacheReadTokens: 0,
          totalDurationMs: 0,
          firstRequestAt: null,
          lastRequestAt: null,
          providers: [],
          models: [],
          userName: "u",
          userId: 1,
          keyName: "k",
          keyId: 1,
          userAgent: null,
          apiType: null,
          cacheTtlApplied: null,
        },
      ],
      "active_sessions"
    );
    expect(getCacheStats().activeSessions.size).toBe(1);

    // 推进到 >2s，等待 cleanup interval 执行（每 1s）
    vi.advanceTimersByTime(3000);
    expect(getCacheStats().activeSessions.size).toBe(0);
    expect(getActiveSessionsCache()).toBeNull();

    stopCacheCleanup();
    expect(getCleanupIntervalId()).toBeNull();
  });
});
