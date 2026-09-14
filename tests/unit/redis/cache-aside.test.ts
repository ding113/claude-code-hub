import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

import { getOrComputeWithRedisLock } from "@/lib/redis/cache-aside";

function createRedis() {
  return {
    get: vi.fn(async () => null as string | null),
    set: vi.fn(async () => "OK" as string | null),
    setex: vi.fn(async () => "OK"),
    del: vi.fn(async () => 1),
  };
}

function options(compute: () => Promise<unknown>) {
  return {
    name: "TestCache",
    cacheKey: "test:key",
    ttlSeconds: 30,
    lockTtlSeconds: 5,
    waitTimeoutMs: 300,
    pollIntervalMs: 100,
    compute,
  };
}

describe("getOrComputeWithRedisLock", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("computes directly without Redis", async () => {
    const compute = vi.fn(async () => ({ v: 1 }));
    await expect(getOrComputeWithRedisLock(null, options(compute))).resolves.toEqual({ v: 1 });
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("returns a cache hit without computing", async () => {
    const redis = createRedis();
    redis.get.mockResolvedValueOnce(JSON.stringify({ v: 2 }));
    const compute = vi.fn();

    await expect(getOrComputeWithRedisLock(redis as never, options(compute))).resolves.toEqual({
      v: 2,
    });
    expect(compute).not.toHaveBeenCalled();
    expect(redis.set).not.toHaveBeenCalled();
  });

  it("computes under the lock, writes the cache and releases the lock", async () => {
    const redis = createRedis();
    const compute = vi.fn(async () => [1, 2]);

    await expect(getOrComputeWithRedisLock(redis as never, options(compute))).resolves.toEqual([
      1, 2,
    ]);
    expect(redis.set).toHaveBeenCalledWith("test:key:lock", "1", "EX", 5, "NX");
    expect(redis.setex).toHaveBeenCalledWith("test:key", 30, "[1,2]");
    expect(redis.del).toHaveBeenCalledWith("test:key:lock");
  });

  it("still returns and releases the lock when the cache write fails", async () => {
    const redis = createRedis();
    redis.setex.mockRejectedValueOnce(new Error("write failed"));
    const compute = vi.fn(async () => "value");

    await expect(getOrComputeWithRedisLock(redis as never, options(compute))).resolves.toBe(
      "value"
    );
    expect(compute).toHaveBeenCalledTimes(1);
    expect(redis.del).toHaveBeenCalled();
  });

  it("polls while another caller holds the lock", async () => {
    const redis = createRedis();
    redis.set.mockResolvedValueOnce(null);
    redis.get
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(JSON.stringify("filled"));
    const compute = vi.fn();

    const pending = getOrComputeWithRedisLock(redis as never, options(compute));
    await vi.advanceTimersByTimeAsync(200);

    await expect(pending).resolves.toBe("filled");
    expect(compute).not.toHaveBeenCalled();
    expect(redis.del).not.toHaveBeenCalled();
  });

  it("computes after the wait times out", async () => {
    const redis = createRedis();
    redis.set.mockResolvedValueOnce(null);
    const compute = vi.fn(async () => "late");

    const pending = getOrComputeWithRedisLock(redis as never, options(compute));
    await vi.advanceTimersByTimeAsync(300);

    await expect(pending).resolves.toBe("late");
    expect(redis.get).toHaveBeenCalledTimes(4);
  });

  it("falls back to computing on Redis errors and does not compute twice", async () => {
    const redis = createRedis();
    redis.get.mockRejectedValueOnce(new Error("read failed"));
    const compute = vi.fn(async () => "fallback");

    await expect(getOrComputeWithRedisLock(redis as never, options(compute))).resolves.toBe(
      "fallback"
    );
    expect(compute).toHaveBeenCalledTimes(1);
  });

  it("swallows lock release failures", async () => {
    const redis = createRedis();
    redis.del.mockImplementationOnce(() => {
      throw new Error("del failed");
    });

    await expect(
      getOrComputeWithRedisLock(
        redis as never,
        options(async () => "ok")
      )
    ).resolves.toBe("ok");
  });
});
