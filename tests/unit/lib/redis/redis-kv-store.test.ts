import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const setexMock = vi.fn();
const getMock = vi.fn();
const delMock = vi.fn();
const evalMock = vi.fn();

function createMockRedis(status = "ready") {
  return {
    status,
    setex: setexMock,
    get: getMock,
    del: delMock,
    eval: evalMock,
  };
}

vi.mock("@/lib/logger", () => ({
  logger: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/redis/client", () => ({
  getRedisClient: vi.fn(),
}));

vi.mock("server-only", () => ({}));

describe("RedisKVStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function createStore<T>(options?: { status?: string }) {
    const { RedisKVStore } = await import("@/lib/redis/redis-kv-store");
    const redis = createMockRedis(options?.status);
    return {
      store: new RedisKVStore<T>({
        prefix: "test:",
        defaultTtlSeconds: 60,
        redisClient: redis,
      }),
      redis,
    };
  }

  describe("set", () => {
    it("stores value with SETEX and default TTL", async () => {
      const { store } = await createStore<{ name: string }>();
      setexMock.mockResolvedValue("OK");

      const result = await store.set("key1", { name: "alice" });

      expect(result).toBe(true);
      expect(setexMock).toHaveBeenCalledWith("test:key1", 60, JSON.stringify({ name: "alice" }));
    });

    it("uses custom TTL when provided", async () => {
      const { store } = await createStore<string>();
      setexMock.mockResolvedValue("OK");

      await store.set("key2", "value", 30);

      expect(setexMock).toHaveBeenCalledWith("test:key2", 30, JSON.stringify("value"));
    });

    it("returns false when Redis is not ready", async () => {
      const { store } = await createStore<string>({ status: "connecting" });

      const result = await store.set("key3", "value");

      expect(result).toBe(false);
      expect(setexMock).not.toHaveBeenCalled();
    });

    it("returns false when SETEX throws", async () => {
      const { store } = await createStore<string>();
      setexMock.mockRejectedValue(new Error("Redis write error"));

      const result = await store.set("key4", "value");

      expect(result).toBe(false);
    });
  });

  describe("get", () => {
    it("retrieves and deserializes stored value", async () => {
      const { store } = await createStore<{ count: number }>();
      getMock.mockResolvedValue(JSON.stringify({ count: 42 }));

      const result = await store.get("key1");

      expect(result).toEqual({ count: 42 });
      expect(getMock).toHaveBeenCalledWith("test:key1");
    });

    it("returns null for missing key", async () => {
      const { store } = await createStore<string>();
      getMock.mockResolvedValue(null);

      const result = await store.get("missing");

      expect(result).toBeNull();
    });

    it("returns null when Redis is not ready", async () => {
      const { store } = await createStore<string>({ status: "connecting" });

      const result = await store.get("key1");

      expect(result).toBeNull();
      expect(getMock).not.toHaveBeenCalled();
    });

    it("returns null when GET throws", async () => {
      const { store } = await createStore<string>();
      getMock.mockRejectedValue(new Error("Redis read error"));

      const result = await store.get("key1");

      expect(result).toBeNull();
    });

    it("returns null when stored value is malformed JSON", async () => {
      const { store } = await createStore<{ count: number }>();
      getMock.mockResolvedValue("not-valid-json");

      const result = await store.get("corrupted");

      expect(result).toBeNull();
    });
  });

  describe("getAndDelete", () => {
    it("atomically retrieves and deletes key via Lua script", async () => {
      const { store } = await createStore<{ id: string }>();
      evalMock.mockResolvedValue(JSON.stringify({ id: "abc" }));

      const result = await store.getAndDelete("key1");

      expect(result).toEqual({ id: "abc" });
      expect(evalMock).toHaveBeenCalledWith(expect.any(String), 1, "test:key1");
    });

    it("returns null for missing key", async () => {
      const { store } = await createStore<string>();
      evalMock.mockResolvedValue(null);

      const result = await store.getAndDelete("missing");

      expect(result).toBeNull();
    });

    it("returns null when Redis is not ready", async () => {
      const { store } = await createStore<string>({ status: "end" });

      const result = await store.getAndDelete("key1");

      expect(result).toBeNull();
    });

    it("returns null when eval throws", async () => {
      const { store } = await createStore<string>();
      evalMock.mockRejectedValue(new Error("Redis eval error"));

      const result = await store.getAndDelete("key1");

      expect(result).toBeNull();
    });

    it("returns null when stored value is malformed JSON", async () => {
      const { store } = await createStore<{ count: number }>();
      evalMock.mockResolvedValue("{invalid json...");

      const result = await store.getAndDelete("corrupted-key");

      expect(result).toBeNull();
    });
  });

  describe("delete", () => {
    it("deletes key and returns true when key existed", async () => {
      const { store } = await createStore<string>();
      delMock.mockResolvedValue(1);

      const result = await store.delete("key1");

      expect(result).toBe(true);
      expect(delMock).toHaveBeenCalledWith("test:key1");
    });

    it("returns false when key did not exist", async () => {
      const { store } = await createStore<string>();
      delMock.mockResolvedValue(0);

      const result = await store.delete("missing");

      expect(result).toBe(false);
    });

    it("returns false when Redis is not ready", async () => {
      const { store } = await createStore<string>({ status: "connecting" });

      const result = await store.delete("key1");

      expect(result).toBe(false);
    });

    it("returns false when DEL throws", async () => {
      const { store } = await createStore<string>();
      delMock.mockRejectedValue(new Error("Redis delete error"));

      const result = await store.delete("key1");

      expect(result).toBe(false);
    });
  });

  describe("key prefixing", () => {
    it("prepends prefix to all operations", async () => {
      const { store } = await createStore<string>();
      setexMock.mockResolvedValue("OK");
      getMock.mockResolvedValue(null);
      delMock.mockResolvedValue(0);

      await store.set("mykey", "val");
      await store.get("mykey");
      await store.delete("mykey");

      expect(setexMock).toHaveBeenCalledWith("test:mykey", expect.any(Number), expect.any(String));
      expect(getMock).toHaveBeenCalledWith("test:mykey");
      expect(delMock).toHaveBeenCalledWith("test:mykey");
    });
  });

  describe("injected client", () => {
    it("returns null for all ops when injected client is null", async () => {
      const { RedisKVStore } = await import("@/lib/redis/redis-kv-store");
      const store = new RedisKVStore<string>({
        prefix: "test:",
        defaultTtlSeconds: 60,
        redisClient: null,
      });

      expect(await store.set("k", "v")).toBe(false);
      expect(await store.get("k")).toBeNull();
      expect(await store.getAndDelete("k")).toBeNull();
      expect(await store.delete("k")).toBe(false);
    });
  });
});
