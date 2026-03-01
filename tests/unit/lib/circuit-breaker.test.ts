import { afterEach, describe, expect, test, vi } from "vitest";

type SavedCircuitState = {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: "closed" | "open" | "half-open";
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
};

type CircuitBreakerConfig = {
  failureThreshold: number;
  openDuration: number;
  halfOpenSuccessThreshold: number;
};

function createLoggerMock() {
  return {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  };
}

function setupFakeTime(): void {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
}

function setupCircuitBreakerMocks(options?: {
  redis?: {
    loadCircuitState?: (providerId: number) => Promise<SavedCircuitState | null>;
    loadAllCircuitStates?: (providerIds: number[]) => Promise<Map<number, SavedCircuitState>>;
    saveCircuitState?: (providerId: number, state: SavedCircuitState) => Promise<void>;
  };
  config?: {
    defaultConfig?: CircuitBreakerConfig;
    loadProviderCircuitConfig?: (providerId: number) => Promise<CircuitBreakerConfig>;
  };
  pubsub?: {
    publishCacheInvalidation?: (channel: string, message?: string) => Promise<void>;
    subscribeCacheInvalidation?: (
      channel: string,
      callback: (message: string) => void
    ) => Promise<(() => void) | null>;
  };
}): void {
  const defaultConfig: CircuitBreakerConfig = options?.config?.defaultConfig ?? {
    failureThreshold: 5,
    openDuration: 1800000,
    halfOpenSuccessThreshold: 2,
  };

  vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
  vi.doMock("@/lib/redis/circuit-breaker-state", () => ({
    loadCircuitState: options?.redis?.loadCircuitState ?? vi.fn(async () => null),
    loadAllCircuitStates: options?.redis?.loadAllCircuitStates ?? vi.fn(async () => new Map()),
    saveCircuitState: options?.redis?.saveCircuitState ?? vi.fn(async () => {}),
  }));
  vi.doMock("@/lib/redis/circuit-breaker-config", () => ({
    DEFAULT_CIRCUIT_BREAKER_CONFIG: defaultConfig,
    loadProviderCircuitConfig:
      options?.config?.loadProviderCircuitConfig ?? vi.fn(async () => defaultConfig),
  }));
  vi.doMock("@/lib/redis/pubsub", () => ({
    publishCacheInvalidation: options?.pubsub?.publishCacheInvalidation ?? vi.fn(async () => {}),
    subscribeCacheInvalidation:
      options?.pubsub?.subscribeCacheInvalidation ?? vi.fn(async () => null),
  }));
}

afterEach(() => {
  vi.useRealTimers();
});

describe("circuit-breaker", () => {
  test("failureThreshold=0 时应视为禁用：即便 Redis 为 OPEN 也不应阻止请求，并自动复位为 CLOSED", async () => {
    setupFakeTime();

    vi.resetModules();

    let redisState: SavedCircuitState | null = {
      failureCount: 10,
      lastFailureTime: Date.now() - 1000,
      circuitState: "open",
      circuitOpenUntil: Date.now() + 300000,
      halfOpenSuccessCount: 0,
    };

    const loadStateMock = vi.fn(async () => redisState);
    const saveStateMock = vi.fn(async (_providerId: number, state: SavedCircuitState) => {
      redisState = state;
    });

    setupCircuitBreakerMocks({
      redis: {
        loadCircuitState: loadStateMock,
        saveCircuitState: saveStateMock,
      },
      config: {
        loadProviderCircuitConfig: vi.fn(async () => ({
          failureThreshold: 0,
          openDuration: 1800000,
          halfOpenSuccessThreshold: 2,
        })),
      },
    });

    const { getCircuitState, isCircuitOpen } = await import("@/lib/circuit-breaker");

    expect(await isCircuitOpen(1)).toBe(false);
    expect(getCircuitState(1)).toBe("closed");

    const lastState = saveStateMock.mock.calls[saveStateMock.mock.calls.length - 1]?.[1] as
      | SavedCircuitState
      | undefined;
    expect(lastState?.circuitState).toBe("closed");
    expect(lastState?.failureCount).toBe(0);
    expect(lastState?.lastFailureTime).toBeNull();
    expect(lastState?.circuitOpenUntil).toBeNull();
    expect(lastState?.halfOpenSuccessCount).toBe(0);
  });

  test("getAllHealthStatusAsync: failureThreshold=0 时应强制返回 CLOSED 并写回 Redis", async () => {
    setupFakeTime();

    vi.resetModules();

    const openState: SavedCircuitState = {
      failureCount: 10,
      lastFailureTime: Date.now() - 1000,
      circuitState: "open",
      circuitOpenUntil: Date.now() + 300000,
      halfOpenSuccessCount: 0,
    };

    let savedState: SavedCircuitState | null = null;
    const saveStateMock = vi.fn(async (_providerId: number, state: SavedCircuitState) => {
      savedState = state;
    });

    setupCircuitBreakerMocks({
      redis: {
        loadCircuitState: vi.fn(async () => null),
        loadAllCircuitStates: vi.fn(async () => new Map([[1, openState]])),
        saveCircuitState: saveStateMock,
      },
      config: {
        loadProviderCircuitConfig: vi.fn(async () => ({
          failureThreshold: 0,
          openDuration: 1800000,
          halfOpenSuccessThreshold: 2,
        })),
      },
    });

    const { getAllHealthStatusAsync } = await import("@/lib/circuit-breaker");

    const status = await getAllHealthStatusAsync([1], { forceRefresh: true });
    expect(status[1]?.circuitState).toBe("closed");

    expect(savedState?.circuitState).toBe("closed");
    expect(savedState?.failureCount).toBe(0);
    expect(savedState?.lastFailureTime).toBeNull();
    expect(savedState?.circuitOpenUntil).toBeNull();
    expect(savedState?.halfOpenSuccessCount).toBe(0);
  });

  test("getAllHealthStatusAsync: Redis 无状态时应清理内存中的非 CLOSED 状态（避免展示/筛选残留）", async () => {
    setupFakeTime();

    vi.resetModules();

    const openState: SavedCircuitState = {
      failureCount: 10,
      lastFailureTime: Date.now() - 1000,
      circuitState: "open",
      circuitOpenUntil: Date.now() + 300000,
      halfOpenSuccessCount: 0,
    };

    let loadCalls = 0;
    const loadAllCircuitStatesMock = vi.fn(async () => {
      loadCalls++;
      if (loadCalls === 1) {
        return new Map([[1, openState]]);
      }
      return new Map();
    });

    setupCircuitBreakerMocks({
      redis: {
        loadCircuitState: vi.fn(async () => null),
        loadAllCircuitStates: loadAllCircuitStatesMock,
        saveCircuitState: vi.fn(async () => {}),
      },
      config: {
        loadProviderCircuitConfig: vi.fn(async () => ({
          failureThreshold: 5,
          openDuration: 1800000,
          halfOpenSuccessThreshold: 2,
        })),
      },
    });

    const { getAllHealthStatusAsync, getCircuitState } = await import("@/lib/circuit-breaker");

    const first = await getAllHealthStatusAsync([1], { forceRefresh: true });
    expect(first[1]?.circuitState).toBe("open");
    expect(getCircuitState(1)).toBe("open");

    const second = await getAllHealthStatusAsync([1], { forceRefresh: true });
    expect(second[1]?.circuitState).toBe("closed");
    expect(getCircuitState(1)).toBe("closed");
  });

  test("recordFailure: 已处于 OPEN 时不应重置 circuitOpenUntil（避免延长熔断时间）", async () => {
    setupFakeTime();

    vi.resetModules();

    let redisState: SavedCircuitState | null = null;
    const loadStateMock = vi.fn(async () => redisState);
    const saveStateMock = vi.fn(async (_providerId: number, state: SavedCircuitState) => {
      redisState = state;
    });

    const sendAlertMock = vi.fn(async () => {});

    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: sendAlertMock,
    }));
    vi.doMock("@/drizzle/schema", () => ({
      providers: { id: "id", name: "name" },
    }));
    vi.doMock("drizzle-orm", () => ({ eq: vi.fn(() => ({})) }));
    vi.doMock("@/drizzle/db", () => ({
      db: {
        select: vi.fn(() => ({
          from: vi.fn(() => ({
            where: vi.fn(() => ({
              limit: vi.fn(async () => [{ name: "Test Provider" }]),
            })),
          })),
        })),
      },
    }));

    setupCircuitBreakerMocks({
      redis: {
        loadCircuitState: loadStateMock,
        saveCircuitState: saveStateMock,
      },
      config: {
        loadProviderCircuitConfig: vi.fn(async () => ({
          failureThreshold: 2,
          openDuration: 300000,
          halfOpenSuccessThreshold: 2,
        })),
      },
    });

    const { recordFailure } = await import("@/lib/circuit-breaker");

    await recordFailure(1, new Error("boom"));
    await recordFailure(1, new Error("boom"));

    expect(redisState?.circuitState).toBe("open");
    const openUntil = redisState?.circuitOpenUntil;
    expect(openUntil).toBe(Date.now() + 300000);

    vi.advanceTimersByTime(1000);

    await recordFailure(1, new Error("boom"));
    expect(redisState?.circuitOpenUntil).toBe(openUntil);

    // recordFailure 在达到阈值后会触发异步告警（dynamic import + non-blocking）。
    // 切回真实计时器推进事件循环，避免任务悬挂导致后续用例 mock 串台。
    vi.useRealTimers();
    await expect.poll(() => sendAlertMock.mock.calls.length, { timeout: 1000 }).toBe(1);
  });

  test("配置加载失败时应缓存默认配置，避免重复请求配置存储", async () => {
    setupFakeTime();

    vi.resetModules();

    const loadProviderCircuitConfigMock = vi.fn(async () => {
      throw new Error("redis down");
    });

    setupCircuitBreakerMocks({
      config: {
        defaultConfig: {
          failureThreshold: 100,
          openDuration: 1800000,
          halfOpenSuccessThreshold: 2,
        },
        loadProviderCircuitConfig: loadProviderCircuitConfigMock,
      },
    });

    const { recordFailure } = await import("@/lib/circuit-breaker");

    await recordFailure(1, new Error("boom"));
    await recordFailure(1, new Error("boom"));

    expect(loadProviderCircuitConfigMock).toHaveBeenCalledTimes(1);
  });

  test("并发加载配置时应进行 in-flight 合并，避免重复请求配置存储", async () => {
    setupFakeTime();

    vi.resetModules();

    const loadProviderCircuitConfigMock = vi.fn(
      async () =>
        await new Promise<CircuitBreakerConfig>((resolve) => {
          setTimeout(() => {
            resolve({
              failureThreshold: 100,
              openDuration: 1800000,
              halfOpenSuccessThreshold: 2,
            });
          }, 50);
        })
    );

    setupCircuitBreakerMocks({
      config: {
        loadProviderCircuitConfig: loadProviderCircuitConfigMock,
      },
    });

    const { recordFailure } = await import("@/lib/circuit-breaker");

    const p1 = recordFailure(1, new Error("boom"));
    const p2 = recordFailure(1, new Error("boom"));

    await vi.advanceTimersByTimeAsync(50);
    await Promise.all([p1, p2]);

    expect(loadProviderCircuitConfigMock).toHaveBeenCalledTimes(1);
  });

  test("收到配置失效通知后应清除配置缓存并触发重新加载（跨实例一致性）", async () => {
    setupFakeTime();

    const originalCi = process.env.CI;
    process.env.CI = "false";

    try {
      vi.resetModules();

      let onInvalidation: ((message: string) => void) | null = null;

      const loadProviderCircuitConfigMock = vi
        .fn()
        .mockResolvedValueOnce({
          failureThreshold: 5,
          openDuration: 1800000,
          halfOpenSuccessThreshold: 2,
        })
        .mockResolvedValueOnce({
          failureThreshold: 0,
          openDuration: 1800000,
          halfOpenSuccessThreshold: 2,
        });

      const subscribeCacheInvalidationMock = vi.fn(
        async (_channel: string, cb: (message: string) => void) => {
          onInvalidation = cb;
          return () => {};
        }
      );

      setupCircuitBreakerMocks({
        config: {
          loadProviderCircuitConfig: loadProviderCircuitConfigMock,
        },
        pubsub: {
          subscribeCacheInvalidation: subscribeCacheInvalidationMock,
        },
      });

      const { recordFailure } = await import("@/lib/circuit-breaker");

      await recordFailure(1, new Error("boom"));
      expect(loadProviderCircuitConfigMock).toHaveBeenCalledTimes(1);

      expect(subscribeCacheInvalidationMock).toHaveBeenCalledTimes(1);
      expect(onInvalidation).not.toBeNull();

      onInvalidation!(JSON.stringify({ providerIds: [1] }));

      await recordFailure(1, new Error("boom"));
      expect(loadProviderCircuitConfigMock).toHaveBeenCalledTimes(2);
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
    }
  });

  test("失效通知发生在配置加载期间时应重试，避免把旧配置写回缓存", async () => {
    setupFakeTime();

    const originalCi = process.env.CI;
    process.env.CI = "false";

    try {
      vi.resetModules();

      let onInvalidation: ((message: string) => void) | null = null;

      const deferred = <T>() => {
        let resolve!: (value: T) => void;
        let reject!: (reason?: unknown) => void;
        const promise = new Promise<T>((res, rej) => {
          resolve = res;
          reject = rej;
        });
        return { promise, resolve, reject };
      };

      const first = deferred<CircuitBreakerConfig>();
      const second = deferred<CircuitBreakerConfig>();

      const loadProviderCircuitConfigMock = vi
        .fn()
        .mockImplementationOnce(async () => await first.promise)
        .mockImplementationOnce(async () => await second.promise);

      const subscribeCacheInvalidationMock = vi.fn(
        async (_channel: string, cb: (message: string) => void) => {
          onInvalidation = cb;
          return () => {};
        }
      );

      setupCircuitBreakerMocks({
        config: {
          loadProviderCircuitConfig: loadProviderCircuitConfigMock,
        },
        pubsub: {
          subscribeCacheInvalidation: subscribeCacheInvalidationMock,
        },
      });

      const { getProviderHealthInfo, recordFailure } = await import("@/lib/circuit-breaker");

      const failurePromise = recordFailure(1, new Error("boom"));

      // recordFailure 会先 await getOrCreateHealth（包含 Redis 同步），这里让出若干微任务以触发配置加载
      for (let i = 0; i < 5 && loadProviderCircuitConfigMock.mock.calls.length === 0; i++) {
        await Promise.resolve();
      }

      expect(loadProviderCircuitConfigMock).toHaveBeenCalledTimes(1);
      expect(onInvalidation).not.toBeNull();

      onInvalidation!(JSON.stringify({ providerIds: [1] }));

      first.resolve({
        failureThreshold: 5,
        openDuration: 1800000,
        halfOpenSuccessThreshold: 2,
      });

      for (let i = 0; i < 5 && loadProviderCircuitConfigMock.mock.calls.length < 2; i++) {
        await Promise.resolve();
      }
      expect(loadProviderCircuitConfigMock).toHaveBeenCalledTimes(2);

      second.resolve({
        failureThreshold: 0,
        openDuration: 1800000,
        halfOpenSuccessThreshold: 2,
      });

      await failurePromise;

      const { health } = await getProviderHealthInfo(1);
      expect(health.failureCount).toBe(0);
    } finally {
      if (originalCi === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCi;
      }
    }
  });
});
