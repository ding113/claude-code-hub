import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import { GET_COST_5H_ROLLING_WINDOW, TRACK_COST_ROLLING_WINDOW } from "@/lib/redis/lua-scripts";

const HAS_REDIS = Boolean(process.env.REDIS_URL);
const run = describe.skipIf(!HAS_REDIS);
const TEST_PREFIX = `it-rolling-cost-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const WINDOW_MS = 5 * 60 * 60 * 1000;
const TTL_SECONDS = 60;

run("rolling cost Lua integration", () => {
  let redis: Redis;
  const touchedKeys = new Set<string>();

  function nextKey(tag: string): string {
    const key = `${TEST_PREFIX}:${tag}`;
    touchedKeys.add(key);
    return key;
  }

  async function track(params: {
    key: string;
    cost: number;
    nowMs: number;
    requestId?: string;
  }): Promise<unknown> {
    return redis.eval(
      TRACK_COST_ROLLING_WINDOW,
      1,
      params.key,
      params.cost.toString(),
      params.nowMs.toString(),
      WINDOW_MS.toString(),
      params.requestId ?? "",
      TTL_SECONDS.toString()
    );
  }

  async function getTotal(key: string, nowMs: number): Promise<number> {
    const result = await redis.eval(
      GET_COST_5H_ROLLING_WINDOW,
      1,
      key,
      nowMs.toString(),
      WINDOW_MS.toString()
    );
    return Number(result);
  }

  beforeAll(async () => {
    redis = new Redis(process.env.REDIS_URL!, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    await redis.connect();
    await expect(redis.ping()).resolves.toBe("PONG");
  });

  afterEach(async () => {
    if (touchedKeys.size > 0) {
      await redis.del(...touchedKeys);
      touchedKeys.clear();
    }
  });

  afterAll(async () => {
    if (redis?.status !== "end") {
      await redis.quit();
    }
  });

  test("write-only tracking preserves valid state, replay cardinality, TTL, cutoff, and exact GET", async () => {
    const key = nextKey("valid");
    const nowMs = 1_700_000_000_000;
    const expiredAt = nowMs - WINDOW_MS - 1;
    const retainedAt = nowMs - 1_000;

    await redis.zadd(key, expiredAt, `${expiredAt}:expired:4`);
    await redis.zadd(key, retainedAt, `${retainedAt}:retained:1.5`);

    await expect(track({ key, cost: 2.5, nowMs, requestId: "request-1" })).resolves.toBe(1);
    await expect(track({ key, cost: 2.5, nowMs, requestId: "request-1" })).resolves.toBe(1);

    expect(await redis.zcard(key)).toBe(2);
    expect(await redis.zscore(key, `${expiredAt}:expired:4`)).toBeNull();
    expect(await redis.zscore(key, `${retainedAt}:retained:1.5`)).toBe(String(retainedAt));
    expect(await redis.zscore(key, `${nowMs}:request-1:2.5`)).toBe(String(nowMs));

    const ttl = await redis.ttl(key);
    expect(ttl).toBeGreaterThan(0);
    expect(ttl).toBeLessThanOrEqual(TTL_SECONDS);
    await expect(getTotal(key, nowMs)).resolves.toBeCloseTo(4, 10);
  });

  test("WRONGTYPE fails before mutation", async () => {
    const key = nextKey("wrongtype");
    await redis.set(key, "not-a-zset");

    await expect(
      track({ key, cost: 2.5, nowMs: 1_700_000_000_000, requestId: "request-2" })
    ).rejects.toThrow(/WRONGTYPE/);

    await expect(redis.get(key)).resolves.toBe("not-a-zset");
    await expect(redis.ttl(key)).resolves.toBe(-1);
  });

  test("malformed members do not block writes and TTL repair, while exact GET remains strict", async () => {
    const key = nextKey("malformed");
    const nowMs = 1_700_000_000_000;
    const expiredAt = nowMs - WINDOW_MS - 1;
    const retainedAt = nowMs - 1_000;

    await redis.zadd(key, expiredAt, "expired:non-numeric-cost");
    await redis.zadd(key, retainedAt, "retained:non-numeric-cost");
    await expect(redis.ttl(key)).resolves.toBe(-1);

    await expect(track({ key, cost: 3, nowMs, requestId: "request-3" })).resolves.toBe(1);

    expect(await redis.zscore(key, "expired:non-numeric-cost")).toBeNull();
    expect(await redis.zscore(key, "retained:non-numeric-cost")).toBe(String(retainedAt));
    expect(await redis.zscore(key, `${nowMs}:request-3:3`)).toBe(String(nowMs));
    expect(await redis.ttl(key)).toBeGreaterThan(0);

    await expect(getTotal(key, nowMs)).rejects.toThrow();

    await redis.zrem(key, "retained:non-numeric-cost");
    await expect(getTotal(key, nowMs)).resolves.toBe(3);
  });
});
