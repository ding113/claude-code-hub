import { describe, expect, it, vi } from "vitest";
import { AffinityStore, getAffinityStore } from "@/app/v1/_lib/proxy/affinity/affinity-store";

/**
 * Fake redis that executes the lookup Lua semantics in JS against an in-memory
 * map: scan KEYS in order, return the first value with an active "1|" prefix,
 * sliding-expire it when ttl > 0. This keeps the value encoding written by
 * put()/tombstone() and the prefix matched by the Lua script under one test.
 */
function createLuaFakeRedis(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const expired: Array<{ key: string; ttl: number }> = [];
  const client = {
    status: "ready",
    set: vi.fn(async (key: string, value: string, _ex: string, ttl: number) => {
      data.set(key, value);
      expired.push({ key, ttl });
      return "OK";
    }),
    del: vi.fn(async () => 1),
    eval: vi.fn(async (_script: string, numkeys: number, ...rest: (string | number)[]) => {
      const keys = rest.slice(0, numkeys) as string[];
      const ttl = Number(rest[numkeys]);
      for (let i = 0; i < keys.length; i++) {
        const value = data.get(keys[i]);
        if (value?.startsWith("1|")) {
          if (ttl > 0) expired.push({ key: keys[i], ttl });
          return [i + 1, value];
        }
      }
      return null;
    }),
  };
  return { client, data, expired };
}

function makeStore(client: unknown) {
  return new AffinityStore({ redisClient: client as never });
}

const key = (scope: string, fp: string) => `cch:pfx:{${scope}}:fp:${fp}`;

describe("AffinityStore.lookup", () => {
  it("returns the deepest active binding (MGET-style deepest-first scan)", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "1|42",
      [key("s1", "mid")]: "1|7",
      [key("s1", "sysf")]: "1|7",
    });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "sysf"], 600);
    expect(hint).toEqual({
      providerId: 42,
      matchedIndex: 0,
      matchedFp: "deep",
      tier: "conversation",
    });
  });

  it("passes keys deepest-first with the scope hash-tag key format and sliding ttl", async () => {
    const { client } = createLuaFakeRedis();
    await makeStore(client).lookup("tag", ["deep", "mid", "sysf"], 300.9);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("GET"),
      3,
      key("tag", "deep"),
      key("tag", "mid"),
      key("tag", "sysf"),
      "300"
    );
  });

  it("skips a tombstoned deepest boundary and falls back to a shallower active one", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "0|failover",
      [key("s1", "mid")]: "1|7",
    });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "sysf"], 600);
    expect(hint).toEqual({
      providerId: 7,
      matchedIndex: 1,
      matchedFp: "mid",
      tier: "conversation",
    });
  });

  it("maps a match on the last (sys) fingerprint to the system tier", async () => {
    const { client } = createLuaFakeRedis({ [key("s1", "sysf")]: "1|9" });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "sysf"], 600);
    expect(hint?.tier).toBe("system");
    expect(hint?.matchedIndex).toBe(2);
  });

  it("returns null when all boundaries are tombstoned or absent", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "0|failover",
      [key("s1", "sysf")]: "0|failover",
    });
    const store = makeStore(client);
    expect(await store.lookup("s1", ["deep", "sysf"], 600)).toBeNull();
    expect(await store.lookup("s1", ["missing-a", "missing-b"], 600)).toBeNull();
  });

  it("slides the TTL on hit and skips renewal when ttl is not positive", async () => {
    const { client, expired } = createLuaFakeRedis({ [key("s1", "deep")]: "1|3" });
    const store = makeStore(client);
    await store.lookup("s1", ["deep"], 900);
    expect(expired).toEqual([{ key: key("s1", "deep"), ttl: 900 }]);

    await store.lookup("s1", ["deep"], -10);
    expect(client.eval).toHaveBeenLastCalledWith(expect.any(String), 1, key("s1", "deep"), "0");
    expect(expired).toHaveLength(1);
  });

  it("rejects malformed or non-positive provider ids", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    for (const value of ["1|abc", "1|0", "1|-5"]) {
      client.eval.mockResolvedValueOnce([1, value]);
      expect(await store.lookup("s1", ["deep"], 600)).toBeNull();
    }
    client.eval.mockResolvedValueOnce("garbage");
    expect(await store.lookup("s1", ["deep"], 600)).toBeNull();
  });

  it("returns null without touching redis for empty scope or fingerprints", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    expect(await store.lookup("", ["deep"], 600)).toBeNull();
    expect(await store.lookup("s1", [], 600)).toBeNull();
    expect(await store.lookup("s1", ["", ""], 600)).toBeNull();
    expect(client.eval).not.toHaveBeenCalled();
  });
});

describe("AffinityStore.put", () => {
  it("writes only tip + sys boundaries with the active encoding and TTL", async () => {
    const { client } = createLuaFakeRedis();
    await makeStore(client).put("s1", "tipfp", "sysfp", 42, 900);
    expect(client.set).toHaveBeenCalledTimes(2);
    expect(client.set).toHaveBeenNthCalledWith(1, key("s1", "tipfp"), "1|42", "EX", 900);
    expect(client.set).toHaveBeenNthCalledWith(2, key("s1", "sysfp"), "1|42", "EX", 900);
  });

  it("writes a single key when tip and sys collide or sys is empty", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.put("s1", "same", "same", 42, 900);
    await store.put("s1", "solo", "", 42, 900);
    expect(client.set).toHaveBeenCalledTimes(2);
    expect(client.set).toHaveBeenNthCalledWith(1, key("s1", "same"), "1|42", "EX", 900);
    expect(client.set).toHaveBeenNthCalledWith(2, key("s1", "solo"), "1|42", "EX", 900);
  });

  it("ignores invalid arguments", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.put("", "tip", "sys", 42, 900);
    await store.put("s1", "", "sys", 42, 900);
    await store.put("s1", "tip", "sys", 0, 900);
    await store.put("s1", "tip", "sys", 42, 0);
    expect(client.set).not.toHaveBeenCalled();
  });
});

describe("AffinityStore.tombstone", () => {
  it("writes a short-TTL tombstone with a truncated reason", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.tombstone("s1", "deadfp", "failover");
    expect(client.set).toHaveBeenCalledWith(key("s1", "deadfp"), "0|failover", "EX", 60);

    await store.tombstone("s1", "deadfp", "x".repeat(50));
    expect(client.set).toHaveBeenLastCalledWith(
      key("s1", "deadfp"),
      `0|${"x".repeat(32)}`,
      "EX",
      60
    );
  });

  it("ignores empty scope or fingerprint", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.tombstone("", "fp", "r");
    await store.tombstone("s1", "", "r");
    expect(client.set).not.toHaveBeenCalled();
  });
});

describe("AffinityStore round-trip through the fake Lua", () => {
  it("put -> lookup hits, tombstone on tip falls back to sys, tombstone on sys misses", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);

    await store.put("s1", "tip", "sysf", 42, 600);
    expect(await store.lookup("s1", ["tip", "sysf"], 600)).toEqual({
      providerId: 42,
      matchedIndex: 0,
      matchedFp: "tip",
      tier: "conversation",
    });

    await store.tombstone("s1", "tip", "failover");
    expect(await store.lookup("s1", ["tip", "sysf"], 600)).toEqual({
      providerId: 42,
      matchedIndex: 1,
      matchedFp: "sysf",
      tier: "system",
    });

    await store.tombstone("s1", "sysf", "failover");
    expect(await store.lookup("s1", ["tip", "sysf"], 600)).toBeNull();
  });
});

describe("AffinityStore fail-open behavior", () => {
  it("fails open when redis is unavailable or not ready", async () => {
    const nullStore = makeStore(null);
    expect(await nullStore.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(nullStore.put("s1", "tip", "sys", 42, 600)).resolves.toBeUndefined();
    await expect(nullStore.tombstone("s1", "fp", "r")).resolves.toBeUndefined();

    const { client } = createLuaFakeRedis();
    client.status = "connecting";
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await store.put("s1", "tip", "sys", 42, 600);
    await store.tombstone("s1", "fp", "r");
    expect(client.eval).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it("fails open when redis commands throw", async () => {
    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValue(new Error("boom"));
    client.set.mockRejectedValue(new Error("boom"));
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(store.put("s1", "tip", "sys", 42, 600)).resolves.toBeUndefined();
    await expect(store.tombstone("s1", "fp", "r")).resolves.toBeUndefined();
  });

  it("fails open when redis rejects with a non-Error value", async () => {
    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValue("string failure");
    client.set.mockRejectedValue("string failure");
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(store.put("s1", "tip", "sys", 42, 600)).resolves.toBeUndefined();
    await expect(store.tombstone("s1", "fp", "r")).resolves.toBeUndefined();
  });
});

describe("getAffinityStore", () => {
  it("returns a shared singleton instance", () => {
    const a = getAffinityStore();
    expect(a).toBeInstanceOf(AffinityStore);
    expect(getAffinityStore()).toBe(a);
  });
});
