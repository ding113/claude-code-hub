import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getRedisClientMock, loggerMock } = vi.hoisted(() => ({
  getRedisClientMock: vi.fn(),
  loggerMock: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
    trace: vi.fn(),
  },
}));

vi.mock("@/lib/redis", () => ({
  getRedisClient: getRedisClientMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: loggerMock,
}));

class FakeRedis {
  status: "ready" | "end" = "ready";
  readonly store = new Map<string, string>();
  readonly ttlByKey = new Map<string, number>();

  throwOnGet = false;
  throwOnSetex = false;
  throwOnDel = false;

  readonly get = vi.fn(async (key: string) => {
    if (this.throwOnGet) throw new Error("redis get failed");
    return this.store.get(key) ?? null;
  });

  readonly setex = vi.fn(async (key: string, ttlSeconds: number, value: string) => {
    if (this.throwOnSetex) throw new Error("redis setex failed");
    this.store.set(key, value);
    this.ttlByKey.set(key, ttlSeconds);
    return "OK";
  });

  readonly del = vi.fn(async (key: string) => {
    if (this.throwOnDel) throw new Error("redis del failed");
    const existed = this.store.delete(key);
    this.ttlByKey.delete(key);
    return existed ? 1 : 0;
  });
}

describe("RedisSessionStore", () => {
  let redis: FakeRedis;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-02-18T10:00:00.000Z"));
    vi.clearAllMocks();

    redis = new FakeRedis();
    getRedisClientMock.mockReturnValue(redis);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("create() returns session data with generated sessionId", async () => {
    const { DEFAULT_SESSION_TTL } = await import("@/lib/auth-session-store");
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const store = new RedisSessionStore();
    const created = await store.create({ keyFingerprint: "fp-1", userId: 101, userRole: "user" });

    expect(created.sessionId).toMatch(/^sid_[0-9a-f-]{36}$/i);
    expect(created.keyFingerprint).toBe("fp-1");
    expect(created.userId).toBe(101);
    expect(created.userRole).toBe("user");
    expect(created.createdAt).toBe(new Date("2026-02-18T10:00:00.000Z").getTime());
    expect(created.expiresAt).toBe(created.createdAt + DEFAULT_SESSION_TTL * 1000);
  });

  it("read() returns data for existing session", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const session = {
      sessionId: "6b5097ff-a11e-4425-aad0-f57f7d2206fc",
      keyFingerprint: "fp-existing",
      userId: 7,
      userRole: "admin",
      createdAt: 1_700_000_000_000,
      expiresAt: 1_700_000_360_000,
    };
    redis.store.set(`cch:session:${session.sessionId}`, JSON.stringify(session));

    const store = new RedisSessionStore();
    const found = await store.read(session.sessionId);

    expect(found).toEqual(session);
  });

  it("read() returns null for non-existent session", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const store = new RedisSessionStore();
    const found = await store.read("missing-session");

    expect(found).toBeNull();
  });

  it("read() returns null when Redis read fails", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    redis.throwOnGet = true;
    const store = new RedisSessionStore();
    const found = await store.read("any-session");

    expect(found).toBeNull();
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("revoke() deletes session", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const sessionId = "f327f4f4-c95f-40ab-a017-af714df7a3f8";
    redis.store.set(`cch:session:${sessionId}`, JSON.stringify({ sessionId }));

    const store = new RedisSessionStore();
    const revoked = await store.revoke(sessionId);

    expect(revoked).toBe(true);
    expect(redis.store.has(`cch:session:${sessionId}`)).toBe(false);
  });

  it("rotate() creates new session and revokes old session", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const oldSession = {
      sessionId: "e7f7bf87-c3b9-4525-ac0c-c2cf7cd5006b",
      keyFingerprint: "fp-rotate",
      userId: 18,
      userRole: "user",
      createdAt: Date.now() - 10_000,
      expiresAt: Date.now() + 120_000,
    };
    redis.store.set(`cch:session:${oldSession.sessionId}`, JSON.stringify(oldSession));

    const store = new RedisSessionStore();
    const rotated = await store.rotate(oldSession.sessionId);

    expect(rotated).not.toBeNull();
    expect(rotated?.sessionId).not.toBe(oldSession.sessionId);
    expect(rotated?.keyFingerprint).toBe(oldSession.keyFingerprint);
    expect(rotated?.userId).toBe(oldSession.userId);
    expect(rotated?.userRole).toBe(oldSession.userRole);
    expect(redis.store.has(`cch:session:${oldSession.sessionId}`)).toBe(false);
    expect(rotated ? redis.store.has(`cch:session:${rotated.sessionId}`) : false).toBe(true);
  });

  it("create() applies TTL and stores expiresAt deterministically", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const store = new RedisSessionStore();
    const created = await store.create(
      { keyFingerprint: "fp-ttl", userId: 9, userRole: "user" },
      120
    );

    const key = `cch:session:${created.sessionId}`;
    expect(redis.ttlByKey.get(key)).toBe(120);
    expect(created.expiresAt - created.createdAt).toBe(120_000);
  });

  it("create() throws when Redis setex fails", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    redis.throwOnSetex = true;
    const store = new RedisSessionStore();

    await expect(
      store.create({ keyFingerprint: "fp-fail", userId: 3, userRole: "user" })
    ).rejects.toThrow("redis setex failed");
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("create() throws when Redis is not ready", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    redis.status = "end";
    const store = new RedisSessionStore();

    await expect(
      store.create({ keyFingerprint: "fp-noredis", userId: 4, userRole: "user" })
    ).rejects.toThrow("Redis not ready");
  });

  it("rotate() returns null when Redis setex fails during create", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const oldSession = {
      sessionId: "2a036ab4-902a-4f31-a782-ec18344e17b9",
      keyFingerprint: "fp-failure",
      userId: 3,
      userRole: "user",
      createdAt: Date.now(),
      expiresAt: Date.now() + 60_000,
    };
    redis.store.set(`cch:session:${oldSession.sessionId}`, JSON.stringify(oldSession));
    redis.throwOnSetex = true;

    const store = new RedisSessionStore();
    const rotated = await store.rotate(oldSession.sessionId);

    expect(rotated).toBeNull();
    expect(redis.store.has(`cch:session:${oldSession.sessionId}`)).toBe(true);
    expect(loggerMock.error).toHaveBeenCalled();
  });

  it("rotate() keeps new session when old session revocation fails", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const oldSession = {
      sessionId: "aaa-old-session",
      keyFingerprint: "fp-revoke-fail",
      userId: 5,
      userRole: "user",
      createdAt: Date.now() - 10_000,
      expiresAt: Date.now() + 120_000,
    };
    redis.store.set(`cch:session:${oldSession.sessionId}`, JSON.stringify(oldSession));
    redis.throwOnDel = true;

    const store = new RedisSessionStore();
    const rotated = await store.rotate(oldSession.sessionId);

    expect(rotated).not.toBeNull();
    expect(rotated?.keyFingerprint).toBe(oldSession.keyFingerprint);
    expect(loggerMock.warn).toHaveBeenCalled();
  });

  it("rotate() returns null for already-expired session", async () => {
    const { RedisSessionStore } = await import("@/lib/auth-session-store/redis-session-store");

    const expiredSession = {
      sessionId: "bbb-expired-session",
      keyFingerprint: "fp-expired",
      userId: 6,
      userRole: "user",
      createdAt: Date.now() - 120_000,
      expiresAt: Date.now() - 1_000,
    };
    redis.store.set(`cch:session:${expiredSession.sessionId}`, JSON.stringify(expiredSession));

    const store = new RedisSessionStore();
    const rotated = await store.rotate(expiredSession.sessionId);

    expect(rotated).toBeNull();
    expect(loggerMock.warn).toHaveBeenCalledWith(
      "[AuthSessionStore] Cannot rotate expired session",
      expect.objectContaining({ sessionId: expiredSession.sessionId })
    );
  });
});
