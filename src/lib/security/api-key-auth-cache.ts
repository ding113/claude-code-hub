import { logger } from "@/lib/logger";
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

const CACHE_VERSION = 1 as const;

const REDIS_KEYS = {
  keyByHash: (sha256Hex: string) => `api_key_auth:v${CACHE_VERSION}:key:${sha256Hex}`,
  userById: (userId: number) => `api_key_auth:v${CACHE_VERSION}:user:${userId}`,
};

function isEdgeRuntime(): boolean {
  if (typeof process === "undefined") return true;
  return process.env.NEXT_RUNTIME === "edge";
}

function isApiKeyRedisCacheEnabled(): boolean {
  if (isEdgeRuntime()) return false;
  const raw = process.env.ENABLE_API_KEY_REDIS_CACHE?.trim();
  return raw !== "false" && raw !== "0";
}

function getCacheTtlSeconds(): number {
  const raw = process.env.API_KEY_AUTH_CACHE_TTL_SECONDS;
  const parsed = raw ? Number.parseInt(raw, 10) : 60;
  if (!Number.isFinite(parsed) || parsed <= 0) return 60;
  // 上限 1 小时，避免配置错误导致“长时间脏读”
  return Math.min(parsed, 3600);
}

const textEncoder = new TextEncoder();
const byteToHex = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

function bufferToHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let out = "";
  for (let i = 0; i < bytes.length; i++) {
    out += byteToHex[bytes[i]];
  }
  return out;
}

async function sha256Hex(value: string): Promise<string | null> {
  const subtle = (globalThis as unknown as { crypto?: Crypto }).crypto?.subtle;
  if (!subtle) return null;

  try {
    const digest = await subtle.digest("SHA-256", textEncoder.encode(value));
    return bufferToHex(digest);
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "[ApiKeyAuthCache] sha256 digest failed"
    );
    return null;
  }
}

function shouldUseRedisClient(): boolean {
  // Edge runtime/浏览器等无 process 环境：直接禁用
  if (typeof process === "undefined") return false;

  // 与 getRedisClient 的启用条件保持一致，避免在未配置 Redis 时触发热路径 warn 日志
  if (process.env.CI === "true" || process.env.NEXT_PHASE === "phase-production-build") return false;
  if (!process.env.REDIS_URL) return false;
  const rateLimitRaw = process.env.ENABLE_RATE_LIMIT?.trim();
  if (rateLimitRaw === "false" || rateLimitRaw === "0") return false;
  return true;
}

let getRedisClientFn: (() => unknown) | null | undefined;

async function getRedisForApiKeyAuthCache(): Promise<RedisLike | null> {
  if (!isApiKeyRedisCacheEnabled()) return null;
  if (!shouldUseRedisClient()) return null;

  if (getRedisClientFn === undefined) {
    try {
      const mod = await import("@/lib/redis/client");
      getRedisClientFn = mod.getRedisClient;
    } catch (error) {
      logger.debug(
        { error: error instanceof Error ? error.message : String(error) },
        "[ApiKeyAuthCache] Load redis client failed"
      );
      getRedisClientFn = null;
    }
  }

  if (!getRedisClientFn) return null;
  return getRedisClientFn() as RedisLike | null;
}

function parseRequiredDate(value: unknown): Date | null {
  const date = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseOptionalDate(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  return parseRequiredDate(value);
}

type CachedKeyPayloadV1 = {
  v: 1;
  key: Omit<Key, "key">;
};

type CachedUserPayloadV1 = {
  v: 1;
  user: User;
};

function hydrateKeyFromCache(keyString: string, payload: CachedKeyPayloadV1): Key | null {
  const key = payload.key as unknown as Record<string, unknown>;
  if (!key || typeof key !== "object") return null;
  if (typeof key.id !== "number" || typeof key.userId !== "number") return null;
  if (typeof key.name !== "string" || typeof key.isEnabled !== "boolean") return null;
  if (typeof key.canLoginWebUi !== "boolean") return null;
  if (typeof key.dailyResetMode !== "string" || typeof key.dailyResetTime !== "string") return null;
  if (typeof key.limitConcurrentSessions !== "number") return null;

  const createdAt = parseRequiredDate(key.createdAt);
  const updatedAt = parseRequiredDate(key.updatedAt);
  if (!createdAt || !updatedAt) return null;

  const expiresAt = parseOptionalDate(key.expiresAt);
  const deletedAt = parseOptionalDate(key.deletedAt);
  if (key.expiresAt != null && !expiresAt) return null;
  if (key.deletedAt != null && !deletedAt) return null;

  return {
    ...(payload.key as Omit<Key, "key">),
    key: keyString,
    createdAt,
    updatedAt,
    expiresAt: expiresAt === undefined ? undefined : expiresAt,
    deletedAt: deletedAt === undefined ? undefined : deletedAt,
  } as Key;
}

function hydrateUserFromCache(payload: CachedUserPayloadV1): User | null {
  const user = payload.user as unknown as Record<string, unknown>;
  if (!user || typeof user !== "object") return null;
  if (typeof user.id !== "number" || typeof user.name !== "string") return null;
  if (typeof user.role !== "string") return null;
  if (typeof user.isEnabled !== "boolean") return null;
  if (typeof user.dailyResetMode !== "string" || typeof user.dailyResetTime !== "string") return null;

  const createdAt = parseRequiredDate(user.createdAt);
  const updatedAt = parseRequiredDate(user.updatedAt);
  if (!createdAt || !updatedAt) return null;

  const expiresAt = parseOptionalDate(user.expiresAt);
  const deletedAt = parseOptionalDate(user.deletedAt);
  if (user.expiresAt != null && !expiresAt) return null;
  if (user.deletedAt != null && !deletedAt) return null;

  return {
    ...(payload.user as User),
    createdAt,
    updatedAt,
    expiresAt: expiresAt === undefined ? undefined : expiresAt,
    deletedAt: deletedAt === undefined ? undefined : deletedAt,
  } as User;
}

function stripKeySecret(key: Key): Omit<Key, "key"> {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const { key: _secretKey, ...rest } = key;
  return rest;
}

function resolveKeyCacheTtlSeconds(key: Key): number {
  const base = getCacheTtlSeconds();
  const expiresAt = parseOptionalDate(key.expiresAt);
  // expiresAt 存在但无法解析：安全起见不缓存
  if (key.expiresAt != null && !expiresAt) return 0;
  if (!(expiresAt instanceof Date)) return base;

  const remainingMs = expiresAt.getTime() - Date.now();
  if (remainingMs <= 0) return 0;
  const remainingSeconds = Math.max(1, Math.floor(remainingMs / 1000));
  return Math.min(base, remainingSeconds);
}

export async function getCachedActiveKey(keyString: string): Promise<Key | null> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return null;

  const keyHash = await sha256Hex(keyString);
  if (!keyHash) return null;
  const redisKey = REDIS_KEYS.keyByHash(keyHash);

  try {
    const raw = await redis.get(redisKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedKeyPayloadV1;
    if (parsed?.v !== 1 || !parsed.key) {
      redis.del(redisKey).catch(() => {});
      return null;
    }

    const hydrated = hydrateKeyFromCache(keyString, parsed);
    if (!hydrated) {
      redis.del(redisKey).catch(() => {});
      return null;
    }

    // 仅用于“活跃 key”缓存：不满足条件时视为缓存失效
    if (hydrated.isEnabled !== true) {
      redis.del(redisKey).catch(() => {});
      return null;
    }
    if (hydrated.deletedAt) {
      redis.del(redisKey).catch(() => {});
      return null;
    }
    if (hydrated.expiresAt && hydrated.expiresAt.getTime() <= Date.now()) {
      redis.del(redisKey).catch(() => {});
      return null;
    }

    return hydrated;
  } catch (error) {
    // Fail open：缓存错误不影响鉴权正确性（会回落到 DB）
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "[ApiKeyAuthCache] Read key cache failed"
    );
    return null;
  }
}

export async function cacheActiveKey(key: Key): Promise<void> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return;

  const ttlSeconds = resolveKeyCacheTtlSeconds(key);
  const expiresAt = parseOptionalDate(key.expiresAt);
  const expiresAtInvalid = key.expiresAt != null && !expiresAt;
  const isExpired = expiresAt instanceof Date && expiresAt.getTime() <= Date.now();

  const keyHash = await sha256Hex(key.key);
  if (!keyHash) return;
  const redisKey = REDIS_KEYS.keyByHash(keyHash);

  // 非活跃 key：直接清理缓存，避免脏读误放行
  if (key.isEnabled !== true || key.deletedAt || isExpired || expiresAtInvalid || ttlSeconds <= 0) {
    try {
      await redis.del(redisKey);
    } catch {
      // ignore
    }
    return;
  }

  const payload: CachedKeyPayloadV1 = { v: 1, key: stripKeySecret(key) };
  try {
    await redis.setex(redisKey, ttlSeconds, JSON.stringify(payload));
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "[ApiKeyAuthCache] Write key cache failed"
    );
  }
}

export async function invalidateCachedKey(keyString: string): Promise<void> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return;

  const keyHash = await sha256Hex(keyString);
  if (!keyHash) return;
  const redisKey = REDIS_KEYS.keyByHash(keyHash);
  try {
    await redis.del(redisKey);
  } catch {
    // ignore
  }
}

export async function getCachedUser(userId: number): Promise<User | null> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return null;

  const redisKey = REDIS_KEYS.userById(userId);

  try {
    const raw = await redis.get(redisKey);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as CachedUserPayloadV1;
    if (parsed?.v !== 1 || !parsed.user) {
      redis.del(redisKey).catch(() => {});
      return null;
    }

    const hydrated = hydrateUserFromCache(parsed);
    if (!hydrated) {
      redis.del(redisKey).catch(() => {});
      return null;
    }

    // validateApiKeyAndGetUser 的语义：user 仅要求“未删除”
    if (hydrated.deletedAt) {
      redis.del(redisKey).catch(() => {});
      return null;
    }

    return hydrated;
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "[ApiKeyAuthCache] Read user cache failed"
    );
    return null;
  }
}

export async function cacheUser(user: User): Promise<void> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return;

  if (user.deletedAt) return;

  const ttlSeconds = getCacheTtlSeconds();
  const redisKey = REDIS_KEYS.userById(user.id);
  const payload: CachedUserPayloadV1 = { v: 1, user };
  try {
    await redis.setex(redisKey, ttlSeconds, JSON.stringify(payload));
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "[ApiKeyAuthCache] Write user cache failed"
    );
  }
}

export async function invalidateCachedUser(userId: number): Promise<void> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return;

  const redisKey = REDIS_KEYS.userById(userId);
  try {
    await redis.del(redisKey);
  } catch {
    // ignore
  }
}

export async function cacheAuthResult(keyString: string, value: { key: Key; user: User }): Promise<void> {
  const redis = await getRedisForApiKeyAuthCache();
  if (!redis) return;

  const { key, user } = value;
  const keyHash = await sha256Hex(keyString);
  if (!keyHash) return;
  const keyRedisKey = REDIS_KEYS.keyByHash(keyHash);
  const userRedisKey = REDIS_KEYS.userById(user.id);

  const keyTtlSeconds = resolveKeyCacheTtlSeconds(key);
  const userTtlSeconds = getCacheTtlSeconds();

  try {
    const pipeline = redis.pipeline();
    if (keyTtlSeconds > 0 && key.isEnabled === true && !key.deletedAt) {
      const keyPayload: CachedKeyPayloadV1 = { v: 1, key: stripKeySecret(key) };
      pipeline.setex(keyRedisKey, keyTtlSeconds, JSON.stringify(keyPayload));
    } else {
      pipeline.del(keyRedisKey);
    }

    if (!user.deletedAt) {
      const userPayload: CachedUserPayloadV1 = { v: 1, user };
      pipeline.setex(userRedisKey, userTtlSeconds, JSON.stringify(userPayload));
    } else {
      pipeline.del(userRedisKey);
    }

    await pipeline.exec();
  } catch (error) {
    logger.debug(
      { error: error instanceof Error ? error.message : String(error) },
      "[ApiKeyAuthCache] Write auth cache failed"
    );
  }
}
