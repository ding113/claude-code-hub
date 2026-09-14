import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const pubsubMocks = vi.hoisted(() => ({
  callbacks: new Map<string, (message: string) => void>(),
  subscribeResult: "cleanup" as "cleanup" | "null" | "throw",
  subscribeCacheInvalidation: vi.fn(),
}));

vi.mock("@/lib/redis/pubsub", () => ({
  subscribeCacheInvalidation: pubsubMocks.subscribeCacheInvalidation,
}));

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { createKeyedRefreshCache } from "@/lib/cache/keyed-refresh-cache";

function createCache(overrides: { enabled?: () => boolean; ttlMs?: number } = {}) {
  return createKeyedRefreshCache<string | null>({
    name: "TestCache",
    ttlMs: overrides.ttlMs ?? 1_000,
    maxSize: 10,
    invalidationChannels: ["channel:a", "channel:b"],
    isEnabled: overrides.enabled ?? (() => true),
  });
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) await Promise.resolve();
}

describe("createKeyedRefreshCache", () => {
  const originalCi = process.env.CI;

  beforeEach(() => {
    delete process.env.CI;
    pubsubMocks.callbacks.clear();
    pubsubMocks.subscribeResult = "cleanup";
    pubsubMocks.subscribeCacheInvalidation.mockReset();
    pubsubMocks.subscribeCacheInvalidation.mockImplementation(
      async (channel: string, callback: (message: string) => void) => {
        if (pubsubMocks.subscribeResult === "throw") throw new Error("subscribe failed");
        if (pubsubMocks.subscribeResult === "null") return null;
        pubsubMocks.callbacks.set(channel, callback);
        return () => pubsubMocks.callbacks.delete(channel);
      }
    );
  });

  afterEach(() => {
    vi.useRealTimers();
    if (originalCi === undefined) delete process.env.CI;
    else process.env.CI = originalCi;
  });

  test("serves repeated reads from cache until the TTL expires", async () => {
    vi.useFakeTimers();
    const cache = createCache({ ttlMs: 1_000 });
    const fetcher = vi.fn(async () => "value");

    await expect(cache.get("k", fetcher)).resolves.toBe("value");
    await expect(cache.get("k", fetcher)).resolves.toBe("value");
    expect(fetcher).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1_001);
    await expect(cache.get("k", fetcher)).resolves.toBe("value");
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  test("caches null results as negative entries", async () => {
    const cache = createCache();
    const fetcher = vi.fn(async () => null);

    await expect(cache.get("missing", fetcher)).resolves.toBeNull();
    await expect(cache.get("missing", fetcher)).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  test("shares one in-flight fetch between concurrent misses for the same key", async () => {
    const cache = createCache();
    let resolveFetch!: (value: string) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveFetch = resolve;
        })
    );

    const first = cache.get("k", fetcher);
    const second = cache.get("k", fetcher);
    await flushMicrotasks();
    expect(cache.getStats().inFlight).toBe(1);
    resolveFetch("shared");

    await expect(Promise.all([first, second])).resolves.toEqual(["shared", "shared"]);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(cache.getStats().inFlight).toBe(0);
  });

  test("does not cache failures, including synchronous fetcher throws", async () => {
    const cache = createCache();
    const asyncFailure = vi.fn(async () => {
      throw new Error("db down");
    });
    const syncFailure = vi.fn(() => {
      throw new Error("sync failure");
    }) as unknown as () => Promise<string>;

    await expect(cache.get("k", asyncFailure)).rejects.toThrow("db down");
    await expect(cache.get("s", syncFailure)).rejects.toThrow("sync failure");
    expect(cache.getStats()).toMatchObject({ size: 0, inFlight: 0 });

    const recovered = vi.fn(async () => "ok");
    await expect(cache.get("k", recovered)).resolves.toBe("ok");
    await expect(cache.get("s", recovered)).resolves.toBe("ok");
    expect(recovered).toHaveBeenCalledTimes(2);
  });

  test("a fetch that started before invalidation does not repopulate the cache", async () => {
    const cache = createCache();
    let resolveStale!: (value: string) => void;
    const staleFetcher = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          resolveStale = resolve;
        })
    );

    const stalePromise = cache.get("k", staleFetcher);
    await flushMicrotasks();
    cache.invalidate();
    resolveStale("stale");
    await expect(stalePromise).resolves.toBe("stale");

    const freshFetcher = vi.fn(async () => "fresh");
    await expect(cache.get("k", freshFetcher)).resolves.toBe("fresh");
    expect(freshFetcher).toHaveBeenCalledTimes(1);
  });

  test("bypasses the cache entirely when disabled", async () => {
    const cache = createCache({ enabled: () => false });
    const fetcher = vi.fn(async () => "direct");

    await cache.get("k", fetcher);
    await cache.get("k", fetcher);

    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(pubsubMocks.subscribeCacheInvalidation).not.toHaveBeenCalled();
  });

  test("clears all entries when any invalidation channel publishes, including RESYNC", async () => {
    const cache = createCache();
    const fetcher = vi.fn(async () => "value");

    await cache.get("k1", fetcher);
    await flushMicrotasks();
    expect(pubsubMocks.subscribeCacheInvalidation).toHaveBeenCalledTimes(2);
    expect(cache.getStats().subscribed).toBe(true);

    pubsubMocks.callbacks.get("channel:b")?.("cch:cache:resync");
    expect(cache.getStats().size).toBe(0);

    await cache.get("k1", fetcher);
    expect(fetcher).toHaveBeenCalledTimes(2);

    pubsubMocks.callbacks.get("channel:a")?.("1");
    expect(cache.getStats().size).toBe(0);
  });

  test("subscribes only once even when Redis is not configured", async () => {
    pubsubMocks.subscribeResult = "null";
    const cache = createCache();

    await cache.get("a", async () => "1");
    await flushMicrotasks();
    await cache.get("b", async () => "2");
    await flushMicrotasks();

    expect(pubsubMocks.subscribeCacheInvalidation).toHaveBeenCalledTimes(2);
    expect(cache.getStats().subscribed).toBe(true);
  });

  test("retries subscription on a later call after a subscription error", async () => {
    pubsubMocks.subscribeResult = "throw";
    const cache = createCache();

    await cache.get("a", async () => "1");
    await flushMicrotasks();
    expect(cache.getStats().subscribed).toBe(false);

    pubsubMocks.subscribeResult = "cleanup";
    await cache.get("b", async () => "2");
    await flushMicrotasks();
    expect(cache.getStats().subscribed).toBe(true);
  });

  test("skips pub/sub subscription in CI builds", async () => {
    process.env.CI = "true";
    const cache = createCache();

    await cache.get("a", async () => "1");

    expect(pubsubMocks.subscribeCacheInvalidation).not.toHaveBeenCalled();
    expect(cache.getStats().subscribed).toBe(true);
  });

  test("resetForTests clears data and subscription state", async () => {
    const cache = createCache();
    await cache.get("a", async () => "1");
    await flushMicrotasks();

    cache.resetForTests();

    expect(cache.getStats()).toMatchObject({ size: 0, inFlight: 0, subscribed: false });
  });
});
