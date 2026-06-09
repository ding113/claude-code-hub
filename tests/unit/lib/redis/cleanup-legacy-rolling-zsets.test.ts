import type Redis from "ioredis";
import { describe, expect, it, vi } from "vitest";

describe("cleanupLegacyRollingZsets", () => {
  it("scans both legacy patterns and UNLINKs all matched keys", async () => {
    const scanCalls: Array<{ cursor: string; pattern: string }> = [];
    const scan = vi.fn(async (cursor: string, _match: string, pattern: string) => {
      scanCalls.push({ cursor, pattern });
      if (pattern === "*:cost_5h_rolling" && cursor === "0") {
        return ["0", ["key:1:cost_5h_rolling", "provider:45:cost_5h_rolling"]] as [
          string,
          string[],
        ];
      }
      if (pattern === "*:cost_daily_rolling" && cursor === "0") {
        return ["0", ["user:7:cost_daily_rolling"]] as [string, string[]];
      }
      return ["0", []] as [string, string[]];
    });
    const unlink = vi.fn(async (..._keys: string[]) => _keys.length);

    const redis = { scan, unlink } as unknown as Redis;

    const { cleanupLegacyRollingZsets } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await cleanupLegacyRollingZsets(redis);

    expect(scanCalls.map((c) => c.pattern).sort()).toEqual([
      "*:cost_5h_rolling",
      "*:cost_daily_rolling",
    ]);
    expect(result.scanned).toBe(3);
    expect(result.deleted).toBe(3);
    expect(unlink).toHaveBeenCalled();
    const unlinkedKeys = unlink.mock.calls.flat().sort();
    expect(unlinkedKeys).toEqual([
      "key:1:cost_5h_rolling",
      "provider:45:cost_5h_rolling",
      "user:7:cost_daily_rolling",
    ]);
  });

  it("is idempotent — second run after cleanup deletes nothing", async () => {
    const scan = vi.fn(async () => ["0", []] as [string, string[]]);
    const unlink = vi.fn();
    const redis = { scan, unlink } as unknown as Redis;

    const { cleanupLegacyRollingZsets } = await import("@/lib/redis/cost-cache-cleanup");

    const r1 = await cleanupLegacyRollingZsets(redis);
    const r2 = await cleanupLegacyRollingZsets(redis);

    expect(r1.scanned).toBe(0);
    expect(r1.deleted).toBe(0);
    expect(r2.deleted).toBe(0);
    expect(unlink).not.toHaveBeenCalled();
  });

  it("paginates SCAN cursor until 0", async () => {
    let calls5h = 0;
    const scan = vi.fn(async (cursor: string, _match: string, pattern: string) => {
      if (pattern === "*:cost_5h_rolling") {
        calls5h++;
        if (cursor === "0") return ["42", ["a", "b"]] as [string, string[]];
        if (cursor === "42") return ["0", ["c"]] as [string, string[]];
      }
      return ["0", []] as [string, string[]];
    });
    const unlink = vi.fn(async (..._keys: string[]) => _keys.length);
    const redis = { scan, unlink } as unknown as Redis;

    const { cleanupLegacyRollingZsets } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await cleanupLegacyRollingZsets(redis);

    expect(calls5h).toBe(2);
    expect(result.scanned).toBe(3);
    expect(result.deleted).toBe(3);
  });
});

describe("cleanupLegacyRollingZsetsOnce — fleet-wide sentinel (bug06)", () => {
  const SENTINEL_KEY = "cleanup:legacy_rolling:v1";
  const LOCK_KEY = `${SENTINEL_KEY}:lock`;

  function makeRedisStub(store: Record<string, string> = {}, scan = vi.fn()) {
    return {
      store,
      scan,
      get: vi.fn(async (key: string) => store[key] ?? null),
      set: vi.fn(async (key: string, value: string, ...args: unknown[]) => {
        if (args.includes("NX") && store[key] !== undefined) return null;
        store[key] = value;
        return "OK";
      }),
      del: vi.fn(async (key: string) => {
        const had = store[key] !== undefined;
        delete store[key];
        return had ? 1 : 0;
      }),
      unlink: vi.fn(async (..._keys: string[]) => _keys.length),
    };
  }

  it("returns early without scanning when the sentinel is already 'done'", async () => {
    const scan = vi.fn();
    const redis = makeRedisStub({ [SENTINEL_KEY]: "done" }, scan);

    const { cleanupLegacyRollingZsetsOnce } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await cleanupLegacyRollingZsetsOnce(redis as unknown as Redis);

    expect(scan).not.toHaveBeenCalled();
    expect(result.skipped).toBe("already-done");
  });

  it("acquires the SETNX lock, scans, writes the sentinel 'done', releases the lock", async () => {
    const scan = vi.fn(async () => ["0", []] as [string, string[]]);
    const redis = makeRedisStub({}, scan);

    const { cleanupLegacyRollingZsetsOnce } = await import("@/lib/redis/cost-cache-cleanup");
    const result = await cleanupLegacyRollingZsetsOnce(redis as unknown as Redis);

    expect(result.skipped).toBeUndefined();
    expect(scan).toHaveBeenCalled();
    expect(redis.store[SENTINEL_KEY]).toBe("done");
    expect(redis.store[LOCK_KEY]).toBeUndefined();
  });

  it("when two callers race, only one runs the SCAN; the other returns 'lock-held'", async () => {
    const scan = vi.fn(async () => ["0", []] as [string, string[]]);
    const redis = makeRedisStub({}, scan);

    const { cleanupLegacyRollingZsetsOnce } = await import("@/lib/redis/cost-cache-cleanup");
    const [r1, r2] = await Promise.all([
      cleanupLegacyRollingZsetsOnce(redis as unknown as Redis),
      cleanupLegacyRollingZsetsOnce(redis as unknown as Redis),
    ]);

    const ran = [r1, r2].filter((r) => r.skipped === undefined);
    const lockedOut = [r1, r2].filter((r) => r.skipped === "lock-held");
    expect(ran).toHaveLength(1);
    expect(lockedOut).toHaveLength(1);
    // SCAN issued once per pattern by the winning caller; never twice.
    const patterns = scan.mock.calls.map((c) => c[2]);
    expect(patterns.filter((p) => p === "*:cost_5h_rolling").length).toBe(1);
    expect(patterns.filter((p) => p === "*:cost_daily_rolling").length).toBe(1);
  });
});
