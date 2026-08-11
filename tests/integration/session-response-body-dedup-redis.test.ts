import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";

const configState = vi.hoisted(() => ({ dedupEnabled: true }));

vi.mock("@/lib/config/env.schema", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config/env.schema")>();
  return {
    ...actual,
    getEnvConfig: () => ({
      ...actual.getEnvConfig(),
      SESSION_RESPONSE_BODY_DEDUP_ENABLED: configState.dedupEnabled,
    }),
  };
});

process.env.ENABLE_RATE_LIMIT = "true";
process.env.SESSION_TTL = "2";
process.env.STORE_SESSION_MESSAGES = "true";
process.env.STORE_SESSION_RESPONSE_BODY = "true";
process.env.SESSION_RESPONSE_BODY_DEDUP_ENABLED = "true";

const { SessionManager } = await import("@/lib/session-manager");
const { closeRedis, getRedisClient } = await import("@/lib/redis/client");

const HAS_REDIS = Boolean(process.env.REDIS_URL);
const runWithRedis = describe.skipIf(!HAS_REDIS);
const TEST_PREFIX = `it-session-response-body-${Date.now()}-${randomUUID()}`;
const touchedKeys = new Set<string>();

function bundleKey(sessionId: string): string {
  return `session:${sessionId}:req:1:response-bodies:v1`;
}

function legacyBodyKey(sessionId: string, view: "legacy" | "before" | "after"): string {
  if (view === "legacy") return `session:${sessionId}:req:1:response`;
  return `session:${sessionId}:req:1:snapshot:response:${view}:body`;
}

async function waitForRedisReady() {
  const client = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!client) throw new Error("Redis client unavailable for integration test");
  if (client.status !== "ready") {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Redis ready timeout")), 5_000);
      client.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  if (client.status !== "ready") throw new Error(`Redis not ready: ${client.status}`);
  return client;
}

runWithRedis("session response body deduplication Redis integration", () => {
  let redis: Redis;
  let sequence = 0;

  function nextSessionId(label: string): string {
    sequence += 1;
    return `${TEST_PREFIX}:${label}:${sequence}`;
  }

  async function cleanupTouchedKeys(): Promise<void> {
    for (const key of touchedKeys) await redis.del(key);
    touchedKeys.clear();
  }

  beforeAll(async () => {
    await waitForRedisReady();
    redis = new Redis(process.env.REDIS_URL!, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
    });
    await redis.connect();
    await expect(redis.ping()).resolves.toBe("PONG");
  });

  beforeEach(() => {
    configState.dedupEnabled = true;
  });

  afterEach(async () => {
    await cleanupTouchedKeys();
  });

  afterAll(async () => {
    if (!redis) {
      await closeRedis();
      return;
    }
    await cleanupTouchedKeys();
    if (redis.status !== "end") await redis.quit();
    await closeRedis();
  });

  test("stores duplicate views once in a Redis Hash and resolves all three logical views", async () => {
    const sessionId = nextSessionId("same");
    const key = bundleKey(sessionId);
    touchedKeys.add(key);

    await SessionManager.storeSessionResponseBodySet(
      sessionId,
      { legacy: "same body", before: "same body", after: "same body" },
      1
    );

    expect(await redis.type(key)).toBe("hash");
    const stored = await redis.hgetall(key);
    expect(stored).toMatchObject({
      schema: "1",
      total_bytes: String(Buffer.byteLength("same body")),
      over_budget: "0",
      "present:legacy": "1",
      "present:before": "1",
      "present:after": "1",
      "ref:legacy": "0",
      "ref:before": "0",
      "ref:after": "0",
      "body:0": "same body",
    });
    expect(Object.keys(stored).filter((field) => field.startsWith("body:"))).toEqual(["body:0"]);
    expect(await redis.ttl(key)).toBeGreaterThan(0);
    for (const view of ["legacy", "before", "after"] as const) {
      const legacyKey = legacyBodyKey(sessionId, view);
      touchedKeys.add(legacyKey);
      expect(await redis.exists(legacyKey)).toBe(0);
    }

    await expect(SessionManager.getSessionResponse(sessionId, 1)).resolves.toBe("same body");
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot(sessionId, "before", 1)
    ).resolves.toMatchObject({ body: "same body" });
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot(sessionId, "after", 1)
    ).resolves.toMatchObject({ body: "same body" });
  });

  test("atomically replaces a complete generation under concurrent retries", async () => {
    const sessionId = nextSessionId("retry");
    const key = bundleKey(sessionId);
    touchedKeys.add(key);
    const first = { legacy: "first legacy", before: "first before", after: "first legacy" };
    const second = { legacy: "second legacy", before: "second before", after: "second legacy" };

    await Promise.all([
      SessionManager.storeSessionResponseBodySet(sessionId, first, 1),
      SessionManager.storeSessionResponseBodySet(sessionId, second, 1),
    ]);

    const actual = {
      legacy: await SessionManager.getSessionResponse(sessionId, 1),
      before: (await SessionManager.getSessionResponsePhaseSnapshot(sessionId, "before", 1))?.body,
      after: (await SessionManager.getSessionResponsePhaseSnapshot(sessionId, "after", 1))?.body,
    };
    expect([first, second]).toContainEqual(actual);

    const stored = await redis.hgetall(key);
    const rawBodies = Object.entries(stored)
      .filter(([field]) => field.startsWith("body:"))
      .map(([, value]) => value)
      .sort();
    expect(rawBodies).toEqual(
      [actual.legacy, actual.before].filter((value): value is string => value !== null).sort()
    );
  });

  test("atomically switches layouts across rollout and rollback writers", async () => {
    const sessionId = nextSessionId("mixed-layout");
    const key = bundleKey(sessionId);
    touchedKeys.add(key);
    for (const view of ["legacy", "before", "after"] as const) {
      touchedKeys.add(legacyBodyKey(sessionId, view));
    }

    await SessionManager.storeSessionResponseBodySet(
      sessionId,
      { legacy: "dedup first", before: "dedup first", after: "dedup first" },
      1
    );

    configState.dedupEnabled = false;
    await SessionManager.storeSessionResponseBodySet(
      sessionId,
      { legacy: "legacy second", before: "legacy before", after: "legacy second" },
      1
    );

    expect(await redis.hget(key, "layout")).toBe("legacy");
    expect(await redis.hkeys(key)).not.toContain("body:0");
    await expect(SessionManager.getSessionResponse(sessionId, 1)).resolves.toBe("legacy second");
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot(sessionId, "before", 1)
    ).resolves.toMatchObject({ body: "legacy before" });
    const legacyTtls = await Promise.all([
      redis.ttl(key),
      ...(["legacy", "before", "after"] as const).map((view) =>
        redis.ttl(legacyBodyKey(sessionId, view))
      ),
    ]);
    expect(Math.max(...legacyTtls) - Math.min(...legacyTtls)).toBeLessThanOrEqual(1);

    configState.dedupEnabled = true;
    await SessionManager.storeSessionResponseBodySet(
      sessionId,
      { legacy: "dedup third", before: "dedup third", after: "dedup third" },
      1
    );

    expect(await redis.hget(key, "layout")).toBe("dedup");
    expect(await redis.hget(key, "body:0")).toBe("dedup third");
    for (const view of ["legacy", "before", "after"] as const) {
      expect(await redis.exists(legacyBodyKey(sessionId, view))).toBe(0);
    }
    await expect(SessionManager.getSessionResponse(sessionId, 1)).resolves.toBe("dedup third");
  });

  test("returns one complete generation when legacy and dedup writers race", async () => {
    const sessionId = nextSessionId("mixed-race");
    const key = bundleKey(sessionId);
    touchedKeys.add(key);
    for (const view of ["legacy", "before", "after"] as const) {
      touchedKeys.add(legacyBodyKey(sessionId, view));
    }

    const legacyGeneration = {
      legacy: "legacy generation",
      before: "legacy before",
      after: "legacy generation",
    };
    const dedupGeneration = {
      legacy: "dedup generation",
      before: "dedup before",
      after: "dedup generation",
    };

    configState.dedupEnabled = false;
    const legacyWrite = SessionManager.storeSessionResponseBodySet(sessionId, legacyGeneration, 1);
    configState.dedupEnabled = true;
    const dedupWrite = SessionManager.storeSessionResponseBodySet(sessionId, dedupGeneration, 1);
    await Promise.all([legacyWrite, dedupWrite]);

    const actual = {
      legacy: await SessionManager.getSessionResponse(sessionId, 1),
      before: (await SessionManager.getSessionResponsePhaseSnapshot(sessionId, "before", 1))?.body,
      after: (await SessionManager.getSessionResponsePhaseSnapshot(sessionId, "after", 1))?.body,
    };
    expect([legacyGeneration, dedupGeneration]).toContainEqual(actual);

    const layout = await redis.hget(key, "layout");
    const oldKeyCount = await Promise.all(
      (["legacy", "before", "after"] as const).map((view) =>
        redis.exists(legacyBodyKey(sessionId, view))
      )
    ).then((values) => values.reduce((sum, value) => sum + value, 0));
    expect(["legacy", "dedup"]).toContain(layout);
    expect(oldKeyCount).toBe(layout === "legacy" ? 3 : 0);
  });

  test("falls back to TTL-window legacy keys only when no v2 bundle exists", async () => {
    const sessionId = nextSessionId("legacy");
    for (const [view, body] of [
      ["legacy", "legacy response"],
      ["before", "legacy before"],
      ["after", "legacy after"],
    ] as const) {
      const key = legacyBodyKey(sessionId, view);
      touchedKeys.add(key);
      await redis.setex(key, 2, body);
    }

    await expect(SessionManager.getSessionResponse(sessionId, 1)).resolves.toBe("legacy response");
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot(sessionId, "before", 1)
    ).resolves.toMatchObject({ body: "legacy before" });
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot(sessionId, "after", 1)
    ).resolves.toMatchObject({ body: "legacy after" });
  });

  test("expires refs and body values together with the request-scoped bundle", async () => {
    const sessionId = nextSessionId("ttl");
    const key = bundleKey(sessionId);
    touchedKeys.add(key);

    await SessionManager.storeSessionResponseBodySet(
      sessionId,
      { legacy: "ttl body", before: "ttl body", after: "ttl body" },
      1
    );

    expect(await redis.pttl(key)).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(await redis.exists(key)).toBe(0);
    await expect(SessionManager.getSessionResponse(sessionId, 1)).resolves.toBeNull();
    await expect(
      SessionManager.getSessionResponsePhaseSnapshot(sessionId, "after", 1)
    ).resolves.toBeNull();
  });
});
