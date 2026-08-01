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
    del: vi.fn(async (...keys: string[]) => {
      for (const redisKey of keys) data.delete(redisKey);
      return keys.length;
    }),
    eval: vi.fn(async (script: string, numkeys: number, ...rest: (string | number)[]) => {
      const keys = rest.slice(0, numkeys) as string[];
      const args = rest.slice(numkeys).map(String);

      if (script.includes("affinity_lookup_v2")) {
        const generationKey = keys.at(-1) as string;
        if (!data.has(generationKey)) data.set(generationKey, "0");
        const generation = data.get(generationKey) as string;
        const ttl = Number(args[0]);
        for (let i = 0; i < keys.length - 1; i++) {
          const value = data.get(keys[i]);
          const bindingGeneration = value?.split("|")[2] ?? "0";
          if (value?.startsWith("1|") && bindingGeneration === generation) {
            if (ttl > 0) expired.push({ key: keys[i], ttl });
            return [i + 1, value, generation];
          }
        }
        return [0, "", generation];
      }

      if (script.includes("affinity_cas_write_v1")) {
        const [generationKey, bindingKey] = keys;
        const [expectedGeneration, value, ttlRaw] = args;
        if (data.get(generationKey) !== expectedGeneration) return 0;
        data.set(bindingKey, value);
        expired.push({ key: bindingKey, ttl: Number(ttlRaw) });
        return 1;
      }

      if (script.includes("affinity_invalidate_v1")) {
        const [generationKey, ...bindingKeys] = keys;
        const generation = Number(data.get(generationKey) ?? "0") + 1;
        data.set(generationKey, String(generation));
        for (const bindingKey of bindingKeys) data.delete(bindingKey);
        return generation;
      }

      throw new Error("unexpected lua script");
    }),
  };
  return { client, data, expired };
}

function makeStore(client: unknown) {
  return new AffinityStore({ redisClient: client as never });
}

const key = (scope: string, fp: string) => `cch:pfx:{${scope}}:fp:${fp}`;
const generationKey = (scope: string) => `cch:pfx:{${scope}}:generation`;

describe("AffinityStore.lookup", () => {
  it("returns the deepest active binding (MGET-style deepest-first scan)", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "1|42",
      [key("s1", "mid")]: "1|7",
      [key("s1", "sysf")]: "1|7",
    });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "sysf"], 600);
    expect(hint).toEqual({
      generation: "0",
      hint: {
        providerId: 42,
        matchedIndex: 0,
        matchedFp: "deep",
      },
    });
  });

  it("passes keys deepest-first with the scope hash-tag key format and sliding ttl", async () => {
    const { client } = createLuaFakeRedis();
    await makeStore(client).lookup("tag", ["deep", "mid", "sysf"], 300.9);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("GET"),
      4,
      key("tag", "deep"),
      key("tag", "mid"),
      key("tag", "sysf"),
      generationKey("tag"),
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
      generation: "0",
      hint: {
        providerId: 7,
        matchedIndex: 1,
        matchedFp: "mid",
      },
    });
  });

  it("matches the shallowest boundary when only it is active", async () => {
    const { client } = createLuaFakeRedis({ [key("s1", "shallow")]: "1|9" });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "shallow"], 600);
    expect(hint?.hint?.matchedFp).toBe("shallow");
    expect(hint?.hint?.matchedIndex).toBe(2);
  });

  it("returns null when all boundaries are tombstoned or absent", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "0|failover",
      [key("s1", "sysf")]: "0|failover",
    });
    const store = makeStore(client);
    expect((await store.lookup("s1", ["deep", "sysf"], 600))?.hint).toBeNull();
    expect((await store.lookup("s1", ["missing-a", "missing-b"], 600))?.hint).toBeNull();
  });

  it("slides the TTL on hit and skips renewal when ttl is not positive", async () => {
    const { client, expired } = createLuaFakeRedis({ [key("s1", "deep")]: "1|3" });
    const store = makeStore(client);
    await store.lookup("s1", ["deep"], 900);
    expect(expired).toEqual([{ key: key("s1", "deep"), ttl: 900 }]);

    await store.lookup("s1", ["deep"], -10);
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.any(String),
      2,
      key("s1", "deep"),
      generationKey("s1"),
      "0"
    );
    expect(expired).toHaveLength(1);
  });

  it("rejects malformed or non-positive provider ids", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    for (const value of ["1|abc", "1|0", "1|-5"]) {
      client.eval.mockResolvedValueOnce([1, value, "0"]);
      expect((await store.lookup("s1", ["deep"], 600))?.hint).toBeNull();
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
  it("writes only the tip boundary with the active encoding and TTL", async () => {
    const { client } = createLuaFakeRedis({ [generationKey("s1")]: "0" });
    await expect(makeStore(client).put("s1", "tipfp", 42, 900, "0")).resolves.toBe(true);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("affinity_cas_write_v1"),
      2,
      generationKey("s1"),
      key("s1", "tipfp"),
      "0",
      "1|42|0",
      900
    );
  });

  it("ignores invalid arguments", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.put("", "tip", 42, 900, "0");
    await store.put("s1", "", 42, 900, "0");
    await store.put("s1", "tip", 0, 900, "0");
    await store.put("s1", "tip", 42, 0, "0");
    await store.put("s1", "tip", 42, 900, null);
    expect(client.eval).not.toHaveBeenCalled();
  });
});

describe("AffinityStore.tombstone", () => {
  it("writes a short-TTL tombstone with a truncated reason", async () => {
    const { client } = createLuaFakeRedis({ [generationKey("s1")]: "0" });
    const store = makeStore(client);
    await store.tombstone("s1", "deadfp", "failover", "0");
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("affinity_cas_write_v1"),
      2,
      generationKey("s1"),
      key("s1", "deadfp"),
      "0",
      "0|failover|0",
      60
    );

    await store.tombstone("s1", "deadfp", "x".repeat(50), "0");
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("affinity_cas_write_v1"),
      2,
      generationKey("s1"),
      key("s1", "deadfp"),
      "0",
      `0|${"x".repeat(32)}|0`,
      60
    );
  });

  it("ignores empty scope or fingerprint", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.tombstone("", "fp", "r", "0");
    await store.tombstone("s1", "", "r", "0");
    await store.tombstone("s1", "fp", "r", null);
    expect(client.eval).not.toHaveBeenCalled();
  });
});

describe("AffinityStore.invalidate", () => {
  it("deletes the target and known ancestor bindings in one call", async () => {
    const { client, data } = createLuaFakeRedis({
      [key("s1", "deep")]: "1|42",
      [key("s1", "mid")]: "1|7",
    });

    await expect(makeStore(client).invalidate("s1", ["deep", "mid"])).resolves.toBe(true);

    expect(data.get(generationKey("s1"))).toBe("1");
    expect(data.has(key("s1", "deep"))).toBe(false);
    expect(data.has(key("s1", "mid"))).toBe(false);
  });

  it("treats a zero-count DEL as an idempotent success", async () => {
    const { client } = createLuaFakeRedis();
    await expect(makeStore(client).invalidate("s1", ["missing"])).resolves.toBe(true);
  });

  it("returns false when redis is unavailable or DEL fails", async () => {
    await expect(makeStore(null).invalidate("s1", ["deep"])).resolves.toBe(false);

    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValueOnce(new Error("boom"));
    await expect(makeStore(client).invalidate("s1", ["deep"])).resolves.toBe(false);
  });

  it("invalidates unknown descendants through the scope generation", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    const initial = await store.lookup("s1", ["child", "parent"], 600);

    expect(initial).toMatchObject({ hint: null, generation: "0" });
    await expect(store.put("s1", "child", 42, 600, initial?.generation)).resolves.toBe(true);
    await expect(store.invalidate("s1", ["parent"])).resolves.toBe(true);

    await expect(store.lookup("s1", ["child", "parent"], 600)).resolves.toMatchObject({
      hint: null,
      generation: "1",
    });
  });

  it("rejects stale writeback after termination and accepts the next generation", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    const stale = await store.lookup("s1", ["tip"], 600);

    await expect(store.invalidate("s1", ["tip"])).resolves.toBe(true);
    await expect(store.put("s1", "tip", 42, 600, stale?.generation)).resolves.toBe(false);

    const fresh = await store.lookup("s1", ["tip"], 600);
    await expect(store.put("s1", "tip", 7, 600, fresh?.generation)).resolves.toBe(true);
    await expect(store.lookup("s1", ["tip"], 600)).resolves.toMatchObject({
      hint: { providerId: 7, matchedFp: "tip" },
      generation: "1",
    });
  });
});

describe("AffinityStore round-trip through the fake Lua", () => {
  it("put -> lookup hits the tip; tombstone on tip misses (no sys fallback)", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);

    const lookup = await store.lookup("s1", ["tip"], 600);
    await store.put("s1", "tip", 42, 600, lookup?.generation);
    expect(await store.lookup("s1", ["tip"], 600)).toEqual({
      generation: "0",
      hint: {
        providerId: 42,
        matchedIndex: 0,
        matchedFp: "tip",
      },
    });

    await store.tombstone("s1", "tip", "failover", lookup?.generation);
    expect((await store.lookup("s1", ["tip"], 600))?.hint).toBeNull();
  });
});

describe("AffinityStore fail-open behavior", () => {
  it("fails open when redis is unavailable or not ready", async () => {
    const nullStore = makeStore(null);
    expect(await nullStore.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(nullStore.put("s1", "tip", 42, 600, "0")).resolves.toBe(false);
    await expect(nullStore.tombstone("s1", "fp", "r", "0")).resolves.toBe(false);

    const { client } = createLuaFakeRedis();
    client.status = "connecting";
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await store.put("s1", "tip", 42, 600, "0");
    await store.tombstone("s1", "fp", "r", "0");
    expect(client.eval).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it("fails open when redis commands throw", async () => {
    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValue(new Error("boom"));
    client.set.mockRejectedValue(new Error("boom"));
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(store.put("s1", "tip", 42, 600, "0")).resolves.toBe(false);
    await expect(store.tombstone("s1", "fp", "r", "0")).resolves.toBe(false);
  });

  it("fails open when redis rejects with a non-Error value", async () => {
    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValue("string failure");
    client.set.mockRejectedValue("string failure");
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(store.put("s1", "tip", 42, 600, "0")).resolves.toBe(false);
    await expect(store.tombstone("s1", "fp", "r", "0")).resolves.toBe(false);
  });
});

describe("getAffinityStore", () => {
  it("returns a shared singleton instance", () => {
    const a = getAffinityStore();
    expect(a).toBeInstanceOf(AffinityStore);
    expect(getAffinityStore()).toBe(a);
  });
});
