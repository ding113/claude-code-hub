import "server-only";

import { randomUUID } from "node:crypto";
import {
  type CodexCatalogSource,
  fetchCodexModelCatalog,
  prepareCodexModelCatalogSource,
} from "@/app/v1/_lib/models/codex-model-catalog-fetcher";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import type { CodexModelInfo } from "@/lib/codex-model-catalog";
import { logger } from "@/lib/logger";
import { getRedisClient } from "@/lib/redis/client";
import { subscribeCacheInvalidation } from "@/lib/redis/pubsub";
import { findAllProvidersFresh } from "@/repository/provider";
import type { Provider } from "@/types/provider";
import { CHANNEL_PROVIDERS_UPDATED } from "./provider-cache";

export const CHANNEL_CODEX_MODEL_CATALOG_UPDATED = "cch:cache:codex-catalog:updated";

const PREFIX = "cch:codex-catalog:v1:";
const DATA_KEY = `${PREFIX}data`;
const REGISTRY_KEY = `${PREFIX}registry`;
const LRU_KEY = `${PREFIX}lru`;
const EPOCH_KEY = `${PREFIX}epochs`;
const REDIS_KEYS = [DATA_KEY, REGISTRY_KEY, LRU_KEY, EPOCH_KEY];
const FRESH_MS = 300_000;
const STALE_MS = 86_400_000;
const REDIS_BUDGET_MS = 200;
const COLD_WAIT_MS = 2_000;
const MAX_REDIS_VARIANTS = 128;
const MAX_LOCAL_VARIANTS = 64;
const MAX_LOCAL_BYTES = 32 * 1024 * 1024;
const SYNC_MS = 5_000;
const RETRY_MS = 30_000;
const LOCK_MS = 15_000;

// Registry values contain only identifiers, never upstream keys, URLs or resolved headers.
interface SourceMetadata {
  key: string;
  providerId: number;
  clientVersion: string;
  dynamicHeaders: boolean;
  lastUsedAt: number;
}

interface Snapshot {
  models: CodexModelInfo[];
  fetchedAt: number;
  epoch: string;
}

interface LocalEntry {
  snapshot: Snapshot;
  providerId: number;
  loadedAt: number;
  bytes: number;
}

export interface CachedCodexModelCatalog {
  models: CodexModelInfo[];
  state: "fresh" | "stale" | "refreshed";
  fetchedAt: number;
}

interface CatalogRedis {
  status: string;
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
}

export interface CodexModelCatalogCacheDependencies {
  now: () => number;
  redis: () => CatalogRedis | null;
  fetchCatalog: typeof fetchCodexModelCatalog;
  prepareSource: typeof prepareCodexModelCatalogSource;
  findProviders: () => Promise<Provider[]>;
  registerTask: (
    id: string,
    factory: (signal: AbortSignal) => Promise<void>,
    controller: AbortController
  ) => void;
  subscribe: typeof subscribeCacheInvalidation;
  backgroundOwner: () => boolean;
}

type RedisResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: "unavailable" | "busy" | "timeout" | "error" };

const TRIM_REGISTRY_LUA = `
local overflow = redis.call('ZCARD', KEYS[3]) - 128
if overflow > 0 then
  local expired = redis.call('ZRANGE', KEYS[3], 0, overflow - 1)
  for _, key in ipairs(expired) do
    redis.call('HDEL', KEYS[1], key)
    redis.call('HDEL', KEYS[2], key)
    redis.call('ZREM', KEYS[3], key)
  end
end
for i = 1, 4 do redis.call('EXPIRE', KEYS[i], 86400) end
`;

const READ_LUA = `-- codex-catalog:read
if ARGV[5] == '1' then
  redis.call('HSET', KEYS[2], ARGV[1], ARGV[2])
  redis.call('ZADD', KEYS[3], redis.call('HINCRBY', KEYS[4], '__lru_sequence', 1), ARGV[1])
  ${TRIM_REGISTRY_LUA}
end
return {redis.call('HGET', KEYS[1], ARGV[1]) or '',
  redis.call('HGET', KEYS[4], ARGV[4]) or '0'}
`;

const ACQUIRE_LUA = `-- codex-catalog:acquire
local acquired = redis.call('SET', KEYS[1], ARGV[1], 'NX', 'PX', ARGV[2])
return {acquired and 1 or 0, redis.call('HGET', KEYS[2], ARGV[3]) or '0',
  acquired and redis.call('HGET', KEYS[3], ARGV[4]) or ''}
`;

const STORE_LUA = `-- codex-catalog:store
if redis.call('GET', KEYS[5]) ~= ARGV[3] then return 0 end
if (redis.call('HGET', KEYS[4], ARGV[4]) or '0') ~= ARGV[5] then return 0 end
if redis.call('HEXISTS', KEYS[2], ARGV[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('PUBLISH', ARGV[6], ARGV[7])
return 1
`;

const REVOKE_LUA = `-- codex-catalog:revoke
redis.call('HSET', KEYS[4], ARGV[1], ARGV[2])
local entries = redis.call('HGETALL', KEYS[2])
for i = 1, #entries, 2 do
  local ok, metadata = pcall(cjson.decode, entries[i + 1])
  if ok and tostring(metadata.providerId) == ARGV[1] then
    redis.call('HDEL', KEYS[1], entries[i])
  end
end
redis.call('EXPIRE', KEYS[4], 86400)
redis.call('PUBLISH', ARGV[3], ARGV[4])
return 1
`;

const RELEASE_LUA = `-- codex-catalog:release
if redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end
if ARGV[2] == '0' then return redis.call('DEL', KEYS[1]) end
return redis.call('PEXPIRE', KEYS[1], ARGV[2])
`;

const REGISTRY_LUA = `-- codex-catalog:registry
return redis.call('HVALS', KEYS[1])
`;

function defaultDependencies(): CodexModelCatalogCacheDependencies {
  return {
    now: Date.now,
    redis: () => getRedisClient({ allowWhenRateLimitDisabled: true }),
    fetchCatalog: fetchCodexModelCatalog,
    prepareSource: prepareCodexModelCatalogSource,
    findProviders: findAllProvidersFresh,
    registerTask: (id, factory, controller) => {
      AsyncTaskManager.register(id, factory, {
        taskType: "codex-model-catalog-refresh",
        abortController: controller,
        staleTimeoutMs: LOCK_MS,
      });
    },
    subscribe: subscribeCacheInvalidation,
    backgroundOwner: () => process.env.CCH_MULTICORE_BACKGROUND_OWNER !== "0",
  };
}

/** Native source snapshots are shared; user and provider permissions are projected per request. */
export class CodexModelCatalogCache {
  private readonly dependencies: CodexModelCatalogCacheDependencies;
  private readonly local = new Map<string, LocalEntry>();
  private readonly active = new Map<string, SourceMetadata>();
  private readonly epochs = new Map<number, string>();
  private readonly pendingRevocations = new Map<number, string>();
  private readonly inFlight = new Map<string, Promise<Snapshot | null>>();
  private readonly controllers = new Set<AbortController>();
  private readonly retryAfter = new Map<string, number>();
  private readonly instanceId = randomUUID();
  private localBytes = 0;
  private redisPending: Promise<unknown> | null = null;
  private redisPendingTimedOut = false;
  private redisWaiters = 0;
  private redisPausedUntil = 0;
  private stopped = false;
  private started = false;
  private runningTick = false;
  private interval?: ReturnType<typeof setInterval>;
  private readonly cleanups: (() => void)[] = [];

  constructor(dependencies: Partial<CodexModelCatalogCacheDependencies> = {}) {
    this.dependencies = { ...defaultDependencies(), ...dependencies };
  }

  private now(): number {
    return this.dependencies.now();
  }

  private async redisOperation<T>(
    operation: (redis: CatalogRedis) => Promise<T>
  ): Promise<RedisResult<T>> {
    let expired = false;
    let admitted: Promise<unknown> | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const work = async (): Promise<RedisResult<T>> => {
      let waiting = false;
      try {
        // Waiting and execution share the same 200ms caller deadline. Only bounded local
        // waiters are retained; no command is admitted after its caller has timed out.
        while (!this.redisPendingTimedOut && !expired) {
          const pending = this.redisPending;
          if (pending === null) break;
          if (!waiting) {
            if (this.redisWaiters >= MAX_LOCAL_VARIANTS) return { ok: false, reason: "busy" };
            this.redisWaiters++;
            waiting = true;
          }
          await pending.catch(() => undefined);
        }
      } finally {
        if (waiting) this.redisWaiters--;
      }
      if (expired) return { ok: false, reason: "busy" };
      if (this.redisPending || this.now() < this.redisPausedUntil) {
        return { ok: false, reason: "unavailable" };
      }
      const redis = this.dependencies.redis();
      if (redis?.status !== "ready") return { ok: false, reason: "unavailable" };

      const pending = Promise.resolve().then(() => operation(redis));
      admitted = pending;
      this.redisPending = pending;
      // A timed-out ioredis command cannot be cancelled. Retain this gate until it settles,
      // preventing a network black hole from accumulating commands in the shared client.
      const settled = pending.then<RedisResult<T>, RedisResult<T>>(
        (value) => ({ ok: true, value }),
        () => {
          this.redisPausedUntil = this.now() + SYNC_MS;
          return { ok: false, reason: "error" };
        }
      );
      void settled.finally(() => {
        if (this.redisPending === pending) {
          this.redisPending = null;
          this.redisPendingTimedOut = false;
        }
      });
      return settled;
    };
    try {
      return await Promise.race([
        work(),
        new Promise<RedisResult<T>>((resolve) => {
          timer = setTimeout(() => {
            expired = true;
            if (admitted && this.redisPending === admitted) {
              this.redisPendingTimedOut = true;
              this.redisPausedUntil = this.now() + SYNC_MS;
              resolve({ ok: false, reason: "timeout" });
            } else {
              resolve({ ok: false, reason: "busy" });
            }
          }, REDIS_BUDGET_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private metadata(source: CodexCatalogSource): SourceMetadata {
    return {
      key: source.key,
      providerId: source.providerId,
      clientVersion: source.clientVersion,
      dynamicHeaders: source.dynamicHeaders,
      lastUsedAt: this.now(),
    };
  }

  private remember(source: CodexCatalogSource): void {
    this.active.delete(source.key);
    this.active.set(source.key, this.metadata(source));
    while (this.active.size > MAX_REDIS_VARIANTS) {
      const oldest = this.active.keys().next().value;
      if (oldest !== undefined) {
        this.active.delete(oldest);
        this.retryAfter.delete(oldest);
      }
    }
  }

  private deferRetry(key: string): void {
    this.retryAfter.delete(key);
    this.retryAfter.set(key, this.now() + RETRY_MS);
    while (this.retryAfter.size > MAX_REDIS_VARIANTS) {
      const oldest = this.retryAfter.keys().next().value;
      if (oldest !== undefined) this.retryAfter.delete(oldest);
    }
  }

  private removeLocal(key: string): void {
    const previous = this.local.get(key);
    if (previous) this.localBytes -= previous.bytes;
    this.local.delete(key);
  }

  private putLocal(key: string, providerId: number, snapshot: Snapshot): void {
    this.removeLocal(key);
    const bytes = Buffer.byteLength(JSON.stringify(snapshot));
    if (bytes > MAX_LOCAL_BYTES) return;
    this.local.set(key, { snapshot, providerId, loadedAt: this.now(), bytes });
    this.localBytes += bytes;
    while (this.local.size > MAX_LOCAL_VARIANTS || this.localBytes > MAX_LOCAL_BYTES) {
      const oldest = this.local.keys().next().value;
      if (oldest !== undefined) this.removeLocal(oldest);
    }
  }

  private usable(providerId: number, snapshot: Snapshot | undefined): snapshot is Snapshot {
    return (
      snapshot !== undefined &&
      snapshot.epoch === (this.epochs.get(providerId) ?? "0") &&
      this.now() - snapshot.fetchedAt <= STALE_MS
    );
  }

  private parseSnapshot(raw: unknown): Snapshot | null {
    try {
      if (typeof raw !== "string" || !raw) return null;
      const value = JSON.parse(raw) as Partial<Snapshot>;
      if (
        !Array.isArray(value.models) ||
        typeof value.fetchedAt !== "number" ||
        !Number.isFinite(value.fetchedAt) ||
        typeof value.epoch !== "string"
      ) {
        return null;
      }
      return value as Snapshot;
    } catch {
      return null;
    }
  }

  private revokeLocally(providerId: number, epoch: string): void {
    this.epochs.set(providerId, epoch);
    for (const [key, entry] of this.local) {
      if (entry.providerId === providerId) this.removeLocal(key);
    }
  }

  private async persistRevocation(providerId: number, epoch: string): Promise<boolean> {
    const result = await this.redisOperation((redis) =>
      redis.eval(
        REVOKE_LUA,
        REDIS_KEYS.length,
        ...REDIS_KEYS,
        String(providerId),
        epoch,
        CHANNEL_CODEX_MODEL_CATALOG_UPDATED,
        JSON.stringify({ providerId, epoch })
      )
    );
    if (result.ok && this.pendingRevocations.get(providerId) === epoch) {
      this.pendingRevocations.delete(providerId);
    }
    return result.ok;
  }

  private async read(source: CodexCatalogSource, touch = true): Promise<Snapshot | null> {
    const entry = this.local.get(source.key);
    if (entry && this.usable(source.providerId, entry.snapshot)) {
      this.local.delete(source.key);
      this.local.set(source.key, entry);
      if (this.now() - entry.loadedAt < SYNC_MS) return entry.snapshot;
    }
    const pendingEpoch = this.pendingRevocations.get(source.providerId);
    if (pendingEpoch && !(await this.persistRevocation(source.providerId, pendingEpoch))) {
      return null;
    }
    const previousEpoch = this.epochs.get(source.providerId) ?? "0";
    const result = await this.redisOperation((redis) =>
      redis.eval(
        READ_LUA,
        REDIS_KEYS.length,
        ...REDIS_KEYS,
        source.key,
        JSON.stringify(this.metadata(source)),
        String(this.now()),
        String(source.providerId),
        touch ? "1" : "0"
      )
    );
    if (result.ok && Array.isArray(result.value)) {
      const [raw, epoch] = result.value;
      const currentEpoch = this.epochs.get(source.providerId) ?? "0";
      if (previousEpoch !== currentEpoch && String(epoch) !== currentEpoch) return null;
      this.epochs.set(source.providerId, String(epoch));
      const snapshot = this.parseSnapshot(raw);
      const latest = this.local.get(source.key) ?? entry;
      // A failed shared write may leave a newer, valid memory snapshot behind. An older
      // same-epoch Redis value must not roll it back; epoch changes still invalidate it.
      if (
        latest &&
        this.usable(source.providerId, latest.snapshot) &&
        (!snapshot || snapshot.fetchedAt < latest.snapshot.fetchedAt)
      ) {
        this.putLocal(source.key, source.providerId, latest.snapshot);
        return latest.snapshot;
      }
      if (snapshot && this.usable(source.providerId, snapshot)) {
        this.putLocal(source.key, source.providerId, snapshot);
        return snapshot;
      }
      // A remote revocation or eviction must not resurrect an older local snapshot.
      this.removeLocal(source.key);
      return null;
    }
    const latest = this.local.get(source.key) ?? entry;
    return latest && this.usable(source.providerId, latest.snapshot) ? latest.snapshot : null;
  }

  private async executeRefresh(
    source: CodexCatalogSource,
    signal: AbortSignal
  ): Promise<Snapshot | null> {
    const lockKey = `${PREFIX}lock:${source.key}`;
    const lockId = randomUUID();
    const previousEpoch = this.epochs.get(source.providerId) ?? "0";
    const hadPendingRevocation = this.pendingRevocations.has(source.providerId);
    const acquired = await this.redisOperation((redis) =>
      redis.eval(
        ACQUIRE_LUA,
        3,
        lockKey,
        EPOCH_KEY,
        DATA_KEY,
        lockId,
        String(LOCK_MS),
        String(source.providerId),
        source.key
      )
    );
    if (!acquired.ok && acquired.reason === "busy") return null;
    if (acquired.ok && (!Array.isArray(acquired.value) || Number(acquired.value[0]) !== 1)) {
      return null;
    }
    const distributed = acquired.ok;
    const epoch = acquired.ok
      ? String((acquired.value as unknown[])[1])
      : (this.epochs.get(source.providerId) ?? "0");
    const currentEpoch = this.epochs.get(source.providerId) ?? "0";
    let keepFailureLock = false;
    let persistence = distributed ? "redis" : "memory";
    try {
      if (signal.aborted || this.stopped) return null;
      // A completed tombstone write must not let an older lock reply lower the local fence.
      if (
        (hadPendingRevocation || this.pendingRevocations.has(source.providerId)) &&
        epoch !== currentEpoch
      ) {
        logger.warn("[CodexModelCatalogCache] Source refresh blocked", {
          providerId: source.providerId,
          reason: "pending_revocation_epoch_mismatch",
        });
        return null;
      }
      if (currentEpoch !== previousEpoch && epoch !== currentEpoch) return null;
      this.epochs.set(source.providerId, epoch);
      const shared = acquired.ok ? this.parseSnapshot((acquired.value as unknown[])[2]) : null;
      // A different worker may publish between the caller's cache read and our lock admission.
      // Read atomically with acquisition so winning the next lock never refetches a fresh value.
      if (
        shared &&
        this.usable(source.providerId, shared) &&
        this.now() - shared.fetchedAt < FRESH_MS
      ) {
        this.putLocal(source.key, source.providerId, shared);
        return shared;
      }
      const result = await this.dependencies.fetchCatalog(source, signal);
      if (signal.aborted || this.stopped) return null;
      if (!result.ok) {
        this.deferRetry(source.key);
        keepFailureLock = true;
        if (result.unauthorized || result.status === 401 || result.status === 403) {
          const revokedEpoch = randomUUID();
          this.revokeLocally(source.providerId, revokedEpoch);
          this.pendingRevocations.set(source.providerId, revokedEpoch);
          await this.persistRevocation(source.providerId, revokedEpoch);
        }
        return null;
      }
      if (epoch !== (this.epochs.get(source.providerId) ?? "0")) {
        this.deferRetry(source.key);
        return null;
      }
      const snapshot: Snapshot = { models: result.models, fetchedAt: this.now(), epoch };
      if (distributed) {
        const stored = await this.redisOperation((redis) =>
          redis.eval(
            STORE_LUA,
            5,
            ...REDIS_KEYS,
            lockKey,
            source.key,
            JSON.stringify(snapshot),
            lockId,
            String(source.providerId),
            epoch,
            CHANNEL_CODEX_MODEL_CATALOG_UPDATED,
            JSON.stringify({ key: source.key })
          )
        );
        if (stored.ok && Number(stored.value) !== 1) {
          this.deferRetry(source.key);
          return null;
        }
        if (!stored.ok) {
          if (stored.reason === "busy") {
            this.deferRetry(source.key);
            return null;
          }
          persistence = "memory";
        }
      }
      if (
        signal.aborted ||
        this.stopped ||
        snapshot.epoch !== (this.epochs.get(source.providerId) ?? "0")
      ) {
        return null;
      }
      this.retryAfter.delete(source.key);
      this.putLocal(source.key, source.providerId, snapshot);
      logger.info("[CodexModelCatalogCache] Source refreshed", {
        providerId: source.providerId,
        modelCount: result.models.length,
        bytes: result.bytes,
        elapsedMs: result.elapsedMs,
        persistence,
      });
      return snapshot;
    } catch {
      this.deferRetry(source.key);
      keepFailureLock = true;
      logger.warn("[CodexModelCatalogCache] Source refresh failed", {
        providerId: source.providerId,
      });
      return null;
    } finally {
      if (distributed) {
        await this.redisOperation((redis) =>
          redis.eval(RELEASE_LUA, 1, lockKey, lockId, keepFailureLock ? String(RETRY_MS) : "0")
        );
      }
    }
  }

  private refresh(source: CodexCatalogSource): Promise<Snapshot | null> {
    for (const [key, deadline] of this.retryAfter) {
      if (deadline <= this.now()) this.retryAfter.delete(key);
    }
    const existing = this.inFlight.get(source.key);
    if (existing) return existing;
    if (
      this.stopped ||
      this.inFlight.size >= MAX_LOCAL_VARIANTS ||
      this.now() < (this.retryAfter.get(source.key) ?? 0)
    ) {
      return Promise.resolve(null);
    }
    const controller = new AbortController();
    this.controllers.add(controller);
    let resolve!: (snapshot: Snapshot | null) => void;
    const pending = new Promise<Snapshot | null>((done) => {
      resolve = done;
    });
    this.inFlight.set(source.key, pending);
    this.dependencies.registerTask(
      `codex-catalog:${this.instanceId}:${source.key}`,
      async (signal) => {
        try {
          resolve(await this.executeRefresh(source, signal));
        } finally {
          resolve(null);
          this.controllers.delete(controller);
          if (this.inFlight.get(source.key) === pending) this.inFlight.delete(source.key);
        }
      },
      controller
    );
    // A closed task manager rejects admission by aborting without running the factory.
    if (controller.signal.aborted) {
      resolve(null);
      this.controllers.delete(controller);
      this.inFlight.delete(source.key);
    }
    return pending;
  }

  async get(source: CodexCatalogSource): Promise<CachedCodexModelCatalog | null> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        this.getWithinBudget(source),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), COLD_WAIT_MS);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  private async getWithinBudget(
    source: CodexCatalogSource
  ): Promise<CachedCodexModelCatalog | null> {
    if (this.stopped) return null;
    const deadline = this.now() + COLD_WAIT_MS;
    this.remember(source);
    const cached = await this.read(source);
    if (cached && this.usable(source.providerId, cached)) {
      const fresh = this.now() - cached.fetchedAt < FRESH_MS;
      if (!fresh) void this.refresh(source);
      return {
        models: cached.models,
        fetchedAt: cached.fetchedAt,
        state: fresh ? "fresh" : "stale",
      };
    }
    while (!this.stopped && this.now() < deadline) {
      const remaining = deadline - this.now();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const refreshed = await Promise.race([
        this.refresh(source),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), remaining);
        }),
      ]).finally(() => clearTimeout(timer));
      if (refreshed && this.usable(source.providerId, refreshed)) {
        return {
          models: refreshed.models,
          fetchedAt: refreshed.fetchedAt,
          state: "refreshed",
        };
      }
      if (this.now() >= deadline || this.stopped) break;
      const shared = await this.read(source);
      if (shared) return { models: shared.models, fetchedAt: shared.fetchedAt, state: "refreshed" };
      if (this.now() < (this.retryAfter.get(source.key) ?? 0)) break;
      await new Promise<void>((resolve) =>
        setTimeout(resolve, Math.min(50, deadline - this.now()))
      );
    }
    return null;
  }

  private onInvalidation(message: string): void {
    try {
      const event = JSON.parse(message) as { key?: string; providerId?: number; epoch?: string };
      if (typeof event.providerId === "number" && typeof event.epoch === "string") {
        this.revokeLocally(event.providerId, event.epoch);
      } else if (typeof event.key === "string") {
        this.removeLocal(event.key);
      } else {
        this.clearLocal();
      }
    } catch {
      this.clearLocal();
    }
  }

  private clearLocal(): void {
    this.local.clear();
    this.localBytes = 0;
  }

  /** Rebuild static variants from current DB configuration; never replay captured credentials. */
  async runScheduledRefresh(): Promise<void> {
    if (this.stopped || this.runningTick) return;
    this.runningTick = true;
    try {
      const registry = await this.redisOperation((redis) =>
        redis.eval(REGISTRY_LUA, 1, REGISTRY_KEY)
      );
      const metadata = new Map(this.active);
      if (registry.ok && Array.isArray(registry.value)) {
        for (const raw of registry.value) {
          try {
            const entry = JSON.parse(String(raw)) as SourceMetadata;
            if (
              typeof entry.key === "string" &&
              typeof entry.providerId === "number" &&
              typeof entry.clientVersion === "string" &&
              typeof entry.lastUsedAt === "number"
            ) {
              metadata.set(entry.key, entry);
            }
          } catch {
            // Corrupt registry entries cannot provide a valid source configuration.
          }
        }
      }
      const providers = new Map(
        (await this.dependencies.findProviders()).map((provider) => [provider.id, provider])
      );
      // Limit metadata fan-out even if Redis was populated by an incompatible older deployment.
      const entries = [...metadata.values()]
        .filter((entry) => !entry.dynamicHeaders && this.now() - entry.lastUsedAt <= STALE_MS)
        .sort((a, b) => b.lastUsedAt - a.lastUsedAt)
        .slice(0, MAX_REDIS_VARIANTS);
      for (let index = 0; index < entries.length && !this.stopped; index += 4) {
        await Promise.all(
          entries.slice(index, index + 4).map(async (entry) => {
            const provider = providers.get(entry.providerId);
            if (!provider?.isEnabled || provider.providerType !== "codex") return;
            let source: CodexCatalogSource;
            try {
              source = this.dependencies.prepareSource(provider, entry.clientVersion);
            } catch {
              return;
            }
            if (source.dynamicHeaders || source.key !== entry.key) return;
            const snapshot = await this.read(source, false);
            if (!snapshot || this.now() - snapshot.fetchedAt >= FRESH_MS) {
              await this.refresh(source);
            }
          })
        );
      }
    } catch {
      logger.warn("[CodexModelCatalogCache] Background refresh cycle failed");
    } finally {
      this.runningTick = false;
    }
  }

  start(): void {
    if (this.started || process.env.CI === "true") return;
    this.started = true;
    this.stopped = false;
    for (const channel of [CHANNEL_PROVIDERS_UPDATED, CHANNEL_CODEX_MODEL_CATALOG_UPDATED]) {
      void this.dependencies
        .subscribe(channel, (message) => this.onInvalidation(message))
        .then((cleanup) => {
          if (!cleanup) return;
          if (this.stopped) cleanup();
          else this.cleanups.push(cleanup);
        })
        .catch(() => {});
    }
    if (this.dependencies.backgroundOwner()) {
      void this.runScheduledRefresh();
      this.interval = setInterval(() => void this.runScheduledRefresh(), RETRY_MS);
      this.interval.unref?.();
    }
  }

  stop(): void {
    this.stopped = true;
    this.started = false;
    clearInterval(this.interval);
    this.interval = undefined;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    for (const controller of this.controllers) controller.abort();
  }
}

type CatalogCacheGlobal = typeof globalThis & {
  __CCH_CODEX_MODEL_CATALOG_CACHE__?: CodexModelCatalogCache;
};

function getCache(): CodexModelCatalogCache {
  const state = globalThis as CatalogCacheGlobal;
  return (state.__CCH_CODEX_MODEL_CATALOG_CACHE__ ??= new CodexModelCatalogCache());
}

export function getCachedCodexModelCatalog(
  source: CodexCatalogSource
): Promise<CachedCodexModelCatalog | null> {
  return getCache().get(source);
}

export function startCodexModelCatalogScheduler(): void {
  getCache().start();
}

export function stopCodexModelCatalogScheduler(): void {
  getCache().stop();
}
