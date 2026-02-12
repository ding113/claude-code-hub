import { afterEach, describe, expect, test, vi } from "vitest";
import type { ProviderType } from "@/types/provider";

type SavedVendorTypeCircuitState = {
  circuitState: "closed" | "open";
  circuitOpenUntil: number | null;
  lastFailureTime: number | null;
  manualOpen: boolean;
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

describe("vendor-type-circuit-breaker", () => {
  test("ENABLE_ENDPOINT_CIRCUIT_BREAKER=false 时，isVendorTypeCircuitOpen 始终返回 false", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    const loadMock = vi.fn(async () => null);
    const saveMock = vi.fn(async () => {});

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/vendor-type-circuit-breaker-state", () => ({
      loadVendorTypeCircuitState: loadMock,
      saveVendorTypeCircuitState: saveMock,
      deleteVendorTypeCircuitState: vi.fn(async () => {}),
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({
        ENABLE_ENDPOINT_CIRCUIT_BREAKER: false,
        NODE_ENV: "test",
      }),
    }));

    const { isVendorTypeCircuitOpen, recordVendorTypeAllEndpointsTimeout } = await import(
      "@/lib/vendor-type-circuit-breaker"
    );

    // 尝试记录熔断
    await recordVendorTypeAllEndpointsTimeout(100, "claude", 60000);
    // 不应调用 save
    expect(saveMock).not.toHaveBeenCalled();

    // 应始终返回 false
    expect(await isVendorTypeCircuitOpen(100, "claude")).toBe(false);
  });

  test("ENABLE_ENDPOINT_CIRCUIT_BREAKER=true 时，熔断功能正常工作", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    let redisState: SavedVendorTypeCircuitState | null = null;
    const loadMock = vi.fn(async () => redisState);
    const saveMock = vi.fn(
      async (
        _vendorId: number,
        _providerType: ProviderType,
        state: SavedVendorTypeCircuitState
      ) => {
        redisState = state;
      }
    );

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/vendor-type-circuit-breaker-state", () => ({
      loadVendorTypeCircuitState: loadMock,
      saveVendorTypeCircuitState: saveMock,
      deleteVendorTypeCircuitState: vi.fn(async () => {}),
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({
        ENABLE_ENDPOINT_CIRCUIT_BREAKER: true,
        NODE_ENV: "test",
      }),
    }));

    const { isVendorTypeCircuitOpen, recordVendorTypeAllEndpointsTimeout } = await import(
      "@/lib/vendor-type-circuit-breaker"
    );

    // 记录熔断
    await recordVendorTypeAllEndpointsTimeout(101, "claude", 60000);
    expect(saveMock).toHaveBeenCalled();

    // 应返回 true
    expect(await isVendorTypeCircuitOpen(101, "claude")).toBe(true);

    // 等待熔断过期
    vi.advanceTimersByTime(60000 + 1);
    expect(await isVendorTypeCircuitOpen(101, "claude")).toBe(false);
  });

  test("manual open 时 isVendorTypeCircuitOpen 始终为 true，且自动 open 不应覆盖", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    let redisState: SavedVendorTypeCircuitState | null = null;
    const loadMock = vi.fn(async () => redisState);
    const saveMock = vi.fn(
      async (
        _vendorId: number,
        _providerType: ProviderType,
        state: SavedVendorTypeCircuitState
      ) => {
        redisState = state;
      }
    );
    const deleteMock = vi.fn(async () => {
      redisState = null;
    });

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/vendor-type-circuit-breaker-state", () => ({
      loadVendorTypeCircuitState: loadMock,
      saveVendorTypeCircuitState: saveMock,
      deleteVendorTypeCircuitState: deleteMock,
    }));

    const {
      isVendorTypeCircuitOpen,
      setVendorTypeCircuitManualOpen,
      recordVendorTypeAllEndpointsTimeout,
      getVendorTypeCircuitInfo,
    } = await import("@/lib/vendor-type-circuit-breaker");

    const vendorId = 1;
    const providerType: ProviderType = "claude";

    await setVendorTypeCircuitManualOpen(vendorId, providerType, true);

    const info = await getVendorTypeCircuitInfo(vendorId, providerType);
    expect(info.manualOpen).toBe(true);
    expect(info.circuitState).toBe("open");
    expect(info.circuitOpenUntil).toBeNull();

    expect(await isVendorTypeCircuitOpen(vendorId, providerType)).toBe(true);

    await recordVendorTypeAllEndpointsTimeout(vendorId, providerType, 60000);
    expect(saveMock).toHaveBeenCalledTimes(1);
  });

  test("auto open 应应用最小 1000ms，并在到期后自动关闭", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    let redisState: SavedVendorTypeCircuitState | null = null;
    const loadMock = vi.fn(async () => redisState);
    const saveMock = vi.fn(
      async (
        _vendorId: number,
        _providerType: ProviderType,
        state: SavedVendorTypeCircuitState
      ) => {
        redisState = state;
      }
    );
    const deleteMock = vi.fn(async () => {
      redisState = null;
    });

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/vendor-type-circuit-breaker-state", () => ({
      loadVendorTypeCircuitState: loadMock,
      saveVendorTypeCircuitState: saveMock,
      deleteVendorTypeCircuitState: deleteMock,
    }));

    const { isVendorTypeCircuitOpen, recordVendorTypeAllEndpointsTimeout } = await import(
      "@/lib/vendor-type-circuit-breaker"
    );

    await recordVendorTypeAllEndpointsTimeout(2, "claude", 0);

    const openState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[2] as SavedVendorTypeCircuitState;
    expect(openState.circuitState).toBe("open");
    expect(openState.manualOpen).toBe(false);
    expect(openState.circuitOpenUntil).toBe(Date.now() + 1000);

    expect(await isVendorTypeCircuitOpen(2, "claude")).toBe(true);

    vi.advanceTimersByTime(1000 + 1);

    expect(await isVendorTypeCircuitOpen(2, "claude")).toBe(false);

    const closedState = saveMock.mock.calls[
      saveMock.mock.calls.length - 1
    ]?.[2] as SavedVendorTypeCircuitState;
    expect(closedState.circuitState).toBe("closed");
    expect(closedState.circuitOpenUntil).toBeNull();
  });

  test("resetVendorTypeCircuit 应清理缓存并删除 redis", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();

    const deleteMock = vi.fn(async () => {});
    const loadMock = vi.fn(async () => null);

    vi.doMock("@/lib/logger", () => ({ logger: createLoggerMock() }));
    vi.doMock("@/lib/redis/vendor-type-circuit-breaker-state", () => ({
      loadVendorTypeCircuitState: loadMock,
      saveVendorTypeCircuitState: vi.fn(async () => {}),
      deleteVendorTypeCircuitState: deleteMock,
    }));

    const { isVendorTypeCircuitOpen, resetVendorTypeCircuit } = await import(
      "@/lib/vendor-type-circuit-breaker"
    );

    expect(await isVendorTypeCircuitOpen(3, "claude")).toBe(false);
    expect(loadMock).toHaveBeenCalledTimes(1);

    await resetVendorTypeCircuit(3, "claude");
    expect(deleteMock).toHaveBeenCalledWith(3, "claude");

    expect(await isVendorTypeCircuitOpen(3, "claude")).toBe(false);
    expect(loadMock).toHaveBeenCalledTimes(2);
  });
});
