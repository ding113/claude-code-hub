import { describe, expect, test, vi } from "vitest";

import type { Vendor, VendorEndpoint, VendorKey } from "@/types/vendor";
import { PROVIDER_GROUP } from "@/lib/constants/provider.constants";
import { selectVendorKey } from "../vendor-selector";

function makeVendor(overrides: Partial<Vendor> & Pick<Vendor, "id" | "slug" | "name">): Vendor {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    slug: overrides.slug,
    name: overrides.name,
    description: overrides.description ?? null,
    category: overrides.category ?? "official",
    isManaged: overrides.isManaged ?? false,
    isEnabled: overrides.isEnabled ?? true,
    tags: overrides.tags ?? [],
    websiteUrl: overrides.websiteUrl ?? null,
    faviconUrl: overrides.faviconUrl ?? null,
    balanceCheckEnabled: overrides.balanceCheckEnabled ?? false,
    balanceCheckEndpoint: overrides.balanceCheckEndpoint ?? null,
    balanceCheckJsonpath: overrides.balanceCheckJsonpath ?? null,
    balanceCheckIntervalSeconds: overrides.balanceCheckIntervalSeconds ?? null,
    balanceCheckLowThresholdUsd: overrides.balanceCheckLowThresholdUsd ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt,
  };
}

function makeEndpoint(
  overrides: Partial<VendorEndpoint> &
    Pick<VendorEndpoint, "id" | "vendorId" | "name" | "url" | "apiFormat">
): VendorEndpoint {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    vendorId: overrides.vendorId,
    name: overrides.name,
    url: overrides.url,
    apiFormat: overrides.apiFormat,
    isEnabled: overrides.isEnabled ?? true,
    priority: overrides.priority ?? 0,
    latencyMs: overrides.latencyMs ?? null,
    healthCheckEnabled: overrides.healthCheckEnabled ?? false,
    healthCheckEndpoint: overrides.healthCheckEndpoint ?? null,
    healthCheckIntervalSeconds: overrides.healthCheckIntervalSeconds ?? null,
    healthCheckTimeoutMs: overrides.healthCheckTimeoutMs ?? null,
    healthCheckLastCheckedAt: overrides.healthCheckLastCheckedAt ?? null,
    healthCheckLastStatusCode: overrides.healthCheckLastStatusCode ?? null,
    healthCheckErrorMessage: overrides.healthCheckErrorMessage ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt,
  };
}

function makeKey(
  overrides: Partial<VendorKey> &
    Pick<VendorKey, "id" | "vendorId" | "endpointId" | "name" | "url" | "key">
): VendorKey {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    vendorId: overrides.vendorId,
    endpointId: overrides.endpointId,
    isUserOverride: overrides.isUserOverride ?? false,
    balanceUsd: overrides.balanceUsd ?? null,
    balanceUpdatedAt: overrides.balanceUpdatedAt ?? null,
    name: overrides.name,
    description: overrides.description ?? null,
    url: overrides.url,
    key: overrides.key,
    isEnabled: overrides.isEnabled ?? true,
    weight: overrides.weight ?? 1,
    priority: overrides.priority ?? 0,
    costMultiplier: overrides.costMultiplier ?? 1,
    groupTag: overrides.groupTag ?? null,
    providerType: overrides.providerType ?? "claude",
    preserveClientIp: overrides.preserveClientIp ?? false,
    modelRedirects: overrides.modelRedirects ?? null,
    allowedModels: overrides.allowedModels ?? null,
    joinClaudePool: overrides.joinClaudePool ?? false,
    codexInstructionsStrategy: overrides.codexInstructionsStrategy ?? "auto",
    mcpPassthroughType: overrides.mcpPassthroughType ?? "none",
    mcpPassthroughUrl: overrides.mcpPassthroughUrl ?? null,
    limit5hUsd: overrides.limit5hUsd ?? null,
    limitDailyUsd: overrides.limitDailyUsd ?? null,
    dailyResetMode: overrides.dailyResetMode ?? "fixed",
    dailyResetTime: overrides.dailyResetTime ?? "00:00",
    limitWeeklyUsd: overrides.limitWeeklyUsd ?? null,
    limitMonthlyUsd: overrides.limitMonthlyUsd ?? null,
    limitConcurrentSessions: overrides.limitConcurrentSessions ?? 0,
    maxRetryAttempts: overrides.maxRetryAttempts ?? null,
    circuitBreakerFailureThreshold: overrides.circuitBreakerFailureThreshold ?? 5,
    circuitBreakerOpenDuration: overrides.circuitBreakerOpenDuration ?? 1800000,
    circuitBreakerHalfOpenSuccessThreshold: overrides.circuitBreakerHalfOpenSuccessThreshold ?? 2,
    proxyUrl: overrides.proxyUrl ?? null,
    proxyFallbackToDirect: overrides.proxyFallbackToDirect ?? false,
    firstByteTimeoutStreamingMs: overrides.firstByteTimeoutStreamingMs ?? 0,
    streamingIdleTimeoutMs: overrides.streamingIdleTimeoutMs ?? 0,
    requestTimeoutNonStreamingMs: overrides.requestTimeoutNonStreamingMs ?? 0,
    websiteUrl: overrides.websiteUrl ?? null,
    faviconUrl: overrides.faviconUrl ?? null,
    cacheTtlPreference: overrides.cacheTtlPreference ?? null,
    context1mPreference: overrides.context1mPreference ?? null,
    tpm: overrides.tpm ?? null,
    rpm: overrides.rpm ?? null,
    rpd: overrides.rpd ?? null,
    cc: overrides.cc ?? null,
    createdAt: overrides.createdAt ?? now,
    updatedAt: overrides.updatedAt ?? now,
    deletedAt: overrides.deletedAt,
  };
}

describe("vendor-selector", () => {
  test("filters by vendor enabled status (vendor layer)", async () => {
    const vendorEnabled = makeVendor({ id: 1, slug: "v1", name: "V1", isEnabled: true });
    const vendorDisabled = makeVendor({ id: 2, slug: "v2", name: "V2", isEnabled: false });

    const endpoints: VendorEndpoint[] = [
      makeEndpoint({
        id: 10,
        vendorId: vendorEnabled.id,
        name: "E1",
        url: "https://v1.example.com",
        apiFormat: "claude",
        latencyMs: 50,
      }),
      makeEndpoint({
        id: 20,
        vendorId: vendorDisabled.id,
        name: "E2",
        url: "https://v2.example.com",
        apiFormat: "claude",
        latencyMs: 10,
      }),
    ];

    const keys: VendorKey[] = [
      makeKey({
        id: 100,
        vendorId: vendorEnabled.id,
        endpointId: 10,
        name: "K1",
        url: "https://v1.example.com",
        key: "k1",
      }),
      makeKey({
        id: 200,
        vendorId: vendorDisabled.id,
        endpointId: 20,
        name: "K2",
        url: "https://v2.example.com",
        key: "k2",
      }),
    ];

    const deps = {
      isCircuitOpen: vi.fn(async () => false),
      checkCostLimits: vi.fn(async () => ({ allowed: true })),
    };

    const selected = await selectVendorKey(
      {
        vendors: [vendorEnabled, vendorDisabled],
        endpoints,
        keys,
        userGroup: null,
        targetApiFormat: "claude",
      },
      deps
    );

    expect(selected).not.toBeNull();
    expect(selected?.vendor.id).toBe(vendorEnabled.id);
  });

  test("filters vendors by group tags derived from keys (vendor layer)", async () => {
    const vendorA = makeVendor({ id: 1, slug: "a", name: "A" });
    const vendorB = makeVendor({ id: 2, slug: "b", name: "B" });

    const endpoints: VendorEndpoint[] = [
      makeEndpoint({
        id: 11,
        vendorId: vendorA.id,
        name: "EA",
        url: "https://a.example.com",
        apiFormat: "claude",
        latencyMs: 10,
      }),
      makeEndpoint({
        id: 22,
        vendorId: vendorB.id,
        name: "EB",
        url: "https://b.example.com",
        apiFormat: "claude",
        latencyMs: 10,
      }),
    ];

    const keys: VendorKey[] = [
      makeKey({
        id: 101,
        vendorId: vendorA.id,
        endpointId: 11,
        name: "KA",
        url: "https://a.example.com",
        key: "ka",
        groupTag: "chat",
      }),
      makeKey({
        id: 202,
        vendorId: vendorB.id,
        endpointId: 22,
        name: "KB",
        url: "https://b.example.com",
        key: "kb",
        groupTag: "cli",
      }),
    ];

    const deps = {
      isCircuitOpen: vi.fn(async () => false),
      checkCostLimits: vi.fn(async () => ({ allowed: true })),
    };

    const selected = await selectVendorKey(
      {
        vendors: [vendorA, vendorB],
        endpoints,
        keys,
        userGroup: "cli",
        targetApiFormat: "claude",
      },
      deps
    );

    expect(selected).not.toBeNull();
    expect(selected?.vendor.id).toBe(vendorB.id);
  });

  test("prefers healthy endpoints even if latency is worse (endpoint layer)", async () => {
    const vendor = makeVendor({ id: 1, slug: "v", name: "V" });

    const endpointUnhealthy = makeEndpoint({
      id: 11,
      vendorId: vendor.id,
      name: "Unhealthy",
      url: "https://bad.example.com",
      apiFormat: "claude",
      latencyMs: 10,
      healthCheckEnabled: true,
      healthCheckLastCheckedAt: new Date("2025-01-01T00:00:00.000Z"),
      healthCheckLastStatusCode: 500,
    });

    const endpointHealthy = makeEndpoint({
      id: 12,
      vendorId: vendor.id,
      name: "Healthy",
      url: "https://good.example.com",
      apiFormat: "claude",
      latencyMs: 50,
      healthCheckEnabled: true,
      healthCheckLastCheckedAt: new Date("2025-01-01T00:00:00.000Z"),
      healthCheckLastStatusCode: 200,
    });

    const keys: VendorKey[] = [
      makeKey({
        id: 101,
        vendorId: vendor.id,
        endpointId: endpointUnhealthy.id,
        name: "Kbad",
        url: endpointUnhealthy.url,
        key: "kbad",
      }),
      makeKey({
        id: 102,
        vendorId: vendor.id,
        endpointId: endpointHealthy.id,
        name: "Kgood",
        url: endpointHealthy.url,
        key: "kgood",
      }),
    ];

    const deps = {
      isCircuitOpen: vi.fn(async () => false),
      checkCostLimits: vi.fn(async () => ({ allowed: true })),
    };

    const selected = await selectVendorKey(
      {
        vendors: [vendor],
        endpoints: [endpointUnhealthy, endpointHealthy],
        keys,
        userGroup: PROVIDER_GROUP.DEFAULT,
        targetApiFormat: "claude",
      },
      deps
    );

    expect(selected).not.toBeNull();
    expect(selected?.endpoint.id).toBe(endpointHealthy.id);
  });

  test("selects keys by priority before weight random (key layer)", async () => {
    const vendor = makeVendor({ id: 1, slug: "v", name: "V" });
    const endpoint = makeEndpoint({
      id: 11,
      vendorId: vendor.id,
      name: "E",
      url: "https://e.example.com",
      apiFormat: "claude",
      latencyMs: 10,
    });

    const highPriorityLowWeight = makeKey({
      id: 201,
      vendorId: vendor.id,
      endpointId: endpoint.id,
      name: "K-high-priority",
      url: endpoint.url,
      key: "k1",
      priority: 0,
      weight: 1,
    });

    const lowPriorityHighWeight = makeKey({
      id: 202,
      vendorId: vendor.id,
      endpointId: endpoint.id,
      name: "K-low-priority",
      url: endpoint.url,
      key: "k2",
      priority: 1,
      weight: 100,
    });

    const deps = {
      isCircuitOpen: vi.fn(async () => false),
      checkCostLimits: vi.fn(async () => ({ allowed: true })),
    };

    const selected = await selectVendorKey(
      {
        vendors: [vendor],
        endpoints: [endpoint],
        keys: [lowPriorityHighWeight, highPriorityLowWeight],
        userGroup: null,
        targetApiFormat: "claude",
      },
      deps
    );

    expect(selected).not.toBeNull();
    expect(selected?.key.id).toBe(highPriorityLowWeight.id);
  });

  test("skips circuit-open and cost-limited keys (key layer)", async () => {
    const vendor = makeVendor({ id: 1, slug: "v", name: "V" });
    const endpoint = makeEndpoint({
      id: 11,
      vendorId: vendor.id,
      name: "E",
      url: "https://e.example.com",
      apiFormat: "claude",
    });

    const circuitOpenKey = makeKey({
      id: 301,
      vendorId: vendor.id,
      endpointId: endpoint.id,
      name: "K-circuit-open",
      url: endpoint.url,
      key: "k1",
    });

    const rateLimitedKey = makeKey({
      id: 302,
      vendorId: vendor.id,
      endpointId: endpoint.id,
      name: "K-rate-limited",
      url: endpoint.url,
      key: "k2",
    });

    const okKey = makeKey({
      id: 303,
      vendorId: vendor.id,
      endpointId: endpoint.id,
      name: "K-ok",
      url: endpoint.url,
      key: "k3",
    });

    const deps = {
      isCircuitOpen: vi.fn(async (id: number) => id === circuitOpenKey.id),
      checkCostLimits: vi.fn(async (id: number) => ({ allowed: id !== rateLimitedKey.id })),
    };

    const selected = await selectVendorKey(
      {
        vendors: [vendor],
        endpoints: [endpoint],
        keys: [circuitOpenKey, rateLimitedKey, okKey],
        userGroup: null,
        targetApiFormat: "claude",
      },
      deps
    );

    expect(selected).not.toBeNull();
    expect(selected?.key.id).toBe(okKey.id);
  });
});
