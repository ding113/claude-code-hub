import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

describe("endpoint-circuit-breaker", () => {
  test("opens circuit after threshold and transitions to half-open after open duration", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();
    const mod = await import("@/lib/endpoint-circuit-breaker");

    const endpointId = 1;

    expect(mod.isEndpointCircuitOpen(endpointId)).toBe(false);

    mod.recordEndpointFailure(endpointId, new Error("fail-1"));
    mod.recordEndpointFailure(endpointId, new Error("fail-2"));
    mod.recordEndpointFailure(endpointId, new Error("fail-3"));

    expect(mod.getEndpointCircuitState(endpointId)).toBe("open");
    expect(mod.isEndpointCircuitOpen(endpointId)).toBe(true);

    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));

    expect(mod.isEndpointCircuitOpen(endpointId)).toBe(false);
    expect(mod.getEndpointCircuitState(endpointId)).toBe("half-open");

    vi.useRealTimers();
  });

  test("half-open successes close the circuit", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();
    const mod = await import("@/lib/endpoint-circuit-breaker");

    const endpointId = 2;

    mod.recordEndpointFailure(endpointId, new Error("fail-1"));
    mod.recordEndpointFailure(endpointId, new Error("fail-2"));
    mod.recordEndpointFailure(endpointId, new Error("fail-3"));

    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));
    expect(mod.isEndpointCircuitOpen(endpointId)).toBe(false);
    expect(mod.getEndpointCircuitState(endpointId)).toBe("half-open");

    mod.recordEndpointSuccess(endpointId);
    expect(mod.getEndpointCircuitState(endpointId)).toBe("half-open");

    mod.recordEndpointSuccess(endpointId);
    expect(mod.getEndpointCircuitState(endpointId)).toBe("closed");

    vi.useRealTimers();
  });

  test("vendor+type fuse opens and expires", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    vi.resetModules();
    const mod = await import("@/lib/endpoint-circuit-breaker");

    mod.openVendorTypeFuse({
      vendorId: 10,
      providerType: "claude",
      reason: "all_endpoints_unhealthy",
    });

    expect(mod.isVendorTypeFuseOpen(10, "claude")).toBe(true);

    vi.setSystemTime(new Date("2026-01-01T00:10:00.000Z"));

    expect(mod.isVendorTypeFuseOpen(10, "claude")).toBe(false);

    vi.useRealTimers();
  });
});
