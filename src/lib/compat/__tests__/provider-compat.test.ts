import { beforeEach, describe, expect, test, vi } from "vitest";

import type { Provider } from "@/types/provider";
import type { Vendor, VendorEndpoint, VendorKey } from "@/types/vendor";
import { findAllProvidersCompat, findAllProvidersHybrid } from "../provider-compat";

vi.mock("@/repository/provider", () => ({
  findAllProviders: vi.fn(),
}));

vi.mock("@/repository/vendor", () => ({
  findAllVendors: vi.fn(),
}));

vi.mock("@/repository/vendor-endpoint", () => ({
  findVendorEndpointsByVendorId: vi.fn(),
}));

vi.mock("@/repository/vendor-key", () => ({
  countVendorKeys: vi.fn(),
  findVendorKeysByVendorAndEndpoint: vi.fn(),
}));

function makeProvider(
  overrides: Partial<Provider> & Pick<Provider, "id" | "name" | "url" | "key">
): Provider {
  const now = new Date("2025-01-01T00:00:00.000Z");
  return {
    id: overrides.id,
    name: overrides.name,
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

describe("provider-compat", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  test("maps vendor architecture into Provider[] and preserves disabled states", async () => {
    const { findAllVendors } = await import("@/repository/vendor");
    const { findVendorEndpointsByVendorId } = await import("@/repository/vendor-endpoint");
    const { findVendorKeysByVendorAndEndpoint } = await import("@/repository/vendor-key");

    const vendorEnabled = makeVendor({ id: 1, slug: "v1", name: "V1", isEnabled: true });
    const vendorDisabled = makeVendor({ id: 2, slug: "v2", name: "V2", isEnabled: false });

    const endpoint1 = makeEndpoint({
      id: 10,
      vendorId: vendorEnabled.id,
      name: "E1",
      url: "https://v1.example.com",
      apiFormat: "claude",
      isEnabled: true,
    });

    const endpoint2 = makeEndpoint({
      id: 20,
      vendorId: vendorDisabled.id,
      name: "E2",
      url: "https://v2.example.com",
      apiFormat: "claude",
      isEnabled: true,
    });

    const key1 = makeKey({
      id: 100,
      vendorId: vendorEnabled.id,
      endpointId: endpoint1.id,
      name: "K1",
      url: endpoint1.url,
      key: "k1",
      isEnabled: true,
      weight: 3,
      costMultiplier: 1.25,
    });

    const key2 = makeKey({
      id: 200,
      vendorId: vendorDisabled.id,
      endpointId: endpoint2.id,
      name: "K2",
      url: endpoint2.url,
      key: "k2",
      isEnabled: true,
      weight: 1,
      costMultiplier: 2,
    });

    vi.mocked(findAllVendors).mockResolvedValue([vendorEnabled, vendorDisabled]);
    vi.mocked(findVendorEndpointsByVendorId).mockImplementation(async (vendorId: number) => {
      if (vendorId === vendorEnabled.id) return [endpoint1];
      if (vendorId === vendorDisabled.id) return [endpoint2];
      return [];
    });

    vi.mocked(findVendorKeysByVendorAndEndpoint).mockImplementation(
      async (vendorId: number, endpointId: number) => {
        if (vendorId === vendorEnabled.id && endpointId === endpoint1.id) return [key1];
        if (vendorId === vendorDisabled.id && endpointId === endpoint2.id) return [key2];
        return [];
      }
    );

    const providers = await findAllProvidersCompat();

    expect(providers).toHaveLength(2);

    const p1 = providers.find((p) => p.id === key1.id);
    expect(p1).toBeTruthy();
    expect(p1?.isEnabled).toBe(true);
    expect(p1?.weight).toBe(3);
    expect(p1?.costMultiplier).toBe(1.25);

    const p2 = providers.find((p) => p.id === key2.id);
    expect(p2).toBeTruthy();
    expect(p2?.isEnabled).toBe(false);
    expect(p2?.weight).toBe(1);
    expect(p2?.costMultiplier).toBe(2);
  });

  test("findAllProvidersHybrid falls back to legacy providers when vendor_keys is empty", async () => {
    const { findAllProviders } = await import("@/repository/provider");
    const { findAllVendors } = await import("@/repository/vendor");
    const { countVendorKeys } = await import("@/repository/vendor-key");

    const legacyProviders: Provider[] = [
      makeProvider({
        id: 1,
        name: "Legacy Provider",
        url: "https://legacy.example.com",
        key: "legacy-key",
      }),
    ];

    vi.mocked(countVendorKeys).mockResolvedValue(0);
    vi.mocked(findAllProviders).mockResolvedValue(legacyProviders);

    const providers = await findAllProvidersHybrid();

    expect(providers).toEqual(legacyProviders);
    expect(findAllProviders).toHaveBeenCalledTimes(1);
    expect(findAllVendors).not.toHaveBeenCalled();
  });

  test("findAllProvidersHybrid uses compat providers when vendor_keys exist", async () => {
    const { findAllProviders } = await import("@/repository/provider");
    const { findAllVendors } = await import("@/repository/vendor");
    const { findVendorEndpointsByVendorId } = await import("@/repository/vendor-endpoint");
    const { countVendorKeys, findVendorKeysByVendorAndEndpoint } = await import(
      "@/repository/vendor-key"
    );

    vi.mocked(countVendorKeys).mockResolvedValue(1);
    vi.mocked(findAllProviders).mockResolvedValue([
      makeProvider({
        id: 999,
        name: "Legacy Provider",
        url: "https://legacy.example.com",
        key: "legacy-key",
      }),
    ]);

    const vendor = makeVendor({
      id: 1,
      slug: "v1",
      name: "V1",
      websiteUrl: "https://vendor.example.com",
    });

    const endpoint = makeEndpoint({
      id: 10,
      vendorId: vendor.id,
      name: "E1",
      url: "https://vendor.example.com",
      apiFormat: "claude",
    });

    const key = makeKey({
      id: 100,
      vendorId: vendor.id,
      endpointId: endpoint.id,
      name: "K1",
      url: endpoint.url,
      key: "k1",
      websiteUrl: null,
    });

    vi.mocked(findAllVendors).mockResolvedValue([vendor]);
    vi.mocked(findVendorEndpointsByVendorId).mockResolvedValue([endpoint]);
    vi.mocked(findVendorKeysByVendorAndEndpoint).mockResolvedValue([key]);

    const providers = await findAllProvidersHybrid();

    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe(key.id);
    expect(providers[0]?.name).toBe(key.name);
    expect(providers[0]?.url).toBe(key.url);
    expect(providers[0]?.key).toBe(key.key);
    expect(providers[0]?.websiteUrl).toBe(vendor.websiteUrl);

    expect(findAllProviders).not.toHaveBeenCalled();
  });
});
