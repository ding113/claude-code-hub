import { afterAll, afterEach, beforeAll, describe, expect, test } from "vitest";
import {
  buildLeaseKey,
  type BudgetLease,
  type LeaseEntityTypeType,
  type LeaseWindowType,
  serializeLease,
} from "@/lib/rate-limit/lease";
import { LeaseService, type SettleLeaseBudgetsParams } from "@/lib/rate-limit/lease-service";
import type { DailyResetMode } from "@/lib/rate-limit/time-utils";
import { closeRedis, getRedisClient } from "@/lib/redis/client";

const HAS_REDIS = Boolean(process.env.REDIS_URL);
const run = describe.skipIf(!HAS_REDIS);
const TEST_PREFIX = `it-lease-settlement-${Date.now()}-${Math.random().toString(16).slice(2)}`;

interface SettlementTarget {
  entityType: LeaseEntityTypeType;
  entityId: number;
  window: LeaseWindowType;
  resetMode: DailyResetMode;
  key: string;
}

function buildParams(tag: string): SettleLeaseBudgetsParams {
  const baseId =
    800_000_000 + (Date.now() % 10_000_000) + Math.floor(Math.random() * 10_000) * 10 + tag.length;

  return {
    requestId: `${TEST_PREFIX}:${tag}`,
    cost: 1.25,
    entities: {
      key: {
        id: baseId,
        resetModes: { "5h": "rolling", daily: "fixed" },
      },
      user: {
        id: baseId + 1,
        resetModes: { "5h": "fixed", daily: "rolling" },
      },
      provider: {
        id: baseId + 2,
        resetModes: { "5h": "rolling", daily: "fixed" },
      },
    },
  };
}

function buildTargets(params: SettleLeaseBudgetsParams): SettlementTarget[] {
  const targets: SettlementTarget[] = [];
  const entityTypes = ["key", "user", "provider"] as const;
  const windows = ["5h", "daily", "weekly", "monthly"] as const;

  for (const entityType of entityTypes) {
    const entity = params.entities[entityType];
    for (const window of windows) {
      const resetMode =
        window === "5h" || window === "daily"
          ? (entity.resetModes?.[window] ?? (window === "5h" ? "rolling" : "fixed"))
          : "fixed";
      targets.push({
        entityType,
        entityId: entity.id,
        window,
        resetMode,
        key: buildLeaseKey(entityType, entity.id, window, resetMode),
      });
    }
  }

  return targets;
}

run("lease settlement Lua integration", () => {
  const touchedKeys = new Set<string>();
  let redis: NonNullable<ReturnType<typeof getRedisClient>>;
  let previousEnableRateLimit: string | undefined;

  async function waitForRedisReady() {
    const client = getRedisClient({ allowWhenRateLimitDisabled: true });
    if (!client) {
      throw new Error("Redis client unavailable for integration test");
    }

    if (client.status !== "ready") {
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Redis ready timeout")), 5_000);
        client.once("ready", () => {
          clearTimeout(timeout);
          resolve();
        });
      });
    }

    if (client.status !== "ready") {
      throw new Error(`Redis not ready: ${client.status}`);
    }
    return client;
  }

  function rememberParams(params: SettleLeaseBudgetsParams): SettlementTarget[] {
    const targets = buildTargets(params);
    for (const target of targets) touchedKeys.add(target.key);
    touchedKeys.add(`lease:settlement:${String(params.requestId)}`);
    return targets;
  }

  function makeLease(target: SettlementTarget, remainingBudget: number): BudgetLease {
    return {
      entityType: target.entityType,
      entityId: target.entityId,
      window: target.window,
      resetMode: target.resetMode,
      resetTime: "00:00",
      snapshotAtMs: Date.now(),
      currentUsage: 10,
      limitAmount: 200,
      remainingBudget,
      ttlSeconds: 120,
    };
  }

  async function seedValidLeases(targets: SettlementTarget[], remainingBudget = 100) {
    const pipeline = redis.pipeline();
    for (let index = 0; index < targets.length; index += 1) {
      pipeline.set(
        targets[index].key,
        serializeLease(makeLease(targets[index], remainingBudget + index)),
        "EX",
        120
      );
    }
    const results = await pipeline.exec();
    expect(results?.every(([error]) => error === null)).toBe(true);
  }

  beforeAll(async () => {
    previousEnableRateLimit = process.env.ENABLE_RATE_LIMIT;
    process.env.ENABLE_RATE_LIMIT = "true";
    redis = await waitForRedisReady();
    await expect(redis.ping()).resolves.toBe("PONG");
  });

  afterEach(async () => {
    if (touchedKeys.size > 0) {
      await redis.del(...touchedKeys);
      touchedKeys.clear();
    }
  });

  afterAll(async () => {
    if (previousEnableRateLimit === undefined) {
      delete process.env.ENABLE_RATE_LIMIT;
    } else {
      process.env.ENABLE_RATE_LIMIT = previousEnableRateLimit;
    }
    await closeRedis();
  });

  test("settles all twelve leases once and replays the marker without a second decrement", async () => {
    const params = buildParams("replay");
    const targets = rememberParams(params);
    await seedValidLeases(targets);

    const first = await LeaseService.settleLeaseBudgets(params);
    expect(first.status).toBe("settled");
    expect(first.settlements).toHaveLength(12);
    expect(first.settlements.every(({ status }) => status === "decremented")).toBe(true);

    for (let index = 0; index < targets.length; index += 1) {
      const raw = await redis.get(targets[index].key);
      expect(raw).not.toBeNull();
      const lease = JSON.parse(raw!) as BudgetLease;
      expect(lease.remainingBudget).toBeCloseTo(100 + index - params.cost, 10);
      expect(await redis.ttl(targets[index].key)).toBeGreaterThan(0);
    }

    const markerKey = `lease:settlement:${String(params.requestId)}`;
    const marker = await redis.get(markerKey);
    expect(marker).not.toBeNull();
    expect(JSON.parse(marker!)).toHaveLength(12);
    const markerTtl = await redis.ttl(markerKey);
    expect(markerTtl).toBeGreaterThan(0);
    expect(markerTtl).toBeLessThanOrEqual(5 * 60);

    const duplicate = await LeaseService.settleLeaseBudgets(params);
    expect(duplicate.status).toBe("duplicate");
    expect(duplicate.settlements).toEqual(first.settlements);

    for (let index = 0; index < targets.length; index += 1) {
      const lease = JSON.parse((await redis.get(targets[index].key))!) as BudgetLease;
      expect(lease.remainingBudget).toBeCloseTo(100 + index - params.cost, 10);
    }
  });

  test("malformed JSON, missing TTL, insufficient budget, and WRONGTYPE are isolated", async () => {
    const params = buildParams("faults");
    const targets = rememberParams(params);
    await seedValidLeases(targets);

    const malformed = targets[0];
    const noTtl = targets[1];
    const insufficient = targets[2];
    const wrongType = targets[3];

    await redis.set(malformed.key, "{malformed", "EX", 120);
    await redis.set(noTtl.key, serializeLease(makeLease(noTtl, 50)));
    await redis.set(insufficient.key, serializeLease(makeLease(insufficient, 0.5)), "EX", 120);
    await redis.del(wrongType.key);
    await redis.lpush(wrongType.key, "not-a-string-lease");
    await redis.expire(wrongType.key, 120);

    const result = await LeaseService.settleLeaseBudgets(params);
    expect(result.status).toBe("settled");
    expect(result.settlements).toHaveLength(12);

    const byTarget = new Map(
      result.settlements.map((settlement) => [
        `${settlement.entityType}:${settlement.window}`,
        settlement,
      ])
    );
    expect(byTarget.get("key:5h")?.status).toBe("missing");
    expect(byTarget.get("key:daily")?.status).toBe("missing");
    expect(byTarget.get("key:weekly")?.status).toBe("insufficient");
    expect(byTarget.get("key:monthly")?.status).toBe("missing");
    expect(result.settlements.filter(({ status }) => status === "decremented")).toHaveLength(8);

    await expect(redis.get(malformed.key)).resolves.toBe("{malformed");
    expect(JSON.parse((await redis.get(noTtl.key))!) as BudgetLease).toMatchObject({
      remainingBudget: 50,
    });
    await expect(redis.ttl(noTtl.key)).resolves.toBe(-1);
    expect(JSON.parse((await redis.get(insufficient.key))!) as BudgetLease).toMatchObject({
      remainingBudget: 0.5,
    });
    await expect(redis.type(wrongType.key)).resolves.toBe("list");

    const markerKey = `lease:settlement:${String(params.requestId)}`;
    expect(JSON.parse((await redis.get(markerKey))!)).toHaveLength(12);
    expect(await redis.ttl(markerKey)).toBeGreaterThan(0);
  });
});
