import { describe, expect, it, vi } from "vitest";
import { RedisListStore } from "@/lib/redis/redis-list-store";

function createMockClient() {
  return {
    status: "ready",
    eval: vi.fn().mockResolvedValue(3),
    lrange: vi.fn().mockResolvedValue(["a", "b"]),
    llen: vi.fn().mockResolvedValue(2),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  };
}

describe("RedisListStore", () => {
  it("rpushBatch atomically appends values with prefix and TTL in a single Lua eval", async () => {
    const client = createMockClient();
    const store = new RedisListStore({ prefix: "cch:replay:", redisClient: client as never });
    const length = await store.rpushBatch("k1:chunks", ["c1", "c2"], 600);
    expect(length).toBe(3);
    expect(client.eval).toHaveBeenCalledTimes(1);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("RPUSH"),
      1,
      "cch:replay:k1:chunks",
      600,
      "c1",
      "c2"
    );
    const script = client.eval.mock.calls[0][0] as string;
    expect(script).toContain("EXPIRE");
  });

  it("rpushBatch passes ttl 0 (no expire branch) when ttlSeconds is absent or non-positive", async () => {
    const client = createMockClient();
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    await store.rpushBatch("k", ["v"]);
    expect(client.eval).toHaveBeenLastCalledWith(expect.any(String), 1, "p:k", 0, "v");
    await store.rpushBatch("k", ["v"], 0);
    expect(client.eval).toHaveBeenLastCalledWith(expect.any(String), 1, "p:k", 0, "v");
  });

  it("rpushBatch skips empty batches", async () => {
    const client = createMockClient();
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    expect(await store.rpushBatch("k", [])).toBeNull();
    expect(client.eval).not.toHaveBeenCalled();
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
    client.eval.mockRejectedValue(new Error("boom"));
    client.lrange.mockRejectedValue(new Error("boom"));
    const store = new RedisListStore({ prefix: "p:", redisClient: client as never });
    expect(await store.rpushBatch("k", ["v"], 600)).toBeNull();
    expect(await store.lrangeFrom("k", 0)).toBeNull();
  });
});
