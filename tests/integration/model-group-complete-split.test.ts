import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { db } from "@/drizzle/db";
import { usageLedger, users } from "@/drizzle/schema";
import { BucketRateLimitService } from "@/lib/model-rate-limit/bucket-service";
import type { ModelLimitBucket } from "@/lib/model-rate-limit/types";
import { getRedisClient } from "@/lib/redis";
import { sumUserCostSplitInTimeRange } from "@/repository/statistics";

config({ path: ".env.test", quiet: true });
config({ path: ".env", quiet: true });

if (!process.env.DSN && process.env.DATABASE_URL) {
  process.env.DSN = process.env.DATABASE_URL;
}

const HAS_DB = Boolean(process.env.DSN);
const HAS_REDIS = Boolean(process.env.REDIS_URL);
const run = describe.skipIf(!HAS_DB);
const runRedis = describe.skipIf(!HAS_DB || !HAS_REDIS);

const TEST_PREFIX = `it-mg-split-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let requestCursor = 910_000_000;
let userCursor = 0;

async function createUserRow(): Promise<number> {
  userCursor += 1;
  const [row] = await db
    .insert(users)
    .values({
      name: `${TEST_PREFIX}-user-${userCursor}`,
      description: "integration test user (complete-split)",
      role: "user",
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      isEnabled: true,
    })
    .returning({ id: users.id });
  if (!row) throw new Error("failed to create integration test user");
  return row.id;
}

async function insertLedgerRow(params: {
  userId: number;
  costUsd: string;
  countedInUserGlobal: boolean;
  createdAt: Date;
  blockedBy?: string | null;
  model?: string;
}): Promise<void> {
  requestCursor += 1;
  await db.insert(usageLedger).values({
    requestId: requestCursor,
    userId: params.userId,
    key: `${TEST_PREFIX}-key`,
    providerId: 910_000_000,
    finalProviderId: 910_000_000,
    model: params.model ?? "test-model",
    endpoint: "/v1/messages",
    apiType: "response",
    statusCode: 200,
    isSuccess: true,
    costUsd: params.costUsd,
    countedInUserGlobal: params.countedInUserGlobal,
    blockedBy: params.blockedBy ?? null,
    createdAt: params.createdAt,
  });
}

async function waitForRedisReady() {
  const redis = getRedisClient();
  if (!redis) throw new Error("Redis client unavailable for integration test");
  if (redis.status !== "ready") {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 3000);
      redis.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  return redis;
}

function makeTotalBucket(
  userId: number,
  models: string[],
  limitTotalUsd: number
): ModelLimitBucket {
  return {
    axis: "user",
    scopeId: userId,
    modelGroupId: 999,
    models,
    caps: {
      limit5hUsd: null,
      limit5hResetMode: "rolling",
      dailyLimitUsd: null,
      limitWeeklyUsd: null,
      limitMonthlyUsd: null,
      limitTotalUsd,
      limit5hCostResetAt: null,
    },
  };
}

async function cleanup(): Promise<void> {
  const like = `${TEST_PREFIX}%`;
  await db.delete(usageLedger).where(sql`${usageLedger.key} LIKE ${like}`);
  await db.delete(users).where(sql`${users.name} LIKE ${like}`);
}

run("model-group complete-split ledger semantics (§5.3)", () => {
  beforeAll(cleanup);
  afterAll(cleanup);

  test("user-axis split: counted_in_user_global partitions total vs model-group-only", async () => {
    const userId = await createUserRow();
    const now = new Date();

    // Mainline consumption that stays on the global axis.
    await insertLedgerRow({ userId, costUsd: "10", countedInUserGlobal: true, createdAt: now });
    // Two rows split out of the global axis by a model-group limit (D13).
    await insertLedgerRow({ userId, costUsd: "4", countedInUserGlobal: false, createdAt: now });
    await insertLedgerRow({ userId, costUsd: "6", countedInUserGlobal: false, createdAt: now });
    // A blocked row must be excluded entirely by the billing condition.
    await insertLedgerRow({
      userId,
      costUsd: "100",
      countedInUserGlobal: true,
      createdAt: now,
      blockedBy: "rate_limit",
    });

    const start = new Date(now.getTime() - 3_600_000);
    const end = new Date(now.getTime() + 3_600_000);
    const split = await sumUserCostSplitInTimeRange(userId, start, end);

    expect(split.total).toBeCloseTo(20, 6);
    expect(split.countedInGlobal).toBeCloseTo(10, 6);
    expect(split.total - split.countedInGlobal).toBeCloseTo(10, 6);
  });

  test("a fully-counted user has model-group-only usage of zero", async () => {
    const userId = await createUserRow();
    const now = new Date();
    await insertLedgerRow({ userId, costUsd: "7.5", countedInUserGlobal: true, createdAt: now });

    const split = await sumUserCostSplitInTimeRange(
      userId,
      new Date(now.getTime() - 3_600_000),
      new Date(now.getTime() + 3_600_000)
    );

    expect(split.total).toBeCloseTo(7.5, 6);
    expect(split.countedInGlobal).toBeCloseTo(7.5, 6);
    expect(split.total - split.countedInGlobal).toBeCloseTo(0, 6);
  });
});

runRedis("model-group total window OPT-A read-through cache (§6/§17.1)", () => {
  const cacheKey = (userId: number) => `total_cost:model:user:${userId}:999`;

  beforeAll(async () => {
    await cleanup();
    await waitForRedisReady();
  });
  afterAll(cleanup);

  test("cold path: aggregates the group's member-model usage from PG and blocks over the cap", async () => {
    const userId = await createUserRow();
    const models = [`${TEST_PREFIX}-m1`, `${TEST_PREFIX}-m2`];
    const now = new Date();
    await insertLedgerRow({
      userId,
      costUsd: "30",
      countedInUserGlobal: true,
      createdAt: now,
      model: models[0],
    });
    await insertLedgerRow({
      userId,
      costUsd: "30",
      countedInUserGlobal: false,
      createdAt: now,
      model: models[1],
    });

    const redis = getRedisClient();
    await redis?.del(cacheKey(userId));

    const result = await BucketRateLimitService.checkCostLimits(
      makeTotalBucket(userId, models, 50)
    );
    expect(result.allowed).toBe(false);
    expect(result.window).toBe("total");
    // model bucket counts ALL member-model usage regardless of counted_in_*_global (30 + 30)
    expect(result.currentUsage).toBeCloseTo(60, 6);
  });

  test("warm path: a pre-seeded cache value is used instead of the DB total", async () => {
    const userId = await createUserRow();
    const models = [`${TEST_PREFIX}-m1`, `${TEST_PREFIX}-m2`];
    const now = new Date();
    await insertLedgerRow({
      userId,
      costUsd: "60",
      countedInUserGlobal: true,
      createdAt: now,
      model: models[0],
    });

    const redis = await waitForRedisReady();
    // Seed a value well under the cap; the cache hit must win over the 60 in PG.
    await redis.setex(cacheKey(userId), 300, "5");

    const result = await BucketRateLimitService.checkCostLimits(
      makeTotalBucket(userId, models, 50)
    );
    expect(result.allowed).toBe(true);

    await redis.del(cacheKey(userId));
  });
});
