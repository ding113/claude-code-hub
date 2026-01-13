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
