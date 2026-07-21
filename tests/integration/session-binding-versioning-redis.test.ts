import { randomUUID } from "node:crypto";
import Redis from "ioredis";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from "vitest";
import {
  buildCanonicalSessionBindingKey,
  buildLegacySessionOwnerKey,
  buildLegacySessionProviderKey,
  buildSessionBindingKeys,
  buildSessionProviderCooldownKey,
  clearSessionBinding,
  compareAndSetSessionBinding,
  ensureVersionedBindingCapability,
  isSessionProviderCoolingDown,
  readOrReconcileSessionBinding,
  resetVersionedBindingCapabilityForTests,
  terminateSessionBinding,
  touchSessionBinding,
  type SessionBindingOkResult,
  type SessionBindingResult,
} from "@/lib/redis/session-binding";

const HAS_REDIS = Boolean(process.env.REDIS_URL);
const EXPECTED_CAPABILITY_RAW = process.env.EXPECT_VERSIONED_BINDING_CAPABILITY;

if (
  EXPECTED_CAPABILITY_RAW !== undefined &&
  EXPECTED_CAPABILITY_RAW !== "available" &&
  EXPECTED_CAPABILITY_RAW !== "unavailable"
) {
  throw new Error("EXPECT_VERSIONED_BINDING_CAPABILITY must be either available or unavailable");
}

const EXPECTED_CAPABILITY = EXPECTED_CAPABILITY_RAW ?? "available";
const runWithRedis = describe.skipIf(!HAS_REDIS);
const runWithVersionedBinding = describe.skipIf(
  !HAS_REDIS || EXPECTED_CAPABILITY === "unavailable"
);
const TEST_PREFIX = `it-session-binding-${Date.now()}-${randomUUID()}`;
const BINDING_TTL_SECONDS = 90;
const COOLDOWN_TTL_SECONDS = 45;

let redis: Redis;
let sequence = 0;
const touchedKeys = new Set<string>();

function nextSessionId(label: string): string {
  sequence += 1;
  return `${TEST_PREFIX}:${label}:${sequence}`;
}

function rememberBindingKeys(
  sessionId: string,
  keyIds: number[],
  cooldownProviders: number[] = []
): void {
  for (const keyId of keyIds) {
    const keys = buildSessionBindingKeys(sessionId, keyId);
    touchedKeys.add(keys.canonical);
    touchedKeys.add(keys.legacyProvider);
    touchedKeys.add(keys.legacyOwner);
    for (const providerId of cooldownProviders) {
      touchedKeys.add(buildSessionProviderCooldownKey(sessionId, keyId, providerId));
    }
  }
}

async function deleteKeysIndividually(keys: Iterable<string>): Promise<void> {
  for (const key of keys) {
    await redis.del(key);
  }
}

async function scanKeys(pattern: string): Promise<string[]> {
  let cursor = "0";
  const keys: string[] = [];
  do {
    const [nextCursor, page] = await redis.scan(cursor, "MATCH", pattern, "COUNT", 100);
    cursor = nextCursor;
    keys.push(...page);
  } while (cursor !== "0");
  return keys.sort();
}

async function cleanupTouchedKeys(): Promise<void> {
  await deleteKeysIndividually(touchedKeys);
  touchedKeys.clear();

  // Probe keys use a reserved isolated namespace and may remain only when a
  // cluster rejects the probe's multi-key cleanup with CROSSSLOT.
  const probeKeys = await scanKeys("session-binding-capability-probe:*");
  await deleteKeysIndividually(probeKeys);
}

function requireOk(result: SessionBindingResult): SessionBindingOkResult {
  if (result.status !== "ok") {
    throw new Error(`Expected successful session binding result, got ${JSON.stringify(result)}`);
  }
  return result;
}

async function readBinding(sessionId: string, keyId: number, ttlSeconds = BINDING_TTL_SECONDS) {
  rememberBindingKeys(sessionId, [keyId]);
  return readOrReconcileSessionBinding({ sessionId, keyId, ttlSeconds, redis });
}

async function bindProvider(
  sessionId: string,
  keyId: number,
  expectedGeneration: string,
  providerId: number
) {
  rememberBindingKeys(sessionId, [keyId]);
  return compareAndSetSessionBinding({
    sessionId,
    keyId,
    expectedGeneration,
    providerId,
    ttlSeconds: BINDING_TTL_SECONDS,
    redis,
  });
}

beforeAll(async () => {
  if (!HAS_REDIS) return;
  redis = new Redis(process.env.REDIS_URL!, {
    lazyConnect: true,
    enableOfflineQueue: false,
    maxRetriesPerRequest: 1,
  });
  await redis.connect();
  await expect(redis.ping()).resolves.toBe("PONG");
});

beforeEach(() => {
  resetVersionedBindingCapabilityForTests();
});

afterEach(async () => {
  if (HAS_REDIS) {
    await cleanupTouchedKeys();
  }
  resetVersionedBindingCapabilityForTests();
});

afterAll(async () => {
  if (HAS_REDIS) {
    await cleanupTouchedKeys();
    if (redis.status !== "end") {
      await redis.quit();
    }
  }
  resetVersionedBindingCapabilityForTests();
});

runWithRedis("versioned session binding Redis capability", () => {
  test("matches the explicitly expected capability and cleans isolated probe keys", async () => {
    const probeKeysBefore = await scanKeys("session-binding-capability-probe:*");

    const capability = await ensureVersionedBindingCapability(redis);

    expect(capability).toBe(EXPECTED_CAPABILITY);
    if (capability === "available") {
      expect(await scanKeys("session-binding-capability-probe:*")).toEqual(probeKeysBefore);
    }
  });

  test.runIf(EXPECTED_CAPABILITY === "unavailable")(
    "fails closed without creating a business binding when capability is unavailable",
    async () => {
      const sessionId = nextSessionId("unavailable");
      const keyId = 9001;
      rememberBindingKeys(sessionId, [keyId]);

      const result = await readBinding(sessionId, keyId);

      expect(result).toMatchObject({
        status: "unavailable",
        capabilityState: "unavailable",
        legacyFallbackAllowed: true,
      });
      expect(await redis.exists(buildCanonicalSessionBindingKey(sessionId, keyId))).toBe(0);
      expect(await redis.exists(buildLegacySessionOwnerKey(sessionId))).toBe(0);
      expect(await redis.exists(buildLegacySessionProviderKey(sessionId))).toBe(0);
    }
  );
});

runWithVersionedBinding("versioned session binding reconcile", () => {
  test("creates a true empty null tombstone and refreshes TTL without rotating generation", async () => {
    const sessionId = nextSessionId("empty");
    const keyId = 1001;
    const keys = buildSessionBindingKeys(sessionId, keyId);

    const created = requireOk(await readBinding(sessionId, keyId));
    expect(created).toMatchObject({
      source: "created",
      snapshot: { sessionId, keyId, providerId: null },
    });
    expect(await redis.hget(keys.canonical, "key_id")).toBe(String(keyId));
    expect(await redis.hget(keys.canonical, "generation")).toBe(created.snapshot.generation);
    expect(await redis.hget(keys.canonical, "provider_id")).toBeNull();
    expect(await redis.get(keys.legacyOwner)).toBe(String(keyId));
    expect(await redis.exists(keys.legacyProvider)).toBe(0);

    await redis.expire(keys.canonical, 5);
    await redis.expire(keys.legacyOwner, 5);

    const reread = requireOk(await readBinding(sessionId, keyId));
    expect(reread.source).toBe("existing");
    expect(reread.snapshot.generation).toBe(created.snapshot.generation);
    expect(reread.snapshot.providerId).toBeNull();
    expect(await redis.ttl(keys.canonical)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
    expect(await redis.ttl(keys.legacyOwner)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
  });

  test("lazy-upgrades a matching legacy provider and owner", async () => {
    const sessionId = nextSessionId("legacy-provider");
    const keyId = 1002;
    const providerId = 2002;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);
    await redis.setex(keys.legacyOwner, BINDING_TTL_SECONDS, String(keyId));
    await redis.setex(keys.legacyProvider, BINDING_TTL_SECONDS, String(providerId));

    const upgraded = requireOk(await readBinding(sessionId, keyId));

    expect(upgraded).toMatchObject({
      source: "legacy_upgraded",
      snapshot: { sessionId, keyId, providerId },
    });
    expect(await redis.hgetall(keys.canonical)).toMatchObject({
      key_id: String(keyId),
      generation: upgraded.snapshot.generation,
      provider_id: String(providerId),
    });
  });

  test("lazy-upgrades a matching owner with no legacy provider as a null tombstone", async () => {
    const sessionId = nextSessionId("legacy-null");
    const keyId = 1003;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);
    await redis.setex(keys.legacyOwner, BINDING_TTL_SECONDS, String(keyId));

    const upgraded = requireOk(await readBinding(sessionId, keyId));

    expect(upgraded.source).toBe("legacy_upgraded");
    expect(upgraded.snapshot.providerId).toBeNull();
    expect(await redis.hget(keys.canonical, "provider_id")).toBeNull();
    expect(await redis.exists(keys.legacyProvider)).toBe(0);
  });

  test("rejects a foreign legacy owner without importing or overwriting it", async () => {
    const sessionId = nextSessionId("foreign-owner");
    const keyId = 1004;
    const foreignKeyId = 7777;
    const providerId = 2004;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);
    await redis.setex(keys.legacyOwner, BINDING_TTL_SECONDS, String(foreignKeyId));
    await redis.setex(keys.legacyProvider, BINDING_TTL_SECONDS, String(providerId));

    const result = await readBinding(sessionId, keyId);

    expect(result).toEqual({
      status: "conflict",
      reason: "foreign_legacy_owner",
      legacyFallbackAllowed: false,
    });
    expect(await redis.exists(keys.canonical)).toBe(0);
    expect(await redis.get(keys.legacyOwner)).toBe(String(foreignKeyId));
    expect(await redis.get(keys.legacyProvider)).toBe(String(providerId));
  });

  test("rejects an orphan legacy provider without claiming ownership", async () => {
    const sessionId = nextSessionId("orphan-provider");
    const keyId = 1005;
    const providerId = 2005;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);
    await redis.setex(keys.legacyProvider, BINDING_TTL_SECONDS, String(providerId));

    const result = await readBinding(sessionId, keyId);

    expect(result).toEqual({
      status: "conflict",
      reason: "orphan_legacy_provider",
      legacyFallbackAllowed: false,
    });
    expect(await redis.exists(keys.canonical)).toBe(0);
    expect(await redis.exists(keys.legacyOwner)).toBe(0);
    expect(await redis.get(keys.legacyProvider)).toBe(String(providerId));
  });

  test("rejects a non-positive legacy provider without creating canonical state", async () => {
    const sessionId = nextSessionId("invalid-provider");
    const keyId = 1006;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);
    await redis.setex(keys.legacyOwner, BINDING_TTL_SECONDS, String(keyId));
    await redis.setex(keys.legacyProvider, BINDING_TTL_SECONDS, "-1");

    const result = await readBinding(sessionId, keyId);

    expect(result).toEqual({
      status: "conflict",
      reason: "invalid_legacy_provider",
      legacyFallbackAllowed: false,
    });
    expect(await redis.exists(keys.canonical)).toBe(0);
  });

  test("fails closed for missing and contradictory mirrors without repairing either side", async () => {
    const sessionId = nextSessionId("mirror-conflict");
    const keyId = 1006;
    const providerId = 2006;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    const created = requireOk(await readBinding(sessionId, keyId));
    const bound = requireOk(
      await bindProvider(sessionId, keyId, created.snapshot.generation, providerId)
    );

    await redis.del(keys.legacyOwner);
    const missing = await readBinding(sessionId, keyId);
    expect(missing).toEqual({
      status: "conflict",
      reason: "mirror_missing",
      legacyFallbackAllowed: false,
    });
    expect(await redis.hget(keys.canonical, "generation")).toBe(bound.snapshot.generation);

    await redis.setex(keys.legacyOwner, BINDING_TTL_SECONDS, String(keyId));
    await redis.setex(keys.legacyProvider, BINDING_TTL_SECONDS, String(providerId + 1));
    const contradictory = await readBinding(sessionId, keyId);
    expect(contradictory).toEqual({
      status: "conflict",
      reason: "mirror_conflict",
      legacyFallbackAllowed: false,
    });
    expect(await redis.hget(keys.canonical, "provider_id")).toBe(String(providerId));
    expect(await redis.get(keys.legacyProvider)).toBe(String(providerId + 1));
  });

  test("allows only one tenant to initialize the same empty legacy session", async () => {
    const sessionId = nextSessionId("tenant-race");
    const keyA = 1101;
    const keyB = 1102;
    rememberBindingKeys(sessionId, [keyA, keyB]);

    const [resultA, resultB] = await Promise.all([
      readOrReconcileSessionBinding({
        sessionId,
        keyId: keyA,
        ttlSeconds: BINDING_TTL_SECONDS,
        redis,
      }),
      readOrReconcileSessionBinding({
        sessionId,
        keyId: keyB,
        ttlSeconds: BINDING_TTL_SECONDS,
        redis,
      }),
    ]);

    const winner = resultA.status === "ok" ? resultA : resultB.status === "ok" ? resultB : null;
    const loser = resultA.status === "conflict" ? resultA : resultB;
    expect(winner).not.toBeNull();
    expect(loser).toMatchObject({ status: "conflict", reason: "foreign_legacy_owner" });
    if (!winner) throw new Error("Expected one tenant to win initialization");

    const losingKeyId = winner.snapshot.keyId === keyA ? keyB : keyA;
    expect(await redis.get(buildLegacySessionOwnerKey(sessionId))).toBe(
      String(winner.snapshot.keyId)
    );
    expect(
      await redis.exists(buildCanonicalSessionBindingKey(sessionId, winner.snapshot.keyId))
    ).toBe(1);
    expect(await redis.exists(buildCanonicalSessionBindingKey(sessionId, losingKeyId))).toBe(0);
  });
});

runWithVersionedBinding("versioned session binding mutation", () => {
  test("touches exact null and provider snapshots without rotating generation", async () => {
    const sessionId = nextSessionId("touch-exact");
    const keyId = 1200;
    const providerId = 2200;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);

    const initial = requireOk(await readBinding(sessionId, keyId));
    await redis.expire(keys.canonical, 5);
    await redis.expire(keys.legacyOwner, 5);
    const touchedNull = requireOk(
      await touchSessionBinding({
        ...initial.snapshot,
        expectedGeneration: initial.snapshot.generation,
        expectedProviderId: null,
        ttlSeconds: BINDING_TTL_SECONDS,
        redis,
      })
    );
    expect(touchedNull.source).toBe("touched");
    expect(touchedNull.snapshot).toEqual(initial.snapshot);
    expect(await redis.ttl(keys.canonical)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
    expect(await redis.ttl(keys.legacyOwner)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
    expect(await redis.exists(keys.legacyProvider)).toBe(0);

    const bound = requireOk(
      await bindProvider(sessionId, keyId, touchedNull.snapshot.generation, providerId)
    );
    await redis.expire(keys.canonical, 5);
    await redis.expire(keys.legacyOwner, 5);
    await redis.expire(keys.legacyProvider, 5);
    const touchedProvider = requireOk(
      await touchSessionBinding({
        sessionId,
        keyId,
        expectedGeneration: bound.snapshot.generation,
        expectedProviderId: providerId,
        ttlSeconds: BINDING_TTL_SECONDS,
        redis,
      })
    );
    expect(touchedProvider.source).toBe("touched");
    expect(touchedProvider.snapshot).toEqual(bound.snapshot);
    expect(await redis.ttl(keys.canonical)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
    expect(await redis.ttl(keys.legacyOwner)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
    expect(await redis.ttl(keys.legacyProvider)).toBeGreaterThan(BINDING_TTL_SECONDS - 5);
  });

  test("rejects a stale touch after administrative termination advances generation", async () => {
    const sessionId = nextSessionId("touch-after-admin-termination");
    const keyId = 1201;
    const providerId = 2201;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    rememberBindingKeys(sessionId, [keyId]);

    const initial = requireOk(await readBinding(sessionId, keyId));
    const bound = requireOk(
      await bindProvider(sessionId, keyId, initial.snapshot.generation, providerId)
    );
    const terminated = requireOk(
      await terminateSessionBinding({
        sessionId,
        keyId,
        expectedProviderId: providerId,
        ttlSeconds: BINDING_TTL_SECONDS,
        redis,
      })
    );

    const staleTouch = await touchSessionBinding({
      sessionId,
      keyId,
      expectedGeneration: bound.snapshot.generation,
      expectedProviderId: providerId,
      ttlSeconds: BINDING_TTL_SECONDS,
      redis,
    });

    expect(staleTouch).toEqual({
      status: "conflict",
      reason: "generation_mismatch",
      legacyFallbackAllowed: false,
    });
    expect(await redis.hget(keys.canonical, "generation")).toBe(terminated.snapshot.generation);
    expect(await redis.hget(keys.canonical, "provider_id")).toBeNull();
    expect(await redis.exists(keys.legacyProvider)).toBe(0);
  });

  test("rotates generation across CAS and rejects a stale ABA clear", async () => {
    const sessionId = nextSessionId("aba");
    const keyId = 1201;
    const providerP = 2201;
    const providerQ = 2202;
    rememberBindingKeys(sessionId, [keyId], [providerP]);

    const initial = requireOk(await readBinding(sessionId, keyId));
    const firstP = requireOk(
      await bindProvider(sessionId, keyId, initial.snapshot.generation, providerP)
    );

    const staleCas = await bindProvider(sessionId, keyId, initial.snapshot.generation, providerQ);
    expect(staleCas).toMatchObject({ status: "conflict", reason: "generation_mismatch" });

    const boundQ = requireOk(
      await bindProvider(sessionId, keyId, firstP.snapshot.generation, providerQ)
    );
    const secondP = requireOk(
      await bindProvider(sessionId, keyId, boundQ.snapshot.generation, providerP)
    );
    expect(
      new Set([
        initial.snapshot.generation,
        firstP.snapshot.generation,
        boundQ.snapshot.generation,
        secondP.snapshot.generation,
      ]).size
    ).toBe(4);

    const staleClear = await clearSessionBinding({
      sessionId,
      keyId,
      expectedGeneration: firstP.snapshot.generation,
      expectedProviderId: providerP,
      ttlSeconds: BINDING_TTL_SECONDS,
      cooldownTtlSeconds: COOLDOWN_TTL_SECONDS,
      redis,
    });
    expect(staleClear).toMatchObject({ status: "conflict", reason: "generation_mismatch" });
    expect(await redis.get(buildLegacySessionProviderKey(sessionId))).toBe(String(providerP));
    expect(await redis.hget(buildCanonicalSessionBindingKey(sessionId, keyId), "generation")).toBe(
      secondP.snapshot.generation
    );
    expect(await redis.exists(buildSessionProviderCooldownKey(sessionId, keyId, providerP))).toBe(
      0
    );
  });

  test("atomically clears a provider and writes a tenant-scoped cooldown", async () => {
    const sessionId = nextSessionId("clear-cooldown");
    const keyId = 1202;
    const otherKeyId = 1203;
    const providerId = 2203;
    rememberBindingKeys(sessionId, [keyId, otherKeyId], [providerId]);
    const keys = buildSessionBindingKeys(sessionId, keyId);
    const cooldownKey = buildSessionProviderCooldownKey(sessionId, keyId, providerId);

    const initial = requireOk(await readBinding(sessionId, keyId));
    const bound = requireOk(
      await bindProvider(sessionId, keyId, initial.snapshot.generation, providerId)
    );
    const cleared = requireOk(
      await clearSessionBinding({
        sessionId,
        keyId,
        expectedGeneration: bound.snapshot.generation,
        expectedProviderId: providerId,
        ttlSeconds: BINDING_TTL_SECONDS,
        cooldownTtlSeconds: COOLDOWN_TTL_SECONDS,
        redis,
      })
    );

    expect(cleared.source).toBe("cleared");
    expect(cleared.snapshot.providerId).toBeNull();
    expect(cleared.snapshot.generation).not.toBe(bound.snapshot.generation);
    expect(await redis.hget(keys.canonical, "provider_id")).toBeNull();
    expect(await redis.get(keys.legacyOwner)).toBe(String(keyId));
    expect(await redis.exists(keys.legacyProvider)).toBe(0);
    expect(await redis.get(cooldownKey)).toBe(cleared.snapshot.generation);
    expect(await redis.ttl(cooldownKey)).toBeGreaterThan(COOLDOWN_TTL_SECONDS - 5);

    await expect(
      isSessionProviderCoolingDown({ sessionId, keyId, providerId, redis })
    ).resolves.toEqual({ status: "ok", coolingDown: true, legacyFallbackAllowed: false });
    await expect(
      isSessionProviderCoolingDown({ sessionId, keyId: otherKeyId, providerId, redis })
    ).resolves.toEqual({ status: "ok", coolingDown: false, legacyFallbackAllowed: false });
  });

  test("does not initialize CAS state after canonical expiry", async () => {
    const sessionId = nextSessionId("canonical-missing");
    const keyId = 1204;
    const providerId = 2204;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    const initial = requireOk(await readBinding(sessionId, keyId));
    await redis.del(keys.canonical);

    const result = await bindProvider(sessionId, keyId, initial.snapshot.generation, providerId);

    expect(result).toMatchObject({ status: "conflict", reason: "canonical_missing" });
    expect(await redis.exists(keys.canonical)).toBe(0);
    expect(await redis.get(keys.legacyOwner)).toBe(String(keyId));
    expect(await redis.exists(keys.legacyProvider)).toBe(0);
  });

  test("fails closed when canonical generation is missing", async () => {
    const sessionId = nextSessionId("generation-missing");
    const keyId = 1205;
    const providerId = 2205;
    const keys = buildSessionBindingKeys(sessionId, keyId);
    const initial = requireOk(await readBinding(sessionId, keyId));
    await redis.hdel(keys.canonical, "generation");

    const readResult = await readBinding(sessionId, keyId);
    expect(readResult).toMatchObject({ status: "conflict", reason: "canonical_corrupt" });

    const casResult = await bindProvider(sessionId, keyId, initial.snapshot.generation, providerId);
    expect(casResult).toMatchObject({ status: "conflict", reason: "canonical_corrupt" });
    expect(await redis.exists(keys.legacyProvider)).toBe(0);
  });
});
