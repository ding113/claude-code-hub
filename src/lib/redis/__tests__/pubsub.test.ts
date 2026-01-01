import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, test, vi } from "vitest";

class MockRedis extends EventEmitter {
  publish = vi.fn();
  subscribe = vi.fn();
  unsubscribe = vi.fn();
  quit = vi.fn();
  duplicate = vi.fn();
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

async function mockRedisClient(value: MockRedis | null) {
  const { getRedisClient } = await import("@/lib/redis/client");
  (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(value);
}

describe("Redis Pub/Sub 缓存失效通知", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  test("publishCacheInvalidation: should publish message to channel", async () => {
    const base = new MockRedis();
    base.publish.mockResolvedValue(1);

    await mockRedisClient(base);

    const { publishCacheInvalidation } = await import("@/lib/redis/pubsub");
    await publishCacheInvalidation("test-channel");

    expect(base.publish).toHaveBeenCalledTimes(1);
    const [channel, message] = base.publish.mock.calls[0] as [unknown, unknown];
    expect(channel).toBe("test-channel");
    expect(typeof message).toBe("string");
    expect((message as string).length).toBeGreaterThan(0);
  });

  test("publishCacheInvalidation: should handle Redis not available gracefully", async () => {
    await mockRedisClient(null);

    const { publishCacheInvalidation } = await import("@/lib/redis/pubsub");
    await expect(publishCacheInvalidation("test-channel")).resolves.toBeUndefined();
  });

  test("publishCacheInvalidation: should swallow publish errors and log warn", async () => {
    const base = new MockRedis();
    const publishError = new Error("network error");
    base.publish.mockRejectedValue(publishError);

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { publishCacheInvalidation } = await import("@/lib/redis/pubsub");

    await expect(publishCacheInvalidation("test-channel")).resolves.toBeUndefined();

    expect(base.publish).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[RedisPubSub] Failed to publish cache invalidation",
      expect.objectContaining({
        channel: "test-channel",
        error: publishError,
      })
    );
  });

  test("subscribeCacheInvalidation: should register callback and receive messages", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);
    subscriber.unsubscribe.mockResolvedValue(1);

    await mockRedisClient(base);

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const onInvalidate = vi.fn();

    const cleanup = await subscribeCacheInvalidation("test-channel", onInvalidate);
    expect(typeof cleanup).toBe("function");

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("test-channel");

    subscriber.emit("message", "test-channel", Date.now().toString());
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    cleanup();
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith("test-channel");
    subscriber.emit("message", "test-channel", Date.now().toString());
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  test("subscribeCacheInvalidation: should handle Redis not configured gracefully", async () => {
    await mockRedisClient(null);

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const cleanup = await subscribeCacheInvalidation("test-channel", vi.fn());

    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
  });

  test("subscribeCacheInvalidation: should subscribe once per channel and unsubscribe on last cleanup", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);
    subscriber.unsubscribe.mockResolvedValue(1);

    await mockRedisClient(base);

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    const cleanup1 = await subscribeCacheInvalidation("test-channel", cb1);
    const cleanup2 = await subscribeCacheInvalidation("test-channel", cb2);

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("test-channel");

    subscriber.emit("message", "test-channel", "msg");
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(1);

    cleanup1();
    expect(subscriber.unsubscribe).not.toHaveBeenCalled();

    subscriber.emit("message", "test-channel", "msg");
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(2);

    cleanup2();
    expect(subscriber.unsubscribe).toHaveBeenCalledTimes(1);
    expect(subscriber.unsubscribe).toHaveBeenCalledWith("test-channel");

    subscriber.emit("message", "test-channel", "msg");
    expect(cb1).toHaveBeenCalledTimes(1);
    expect(cb2).toHaveBeenCalledTimes(2);
  });

  test("subscribeCacheInvalidation: should catch callback errors and continue", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);
    subscriber.unsubscribe.mockResolvedValue(1);

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    const badCb = vi.fn(() => {
      throw new Error("callback error");
    });
    const goodCb = vi.fn();

    const cleanupBad = await subscribeCacheInvalidation("test-channel", badCb);
    const cleanupGood = await subscribeCacheInvalidation("test-channel", goodCb);

    subscriber.emit("message", "test-channel", "msg");

    expect(badCb).toHaveBeenCalledTimes(1);
    expect(goodCb).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledTimes(1);
    expect(logger.error).toHaveBeenCalledWith(
      "[RedisPubSub] Callback error",
      expect.objectContaining({
        channel: "test-channel",
        error: expect.any(Error),
      })
    );

    cleanupBad();
    cleanupGood();
  });

  test("subscribeCacheInvalidation: should log warn on subscriber connection error event", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    await subscribeCacheInvalidation("test-channel", vi.fn());

    const error = new Error("subscriber network error");
    subscriber.emit("error", error);

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[RedisPubSub] Subscriber connection error",
      expect.objectContaining({ error })
    );
  });

  test("subscribeCacheInvalidation: should handle duplicate errors gracefully", async () => {
    const base = new MockRedis();
    const duplicateError = new Error("duplicate error");
    base.duplicate.mockImplementation(() => {
      throw duplicateError;
    });

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    const cleanup = await subscribeCacheInvalidation("test-channel", vi.fn());
    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();

    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[RedisPubSub] Failed to subscribe cache invalidation",
      expect.objectContaining({
        channel: "test-channel",
        error: duplicateError,
      })
    );
  });

  test("subscribeCacheInvalidation: should not leak state when subscribe fails (allow retry)", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);

    const subscribeError = new Error("subscribe error");
    subscriber.subscribe.mockRejectedValueOnce(subscribeError).mockResolvedValueOnce(1);
    subscriber.unsubscribe.mockResolvedValue(1);

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    const cb1 = vi.fn();
    const cleanup1 = await subscribeCacheInvalidation("test-channel", cb1);
    expect(typeof cleanup1).toBe("function");

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith(
      "[RedisPubSub] Failed to subscribe cache invalidation",
      expect.objectContaining({
        channel: "test-channel",
        error: subscribeError,
      })
    );

    const cb2 = vi.fn();
    const cleanup2 = await subscribeCacheInvalidation("test-channel", cb2);

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);

    subscriber.emit("message", "test-channel", "msg");
    expect(cb1).toHaveBeenCalledTimes(0);
    expect(cb2).toHaveBeenCalledTimes(1);

    cleanup2();
    expect(subscriber.unsubscribe).toHaveBeenCalledWith("test-channel");
  });

  test("subscribeCacheInvalidation: should swallow unsubscribe errors and log warn", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);

    const unsubscribeError = new Error("unsubscribe error");
    subscriber.unsubscribe.mockRejectedValueOnce(unsubscribeError);

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    const cleanup = await subscribeCacheInvalidation("test-channel", vi.fn());
    expect(() => cleanup()).not.toThrow();

    // 等待 microtask queue 清空，确保 Promise.resolve().then().catch() 链完成
    await new Promise((resolve) => setTimeout(resolve, 10));

    expect(logger.warn).toHaveBeenCalledWith(
      "[RedisPubSub] Failed to unsubscribe cache invalidation",
      expect.objectContaining({
        channel: "test-channel",
        error: unsubscribeError,
      })
    );
  });

  test("closeSubscriber: should quit subscriber and clear subscriptions", async () => {
    const base = new MockRedis();
    const subscriber1 = new MockRedis();
    const subscriber2 = new MockRedis();
    base.duplicate.mockReturnValueOnce(subscriber1).mockReturnValueOnce(subscriber2);
    subscriber1.subscribe.mockResolvedValue(1);
    subscriber2.subscribe.mockResolvedValue(1);

    await mockRedisClient(base);

    const { closeSubscriber, subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    const cb1 = vi.fn();
    await subscribeCacheInvalidation("test-channel", cb1);
    expect(base.duplicate).toHaveBeenCalledTimes(1);

    await closeSubscriber();
    expect(subscriber1.quit).toHaveBeenCalledTimes(1);

    subscriber1.emit("message", "test-channel", "msg");
    expect(cb1).toHaveBeenCalledTimes(0);

    const cb2 = vi.fn();
    await subscribeCacheInvalidation("test-channel", cb2);
    expect(base.duplicate).toHaveBeenCalledTimes(2);

    subscriber2.emit("message", "test-channel", "msg");
    expect(cb2).toHaveBeenCalledTimes(1);
  });

  test("closeSubscriber: should swallow quit errors and log warn", async () => {
    const base = new MockRedis();
    const subscriber = new MockRedis();
    base.duplicate.mockReturnValue(subscriber);
    subscriber.subscribe.mockResolvedValue(1);

    const quitError = new Error("quit error");
    subscriber.quit.mockRejectedValue(quitError);

    await mockRedisClient(base);

    const { logger } = await import("@/lib/logger");
    const { closeSubscriber, subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");

    await subscribeCacheInvalidation("test-channel", vi.fn());
    await expect(closeSubscriber()).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "[RedisPubSub] Failed to close subscriber",
      expect.objectContaining({ error: quitError })
    );
  });
});
