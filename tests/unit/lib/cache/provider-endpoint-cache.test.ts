import { beforeEach, describe, expect, test, vi } from "vitest";
import type { ProviderEndpoint } from "@/types/provider";

const envState = vi.hoisted(() => ({ ENABLE_PROVIDER_CACHE: true }));
const pubsubMocks = vi.hoisted(() => ({
  callbacks: new Map<string, (message: string) => void>(),
  publishCacheInvalidation: vi.fn(async () => undefined),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => envState,
  isDevelopment: () => false,
}));
vi.mock("@/lib/config", () => ({
  getEnvConfig: () => envState,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_PROVIDERS_UPDATED: "cch:cache:providers:updated",
  CHANNEL_PROVIDER_ENDPOINTS_UPDATED: "cch:cache:provider_endpoints:updated",
  publishCacheInvalidation: pubsubMocks.publishCacheInvalidation,
  subscribeCacheInvalidation: vi.fn(async (channel: string, callback: (m: string) => void) => {
    pubsubMocks.callbacks.set(channel, callback);
    return () => undefined;
  }),
}));

import {
  getCachedProviderEndpoints,
  getProviderEndpointCacheStats,
  invalidateProviderEndpointCache,
  publishProviderEndpointCacheInvalidation,
  resetProviderEndpointCacheForTests,
} from "@/lib/cache/provider-endpoint-cache";
import { publishProviderCacheInvalidation } from "@/lib/cache/provider-cache";

function makeEndpoint(id: number, overrides: Partial<ProviderEndpoint> = {}): ProviderEndpoint {
  return {
    id,
    vendorId: 1,
    providerType: "claude",
    url: `https://e${id}.example.com`,
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

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("provider endpoint cache", () => {
  beforeEach(() => {
    envState.ENABLE_PROVIDER_CACHE = true;
    pubsubMocks.callbacks.clear();
    pubsubMocks.publishCacheInvalidation.mockClear();
    resetProviderEndpointCacheForTests();
  });

  test("caches per vendor and provider type", async () => {
    const claudeFetcher = vi.fn(async () => [makeEndpoint(1)]);
    const codexFetcher = vi.fn(async () => [makeEndpoint(2, { providerType: "codex" })]);

    await getCachedProviderEndpoints(1, "claude", claudeFetcher);
    await getCachedProviderEndpoints(1, "claude", claudeFetcher);
    await getCachedProviderEndpoints(1, "codex", codexFetcher);
    await getCachedProviderEndpoints(2, "claude", claudeFetcher);

    expect(claudeFetcher).toHaveBeenCalledTimes(2);
    expect(codexFetcher).toHaveBeenCalledTimes(1);
    expect(getProviderEndpointCacheStats().size).toBe(3);
  });

  test("goes to the database on every call when ENABLE_PROVIDER_CACHE is false", async () => {
    envState.ENABLE_PROVIDER_CACHE = false;
    const fetcher = vi.fn(async () => [makeEndpoint(1)]);

    await getCachedProviderEndpoints(1, "claude", fetcher);
    await getCachedProviderEndpoints(1, "claude", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("invalidates on both the endpoint and provider channels", async () => {
    const fetcher = vi.fn(async () => [makeEndpoint(1)]);
    await getCachedProviderEndpoints(1, "claude", fetcher);
    await flushMicrotasks();

    pubsubMocks.callbacks.get("cch:cache:provider_endpoints:updated")?.("1");
    await getCachedProviderEndpoints(1, "claude", fetcher);
    pubsubMocks.callbacks.get("cch:cache:providers:updated")?.("1");
    await getCachedProviderEndpoints(1, "claude", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  test("local and published invalidation clear the cache", async () => {
    const fetcher = vi.fn(async () => [makeEndpoint(1)]);

    await getCachedProviderEndpoints(1, "claude", fetcher);
    invalidateProviderEndpointCache();
    await getCachedProviderEndpoints(1, "claude", fetcher);
    await publishProviderEndpointCacheInvalidation();
    await getCachedProviderEndpoints(1, "claude", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(pubsubMocks.publishCacheInvalidation).toHaveBeenCalledWith(
      "cch:cache:provider_endpoints:updated"
    );
  });

  test("publishing a provider invalidation also clears this process's endpoint cache", async () => {
    const fetcher = vi.fn(async () => [makeEndpoint(1)]);

    await getCachedProviderEndpoints(1, "claude", fetcher);
    await publishProviderCacheInvalidation();
    await getCachedProviderEndpoints(1, "claude", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});

describe("getPreferredProviderEndpoints with the endpoint cache", () => {
  test("serves repeated selections from one query and never reorders the cached array", async () => {
    vi.resetModules();
    const cached = [
      makeEndpoint(30, { lastProbeOk: false }),
      makeEndpoint(10, { lastProbeOk: true }),
      makeEndpoint(20, { lastProbeOk: null }),
    ];
    const findEnabled = vi.fn(async () => cached);
    vi.doMock("@/repository", () => ({
      findEnabledProviderEndpointsByVendorAndType: findEnabled,
      findProviderEndpointsByVendorAndType: vi.fn(),
    }));
    vi.doMock("@/lib/endpoint-circuit-breaker", () => ({
      getAllEndpointHealthStatusAsync: vi.fn(async () => ({})),
    }));
    envState.ENABLE_PROVIDER_CACHE = true;
    const cacheModule = await import("@/lib/cache/provider-endpoint-cache");
    cacheModule.resetProviderEndpointCacheForTests();
    const { getPreferredProviderEndpoints } = await import(
      "@/lib/provider-endpoints/endpoint-selector"
    );

    const first = await getPreferredProviderEndpoints({ vendorId: 9, providerType: "claude" });
    const second = await getPreferredProviderEndpoints({
      vendorId: 9,
      providerType: "claude",
      excludeEndpointIds: [10],
    });

    expect(findEnabled).toHaveBeenCalledTimes(1);
    expect(first.map((e) => e.id)).toEqual([10, 20, 30]);
    expect(second.map((e) => e.id)).toEqual([20, 30]);
    expect(cached.map((e) => e.id)).toEqual([30, 10, 20]);
  });
});
