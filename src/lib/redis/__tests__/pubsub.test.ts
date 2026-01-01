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

describe("Redis Pub/Sub 缓存失效通知", () => {
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

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const onInvalidate = vi.fn();

    const cleanup = await subscribeCacheInvalidation("test-channel", onInvalidate);
    expect(typeof cleanup).toBe("function");

    expect(base.duplicate).toHaveBeenCalledTimes(1);
    expect(subscriber.subscribe).toHaveBeenCalledWith("test-channel");

    subscriber.emit("message", "test-channel", Date.now().toString());
    expect(onInvalidate).toHaveBeenCalledTimes(1);

    cleanup();
    subscriber.emit("message", "test-channel", Date.now().toString());
    expect(onInvalidate).toHaveBeenCalledTimes(1);
  });

  test("subscribeCacheInvalidation: should handle Redis not configured gracefully", async () => {
    const { getRedisClient } = await import("@/lib/redis/client");
    (getRedisClient as unknown as ReturnType<typeof vi.fn>).mockReturnValue(null);

    const { subscribeCacheInvalidation } = await import("@/lib/redis/pubsub");
    const cleanup = await subscribeCacheInvalidation("test-channel", vi.fn());

    expect(typeof cleanup).toBe("function");
    expect(() => cleanup()).not.toThrow();
  });
});
