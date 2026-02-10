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

afterEach(() => {
  vi.useRealTimers();
});

describe("endpoint-circuit-breaker", () => {
  test("达到阈值后应打开熔断；到期后进入 half-open；成功后关闭并清零", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    let redisState: SavedEndpointCircuitState | null = null;
    const loadMock = vi.fn(async () => redisState);
    const saveMock = vi.fn(async (_endpointId: number, state: SavedEndpointCircuitState) => {
      redisState = state;
    });
    const deleteMock = vi.fn(async () => {
      redisState = null;
    });

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: loadMock,
      saveEndpointCircuitState: saveMock,
      deleteEndpointCircuitState: deleteMock,
    }));

    const {
      isEndpointCircuitOpen,
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

    expect(await isEndpointCircuitOpen(1)).toBe(true);

    vi.advanceTimersByTime(300000 + 1);

    expect(await isEndpointCircuitOpen(1)).toBe(false);
    const halfOpenState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[1] as SavedEndpointCircuitState;
    expect(halfOpenState.circuitState).toBe("half-open");

    await recordEndpointSuccess(1);
    const closedState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[1] as SavedEndpointCircuitState;
    expect(closedState.circuitState).toBe("closed");
    expect(closedState.failureCount).toBe(0);
    expect(closedState.circuitOpenUntil).toBeNull();
    expect(closedState.lastFailureTime).toBeNull();
    expect(closedState.halfOpenSuccessCount).toBe(0);

    expect(await isEndpointCircuitOpen(1)).toBe(false);

    await resetEndpointCircuit(1);
    expect(deleteMock).toHaveBeenCalledWith(1);
  });

  test("recordEndpointSuccess: closed 且 failureCount>0 时应清零", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    const saveMock = vi.fn(async () => {});

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/endpoint-circuit-breaker-state", () => ({
      loadEndpointCircuitState: vi.fn(async () => null),
      saveEndpointCircuitState: saveMock,
      deleteEndpointCircuitState: vi.fn(async () => {}),
    }));

    const { recordEndpointFailure, recordEndpointSuccess, getEndpointHealthInfo } = await import(
      "@/lib/endpoint-circuit-breaker"
    );

    await recordEndpointFailure(2, new Error("boom"));
    await recordEndpointSuccess(2);

    const { health } = await getEndpointHealthInfo(2);
    expect(health.failureCount).toBe(0);
    expect(health.circuitState).toBe("closed");

    const lastState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[1] as SavedEndpointCircuitState;
    expect(lastState.failureCount).toBe(0);
  });

  test("triggerEndpointCircuitBreakerAlert should call sendCircuitBreakerAlert", async () => {
    vi.resetModules();

    const sendAlertMock = vi.fn(async () => {});
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: sendAlertMock,
    }));
    vi.doMock("@/repository", () => ({
      findProviderEndpointById: vi.fn(async () => null),
    }));

    const { triggerEndpointCircuitBreakerAlert } = await import("@/lib/endpoint-circuit-breaker");

    await triggerEndpointCircuitBreakerAlert(
      5,
      3,
      "2026-01-01T00:05:00.000Z",
      "connection refused"
    );

    expect(sendAlertMock).toHaveBeenCalledTimes(1);
    expect(sendAlertMock).toHaveBeenCalledWith({
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

    const sendAlertMock = vi.fn(async () => {});
    vi.doMock("@/lib/notification/notifier", () => ({
      sendCircuitBreakerAlert: sendAlertMock,
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

    const { triggerEndpointCircuitBreakerAlert } = await import("@/lib/endpoint-circuit-breaker");

    await triggerEndpointCircuitBreakerAlert(10, 3, "2026-01-01T00:05:00.000Z", "timeout");

    expect(sendAlertMock).toHaveBeenCalledTimes(1);
    expect(sendAlertMock).toHaveBeenCalledWith({
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
});
