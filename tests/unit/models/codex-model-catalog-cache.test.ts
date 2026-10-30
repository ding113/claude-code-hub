import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CodexCatalogSource } from "@/app/v1/_lib/models/codex-model-catalog-fetcher";
import {
  CHANNEL_CODEX_MODEL_CATALOG_UPDATED,
  CodexModelCatalogCache,
  type CodexModelCatalogCacheDependencies,
  getCachedCodexModelCatalog,
  startCodexModelCatalogScheduler,
  stopCodexModelCatalogScheduler,
} from "@/lib/cache/codex-model-catalog-cache";
import type { CodexModelInfo } from "@/lib/codex-model-catalog";
import { logger } from "@/lib/logger";
import type { Provider } from "@/types/provider";

const defaults = vi.hoisted(() => ({
  redis: vi.fn(() => null),
  fetchCatalog: vi.fn(),
  prepareSource: vi.fn(),
  findProviders: vi.fn(async () => []),
  subscribe: vi.fn(async () => null),
  register: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/logger", () => ({ logger: { warn: vi.fn(), info: vi.fn() } }));
vi.mock("@/lib/redis/client", () => ({ getRedisClient: defaults.redis }));
vi.mock("@/lib/redis/pubsub", () => ({ subscribeCacheInvalidation: defaults.subscribe }));
vi.mock("@/lib/cache/provider-cache", () => ({
  CHANNEL_PROVIDERS_UPDATED: "cch:cache:providers:updated",
}));
vi.mock("@/lib/async-task-manager", () => ({
  AsyncTaskManager: { register: defaults.register },
}));
vi.mock("@/repository/provider", () => ({ findAllProvidersFresh: defaults.findProviders }));
vi.mock("@/app/v1/_lib/models/codex-model-catalog-fetcher", () => ({
  fetchCodexModelCatalog: defaults.fetchCatalog,
  prepareCodexModelCatalogSource: defaults.prepareSource,
}));

function model(slug = "gpt-6.1-terra"): CodexModelInfo {
  return { slug, display_name: slug, visibility: "list" };
}

function source(key = "source-1", providerId = 1, dynamicHeaders = false): CodexCatalogSource {
  return {
    key,
    providerId,
    clientVersion: "0.164.0",
    dynamicHeaders,
    provider: { id: providerId, providerType: "codex", isEnabled: true } as Provider,
    url: "https://catalog.example/v1/models",
    headers: { Authorization: "Bearer test-provider-secret" },
    timeoutMs: 4_000,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flush() {
  for (let i = 0; i < 30; i++) await Promise.resolve();
}

/** Model the atomic Redis primitives, including ownership and source revocation fences. */
class FakeRedis {
  status = "ready";
  data = new Map<string, string>();
  registry = new Map<string, string>();
  epochs = new Map<string, string>();
  locks = new Map<string, { owner: string; until: number }>();
  publications: Array<{ channel: string; message: string }> = [];

  eval = vi.fn(async (script: string, keyCount: number, ...args: string[]): Promise<unknown> => {
    const keys = args.slice(0, keyCount);
    const values = args.slice(keyCount);
    if (script.startsWith("-- codex-catalog:read")) {
      if (values[4] === "1") {
        this.registry.delete(values[0]);
        this.registry.set(values[0], values[1]);
        while (this.registry.size > 128) {
          const oldest = this.registry.keys().next().value as string;
          this.registry.delete(oldest);
          this.data.delete(oldest);
        }
      }
      return [this.data.get(values[0]) ?? "", this.epochs.get(values[3]) ?? "0"];
    }
    if (script.startsWith("-- codex-catalog:acquire")) {
      const lock = this.locks.get(keys[0]);
      if (lock && lock.until > Date.now()) return [0, this.epochs.get(values[2]) ?? "0"];
      this.locks.set(keys[0], { owner: values[0], until: Date.now() + Number(values[1]) });
      return [1, this.epochs.get(values[2]) ?? "0", this.data.get(values[3]) ?? ""];
    }
    if (script.startsWith("-- codex-catalog:store")) {
      if (
        this.locks.get(keys[4])?.owner !== values[2] ||
        (this.epochs.get(values[3]) ?? "0") !== values[4] ||
        !this.registry.has(values[0])
      ) {
        return 0;
      }
      this.data.set(values[0], values[1]);
      this.publications.push({ channel: values[5], message: values[6] });
      return 1;
    }
    if (script.startsWith("-- codex-catalog:revoke")) {
      this.epochs.set(values[0], values[1]);
      for (const [key, raw] of this.registry) {
        if (String(JSON.parse(raw).providerId) === values[0]) this.data.delete(key);
      }
      this.publications.push({ channel: values[2], message: values[3] });
      return 1;
    }
    if (script.startsWith("-- codex-catalog:release")) {
      const lock = this.locks.get(keys[0]);
      if (lock?.owner !== values[0]) return 0;
      if (values[1] === "0") this.locks.delete(keys[0]);
      else lock.until = Date.now() + Number(values[1]);
      return 1;
    }
    if (script.startsWith("-- codex-catalog:registry")) return [...this.registry.values()];
    throw new Error("Unexpected Redis operation");
  });
}

function harness(
  redis: FakeRedis | null = null,
  overrides: Partial<CodexModelCatalogCacheDependencies> = {}
) {
  const fetchCatalog = vi.fn(async (_source: CodexCatalogSource, _signal?: AbortSignal) => ({
    ok: true as const,
    models: [model()],
    bytes: 100,
    elapsedMs: 1,
  }));
  const callbacks = new Map<string, (message: string) => void>();
  const cleanup = vi.fn();
  const subscribe = vi.fn(async (channel: string, callback: (message: string) => void) => {
    callbacks.set(channel, callback);
    return cleanup;
  });
  const registerTask = vi.fn(
    (_id: string, factory: (signal: AbortSignal) => Promise<void>, controller: AbortController) => {
      void factory(controller.signal);
    }
  );
  const findProviders = vi.fn(async (): Promise<Provider[]> => [source().provider]);
  const prepareSource = vi.fn((provider: Provider, _version: string) =>
    source(`source-${provider.id}`, provider.id)
  );
  const backgroundOwner = vi.fn(() => true);
  const cache = new CodexModelCatalogCache({
    now: () => Date.now(),
    redis: () => redis,
    fetchCatalog,
    registerTask,
    findProviders,
    prepareSource,
    subscribe,
    backgroundOwner,
    ...overrides,
  });
  caches.push(cache);
  return {
    cache,
    fetchCatalog,
    registerTask,
    findProviders,
    prepareSource,
    subscribe,
    backgroundOwner,
    callbacks,
    cleanup,
  };
}

const caches: CodexModelCatalogCache[] = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-27T12:00:00Z"));
  vi.stubEnv("CI", "false");
});

afterEach(() => {
  for (const cache of caches.splice(0)) cache.stop();
  delete (globalThis as Record<string, unknown>).__CCH_CODEX_MODEL_CATALOG_CACHE__;
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("native catalog snapshots", () => {
  it("returns a successful cold fetch, then serves the fresh snapshot without upstream traffic", async () => {
    const { cache, fetchCatalog } = harness();
    const first = await cache.get(source());
    expect(first).toMatchObject({ state: "refreshed", models: [model()] });
    expect(await cache.get(source())).toMatchObject({
      state: "fresh",
      fetchedAt: first?.fetchedAt,
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("treats a successful empty directory as a real snapshot", async () => {
    const { cache, fetchCatalog } = harness();
    fetchCatalog.mockResolvedValue({ ok: true, models: [], bytes: 13, elapsedMs: 1 });
    expect(await cache.get(source())).toMatchObject({ models: [], state: "refreshed" });
    expect(await cache.get(source())).toMatchObject({ models: [], state: "fresh" });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("returns stale immediately while refreshing and replaces it with an authoritative empty directory", async () => {
    const { cache, fetchCatalog } = harness();
    const first = await cache.get(source());
    vi.setSystemTime(Date.now() + 300_000);
    const refresh = deferred<Awaited<ReturnType<typeof fetchCatalog>>>();
    fetchCatalog.mockReturnValue(refresh.promise);
    expect(await cache.get(source())).toMatchObject({
      state: "stale",
      fetchedAt: first?.fetchedAt,
    });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    refresh.resolve({ ok: true, models: [], bytes: 13, elapsedMs: 1 });
    await flush();
    expect(await cache.get(source())).toMatchObject({ state: "fresh", models: [] });
  });

  it("does not renew last-good freshness when the upstream fails", async () => {
    const { cache, fetchCatalog } = harness();
    const first = await cache.get(source());
    vi.setSystemTime(Date.now() + 300_000);
    fetchCatalog.mockResolvedValue({ ok: false, reason: "timeout" } as never);
    expect(await cache.get(source())).toMatchObject({
      state: "stale",
      fetchedAt: first?.fetchedAt,
    });
    await flush();
    expect(await cache.get(source())).toMatchObject({ fetchedAt: first?.fetchedAt });
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    vi.setSystemTime((first?.fetchedAt ?? 0) + 86_400_001);
    expect(await cache.get(source())).toBeNull();
  });

  it("deduplicates concurrent cold requests in a worker", async () => {
    const { cache, fetchCatalog } = harness();
    const response = deferred<Awaited<ReturnType<typeof fetchCatalog>>>();
    fetchCatalog.mockReturnValue(response.promise);
    const pending = [cache.get(source()), cache.get(source()), cache.get(source())];
    await flush();
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    response.resolve({ ok: true, models: [model()], bytes: 100, elapsedMs: 1 });
    expect((await Promise.all(pending)).every((snapshot) => snapshot?.models.length === 1)).toBe(
      true
    );
  });

  it("bounds a cold wait at two seconds while allowing the managed refresh to complete", async () => {
    const { cache, fetchCatalog } = harness();
    const response = deferred<Awaited<ReturnType<typeof fetchCatalog>>>();
    fetchCatalog.mockReturnValue(response.promise);
    const pending = cache.get(source());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    response.resolve({ ok: true, models: [model()], bytes: 100, elapsedMs: 3_000 });
    await flush();
    expect(await cache.get(source())).toMatchObject({ state: "fresh" });
  });

  it("keeps client versions and resolved header variants isolated", async () => {
    const { cache, fetchCatalog } = harness();
    await cache.get(source());
    const otherVersion = { ...source("version-2"), clientVersion: "0.165.0" };
    await cache.get(otherVersion);
    await cache.get({ ...source("header-b", 1, true), headers: { "x-account": "account-b" } });
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("evicts the least recently used local entry at 64 variants", async () => {
    const { cache, fetchCatalog } = harness();
    for (let index = 0; index < 64; index++) await cache.get(source(`variant-${index}`));
    await cache.get(source("variant-0"));
    await cache.get(source("variant-64"));
    await cache.get(source("variant-0"));
    expect(fetchCatalog).toHaveBeenCalledTimes(65);
    await cache.get(source("variant-1"));
    expect(fetchCatalog).toHaveBeenCalledTimes(66);
  });

  it("bounds the local model payload bytes as well as the entry count", async () => {
    const { cache, fetchCatalog } = harness();
    const largeModel = { ...model(), instructions: "x".repeat(2 * 1024 * 1024) };
    fetchCatalog.mockResolvedValue({
      ok: true,
      models: [largeModel],
      bytes: 2_100_000,
      elapsedMs: 1,
    });
    for (let index = 0; index < 17; index++) await cache.get(source(`large-${index}`));
    await cache.get(source("large-0"));
    expect(fetchCatalog).toHaveBeenCalledTimes(18);
  });
});

describe("shared Redis state and failure budgets", () => {
  it("persists both sources when simultaneous fetch completions contend with a healthy read", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    const reader = source("reader", 3);
    await cache.get(reader);
    vi.setSystemTime(Date.now() + 5_001);
    const evaluate = redis.eval.getMockImplementation();
    redis.eval.mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => setTimeout(resolve, 10));
      return evaluate?.(...args);
    });
    const firstSource = source("simultaneous-a", 1);
    const secondSource = source("simultaneous-b", 2);
    const firstResult = deferred<Awaited<ReturnType<typeof fetchCatalog>>>();
    const secondResult = deferred<Awaited<ReturnType<typeof fetchCatalog>>>();
    fetchCatalog.mockImplementation((candidate) =>
      candidate.key === firstSource.key ? firstResult.promise : secondResult.promise
    );
    const first = cache.get(firstSource);
    const second = cache.get(secondSource);
    await vi.advanceTimersByTimeAsync(100);
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
    firstResult.resolve({ ok: true, models: [model("first")], bytes: 100, elapsedMs: 1 });
    secondResult.resolve({ ok: true, models: [model("second")], bytes: 100, elapsedMs: 1 });
    const competingRead = cache.get(reader);
    await vi.advanceTimersByTimeAsync(150);
    const firstSnapshot = await first;
    const secondSnapshot = await second;
    expect(await competingRead).not.toBeNull();
    expect(firstSnapshot).not.toBeNull();
    expect(secondSnapshot).not.toBeNull();
    expect(JSON.parse(redis.data.get(firstSource.key) ?? "null")).toMatchObject({
      models: [model("first")],
      fetchedAt: firstSnapshot?.fetchedAt,
    });
    expect(JSON.parse(redis.data.get(secondSource.key) ?? "null")).toMatchObject({
      models: [model("second")],
      fetchedAt: secondSnapshot?.fetchedAt,
    });
    expect(redis.locks.size).toBe(0);
  });

  it("keeps a newer memory fallback when Redis still has an older same-epoch snapshot", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    const initial = await cache.get(source());
    const evaluate = redis.eval.getMockImplementation();
    let failStore = true;
    redis.eval.mockImplementation(async (...args) => {
      if (args[0].startsWith("-- codex-catalog:store") && failStore) {
        failStore = false;
        throw new Error("Redis write connection lost");
      }
      return evaluate?.(...args);
    });
    vi.setSystemTime(Date.now() + 300_000);
    fetchCatalog.mockResolvedValue({
      ok: true,
      models: [model("newer")],
      bytes: 100,
      elapsedMs: 1,
    });
    expect(await cache.get(source())).toMatchObject({ state: "stale" });
    await flush();
    expect(logger.info).toHaveBeenLastCalledWith(
      "[CodexModelCatalogCache] Source refreshed",
      expect.objectContaining({ persistence: "memory" })
    );
    expect(JSON.parse(redis.data.get("source-1") ?? "null").fetchedAt).toBe(initial?.fetchedAt);
    vi.setSystemTime(Date.now() + 5_001);
    const memory = await cache.get(source());
    expect(memory).toMatchObject({ models: [model("newer")], state: "fresh" });
    expect(memory?.fetchedAt).toBeGreaterThan(initial?.fetchedAt ?? 0);
    expect(fetchCatalog).toHaveBeenCalledTimes(2);

    // An authoritative epoch change still invalidates that newer memory-only result.
    redis.epochs.set("1", "remote-revocation");
    vi.setSystemTime(Date.now() + 15_001);
    fetchCatalog.mockResolvedValue({ ok: false, reason: "http_403", status: 403 } as never);
    expect(await cache.get(source())).toBeNull();
  });

  it("includes healthy admission waiting within the 200ms Redis budget", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    const evaluate = redis.eval.getMockImplementation();
    const heldRead = deferred<unknown>();
    let reads = 0;
    redis.eval.mockImplementation(async (...args) => {
      if (args[0].startsWith("-- codex-catalog:read")) {
        reads++;
        if (reads === 1) await new Promise<void>((resolve) => setTimeout(resolve, 150));
        else return heldRead.promise;
      }
      return evaluate?.(...args);
    });
    const first = cache.get(source("admission-first"));
    const second = cache.get(source("admission-second"));
    await vi.advanceTimersByTimeAsync(200);
    expect(await second).toMatchObject({ state: "refreshed" });
    expect(redis.eval).toHaveBeenCalledTimes(2);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(200);
    expect(await first).toMatchObject({ state: "refreshed" });
    heldRead.resolve(["", "0"]);
    await flush();
    expect(redis.eval).toHaveBeenCalledTimes(2);
  });

  it("shares snapshots between workers without exposing credentials in the active registry", async () => {
    const redis = new FakeRedis();
    const first = harness(redis);
    await first.cache.get(source());
    const second = harness(redis);
    expect(await second.cache.get(source())).toMatchObject({ state: "fresh", models: [model()] });
    expect(second.fetchCatalog).not.toHaveBeenCalled();
    const persisted = [...redis.registry.values()].join("");
    expect(persisted).toContain("0.164.0");
    expect(persisted).not.toMatch(/test-provider-secret|Authorization|https:/);
  });

  it("lets only one worker fetch a shared cold source", async () => {
    const redis = new FakeRedis();
    const first = harness(redis);
    const second = harness(redis);
    const response = deferred<Awaited<ReturnType<typeof first.fetchCatalog>>>();
    first.fetchCatalog.mockReturnValue(response.promise);
    const one = first.cache.get(source());
    await flush();
    const two = second.cache.get(source());
    await flush();
    expect(first.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(second.fetchCatalog).not.toHaveBeenCalled();
    response.resolve({ ok: true, models: [model()], bytes: 100, elapsedMs: 1 });
    await vi.advanceTimersByTimeAsync(100);
    expect(await one).not.toBeNull();
    expect(await two).not.toBeNull();
  });

  it("reuses a source published by another worker between the cache read and lock acquisition", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    const evaluate = redis.eval.getMockImplementation();
    redis.eval.mockImplementation(async (...args) => {
      if (args[0].startsWith("-- codex-catalog:acquire")) {
        redis.data.set(
          "source-1",
          JSON.stringify({ models: [model("other-worker")], fetchedAt: Date.now(), epoch: "0" })
        );
      }
      return evaluate?.(...args);
    });
    expect(await cache.get(source())).toMatchObject({ models: [model("other-worker")] });
    expect(fetchCatalog).not.toHaveBeenCalled();
    expect(redis.locks.size).toBe(0);
  });

  it("limits global variants to 128 and touches reads in LRU order", async () => {
    const redis = new FakeRedis();
    const { cache } = harness(redis);
    for (let index = 0; index < 128; index++) await cache.get(source(`shared-${index}`));
    await cache.get(source("shared-0"));
    await cache.get(source("shared-128"));
    expect(redis.registry.size).toBe(128);
    expect(redis.data.size).toBe(128);
    expect(redis.registry.has("shared-0")).toBe(true);
    expect(redis.registry.has("shared-1")).toBe(false);
  });

  it("rejects corrupt or expired Redis snapshots instead of publishing them", async () => {
    const redis = new FakeRedis();
    redis.data.set("source-1", "not-json");
    const { cache, fetchCatalog } = harness(redis);
    expect(await cache.get(source())).toMatchObject({ state: "refreshed" });
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    const other = source("bad-snapshot");
    redis.data.set(other.key, JSON.stringify({ fetchedAt: "invalid", models: [] }));
    expect(await cache.get(other)).toMatchObject({ state: "refreshed" });
  });

  it("uses memory when Redis is disconnected or errors", async () => {
    const redis = new FakeRedis();
    redis.status = "connecting";
    const first = harness(redis);
    expect(await first.cache.get(source())).toMatchObject({ state: "refreshed" });
    expect(redis.eval).not.toHaveBeenCalled();
    redis.status = "ready";
    redis.eval.mockRejectedValue(new Error("offline"));
    const second = harness(redis);
    expect(await second.cache.get(source())).toMatchObject({ state: "refreshed" });
    expect(second.fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("never queues additional Redis operations behind a black-holed command", async () => {
    const redis = new FakeRedis();
    redis.eval.mockReturnValue(new Promise(() => {}));
    const { cache, fetchCatalog } = harness(redis);
    const one = cache.get(source());
    await vi.advanceTimersByTimeAsync(200);
    await vi.advanceTimersByTimeAsync(1_800);
    expect(await one).toMatchObject({ state: "refreshed" });
    expect(redis.eval).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
    const two = cache.get(source("other"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await two).toMatchObject({ state: "refreshed" });
    expect(redis.eval).toHaveBeenCalledTimes(1);
  });

  it("serves a local last-good snapshot within 200ms when Redis stops replying", async () => {
    const redis = new FakeRedis();
    const { cache } = harness(redis);
    await cache.get(source());
    vi.setSystemTime(Date.now() + 300_000);
    redis.eval.mockReturnValue(new Promise(() => {}));
    const pending = cache.get(source());
    await vi.advanceTimersByTimeAsync(200);
    expect(await pending).toMatchObject({ state: "stale" });
    expect(
      redis.eval.mock.calls.filter(([script]) => script.includes("codex-catalog:read"))
    ).toHaveLength(2);
  });

  it("does not overwrite a snapshot after losing the distributed lock", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    fetchCatalog.mockImplementation(async () => {
      for (const lock of redis.locks.values()) lock.owner = "replacement-owner";
      return { ok: true, models: [model()], bytes: 100, elapsedMs: 1 };
    });
    const pending = cache.get(source());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    expect(redis.data.has("source-1")).toBe(false);
  });
});

describe("authoritative access revocations", () => {
  it("invalidates every variant for a provider on 401 and does not retain stale directories", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    await cache.get(source());
    await cache.get(source("other-variant"));
    await cache.get(source("other-provider", 2));
    vi.setSystemTime(Date.now() + 300_000);
    fetchCatalog.mockResolvedValue({
      ok: false,
      reason: "http_401",
      status: 401,
      unauthorized: true,
    } as never);
    expect(await cache.get(source())).toMatchObject({ state: "stale" });
    await flush();
    expect(redis.data.has("source-1")).toBe(false);
    expect(redis.data.has("other-variant")).toBe(false);
    expect(redis.data.has("other-provider")).toBe(true);
    expect(await cache.get(source())).toBeNull();
    expect(redis.epochs.has("1")).toBe(true);
  });

  it("fences an older in-flight success when another variant returns 403", async () => {
    const redis = new FakeRedis();
    const first = harness(redis);
    const second = harness(redis);
    const response = deferred<Awaited<ReturnType<typeof first.fetchCatalog>>>();
    first.fetchCatalog.mockReturnValue(response.promise);
    const old = first.cache.get(source());
    await flush();
    second.fetchCatalog.mockResolvedValue({ ok: false, reason: "http_403", status: 403 } as never);
    expect(await second.cache.get(source("variant-b"))).toBeNull();
    response.resolve({ ok: true, models: [model()], bytes: 100, elapsedMs: 1 });
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await old).toBeNull();
    expect(redis.data.has("source-1")).toBe(false);
  });

  it("replays a pending tombstone after Redis recovers, before loading old shared data", async () => {
    const redis = new FakeRedis();
    const { cache, fetchCatalog } = harness(redis);
    await cache.get(source());
    redis.status = "end";
    vi.setSystemTime(Date.now() + 300_000);
    fetchCatalog.mockResolvedValue({ ok: false, reason: "http_401", status: 401 } as never);
    await cache.get(source());
    await flush();
    redis.status = "ready";
    expect(await cache.get(source())).toBeNull();
    expect(redis.data.has("source-1")).toBe(false);
  });

  describe("pending revocation boundary", () => {
    async function pendingRevocation() {
      const redis = new FakeRedis();
      let missNextRedisRead = false;
      const context = harness(redis, {
        redis: () => {
          if (!missNextRedisRead) return redis;
          missNextRedisRead = false;
          return null;
        },
      });
      await context.cache.get(source());
      redis.status = "end";
      vi.setSystemTime(Date.now() + 300_000);
      context.fetchCatalog.mockResolvedValue({
        ok: false,
        reason: "http_401",
        status: 401,
      } as never);
      await context.cache.get(source());
      await flush();
      redis.status = "ready";
      redis.registry.set("other-variant", redis.registry.get("source-1")!);
      redis.data.set(
        "other-variant",
        JSON.stringify({ models: [model("revoked-shared")], fetchedAt: Date.now(), epoch: "0" })
      );
      context.fetchCatalog.mockResolvedValue({
        ok: true,
        models: [model("authorized-new")],
        bytes: 100,
        elapsedMs: 1,
      });
      missNextRedisRead = true;
      return { ...context, redis };
    }

    it("rejects old shared data when Redis recovers after the pending tombstone write fails", async () => {
      const { cache, redis, fetchCatalog } = await pendingRevocation();
      const result = cache.get(source("other-variant"));
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toMatchObject({ models: [model("authorized-new")] });
      expect(fetchCatalog).toHaveBeenCalledTimes(3);
      expect(redis.locks.size).toBe(0);
      expect(logger.warn).toHaveBeenCalledWith("[CodexModelCatalogCache] Source refresh blocked", {
        providerId: 1,
        reason: "pending_revocation_epoch_mismatch",
      });
    });

    it("retains the fence when a pending tombstone completes while an old lock reply is in flight", async () => {
      const { cache, redis, fetchCatalog } = await pendingRevocation();
      const pending = (cache as unknown as { pendingRevocations: Map<number, string> })
        .pendingRevocations;
      const evaluate = redis.eval.getMockImplementation();
      let completeRevocation = true;
      redis.eval.mockImplementation(async (...args) => {
        const reply = await evaluate?.(...args);
        if (completeRevocation && args[0].startsWith("-- codex-catalog:acquire")) {
          completeRevocation = false;
          // Complete the earlier tombstone after Redis captured its old lock reply.
          await evaluate?.(
            "-- codex-catalog:revoke",
            4,
            "data",
            "registry",
            "lru",
            "epochs",
            "1",
            pending.get(1)!,
            CHANNEL_CODEX_MODEL_CATALOG_UPDATED,
            "{}"
          );
          pending.delete(1);
        }
        return reply;
      });
      const result = cache.get(source("other-variant"));
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toMatchObject({ models: [model("authorized-new")] });
      expect(fetchCatalog).toHaveBeenCalledTimes(3);
      expect(pending.size).toBe(0);
      expect(redis.locks.size).toBe(0);
    });

    it("keeps normal memory fallback when Redis is unavailable without a pending revocation", async () => {
      const redis = new FakeRedis();
      redis.status = "end";
      const { cache, fetchCatalog } = harness(redis);
      const first = await cache.get(source());
      expect(first).toMatchObject({ models: [model()], state: "refreshed" });
      vi.setSystemTime(Date.now() + 300_000);
      fetchCatalog.mockResolvedValue({ ok: false, reason: "network_error" } as never);
      expect(await cache.get(source())).toMatchObject({
        models: [model()],
        state: "stale",
        fetchedAt: first?.fetchedAt,
      });
      await flush();
      expect(fetchCatalog).toHaveBeenCalledTimes(2);
      expect(redis.eval).not.toHaveBeenCalled();
    });
  });
});

describe("scheduler and task lifecycle", () => {
  it("refreshes static active sources from fresh DB records but never replays dynamic header variants", async () => {
    const { cache, fetchCatalog, findProviders, prepareSource } = harness();
    await cache.get(source());
    await cache.get(source("dynamic", 1, true));
    vi.setSystemTime(Date.now() + 300_000);
    await cache.runScheduledRefresh();
    expect(findProviders).toHaveBeenCalledTimes(1);
    expect(prepareSource).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
  });

  it("does not refresh changed, disabled, missing or non-Codex providers", async () => {
    const { cache, fetchCatalog, findProviders, prepareSource } = harness();
    for (let index = 1; index <= 4; index++) await cache.get(source(`source-${index}`, index));
    vi.setSystemTime(Date.now() + 300_000);
    findProviders.mockResolvedValue([
      source().provider,
      { ...source("source-2", 2).provider, isEnabled: false },
      { ...source("source-3", 3).provider, providerType: "claude" },
    ]);
    prepareSource.mockReturnValue(source("changed-key"));
    await cache.runScheduledRefresh();
    expect(fetchCatalog).toHaveBeenCalledTimes(4);
    expect(prepareSource).toHaveBeenCalledTimes(1);
  });

  it("prewarms Redis active versions on restart without renewing their last-used timestamps", async () => {
    const redis = new FakeRedis();
    const first = harness(redis);
    await first.cache.get(source());
    const metadata = redis.registry.get("source-1");
    vi.setSystemTime(Date.now() + 300_000);
    const second = harness(redis);
    await second.cache.runScheduledRefresh();
    expect(second.fetchCatalog).toHaveBeenCalledTimes(1);
    expect(redis.registry.get("source-1")).toBe(metadata);
  });

  it("does not refresh unused variants past the retention window or duplicate concurrent ticks", async () => {
    const { cache, fetchCatalog, findProviders } = harness();
    await cache.get(source());
    vi.setSystemTime(Date.now() + 86_400_001);
    const providers = deferred<Provider[]>();
    findProviders.mockReturnValue(providers.promise);
    const first = cache.runScheduledRefresh();
    await flush();
    await cache.runScheduledRefresh();
    providers.resolve([source().provider]);
    await first;
    expect(findProviders).toHaveBeenCalledTimes(1);
    expect(fetchCatalog).toHaveBeenCalledTimes(1);
  });

  it("starts idempotent owner scheduling and clears local cache on pubsub invalidations", async () => {
    const { cache, fetchCatalog, callbacks, subscribe, cleanup, findProviders } = harness();
    await cache.get(source());
    cache.start();
    cache.start();
    await flush();
    expect(subscribe).toHaveBeenCalledTimes(2);
    callbacks.get(CHANNEL_CODEX_MODEL_CATALOG_UPDATED)?.(JSON.stringify({ key: "source-1" }));
    await cache.get(source());
    expect(fetchCatalog).toHaveBeenCalledTimes(2);
    callbacks.get("cch:cache:providers:updated")?.("cch:cache:resync");
    await cache.get(source());
    expect(fetchCatalog).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(findProviders).toHaveBeenCalledTimes(2);
    cache.stop();
    expect(cleanup).toHaveBeenCalledTimes(2);
    expect(await cache.get(source())).toBeNull();
  });

  it("initializes subscriptions in request workers without starting a scheduler", async () => {
    const { cache, backgroundOwner, subscribe, findProviders } = harness();
    backgroundOwner.mockReturnValue(false);
    cache.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(findProviders).not.toHaveBeenCalled();
  });

  it("aborts managed in-flight refreshes and does not publish their late successes", async () => {
    const { cache, fetchCatalog } = harness();
    const response = deferred<Awaited<ReturnType<typeof fetchCatalog>>>();
    fetchCatalog.mockReturnValue(response.promise);
    const pending = cache.get(source());
    await flush();
    const signal = fetchCatalog.mock.calls[0]?.[1];
    cache.stop();
    expect(signal?.aborted).toBe(true);
    response.resolve({ ok: true, models: [model()], bytes: 100, elapsedMs: 1 });
    expect(await pending).toBeNull();
    expect(await cache.get(source())).toBeNull();
  });

  it("handles refused task admission without hanging a cold request", async () => {
    const { cache, registerTask, fetchCatalog } = harness();
    registerTask.mockImplementation((_id, _factory, controller) => controller.abort());
    const pending = cache.get(source());
    await vi.advanceTimersByTimeAsync(2_000);
    expect(await pending).toBeNull();
    expect(fetchCatalog).not.toHaveBeenCalled();
  });

  it("uses the default singleton wiring and skips startup in CI", async () => {
    defaults.fetchCatalog.mockResolvedValue({
      ok: true,
      models: [model()],
      bytes: 100,
      elapsedMs: 1,
    });
    defaults.register.mockImplementation((_id, factory, options) => {
      void factory(options.abortController.signal);
    });
    expect(await getCachedCodexModelCatalog(source())).toMatchObject({ state: "refreshed" });
    vi.stubEnv("CI", "true");
    startCodexModelCatalogScheduler();
    expect(defaults.subscribe).not.toHaveBeenCalled();
    vi.stubEnv("CI", "false");
    startCodexModelCatalogScheduler();
    await flush();
    expect(defaults.subscribe).toHaveBeenCalledTimes(2);
    stopCodexModelCatalogScheduler();
    expect(await getCachedCodexModelCatalog(source())).toBeNull();
  });
});
