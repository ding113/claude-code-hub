import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";

class MockRedis extends EventEmitter {
  publish = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
  disconnect = vi.fn();
  quit = vi.fn();
  duplicate = vi.fn();
  status = "wait";
}

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

describe("Redis Pub/Sub cache invalidation", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("publishCacheInvalidation: should publish message to channel", async () => {
    const base = new MockRedis();
    base.publish.mockResolvedValue(1);

    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

    const { publishCacheInvalidation } = await import("@/lib/redis/pubsub");
    await publishCacheInvalidation("test-channel");

    expect(base.publish).toHaveBeenCalledTimes(1);
    const [channel, message] = base.publish.mock.calls[0] as [unknown, unknown];
    expect(channel).toBe("test-channel");
    expect(typeof message).toBe("string");
    expect((message as string).length).toBeGreaterThan(0);
  });

  test("publishCacheInvalidation: should handle Redis not available gracefully", async () => {
    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { publishCacheInvalidation } = await import("@/lib/redis/pubsub");
    await expect(publishCacheInvalidation("test-channel")).resolves.toBeUndefined();
  });

  test("subscribeCacheInvalidation: should register callback and receive messages", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);

    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

    const { CACHE_INVALIDATION_RESYNC_MESSAGE, subscribeCacheInvalidation } = await import(
      "@/lib/redis/pubsub"
    );
    const onInvalidate = vi.fn();

    // Start subscription (will wait for ready)
    const subscribePromise = subscribeCacheInvalidation("test-channel", onInvalidate);

    // Simulate connection ready
    subscriber.status = "ready";
    subscriber.emit("ready");

    const cleanup = await subscribePromise;
    expect(cleanup).not.toBeNull();
    expect(typeof cleanup).toBe("function");

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("test-channel");
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenLastCalledWith(CACHE_INVALIDATION_RESYNC_MESSAGE);

    const message = Date.now().toString();
    subscriber.emit("message", "test-channel", message);
    expect(onInvalidate).toHaveBeenCalledTimes(2);
    expect(onInvalidate).toHaveBeenCalledWith(message);

    cleanup!();
    subscriber.emit("message", "test-channel", Date.now().toString());
    expect(onInvalidate).toHaveBeenCalledTimes(2);
  });

  test("subscribeCacheInvalidation: should resubscribe on reconnect", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);

    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

    const { CACHE_INVALIDATION_RESYNC_MESSAGE, subscribeCacheInvalidation } = await import(
      "@/lib/redis/pubsub"
    );
    const onInvalidate = vi.fn();

    const subscribePromise = subscribeCacheInvalidation("test-channel", onInvalidate);

    subscriber.status = "ready";
    subscriber.emit("ready");

    const cleanup = await subscribePromise;
    expect(cleanup).not.toBeNull();
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith(CACHE_INVALIDATION_RESYNC_MESSAGE);

    subscriber.subscribe.mockClear();
    onInvalidate.mockClear();
    subscriber.emit("close");
    subscriber.emit("ready");
    await new Promise((resolve) => setImmediate(resolve));
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("test-channel");
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith(CACHE_INVALIDATION_RESYNC_MESSAGE);

    subscriber.subscribe.mockClear();
    onInvalidate.mockClear();
    subscriber.emit("close");
    subscriber.emit("ready");
    await new Promise((resolve) => setImmediate(resolve));
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("test-channel");
    expect(onInvalidate).toHaveBeenCalledTimes(1);
    expect(onInvalidate).toHaveBeenCalledWith(CACHE_INVALIDATION_RESYNC_MESSAGE);

    cleanup!();
  });

  test("subscribeCacheInvalidation: should handle Redis not configured gracefully", async () => {
    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const cleanup = await subscribeCacheInvalidation("test-channel", vi.fn());

    expect(cleanup).toBeNull();
  });

  test("subscribeCacheInvalidation: should retain registration on connection error", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);

    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const onInvalidate = vi.fn();

    // Start subscription
    const subscribePromise = subscribeCacheInvalidation("test-channel", onInvalidate);

    // Simulate connection error
    subscriber.emit("error", new Error("Connection refused"));

    const cleanup = await subscribePromise;
    expect(cleanup).not.toBeNull();
    expect(onInvalidate).not.toHaveBeenCalled();
    cleanup!();
  });

  test("subscribeCacheInvalidation: should persistently recover without a second caller", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    try {
      const base = new MockRedis();
      const subscriber1 = new MockRedis();
      const subscriber2 = new MockRedis();
      base.duplicate.mockReturnValueOnce(subscriber1).mockReturnValueOnce(subscriber2);
      subscriber2.subscribe.mockResolvedValue(1);

      const { getRedisClient } = await import("@/lib/redis/client");
      (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

      const { CACHE_INVALIDATION_RESYNC_MESSAGE, subscribeCacheInvalidation } = await import(
        "@/lib/redis/pubsub"
      );
      const onInvalidate = vi.fn();

      const cleanupPromise = subscribeCacheInvalidation("test-channel", onInvalidate);
      subscriber1.emit("error", new Error("Connection refused"));

      const cleanup = await cleanupPromise;
      expect(cleanup).not.toBeNull();
      expect(base.duplicate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(999);
      expect(base.duplicate).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      expect(base.duplicate).toHaveBeenCalledTimes(2);

      subscriber2.status = "ready";
      subscriber2.emit("ready");
      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber2.subscribe).toHaveBeenCalledWith("test-channel");
      expect(onInvalidate).toHaveBeenCalledTimes(1);
      expect(onInvalidate).toHaveBeenCalledWith(CACHE_INVALIDATION_RESYNC_MESSAGE);
      cleanup!();
    } finally {
      vi.useRealTimers();
    }
  });

  test("subscribeCacheInvalidation: should create a fresh subscriber after retry exhaustion", async () => {
    vi.useFakeTimers();
    try {
      const base = new MockRedis();
      const subscriber1 = new MockRedis();
      const subscriber2 = new MockRedis();
      subscriber1.subscribe.mockResolvedValue(1);
      subscriber2.subscribe.mockResolvedValue(1);
      base.duplicate.mockReturnValueOnce(subscriber1).mockReturnValueOnce(subscriber2);

      const { getRedisClient } = await import("@/lib/redis/client");
      (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

      const { CACHE_INVALIDATION_RESYNC_MESSAGE, subscribeCacheInvalidation } = await import(
        "@/lib/redis/pubsub"
      );
      const onInvalidate = vi.fn();

      const subscribePromise = subscribeCacheInvalidation("test-channel", onInvalidate);
      subscriber1.status = "ready";
      subscriber1.emit("ready");
      const cleanup = await subscribePromise;

      onInvalidate.mockClear();
      subscriber1.status = "end";
      subscriber1.emit("close");
      subscriber1.emit("end");

      await vi.advanceTimersByTimeAsync(1000);
      expect(base.duplicate).toHaveBeenCalledTimes(2);

      subscriber2.status = "ready";
      subscriber2.emit("ready");
      await vi.advanceTimersByTimeAsync(0);

      expect(subscriber2.subscribe).toHaveBeenCalledWith("test-channel");
      expect(onInvalidate).toHaveBeenCalledTimes(1);
      expect(onInvalidate).toHaveBeenCalledWith(CACHE_INVALIDATION_RESYNC_MESSAGE);
      cleanup!();
    } finally {
      vi.useRealTimers();
    }
  });

  test("subscribeCacheInvalidation: should retain callback when SUBSCRIBE fails and retry", async () => {
    vi.useFakeTimers();
    try {
      const base = new MockRedis();
      const subscriber = new MockRedis();
      base.duplicate.mockReturnValue(subscriber);
      subscriber.subscribe
        .mockRejectedValueOnce(new Error("Subscribe failed"))
        .mockResolvedValueOnce(1);

      const { getRedisClient } = await import("@/lib/redis/client");
      (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

      const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

      const onInvalidateA = vi.fn();
      const subscribePromiseA = subscribeCacheInvalidation("test-channel", onInvalidateA);

      subscriber.status = "ready";
      subscriber.emit("ready");

      const cleanupA = await subscribePromiseA;
      expect(cleanupA).not.toBeNull();
      expect(onInvalidateA).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(1000);
      expect(subscriber.subscribe).toHaveBeenCalledTimes(2);
      expect(onInvalidateA).toHaveBeenCalledTimes(1);

      subscriber.emit("message", "test-channel", Date.now().toString());

      expect(onInvalidateA).toHaveBeenCalledTimes(2);

      cleanupA!();
    } finally {
      vi.useRealTimers();
    }
  });

  test("subscribeCacheInvalidation: should timeout waiting for ready and disconnect subscriber", async () => {
    vi.useFakeTimers();
    try {
      const base = new MockRedis();
      const subscriber = new MockRedis();
      base.duplicate.mockReturnValue(subscriber);

      const { getRedisClient } = await import("@/lib/redis/client");
      (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(base);

      const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
      const subscribePromise = subscribeCacheInvalidation("test-channel", vi.fn());

      await vi.advanceTimersByTimeAsync(10000);

      const cleanup = await subscribePromise;
      expect(cleanup).not.toBeNull();
      expect(subscriber.disconnect).toHaveBeenCalledTimes(1);
      cleanup!();
    } finally {
      vi.useRealTimers();
    }
  });
});
