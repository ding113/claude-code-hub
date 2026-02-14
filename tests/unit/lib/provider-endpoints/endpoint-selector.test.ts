import { describe, expect, test, vi } from "vitest";
import type { ProviderEndpoint } from "@/types/provider";

function makeEndpoint(overrides: Partial<ProviderEndpoint>): ProviderEndpoint {
  return {
    id: 1,
    vendorId: 1,
    providerType: "claude",
    url: "https://example.com",
    label: null,
    sortOrder: 0,
    isEnabled: true,
    lastProbedAt: null,
    lastProbeOk: null,
    lastProbeStatusCode: null,
    lastProbeLatencyMs: null,
    lastProbeErrorType: null,
    lastProbeErrorMessage: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    deletedAt: null,
    ...overrides,
  };
}

describe("provider-endpoints: endpoint-selector", () => {
  test("rankProviderEndpoints 应过滤 disabled/deleted，并按 lastProbeOk/sortOrder/latency/id 排序", async () => {
    vi.resetModules();
    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: vi.fn(),
    }));

    const { rankProviderEndpoints } = await import("@/lib/provider-endpoints/endpoint-selector");

    const healthyHighOrder = makeEndpoint({
      id: 10,
      lastProbeOk: true,
      sortOrder: 1,
      lastProbeLatencyMs: 50,
    });
    const healthyLowOrder = makeEndpoint({
      id: 11,
      lastProbeOk: true,
      sortOrder: 0,
      lastProbeLatencyMs: 999,
    });
    const unknownFast = makeEndpoint({
      id: 20,
      lastProbeOk: null,
      sortOrder: 0,
      lastProbeLatencyMs: 10,
    });
    const unknownNoLatency = makeEndpoint({
      id: 21,
      lastProbeOk: null,
      sortOrder: 0,
      lastProbeLatencyMs: null,
    });
    const unhealthyFast30 = makeEndpoint({
      id: 30,
      lastProbeOk: false,
      sortOrder: 0,
      lastProbeLatencyMs: 1,
    });
    const unhealthyFast31 = makeEndpoint({
      id: 31,
      lastProbeOk: false,
      sortOrder: 0,
      lastProbeLatencyMs: 1,
    });
    const disabled = makeEndpoint({ id: 40, isEnabled: false, lastProbeOk: true });
    const deleted = makeEndpoint({ id: 41, deletedAt: new Date(1), lastProbeOk: true });

    const ranked = rankProviderEndpoints([
      healthyHighOrder,
      healthyLowOrder,
      unknownFast,
      unknownNoLatency,
      unhealthyFast30,
      unhealthyFast31,
      disabled,
      deleted,
    ]);

    expect(ranked.map((e) => e.id)).toEqual([11, 10, 20, 21, 30, 31]);
  });

  test("getPreferredProviderEndpoints 应排除禁用/已删除/显式 exclude/熔断 open 的端点，并返回排序结果", async () => {
    vi.resetModules();

    const endpoints: ProviderEndpoint[] = [
      makeEndpoint({ id: 1, lastProbeOk: true, sortOrder: 1, lastProbeLatencyMs: 20 }),
      makeEndpoint({ id: 2, lastProbeOk: true, sortOrder: 0, lastProbeLatencyMs: 999 }),
      makeEndpoint({ id: 3, lastProbeOk: null, sortOrder: 0, lastProbeLatencyMs: 10 }),
      makeEndpoint({ id: 4, isEnabled: false }),
      makeEndpoint({ id: 5, deletedAt: new Date(1) }),
      makeEndpoint({ id: 6, lastProbeOk: false, sortOrder: 0, lastProbeLatencyMs: 1 }),
    ];

    const findMock = vi.fn(async () => endpoints);
    const isOpenMock = vi.fn(async (endpointId: number) => endpointId === 2);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));

    const { getPreferredProviderEndpoints, pickBestProviderEndpoint } = await import(
      "@/lib/provider-endpoints/endpoint-selector"
    );

    const result = await getPreferredProviderEndpoints({
      vendorId: 123,
      providerType: "claude",
      excludeEndpointIds: [6],
    });

    expect(findMock).toHaveBeenCalledWith(123, "claude");
    expect(isOpenMock.mock.calls.map((c) => c[0])).toEqual([1, 2, 3]);
    expect(result.map((e) => e.id)).toEqual([1, 3]);

    const best = await pickBestProviderEndpoint({ vendorId: 123, providerType: "claude" });
    expect(best?.id).toBe(1);
  });

  test("getPreferredProviderEndpoints 过滤后无候选时返回空数组", async () => {
    vi.resetModules();

    const findMock = vi.fn(async () => [makeEndpoint({ id: 1, isEnabled: false })]);
    const isOpenMock = vi.fn(async () => false);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));

    const { getPreferredProviderEndpoints, pickBestProviderEndpoint } = await import(
      "@/lib/provider-endpoints/endpoint-selector"
    );

    const result = await getPreferredProviderEndpoints({ vendorId: 1, providerType: "claude" });
    expect(result).toEqual([]);

    const best = await pickBestProviderEndpoint({ vendorId: 1, providerType: "claude" });
    expect(best).toBeNull();

    expect(isOpenMock).not.toHaveBeenCalled();
  });
});

describe("getEndpointFilterStats", () => {
  test("should correctly count total, enabled, circuitOpen, and available endpoints", async () => {
    vi.resetModules();

    const endpoints: ProviderEndpoint[] = [
      makeEndpoint({ id: 1, isEnabled: true, lastProbeOk: true }),
      makeEndpoint({ id: 2, isEnabled: true, lastProbeOk: true }),
      makeEndpoint({ id: 3, isEnabled: true, lastProbeOk: false }),
      makeEndpoint({ id: 4, isEnabled: false }),
      makeEndpoint({ id: 5, deletedAt: new Date(1) }),
    ];

    const findMock = vi.fn(async () => endpoints);
    // id=2 is circuit open
    const isOpenMock = vi.fn(async (endpointId: number) => endpointId === 2);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));

    const { getEndpointFilterStats } = await import("@/lib/provider-endpoints/endpoint-selector");
    const stats = await getEndpointFilterStats({ vendorId: 10, providerType: "claude" });

    expect(findMock).toHaveBeenCalledWith(10, "claude");
    expect(stats).toEqual({
      total: 5, // all endpoints
      enabled: 3, // id=1,2,3 (isEnabled && !deletedAt)
      circuitOpen: 1, // id=2
      available: 2, // enabled - circuitOpen = 3 - 1
    });
  });

  test("should return all zeros when no endpoints exist", async () => {
    vi.resetModules();

    const findMock = vi.fn(async () => []);
    const isOpenMock = vi.fn(async () => false);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));

    const { getEndpointFilterStats } = await import("@/lib/provider-endpoints/endpoint-selector");
    const stats = await getEndpointFilterStats({ vendorId: 99, providerType: "codex" });

    expect(stats).toEqual({
      total: 0,
      enabled: 0,
      circuitOpen: 0,
      available: 0,
    });
    expect(isOpenMock).not.toHaveBeenCalled();
  });

  test("should count all enabled endpoints as circuitOpen when all are open", async () => {
    vi.resetModules();

    const endpoints: ProviderEndpoint[] = [
      makeEndpoint({ id: 1, isEnabled: true }),
      makeEndpoint({ id: 2, isEnabled: true }),
    ];

    const findMock = vi.fn(async () => endpoints);
    const isOpenMock = vi.fn(async () => true);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: true }),
    }));

    const { getEndpointFilterStats } = await import("@/lib/provider-endpoints/endpoint-selector");
    const stats = await getEndpointFilterStats({ vendorId: 1, providerType: "openai-compatible" });

    expect(stats).toEqual({
      total: 2,
      enabled: 2,
      circuitOpen: 2,
      available: 0,
    });
  });
});

describe("ENABLE_ENDPOINT_CIRCUIT_BREAKER disabled", () => {
  test("getPreferredProviderEndpoints skips circuit check when disabled", async () => {
    vi.resetModules();

    const endpoints: ProviderEndpoint[] = [
      makeEndpoint({ id: 1, lastProbeOk: true, sortOrder: 0, lastProbeLatencyMs: 100 }),
      makeEndpoint({ id: 2, lastProbeOk: true, sortOrder: 1, lastProbeLatencyMs: 50 }),
      makeEndpoint({ id: 3, lastProbeOk: false, sortOrder: 0, lastProbeLatencyMs: 10 }),
      makeEndpoint({ id: 4, isEnabled: false }),
      makeEndpoint({ id: 5, deletedAt: new Date(1) }),
    ];

    const findMock = vi.fn(async () => endpoints);
    const isOpenMock = vi.fn(async () => true);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
    }));

    const { getPreferredProviderEndpoints } = await import(
      "@/lib/provider-endpoints/endpoint-selector"
    );

    const result = await getPreferredProviderEndpoints({
      vendorId: 1,
      providerType: "claude",
    });

    expect(isOpenMock).not.toHaveBeenCalled();
    // All enabled, non-deleted endpoints returned (id=1,2,3), ranked by sortOrder/health
    expect(result.map((e) => e.id)).toEqual([1, 2, 3]);
  });

  test("getEndpointFilterStats returns circuitOpen=0 when disabled", async () => {
    vi.resetModules();

    const endpoints: ProviderEndpoint[] = [
      makeEndpoint({ id: 1, isEnabled: true, lastProbeOk: true }),
      makeEndpoint({ id: 2, isEnabled: true, lastProbeOk: false }),
      makeEndpoint({ id: 3, isEnabled: false }),
      makeEndpoint({ id: 4, deletedAt: new Date(1) }),
    ];

    const findMock = vi.fn(async () => endpoints);
    const isOpenMock = vi.fn(async () => true);

    vi.doMock("@/repository", () => ({
      findProviderEndpointsByVendorAndType: findMock,
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      isEndpointCircuitOpen: isOpenMock,
    }));
    vi.doMock("@/lib/config/env.schema", () => ({
      getEnvConfig: () => ({ ENABLE_ENDPOINT_CIRCUIT_BREAKER: false }),
    }));

    const { getEndpointFilterStats } = await import("@/lib/provider-endpoints/endpoint-selector");
    const stats = await getEndpointFilterStats({ vendorId: 10, providerType: "claude" });

    expect(isOpenMock).not.toHaveBeenCalled();
    expect(stats).toEqual({
      total: 4,
      enabled: 2, // id=1,2 (isEnabled && !deletedAt)
      circuitOpen: 0, // always 0 when disabled
      available: 2, // equals enabled when disabled
    });
  });
});
