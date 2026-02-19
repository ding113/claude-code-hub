import { afterEach, describe, expect, test, vi } from "vitest";

type SavedEndpointCircuitState = {
  failureCount: number;
  lastFailureTime: number | null;
  circuitState: "closed" | "open" | "half-open";
  circuitOpenUntil: number | null;
  halfOpenSuccessCount: number;
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

async function flushPromises(rounds = 2): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.ENDPOINT_CIRCUIT_HEALTH_CACHE_MAX_SIZE;
});

describe("endpoint-circuit-breaker", () => {
  test("达到阈值后应打开熔断；到期后进入 half-open；成功后关闭并清零", async () => {
    vi.resetModules();

    let redisState: SavedEndpointCircuitState | null = null;
    const loadMock = vi.fn(async () => redisState);
    const saveMock = vi.fn(async (_endpointId: number, state: SavedEndpointCircuitState) => {
      redisState = state;
    });
    const deleteMock = vi.fn(async () => {
      redisState = null;
    });

    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));
    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    const sendAlertMock = vi.fn(async () => {});
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: sendAlertMock,
    }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: loadMock,
      saveEndpointCircuitState: saveMock,
      deleteEndpointCircuitState: deleteMock,
    }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const {
      isEndpointCircuitOpen,
      getEndpointHealthInfo,
      recordEndpointFailure,
      recordEndpointSuccess,
      resetEndpointCircuit,
    } = await import("@/lib/endpoint-circuit-breaker");

    await recordEndpointFailure(1, new Error("boom"));
    await recordEndpointFailure(1, new Error("boom"));
    await recordEndpointFailure(1, new Error("boom"));

    const openState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[1] as SavedEndpointCircuitState;
    expect(openState.circuitState).toBe("open");
    expect(openState.failureCount).toBe(3);
    expect(openState.circuitOpenUntil).toBe(Date.now() + 300000);

    // Prime env module cache: under fake timers, dynamic import() inside isEndpointCircuitOpen
    // may fail to resolve the vi.doMock unless the module is already in the import cache.
    await import("@/lib/config/env.schema");

    expect(await isEndpointCircuitOpen(1)).toBe(true);

    vi.advanceTimersByTime(300000 + 1);

    expect(await isEndpointCircuitOpen(1)).toBe(false);
    const halfOpenState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[1] as SavedEndpointCircuitState;
    expect(halfOpenState.circuitState).toBe("half-open");

    await recordEndpointSuccess(1);
    expect(deleteMock).toHaveBeenCalledWith(1);

    const { health: afterSuccess } = await getEndpointHealthInfo(1);
    expect(afterSuccess.circuitState).toBe("closed");
    expect(afterSuccess.failureCount).toBe(0);
    expect(afterSuccess.circuitOpenUntil).toBeNull();
    expect(afterSuccess.lastFailureTime).toBeNull();
    expect(afterSuccess.halfOpenSuccessCount).toBe(0);

    expect(await isEndpointCircuitOpen(1)).toBe(false);

    const deleteCallsAfterSuccess = deleteMock.mock.calls.length;
    await resetEndpointCircuit(1);
    expect(deleteMock.mock.calls.length).toBeGreaterThan(deleteCallsAfterSuccess);

    // 说明：recordEndpointFailure 在达到阈值后会触发异步告警（dynamic import + await）。
    // 在 CI/bun 环境下，告警 Promise 可能在下一个测试开始后才完成，从而“借用”后续用例的 module mock，
    // 导致 sendAlertMock 被额外调用而产生偶发失败。这里用真实计时器让事件循环前进，确保告警任务尽快落地。
    vi.useRealTimers();
    const startedAt = Date.now();
    while (sendAlertMock.mock.calls.length === 0 && Date.now() - startedAt < 1000) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  });

  test("recordEndpointSuccess: closed 且 failureCount>0 时应清零", async () => {
    vi.resetModules();

    const saveMock = vi.fn(async () => {});
    const deleteMock = vi.fn(async () => {});

    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));
    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: vi.fn(async () => null),
      saveEndpointCircuitState: saveMock,
      deleteEndpointCircuitState: deleteMock,
    }));

    const { recordEndpointFailure, recordEndpointSuccess, getEndpointHealthInfo } = await import(
      "@/lib/endpoint-circuit-breaker"
    );

    await recordEndpointFailure(2, new Error("boom"));
    await recordEndpointSuccess(2);

    const { health } = await getEndpointHealthInfo(2);
    expect(health.failureCount).toBe(0);
    expect(health.circuitState).toBe("closed");

    expect(saveMock).toHaveBeenCalledTimes(1);
    expect(deleteMock).toHaveBeenCalledWith(2);
  });

  test("getAllEndpointHealthStatusAsync: forceRefresh 时应同步 Redis 中的计数（即使 circuitState 未变化）", async () => {
    vi.resetModules();

    const endpointId = 42;

    const redisStates = new Map<number, SavedEndpointCircuitState>();
    const loadManyMock = vi.fn(async (endpointIds: number[]) => {
      const result = new Map<number, SavedEndpointCircuitState>();
      for (const id of endpointIds) {
        const state = redisStates.get(id);
        if (state) {
          result.set(id, state);
        }
      }
      return result;
    });

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: vi.fn(async () => null),
      loadEndpointCircuitStates: loadManyMock,
      saveEndpointCircuitState: vi.fn(async () => {}),
      deleteEndpointCircuitState: vi.fn(async () => {}),
    }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));
    const t0 = Date.now();

    redisStates.set(endpointId, {
      failureCount: 1,
      lastFailureTime: t0 - 1000,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    const { getAllEndpointHealthStatusAsync } = await import("@/lib/endpoint-circuit-breaker");

    const first = await getAllEndpointHealthStatusAsync([endpointId], { forceRefresh: true });
    expect(first[endpointId]).toMatchObject({
      failureCount: 1,
      lastFailureTime: t0 - 1000,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    redisStates.set(endpointId, {
      failureCount: 2,
      lastFailureTime: t0 + 123,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    const second = await getAllEndpointHealthStatusAsync([endpointId], { forceRefresh: true });
    expect(second[endpointId]).toMatchObject({
      failureCount: 2,
      lastFailureTime: t0 + 123,
      circuitState: "closed",
      circuitOpenUntil: null,
      halfOpenSuccessCount: 0,
    });

    expect(loadManyMock).toHaveBeenCalledTimes(2);
  });

  test("getAllEndpointHealthStatusAsync: 并发请求应复用 in-flight Redis 批量加载", async () => {
    vi.resetModules();

    const loadManyMock = vi.fn(async (_endpointIds: number[]) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const result = new Map<number, SavedEndpointCircuitState>();
      result.set(1, {
        failureCount: 0,
        lastFailureTime: null,
        circuitState: "closed",
        circuitOpenUntil: null,
        halfOpenSuccessCount: 0,
      });
      result.set(2, {
        failureCount: 0,
        lastFailureTime: null,
        circuitState: "closed",
        circuitOpenUntil: null,
        halfOpenSuccessCount: 0,
      });
      result.set(3, {
        failureCount: 0,
        lastFailureTime: null,
        circuitState: "closed",
        circuitOpenUntil: null,
        halfOpenSuccessCount: 0,
      });
      return result;
    });

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: vi.fn(async () => null),
      loadEndpointCircuitStates: loadManyMock,
      saveEndpointCircuitState: vi.fn(async () => {}),
      deleteEndpointCircuitState: vi.fn(async () => {}),
    }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { getAllEndpointHealthStatusAsync } = await import("@/lib/endpoint-circuit-breaker");

    const p1 = getAllEndpointHealthStatusAsync([1, 2, 3], { forceRefresh: true });
    const p2 = getAllEndpointHealthStatusAsync([1, 2, 3], { forceRefresh: true });

    vi.advanceTimersByTime(20);
    await Promise.all([p1, p2]);
    expect(loadManyMock).toHaveBeenCalledTimes(1);
  });

  test("triggerEndpointCircuitBreakerAlert should call sendCircuitBreakerAlert", async () => {
    vi.resetModules();

    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));
    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: vi.fn(async () => {}),
    }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(async () => null),
    }));

    // recordEndpointFailure 会 non-blocking 触发告警；先让 event-loop 跑完再清空计数，避免串台导致误判
    await flushPromises();

    // Prime module cache for dynamic import() consumers
    await import("@/lib/config/env.schema");
    const notifierModule = await import("@/lib/notification/notifier");
    const sendAlertSpy = vi
      .spyOn(notifierModule, "sendCircuitBreakerAlert")
      .mockResolvedValue(undefined);
    sendAlertSpy.mockClear();

    const { triggerEndpointCircuitBreakerAlert } = await import("@/lib/endpoint-circuit-breaker");

    await triggerEndpointCircuitBreakerAlert(
      5,
      3,
      "2026-01-01T00:05:00.000Z",
      "connection refused"
    );

    const endpoint5Calls = sendAlertSpy.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((payload) => payload.endpointId === 5);
    expect(endpoint5Calls).toHaveLength(1);
    expect(endpoint5Calls[0]).toEqual({
      providerId: 0,
      providerName: "endpoint:5",
      failureCount: 3,
      retryAt: "2026-01-01T00:05:00.000Z",
      lastError: "connection refused",
      incidentSource: "endpoint",
      endpointId: 5,
      endpointUrl: undefined,
    });
  });

  test("triggerEndpointCircuitBreakerAlert should include endpointUrl when available", async () => {
    vi.resetModules();

    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: vi.fn(async () => {}),
    }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(async () => ({
        id: 10,
        url: "https://custom.example.com/v1/chat/completions",
        vendorId: 1,
        providerType: "openai",
        label: "Custom Endpoint",
        sortOrder: 0,
        isEnabled: true,
        lastProbedAt: null,
        lastProbeOk: null,
        lastProbeStatusCode: null,
        lastProbeLatencyMs: null,
        lastProbeErrorType: null,
        lastProbeErrorMessage: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      })),
    }));

    // recordEndpointFailure 会 non-blocking 触发告警；先让 event-loop 跑完再清空计数，避免串台导致误判
    await flushPromises();

    // Prime module cache for dynamic import() consumers
    await import("@/lib/config/env.schema");
    const notifierModule = await import("@/lib/notification/notifier");
    const sendAlertSpy = vi
      .spyOn(notifierModule, "sendCircuitBreakerAlert")
      .mockResolvedValue(undefined);
    sendAlertSpy.mockClear();

    const { triggerEndpointCircuitBreakerAlert } = await import("@/lib/endpoint-circuit-breaker");

    await triggerEndpointCircuitBreakerAlert(10, 3, "2026-01-01T00:05:00.000Z", "timeout");

    const endpoint10Calls = sendAlertSpy.mock.calls
      .map((call) => call[0] as Record<string, unknown>)
      .filter((payload) => payload.endpointId === 10);
    expect(endpoint10Calls).toHaveLength(1);
    expect(endpoint10Calls[0]).toEqual({
      providerId: 1,
      providerName: "Custom Endpoint",
      failureCount: 3,
      retryAt: "2026-01-01T00:05:00.000Z",
      lastError: "timeout",
      incidentSource: "endpoint",
      endpointId: 10,
      endpointUrl: "https://custom.example.com/v1/chat/completions",
    });
  });

  test("recordEndpointFailure should NOT reset circuitOpenUntil when already open", async () => {
    vi.resetModules();

    let redisState: SavedEndpointCircuitState | null = null;
    const saveMock = vi.fn(async (_endpointId: number, state: SavedEndpointCircuitState) => {
      redisState = state;
    });

    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));
    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: vi.fn(async () => {}),
    }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: vi.fn(async () => redisState),
      saveEndpointCircuitState: saveMock,
      deleteEndpointCircuitState: vi.fn(async () => {}),
    }));

    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { recordEndpointFailure, isEndpointCircuitOpen, getEndpointHealthInfo } = await import(
      "@/lib/endpoint-circuit-breaker"
    );

    // Record 3 failures to open the circuit
    await recordEndpointFailure(100, new Error("fail"));
    await recordEndpointFailure(100, new Error("fail"));
    await recordEndpointFailure(100, new Error("fail"));

    // Verify circuit was opened (also serves as async flush before isEndpointCircuitOpen)
    const { health: healthSnap } = await getEndpointHealthInfo(100);
    expect(healthSnap.circuitState).toBe("open");

    // Prime the env module cache: under fake timers, the dynamic import("@/lib/config/env.schema")
    // inside isEndpointCircuitOpen may fail to resolve the mock unless the module is already cached.
    const envMod = await import("@/lib/config/env.schema");
    expect(envMod.getEnvConfig().ENABLE_ENDPOINT_CIRCUIT_BREAKER).toBe(true);

    expect(await isEndpointCircuitOpen(100)).toBe(true);
    const originalOpenUntil = redisState!.circuitOpenUntil;
    expect(originalOpenUntil).toBe(Date.now() + 300000);

    // Advance 1 min and record another failure — timer must NOT reset
    vi.advanceTimersByTime(60_000);
    await recordEndpointFailure(100, new Error("fail again"));

    expect(redisState!.circuitState).toBe("open");
    expect(redisState!.circuitOpenUntil).toBe(originalOpenUntil); // unchanged!
    expect(redisState!.failureCount).toBe(4);
  });

  test("getEndpointCircuitStateSync returns correct state for known and unknown endpoints", async () => {
    vi.resetModules();

    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));
    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: vi.fn(async () => {}),
    }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: vi.fn(async () => null),
      saveEndpointCircuitState: vi.fn(async () => {}),
      deleteEndpointCircuitState: vi.fn(async () => {}),
    }));

    const { getEndpointCircuitStateSync, recordEndpointFailure } = await import(
      "@/lib/endpoint-circuit-breaker"
    );

    // Unknown endpoint returns "closed"
    expect(getEndpointCircuitStateSync(9999)).toBe("closed");

    // After opening the circuit, sync accessor reflects "open"
    await recordEndpointFailure(200, new Error("a"));
    await recordEndpointFailure(200, new Error("b"));
    await recordEndpointFailure(200, new Error("c"));
    expect(getEndpointCircuitStateSync(200)).toBe("open");
  });

  describe("ENABLE_ENDPOINT_CIRCUIT_BREAKER disabled", () => {
    test("isEndpointCircuitOpen returns false when ENABLE_ENDPOINT_CIRCUIT_BREAKER=false", async () => {
      vi.resetModules();

      vi.doMock("@/lib/config/env.schema", () => ({
        getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
      }));
      vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
      vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
        loadEndpointCircuitState: vi.fn(async () => null),
        saveEndpointCircuitState: vi.fn(async () => {}),
        deleteEndpointCircuitState: vi.fn(async () => {}),
      }));

      const { isEndpointCircuitOpen } = await import("@/lib/endpoint-circuit-breaker");

      expect(await isEndpointCircuitOpen(1)).toBe(false);
      expect(await isEndpointCircuitOpen(999)).toBe(false);
    });

    test("recordEndpointFailure is no-op when disabled", async () => {
      vi.resetModules();

      const saveMock = vi.fn(async () => {});

      vi.doMock("@/lib/config/env.schema", () => ({
        getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
      }));
      vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
      vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
        loadEndpointCircuitState: vi.fn(async () => null),
        saveEndpointCircuitState: saveMock,
        deleteEndpointCircuitState: vi.fn(async () => {}),
      }));

      const { recordEndpointFailure } = await import("@/lib/endpoint-circuit-breaker");

      await recordEndpointFailure(1, new Error("boom"));
      await recordEndpointFailure(1, new Error("boom"));
      await recordEndpointFailure(1, new Error("boom"));

      expect(saveMock).not.toHaveBeenCalled();
    });

    test("recordEndpointSuccess is no-op when disabled", async () => {
      vi.resetModules();

      const saveMock = vi.fn(async () => {});

      vi.doMock("@/lib/config/env.schema", () => ({
        getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
      }));
      vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
      vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
        loadEndpointCircuitState: vi.fn(async () => null),
        saveEndpointCircuitState: saveMock,
        deleteEndpointCircuitState: vi.fn(async () => {}),
      }));

      const { recordEndpointSuccess } = await import("@/lib/endpoint-circuit-breaker");

      await recordEndpointSuccess(1);

      expect(saveMock).not.toHaveBeenCalled();
    });

    test("triggerEndpointCircuitBreakerAlert is no-op when disabled", async () => {
      vi.resetModules();

      const sendAlertMock = vi.fn(async () => {});

      vi.doMock("@/lib/config/env.schema", () => ({
        getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
      }));
      vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
      vi.doMock("@/lib/notification/notifier", () => ({
        sendCircuitBreakerAlert: sendAlertMock,
      }));
      vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
        loadEndpointCircuitState: vi.fn(async () => null),
        saveEndpointCircuitState: vi.fn(async () => {}),
        deleteEndpointCircuitState: vi.fn(async () => {}),
      }));

      const { triggerEndpointCircuitBreakerAlert } = await import("@/lib/endpoint-circuit-breaker");

      await triggerEndpointCircuitBreakerAlert(
        5,
        3,
        "2026-01-01T00:05:00.000Z",
        "connection refused"
      );

      expect(sendAlertMock).not.toHaveBeenCalled();
    });

    test("initEndpointCircuitBreaker clears in-memory state and Redis keys when disabled", async () => {
      vi.resetModules();

      const redisMock = {
        scan: vi
          .fn()
          .mockResolvedValueOnce([
            "0",
            ["endpoint_circuit_breaker:state:1", "endpoint_circuit_breaker:state:2"],
          ]),
        del: vi.fn(async () => {}),
      };

      vi.doMock("@/lib/config/env.schema", () => ({
        getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
      }));
      vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
      vi.doMock("@/lib/redis/client", () => ({
        getRedisClient: () => redisMock,
      }));
      vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
        loadEndpointCircuitState: vi.fn(async () => null),
        saveEndpointCircuitState: vi.fn(async () => {}),
        deleteEndpointCircuitState: vi.fn(async () => {}),
      }));

      const { initEndpointCircuitBreaker } = await import("@/lib/endpoint-circuit-breaker");
      await initEndpointCircuitBreaker();

      expect(redisMock.scan).toHaveBeenCalled();
      expect(redisMock.del).toHaveBeenCalledWith(
        "endpoint_circuit_breaker:state:1",
        "endpoint_circuit_breaker:state:2"
      );
    });

    test("initEndpointCircuitBreaker is no-op when enabled", async () => {
      vi.resetModules();

      const redisMock = {
        scan: vi.fn(),
        del: vi.fn(),
      };

      vi.doMock("@/lib/config/env.schema", () => ({
        getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
      }));
      vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
      vi.doMock("@/lib/redis/client", () => ({
        getRedisClient: () => redisMock,
      }));
      vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
        loadEndpointCircuitState: vi.fn(async () => null),
        saveEndpointCircuitState: vi.fn(async () => {}),
        deleteEndpointCircuitState: vi.fn(async () => {}),
      }));

      const { initEndpointCircuitBreaker } = await import("@/lib/endpoint-circuit-breaker");
      await initEndpointCircuitBreaker();

      expect(redisMock.scan).not.toHaveBeenCalled();
      expect(redisMock.del).not.toHaveBeenCalled();
    });
  });
});
