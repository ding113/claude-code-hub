import { describe, expect, it, vi } from "vitest";
import { RedisListStore } from "@/lib/redis/redis-list-store";

function createMockClient() {
  return {
    status: "ready",
    rpush: vi.fn().mockResolvedValue(3),
    lrange: vi.fn().mockResolvedValue(["a", "b"]),
    llen: vi.fn().mockResolvedValue(2),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe("RedisListStore", () => {
  it("rpushBatch appends values with prefix and refreshes TTL", async () => {
    const client = createMockClient();
    const store = new RedisListStore({ prefix: "cch:replay:", redisClient: client as never });
    const length = await store.rpushBatch("k1:chunks", ["c1", "c2"], 600);
    expect(length).toBe(3);
    expect(client.rpush).toHaveBeenCalledWith("cch:replay:k1:chunks", "c1", "c2");
    expect(client.expire).toHaveBeenCalledWith("cch:replay:k1:chunks", 600);
  });

  it("rpushBatch skips empty batches", async () => {
    const client = createMockClient();
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    expect(await store.rpushBatch("k", [])).toBeNull();
    expect(client.rpush).not.toHaveBeenCalled();
  });

  it("lrangeFrom reads from offset to end", async () => {
    const client = createMockClient();
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    expect(await store.lrangeFrom("k", 5)).toEqual(["a", "b"]);
    expect(client.lrange).toHaveBeenCalledWith("p:k", 5, -1);
  });

  it("fails open (null/false) when redis is unavailable", async () => {
    const store = new RedisListStore({ prefix: "p:", redisClient: null });
    expect(await store.rpushBatch("k", ["v"])).toBeNull();
    expect(await store.lrangeFrom("k", 0)).toBeNull();
    expect(await store.llen("k")).toBeNull();
    expect(await store.expire("k", 60)).toBe(false);
    expect(await store.delete("k")).toBe(false);
  });

  it("fails open when redis client is not ready", async () => {
    const client = { ...createMockClient(), status: "connecting" };
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    expect(await store.llen("k")).toBeNull();
    expect(client.llen).not.toHaveBeenCalled();
  });

  it("fails open (null) when a redis command throws", async () => {
    const client = createMockClient();
    client.rpush.mockRejectedValue(new Error("boom"));
    client.lrange.mockRejectedValue(new Error("boom"));
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    expect(await store.rpushBatch("k", ["v"])).toBeNull();
    expect(await store.lrangeFrom("k", 0)).toBeNull();
  });
});
