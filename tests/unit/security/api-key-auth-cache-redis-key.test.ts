import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import type { Key } from "@/types/key";
import type { User } from "@/types/user";

type RedisPipelineLike = {
  setex(key: string, ttlSeconds: number, value: string): RedisPipelineLike;
  del(key: string): RedisPipelineLike;
  exec(): Promise<unknown>;
};

type RedisLike = {
  get(key: string): Promise<string | null>;
  setex(key: string, ttlSeconds: number, value: string): Promise<unknown>;
  del(key: string): Promise<number>;
  pipeline(): RedisPipelineLike;
};

type PipelineOp =
  | { kind: "setex"; key: string; ttlSeconds: number; value: string }
  | { kind: "del"; key: string };

class FakeRedisPipeline implements RedisPipelineLike {
  readonly ops: PipelineOp[] = [];
  readonly exec = vi.fn(async () => {
    for (const op of this.ops) {
      if (op.kind === "setex") {
        this.parent.store.set(op.key, op.value);
      } else {
        this.parent.store.delete(op.key);
      }
    }
    return [];
  });

  constructor(private readonly parent: FakeRedis) {}

  setex(key: string, ttlSeconds: number, value: string): RedisPipelineLike {
    this.ops.push({ kind: "setex", key, ttlSeconds, value });
    return this;
  }

  del(key: string): RedisPipelineLike {
    this.ops.push({ kind: "del", key });
    return this;
  }
}

class FakeRedis implements RedisLike {
  readonly store = new Map<string, string>();
  readonly get = vi.fn(async (key: string) => this.store.get(key) ?? null);
  readonly setex = vi.fn(async (key: string, _ttlSeconds: number, value: string) => {
    this.store.set(key, value);
    return "OK";
  });
  readonly del = vi.fn(async (key: string) => (this.store.delete(key) ? 1 : 0));
  readonly pipeline = vi.fn(() => {
    const pipeline = new FakeRedisPipeline(this);
    this.pipelines.push(pipeline);
    return pipeline;
  });

  readonly pipelines: FakeRedisPipeline[] = [];
}

let currentRedis: FakeRedis | null = null;
const getRedisClient = vi.fn(() => currentRedis);

vi.mock("@/lib/redis/client", () => ({
  getRedisClient,
}));

function sha256HexNode(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function buildKey(overrides?: Partial<Key>): Key {
  return {
    id: 1,
    userId: 10,
    name: "k1",
    key: "sk-secret",
    isEnabled: true,
    expiresAt: undefined,
    canLoginWebUi: true,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 0,
    providerGroup: null,
    cacheTtlPreference: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    deletedAt: undefined,
    ...overrides,
  };
}

function buildUser(overrides?: Partial<User>): User {
  return {
    id: 10,
    name: "u1",
    description: "",
    role: "user",
    rpm: null,
    dailyQuota: null,
    providerGroup: null,
    tags: [],
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    deletedAt: undefined,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    isEnabled: true,
    expiresAt: null,
    allowedClients: [],
    allowedModels: [],
    ...overrides,
  };
}

function setEnv(values: Record<string, string | undefined>): void {
  for (const [key, value] of Object.entries(values)) {
    if (value === undefined) {
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
}

describe("ApiKeyAuthCache：Redis key（哈希/命名/TTL/失效）", () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    currentRedis = new FakeRedis();

    // 记录并覆盖本文件会改动的环境变量（避免泄漏到其它用例）
    for (const k of [
      "CI",
      "NEXT_PHASE",
      "NEXT_RUNTIME",
      "ENABLE_RATE_LIMIT",
      "REDIS_URL",
      "ENABLE_API_KEY_REDIS_CACHE",
      "API_KEY_AUTH_CACHE_TTL_SECONDS",
    ]) {
      originalEnv[k] = process.env[k];
    }

    setEnv({
      CI: "false",
      NEXT_PHASE: "",
      NEXT_RUNTIME: "nodejs",
      ENABLE_RATE_LIMIT: "true",
      REDIS_URL: "redis://localhost:6379",
      ENABLE_API_KEY_REDIS_CACHE: "true",
      API_KEY_AUTH_CACHE_TTL_SECONDS: "60",
    });

    // 确保测试环境一定有 WebCrypto subtle（不依赖 Node 版本/运行模式）
    vi.stubGlobal("crypto", webcrypto as unknown as Crypto);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    setEnv(originalEnv);
    currentRedis = null;
  });

  test("cacheActiveKey：应使用 SHA-256(keyString) 作为 Redis key，且不泄漏明文 key", async () => {
    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");
    const key = buildKey({ key: "sk-secret" });

    await cacheActiveKey(key);

    const expectedRedisKey = `api_key_auth:v1:key:${sha256HexNode("sk-secret")}`;
    expect(getRedisClient).toHaveBeenCalled();
    expect(currentRedis?.setex).toHaveBeenCalledTimes(1);

    const [redisKey, ttlSeconds, payload] = currentRedis!.setex.mock.calls[0];
    expect(redisKey).toBe(expectedRedisKey);
    expect(redisKey).not.toContain("sk-secret");
    expect(ttlSeconds).toBe(60);
    expect(typeof payload).toBe("string");
    expect(payload).not.toContain("sk-secret");

    const parsed = JSON.parse(payload) as { v: number; key: Record<string, unknown> };
    expect(parsed.v).toBe(1);
    // payload.key 不应包含明文 key 字段
    expect(Object.hasOwn(parsed.key, "key")).toBe(false);
  });

  test("cacheActiveKey + getCachedActiveKey：应可回读并水合 Date 字段", async () => {
    const { cacheActiveKey, getCachedActiveKey } = await import("@/lib/security/api-key-auth-cache");
    const key = buildKey({ key: "sk-roundtrip" });

    await cacheActiveKey(key);
    const cached = await getCachedActiveKey("sk-roundtrip");

    expect(cached?.key).toBe("sk-roundtrip");
    expect(cached?.id).toBe(1);
    expect(cached?.userId).toBe(10);
    expect(cached?.createdAt).toBeInstanceOf(Date);
    expect(cached?.updatedAt).toBeInstanceOf(Date);
    expect(cached?.createdAt.toISOString()).toBe(key.createdAt.toISOString());
    expect(cached?.updatedAt.toISOString()).toBe(key.updatedAt.toISOString());
  });

  test("getCachedActiveKey：payload 版本不匹配时应删除缓存并返回 null", async () => {
    const { getCachedActiveKey } = await import("@/lib/security/api-key-auth-cache");
    const keyString = "sk-version-mismatch";
    const redisKey = `api_key_auth:v1:key:${sha256HexNode(keyString)}`;

    currentRedis!.store.set(
      redisKey,
      JSON.stringify({
        v: 999,
        key: {
          id: 1,
          userId: 10,
          name: "k1",
          isEnabled: true,
          canLoginWebUi: true,
          dailyResetMode: "fixed",
          dailyResetTime: "00:00",
          limitConcurrentSessions: 0,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      })
    );

    await expect(getCachedActiveKey(keyString)).resolves.toBeNull();
    expect(currentRedis!.del).toHaveBeenCalledWith(redisKey);
  });

  test("getCachedActiveKey：disabled/deleted/expired 应视为失效并清理", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    const { getCachedActiveKey } = await import("@/lib/security/api-key-auth-cache");

    const cases: Array<{
      name: string;
      payload: Record<string, unknown>;
    }> = [
      {
        name: "disabled",
        payload: { isEnabled: false },
      },
      {
        name: "deleted",
        payload: { deletedAt: "2026-01-01T00:00:00.000Z" },
      },
      {
        name: "expired",
        payload: { expiresAt: "2026-01-01T00:00:00.000Z" },
      },
    ];

    for (const c of cases) {
      currentRedis!.get.mockClear();
      currentRedis!.del.mockClear();

      const keyString = `sk-${c.name}`;
      const redisKey = `api_key_auth:v1:key:${sha256HexNode(keyString)}`;
      currentRedis!.store.set(
        redisKey,
        JSON.stringify({
          v: 1,
          key: {
            id: 1,
            userId: 10,
            name: "k1",
            isEnabled: true,
            canLoginWebUi: true,
            dailyResetMode: "fixed",
            dailyResetTime: "00:00",
            limitConcurrentSessions: 0,
            createdAt: "2026-01-01T00:00:00.000Z",
            updatedAt: "2026-01-02T00:00:00.000Z",
            ...c.payload,
          },
        })
      );

      await expect(getCachedActiveKey(keyString)).resolves.toBeNull();
      expect(currentRedis!.del).toHaveBeenCalledWith(redisKey);
    }
  });

  test("cacheActiveKey：非活跃 key（禁用/已删/已过期/无效 expiresAt）应删除缓存，不应 setex", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-10T00:00:00.000Z"));

    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");

    const cases: Array<{ name: string; key: Key }> = [
      { name: "disabled", key: buildKey({ key: "sk-disabled", isEnabled: false }) },
      {
        name: "deleted",
        key: buildKey({ key: "sk-deleted", deletedAt: new Date("2026-01-01T00:00:00.000Z") }),
      },
      {
        name: "expired",
        key: buildKey({ key: "sk-expired", expiresAt: new Date("2026-01-01T00:00:00.000Z") }),
      },
      {
        name: "invalid_expiresAt",
        // @ts-expect-error: 覆盖运行时边界
        key: buildKey({ key: "sk-invalid", expiresAt: "not-a-date" }),
      },
    ];

    for (const c of cases) {
      currentRedis!.setex.mockClear();
      currentRedis!.del.mockClear();

      await cacheActiveKey(c.key);

      const expectedRedisKey = `api_key_auth:v1:key:${sha256HexNode(c.key.key)}`;
      expect(currentRedis!.setex).not.toHaveBeenCalled();
      expect(currentRedis!.del).toHaveBeenCalledWith(expectedRedisKey);
    }
  });

  test("cacheActiveKey：应按 key.expiresAt 剩余时间收敛 TTL（秒）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");
    const expiresAt = new Date(Date.now() + 30_000);
    const key = buildKey({ key: "sk-ttl-cap", expiresAt });

    await cacheActiveKey(key);

    expect(currentRedis!.setex).toHaveBeenCalledTimes(1);
    const [_redisKey, ttlSeconds] = currentRedis!.setex.mock.calls[0];
    expect(ttlSeconds).toBe(30);
  });

  test("API_KEY_AUTH_CACHE_TTL_SECONDS：应 clamp 到最大 3600s", async () => {
    setEnv({ API_KEY_AUTH_CACHE_TTL_SECONDS: "999999" });

    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");
    const key = buildKey({ key: "sk-ttl-max" });

    await cacheActiveKey(key);

    expect(currentRedis!.setex).toHaveBeenCalledTimes(1);
    const [_redisKey, ttlSeconds] = currentRedis!.setex.mock.calls[0];
    expect(ttlSeconds).toBe(3600);
  });

  test("invalidateCachedKey：应删除对应的 hashed Redis key", async () => {
    const { invalidateCachedKey } = await import("@/lib/security/api-key-auth-cache");
    const keyString = "sk-invalidate";

    await invalidateCachedKey(keyString);

    const expectedRedisKey = `api_key_auth:v1:key:${sha256HexNode(keyString)}`;
    expect(currentRedis!.del).toHaveBeenCalledWith(expectedRedisKey);
  });

  test("cacheAuthResult：应使用 pipeline 写入 key cache（并遵守活跃条件）", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    const { cacheAuthResult } = await import("@/lib/security/api-key-auth-cache");

    await cacheAuthResult("sk-auth", {
      key: buildKey({ key: "sk-auth" }),
      user: buildUser({ id: 10 }),
    });

    expect(currentRedis!.pipeline).toHaveBeenCalledTimes(1);
    const pipeline = currentRedis!.pipelines[0];
    expect(pipeline.exec).toHaveBeenCalledTimes(1);
    const keyRedisKey = `api_key_auth:v1:key:${sha256HexNode("sk-auth")}`;
    expect(pipeline.ops.some((op) => op.kind === "setex" && op.key === keyRedisKey)).toBe(true);
  });

  test("cacheAuthResult：key 非活跃时应 del key cache（避免脏读误放行）", async () => {
    const { cacheAuthResult } = await import("@/lib/security/api-key-auth-cache");

    await cacheAuthResult("sk-inactive", {
      key: buildKey({ key: "sk-inactive", isEnabled: false }),
      user: buildUser({ id: 10 }),
    });

    const keyRedisKey = `api_key_auth:v1:key:${sha256HexNode("sk-inactive")}`;
    const pipeline = currentRedis!.pipelines[0];
    expect(pipeline.ops.some((op) => op.kind === "del" && op.key === keyRedisKey)).toBe(true);
  });

  test("ENABLE_API_KEY_REDIS_CACHE=false：应完全禁用缓存（不触发 Redis 调用）", async () => {
    setEnv({ ENABLE_API_KEY_REDIS_CACHE: "false" });
    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");

    await cacheActiveKey(buildKey({ key: "sk-disabled-by-env" }));

    expect(getRedisClient).not.toHaveBeenCalled();
    expect(currentRedis!.setex).not.toHaveBeenCalled();
    expect(currentRedis!.del).not.toHaveBeenCalled();
  });

  test("ENABLE_API_KEY_REDIS_CACHE=0：应完全禁用缓存（不触发 Redis 调用）", async () => {
    setEnv({ ENABLE_API_KEY_REDIS_CACHE: "0" });
    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");

    await cacheActiveKey(buildKey({ key: "sk-disabled-by-env-0" }));

    expect(getRedisClient).not.toHaveBeenCalled();
    expect(currentRedis!.setex).not.toHaveBeenCalled();
    expect(currentRedis!.del).not.toHaveBeenCalled();
  });

  test("NEXT_RUNTIME=edge：应禁用缓存（避免在 Edge runtime 引入 Node Redis 依赖）", async () => {
    setEnv({ NEXT_RUNTIME: "edge" });
    const { getCachedActiveKey } = await import("@/lib/security/api-key-auth-cache");

    await expect(getCachedActiveKey("sk-edge")).resolves.toBeNull();
    expect(getRedisClient).not.toHaveBeenCalled();
  });

  test("ENABLE_RATE_LIMIT!=true 或缺少 REDIS_URL：应自动回落（不触发 Redis 调用）", async () => {
    setEnv({ ENABLE_RATE_LIMIT: "false" });
    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");
    await cacheActiveKey(buildKey({ key: "sk-fallback-1" }));
    expect(getRedisClient).not.toHaveBeenCalled();

    vi.resetModules();
    vi.clearAllMocks();
    currentRedis = new FakeRedis();
    setEnv({ ENABLE_RATE_LIMIT: "true", REDIS_URL: undefined });
    const { cacheActiveKey: cacheActiveKey2 } = await import("@/lib/security/api-key-auth-cache");
    await cacheActiveKey2(buildKey({ key: "sk-fallback-2" }));
    expect(getRedisClient).not.toHaveBeenCalled();
  });

  test("crypto.subtle 缺失：sha256Hex 返回 null，应自动回落（不触发 Redis 调用）", async () => {
    vi.unstubAllGlobals();
    vi.stubGlobal("crypto", {} as unknown as Crypto);

    const { cacheActiveKey } = await import("@/lib/security/api-key-auth-cache");
    await cacheActiveKey(buildKey({ key: "sk-no-crypto" }));

    expect(currentRedis!.setex).not.toHaveBeenCalled();
    expect(currentRedis!.del).not.toHaveBeenCalled();
  });

  test("Redis 异常：get/setex 抛错时应 fail-open（不影响鉴权正确性）", async () => {
    const { cacheActiveKey, getCachedActiveKey } = await import("@/lib/security/api-key-auth-cache");
    currentRedis!.setex.mockRejectedValueOnce(new Error("REDIS_DOWN"));
    await expect(cacheActiveKey(buildKey({ key: "sk-redis-down" }))).resolves.toBeUndefined();

    currentRedis!.get.mockRejectedValueOnce(new Error("REDIS_DOWN"));
    await expect(getCachedActiveKey("sk-redis-down")).resolves.toBeNull();
  });
});
