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
  const sets = new Map<string, Set<string>>();
  const zsets = new Map<string, Map<string, number>>();
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
    smembers: vi.fn(async (redisKey: string) => [...(sets.get(redisKey) ?? [])]),
    zrange: vi.fn(async (redisKey: string, _start: number, _stop: number) =>
      [...(zsets.get(redisKey) ?? new Map()).entries()]
        .sort((a, b) => a[1] - b[1])
        .map(([member]) => member)
    ),
    zremrangebyscore: vi.fn(async (redisKey: string, _min: string, max: number) => {
      const zset = zsets.get(redisKey);
      if (!zset) return 0;
      let removed = 0;
      for (const [member, score] of zset) {
        if (score <= Number(max)) {
          zset.delete(member);
          removed += 1;
        }
      }
      return removed;
    }),
    eval: vi.fn(async (script: string, numkeys: number, ...rest: (string | number)[]) => {
      const keys = rest.slice(0, numkeys) as string[];
      const args = rest.slice(numkeys).map(String);

      if (script.includes("affinity_lookup_candidates_v4")) {
        const legacyGenerationKey = keys.at(-1) as string;
        const legacyGeneration = data.get(legacyGenerationKey) ?? "0";
        const candidates: Array<number | string> = [];
        for (let i = 0; i < keys.length - 1; i++) {
          const value = data.get(keys[i]);
          if (!value?.startsWith("1|")) continue;
          const parts = value.split("|");
          if (
            parts.length === 4 ||
            parts.length === 2 ||
            (parts.length === 3 && parts[2] === legacyGeneration)
          ) {
            candidates.push(i + 1, value);
          }
        }
        return candidates;
      }

      if (script.includes("affinity_validate_hit_v5")) {
        const [bindingKey, identityGenerationKey, descendantsKey] = keys;
        const [
          expectedValue,
          expectedGeneration,
          migratedValue,
          ttlRaw,
          generationTtlRaw,
          nowRaw,
          expiresAtRaw,
        ] = args;
        if (data.get(bindingKey) !== expectedValue) return 0;
        if (!data.has(identityGenerationKey)) data.set(identityGenerationKey, expectedGeneration);
        if (data.get(identityGenerationKey) !== expectedGeneration) return 0;
        if (migratedValue) data.set(bindingKey, migratedValue);
        const ttl = Number(ttlRaw);
        if (ttl > 0) expired.push({ key: bindingKey, ttl });
        expired.push({ key: identityGenerationKey, ttl: Number(generationTtlRaw) });
        const zset = zsets.get(descendantsKey) ?? new Map<string, number>();
        for (const [member, score] of zset) {
          if (score <= Number(nowRaw)) zset.delete(member);
        }
        if (ttl > 0) {
          zset.set(bindingKey, Number(expiresAtRaw));
          zsets.set(descendantsKey, zset);
          expired.push({ key: descendantsKey, ttl });
        }
        return 1;
      }

      if (script.includes("affinity_ensure_generation_v4")) {
        const [candidateGeneration, generationTtlRaw] = args;
        if (!data.has(keys[0])) data.set(keys[0], candidateGeneration);
        expired.push({ key: keys[0], ttl: Number(generationTtlRaw) });
        return data.get(keys[0]);
      }

      if (script.includes("affinity_cas_write_v3")) {
        const [generationKey, bindingKey, descendantsKey] = keys;
        const [expectedGeneration, value, ttlRaw, generationTtlRaw, nowRaw, expiresAtRaw] = args;
        if (data.get(generationKey) !== expectedGeneration) return 0;
        data.set(bindingKey, value);
        expired.push({ key: bindingKey, ttl: Number(ttlRaw) });
        const zset = zsets.get(descendantsKey) ?? new Map<string, number>();
        for (const [member, score] of zset) {
          if (score <= Number(nowRaw)) zset.delete(member);
        }
        zset.set(bindingKey, Number(expiresAtRaw));
        zsets.set(descendantsKey, zset);
        expired.push({ key: descendantsKey, ttl: Number(ttlRaw) });
        expired.push({ key: generationKey, ttl: Number(generationTtlRaw) });
        return 1;
      }

      if (script.includes("affinity_invalidate_v3")) {
        const [generationKey, legacyDescendantsKey, descendantsKey, ...bindingKeys] = keys;
        const [generation, generationTtlRaw] = args;
        data.set(generationKey, generation);
        expired.push({ key: generationKey, ttl: Number(generationTtlRaw) });
        for (const bindingKey of bindingKeys) data.delete(bindingKey);
        sets.delete(legacyDescendantsKey);
        zsets.delete(descendantsKey);
        return generation;
      }

      throw new Error("unexpected lua script");
    }),
  };
  return { client, data, expired, sets, zsets };
}

function makeStore(client: unknown) {
  let tokenSequence = 0;
  return new AffinityStore({
    redisClient: client as never,
    generationToken: () => `v3:test-${++tokenSequence}`,
  });
}

const key = (scope: string, fp: string) => `cch:pfx:{${scope}}:fp:${fp}`;
const generationKey = (scope: string, identityFp: string) => `cch:pfx:{${scope}}:gen:${identityFp}`;
const descendantsKey = (scope: string, identityFp: string) =>
  `cch:pfx:{${scope}}:desc:${identityFp}`;
const descendantsV2Key = (scope: string, identityFp: string) =>
  `cch:pfx:{${scope}}:desc-v2:${identityFp}`;
const legacyGenerationKey = (scope: string) => `cch:pfx:{${scope}}:generation`;

describe("AffinityStore.lookup", () => {
  it("returns the deepest active binding (MGET-style deepest-first scan)", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "1|42",
      [key("s1", "mid")]: "1|7",
      [key("s1", "sysf")]: "1|7",
    });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "sysf"], 600);
    expect(hint).toEqual({
      generation: "v3:test-1",
      identityFp: "deep",
      hint: {
        providerId: 42,
        matchedIndex: 0,
        matchedFp: "deep",
      },
    });
  });

  it("preserves the root identity stored on a descendant binding", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "child")]: "1|42|root|3",
      [generationKey("s1", "root")]: "3",
    });

    await expect(makeStore(client).lookup("s1", ["child", "root"], 600)).resolves.toEqual({
      generation: "3",
      identityFp: "root",
      hint: {
        providerId: 42,
        matchedIndex: 0,
        matchedFp: "child",
      },
    });
  });

  it("reads the previous three-part encoding while its scope generation is current", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "child")]: "1|42|2",
      [legacyGenerationKey("s1")]: "2",
    });

    await expect(makeStore(client).lookup("s1", ["child"], 600)).resolves.toMatchObject({
      generation: "v3:test-1",
      identityFp: "child",
      hint: { providerId: 42 },
    });
  });

  it("passes keys deepest-first with the scope hash-tag key format and sliding ttl", async () => {
    const { client } = createLuaFakeRedis();
    await makeStore(client).lookup("tag", ["deep", "mid", "sysf"], 300.9);
    expect(client.eval).toHaveBeenNthCalledWith(
      1,
      expect.stringContaining("affinity_lookup_candidates_v4"),
      4,
      key("tag", "deep"),
      key("tag", "mid"),
      key("tag", "sysf"),
      legacyGenerationKey("tag")
    );
    expect(client.eval).toHaveBeenNthCalledWith(
      2,
      expect.stringContaining("affinity_ensure_generation_v4"),
      1,
      generationKey("tag", "deep"),
      "v3:test-1",
      172800
    );
  });

  it("skips a tombstoned deepest boundary and falls back to a shallower active one", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "deep")]: "0|failover",
      [key("s1", "mid")]: "1|7",
    });
    const hint = await makeStore(client).lookup("s1", ["deep", "mid", "sysf"], 600);
    expect(hint).toEqual({
      generation: "v3:test-1",
      identityFp: "mid",
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

  it("bounds per-identity generation state with a stale-write-safe TTL", async () => {
    const { client, expired } = createLuaFakeRedis();

    await makeStore(client).lookup("s1", ["new-root"], 600);

    expect(expired).toContainEqual({
      key: generationKey("s1", "new-root"),
      ttl: 172800,
    });
  });

  it("slides the TTL on hit and skips renewal when ttl is not positive", async () => {
    const { client, expired } = createLuaFakeRedis({ [key("s1", "deep")]: "1|3" });
    const store = makeStore(client);
    await store.lookup("s1", ["deep"], 900);
    expect(expired).toEqual([
      { key: key("s1", "deep"), ttl: 900 },
      { key: generationKey("s1", "deep"), ttl: 172800 },
      { key: descendantsV2Key("s1", "deep"), ttl: 900 },
    ]);

    await store.lookup("s1", ["deep"], -10);
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("affinity_validate_hit_v5"),
      3,
      key("s1", "deep"),
      generationKey("s1", "deep"),
      descendantsV2Key("s1", "deep"),
      "1|3|deep|v3:test-1",
      "v3:test-1",
      "",
      "0",
      172800,
      expect.any(Number),
      expect.any(Number)
    );
    expect(expired).toHaveLength(4);
  });

  it("rejects malformed or non-positive provider ids", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    for (const value of ["1|abc", "1|0", "1|-5"]) {
      client.eval.mockResolvedValueOnce([1, value]);
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
    const { client } = createLuaFakeRedis({ [generationKey("s1", "rootfp")]: "0" });
    await expect(makeStore(client).put("s1", "tipfp", 42, 900, "rootfp", "0")).resolves.toBe(true);
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("affinity_cas_write_v3"),
      3,
      generationKey("s1", "rootfp"),
      key("s1", "tipfp"),
      descendantsV2Key("s1", "rootfp"),
      "0",
      "1|42|rootfp|0",
      900,
      172800,
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("ignores invalid arguments", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.put("", "tip", 42, 900, "root", "0");
    await store.put("s1", "", 42, 900, "root", "0");
    await store.put("s1", "tip", 0, 900, "root", "0");
    await store.put("s1", "tip", 42, 0, "root", "0");
    await store.put("s1", "tip", 42, 900, null, "0");
    await store.put("s1", "tip", 42, 900, "root", null);
    expect(client.eval).not.toHaveBeenCalled();
  });

  it("prunes expired descendants from the v2 registry before adding a live binding", async () => {
    const { client, zsets } = createLuaFakeRedis({ [generationKey("s1", "rootfp")]: "0" });
    zsets.set(descendantsV2Key("s1", "rootfp"), new Map([[key("s1", "expired-tip"), 0]]));

    await expect(makeStore(client).put("s1", "live-tip", 42, 900, "rootfp", "0")).resolves.toBe(
      true
    );

    expect([...(zsets.get(descendantsV2Key("s1", "rootfp")) ?? new Map()).keys()]).toEqual([
      key("s1", "live-tip"),
    ]);
  });
});

describe("AffinityStore.tombstone", () => {
  it("writes a short-TTL tombstone with a truncated reason", async () => {
    const { client } = createLuaFakeRedis({ [generationKey("s1", "rootfp")]: "0" });
    const store = makeStore(client);
    await store.tombstone("s1", "deadfp", "failover", "rootfp", "0");
    expect(client.eval).toHaveBeenCalledWith(
      expect.stringContaining("affinity_cas_write_v3"),
      3,
      generationKey("s1", "rootfp"),
      key("s1", "deadfp"),
      descendantsV2Key("s1", "rootfp"),
      "0",
      "0|failover|rootfp|0",
      60,
      172800,
      expect.any(Number),
      expect.any(Number)
    );

    await store.tombstone("s1", "deadfp", "x".repeat(50), "rootfp", "0");
    expect(client.eval).toHaveBeenLastCalledWith(
      expect.stringContaining("affinity_cas_write_v3"),
      3,
      generationKey("s1", "rootfp"),
      key("s1", "deadfp"),
      descendantsV2Key("s1", "rootfp"),
      "0",
      `0|${"x".repeat(32)}|rootfp|0`,
      60,
      172800,
      expect.any(Number),
      expect.any(Number)
    );
  });

  it("ignores empty scope or fingerprint", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    await store.tombstone("", "fp", "r", "root", "0");
    await store.tombstone("s1", "", "r", "root", "0");
    await store.tombstone("s1", "fp", "r", null, "0");
    await store.tombstone("s1", "fp", "r", "root", null);
    expect(client.eval).not.toHaveBeenCalled();
  });
});

describe("AffinityStore.invalidate", () => {
  it("invalidates one identity and its descendants without touching another identity in the scope", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);

    const identityA = await store.lookup("s1", ["a-root"], 600);
    await store.put("s1", "a-root", 42, 600, "a-root", identityA?.generation);
    await store.put("s1", "a-child", 42, 600, "a-root", identityA?.generation);

    const identityB = await store.lookup("s1", ["b-root"], 600);
    await store.put("s1", "b-root", 7, 600, "b-root", identityB?.generation);

    await expect(store.invalidate("s1", "a-root", ["a-root"])).resolves.toBe(true);

    await expect(store.lookup("s1", ["b-root"], 600)).resolves.toMatchObject({
      identityFp: "b-root",
      hint: { providerId: 7 },
    });
    await expect(
      store.put("s1", "a-child", 99, 600, "a-root", identityA?.generation)
    ).resolves.toBe(false);
  });

  it("deletes the target and known ancestor bindings in one call", async () => {
    const { client, data } = createLuaFakeRedis({
      [key("s1", "deep")]: "1|42",
      [key("s1", "mid")]: "1|7",
    });

    await expect(makeStore(client).invalidate("s1", "deep", ["mid"])).resolves.toBe(true);

    expect(data.get(generationKey("s1", "deep"))).toBe("v3:test-1");
    expect(data.has(key("s1", "deep"))).toBe(false);
    expect(data.has(key("s1", "mid"))).toBe(false);
  });

  it("treats a zero-count DEL as an idempotent success", async () => {
    const { client } = createLuaFakeRedis();
    await expect(makeStore(client).invalidate("s1", "missing", [])).resolves.toBe(true);
  });

  it("returns false when redis is unavailable or DEL fails", async () => {
    await expect(makeStore(null).invalidate("s1", "deep", [])).resolves.toBe(false);

    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValueOnce(new Error("boom"));
    await expect(makeStore(client).invalidate("s1", "deep", [])).resolves.toBe(false);
  });

  it("invalidates descendants registered under the identity", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    const initial = await store.lookup("s1", ["parent"], 600);

    expect(initial).toMatchObject({
      hint: null,
      identityFp: "parent",
      generation: "v3:test-1",
    });
    await expect(
      store.put("s1", "child", 42, 600, initial?.identityFp, initial?.generation)
    ).resolves.toBe(true);
    await expect(store.invalidate("s1", "parent", ["parent"])).resolves.toBe(true);

    await expect(store.lookup("s1", ["child", "parent"], 600)).resolves.toMatchObject({
      hint: null,
      identityFp: "child",
      generation: "v3:test-3",
    });
  });

  it("rejects stale writeback after termination and accepts the next generation", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);
    const stale = await store.lookup("s1", ["tip"], 600);

    await expect(store.invalidate("s1", "tip", [])).resolves.toBe(true);
    await expect(
      store.put("s1", "tip", 42, 600, stale?.identityFp, stale?.generation)
    ).resolves.toBe(false);

    const fresh = await store.lookup("s1", ["tip"], 600);
    await expect(
      store.put("s1", "tip", 7, 600, fresh?.identityFp, fresh?.generation)
    ).resolves.toBe(true);
    await expect(store.lookup("s1", ["tip"], 600)).resolves.toMatchObject({
      hint: { providerId: 7, matchedFp: "tip" },
      identityFp: "tip",
      generation: "v3:test-2",
    });
  });

  it("uses a non-repeating fence when invalidating a migrated legacy binding", async () => {
    const { client } = createLuaFakeRedis({
      [key("s1", "tip")]: "1|42|1",
      [legacyGenerationKey("s1")]: "1",
    });
    const store = makeStore(client);

    const legacy = await store.lookup("s1", ["tip"], 600);
    expect(legacy).toMatchObject({
      identityFp: "tip",
      generation: "v3:test-1",
      hint: { providerId: 42 },
    });

    await expect(store.invalidate("s1", "tip", [])).resolves.toBe(true);
    await expect(
      store.put("s1", "tip", 99, 600, legacy?.identityFp, legacy?.generation)
    ).resolves.toBe(false);
    await expect(store.lookup("s1", ["tip"], 600)).resolves.toMatchObject({
      hint: null,
      generation: "v3:test-2",
    });
  });

  it("merges legacy Set and v2 ZSET descendants during invalidation", async () => {
    const legacyBinding = key("s1", "legacy-child");
    const currentBinding = key("s1", "current-child");
    const { client, data, sets, zsets } = createLuaFakeRedis({
      [generationKey("s1", "root")]: "0",
      [legacyBinding]: "1|41|root|0",
    });
    sets.set(descendantsKey("s1", "root"), new Set([legacyBinding]));
    const store = makeStore(client);
    await store.put("s1", "current-child", 42, 600, "root", "0");

    await expect(store.invalidate("s1", "root", [])).resolves.toBe(true);

    expect(data.has(legacyBinding)).toBe(false);
    expect(data.has(currentBinding)).toBe(false);
    expect(sets.has(descendantsKey("s1", "root"))).toBe(false);
    expect(zsets.has(descendantsV2Key("s1", "root"))).toBe(false);
  });
});

describe("AffinityStore round-trip through the fake Lua", () => {
  it("put -> lookup hits the tip; tombstone on tip misses (no sys fallback)", async () => {
    const { client } = createLuaFakeRedis();
    const store = makeStore(client);

    const lookup = await store.lookup("s1", ["tip"], 600);
    await store.put("s1", "tip", 42, 600, lookup?.identityFp, lookup?.generation);
    expect(await store.lookup("s1", ["tip"], 600)).toEqual({
      generation: "v3:test-1",
      identityFp: "tip",
      hint: {
        providerId: 42,
        matchedIndex: 0,
        matchedFp: "tip",
      },
    });

    await store.tombstone("s1", "tip", "failover", lookup?.identityFp, lookup?.generation);
    expect((await store.lookup("s1", ["tip"], 600))?.hint).toBeNull();
  });
});

describe("AffinityStore fail-open behavior", () => {
  it("fails open when redis is unavailable or not ready", async () => {
    const nullStore = makeStore(null);
    expect(await nullStore.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(nullStore.put("s1", "tip", 42, 600, "tip", "0")).resolves.toBe(false);
    await expect(nullStore.tombstone("s1", "fp", "r", "fp", "0")).resolves.toBe(false);

    const { client } = createLuaFakeRedis();
    client.status = "connecting";
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await store.put("s1", "tip", 42, 600, "tip", "0");
    await store.tombstone("s1", "fp", "r", "fp", "0");
    expect(client.eval).not.toHaveBeenCalled();
    expect(client.set).not.toHaveBeenCalled();
  });

  it("fails open when redis commands throw", async () => {
    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValue(new Error("boom"));
    client.set.mockRejectedValue(new Error("boom"));
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(store.put("s1", "tip", 42, 600, "tip", "0")).resolves.toBe(false);
    await expect(store.tombstone("s1", "fp", "r", "fp", "0")).resolves.toBe(false);
  });

  it("fails open when redis rejects with a non-Error value", async () => {
    const { client } = createLuaFakeRedis();
    client.eval.mockRejectedValue("string failure");
    client.set.mockRejectedValue("string failure");
    const store = makeStore(client);
    expect(await store.lookup("s1", ["fp"], 600)).toBeNull();
    await expect(store.put("s1", "tip", 42, 600, "tip", "0")).resolves.toBe(false);
    await expect(store.tombstone("s1", "fp", "r", "fp", "0")).resolves.toBe(false);
  });
});

describe("getAffinityStore", () => {
  it("returns a shared singleton instance", () => {
    const a = getAffinityStore();
    expect(a).toBeInstanceOf(AffinityStore);
    expect(getAffinityStore()).toBe(a);
  });
});
