import { config } from "dotenv";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { db } from "@/drizzle/db";
import { messageRequest, usageLedger, users } from "@/drizzle/schema";
import { RateLimitService } from "@/lib/rate-limit/service";
import {
  buildCostDisplayCacheKey,
  buildCostDisplayCacheScanPattern,
} from "@/lib/redis/cost-display-cache";
import { getRedisClient } from "@/lib/redis/client";
import { scanPattern } from "@/lib/redis/scan-helper";

config({ path: ".env.test", quiet: true });
config({ path: ".env", quiet: true });

// next-intl / auth / cache mocks are required because the tested code paths
// transitively touch server actions whose imports otherwise blow up under
// `vitest --environment=node`.
vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(async () => ({
    user: { id: 1, role: "admin" },
    key: { id: 1, canLoginWebUi: true },
  })),
}));

vi.mock("next-intl/server", () => ({
  getTranslations: vi.fn(async () => (key: string) => key),
  getLocale: vi.fn(async () => "en"),
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

if (!process.env.DSN && process.env.DATABASE_URL) {
  process.env.DSN = process.env.DATABASE_URL;
}

const HAS_DB = Boolean(process.env.DSN);
const HAS_REDIS = Boolean(process.env.REDIS_URL);
const run = describe.skipIf(!HAS_DB || !HAS_REDIS);

const TEST_PREFIX = `it-cost-cache-rolling-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ID_SEED = Math.floor(Date.now() / 1000) % 1_000_000;

let keyCursor = 0;
let providerCursor = 0;
let userCursor = 0;

function nextKey(tag: string): string {
  keyCursor += 1;
  return `${TEST_PREFIX}-${tag}-${keyCursor}`;
}

function nextProviderId(): number {
  providerCursor += 1;
  // High synthetic ID space; message_request.provider_id has no FK so the row
  // does not need a corresponding providers entry. getProviderCostResetAtMap
  // simply returns no row -> no clipping -> full window.
  return 900_000_000 + ID_SEED * 10 + providerCursor;
}

function nextUserId(): number {
  userCursor += 1;
  return 950_000_000 + ID_SEED * 10 + userCursor;
}

async function waitForRedisReady() {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
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

  if (redis.status !== "ready") {
    throw new Error("Redis not ready for integration test");
  }
  return redis;
}

async function insertBillingRow(params: {
  key: string;
  userId: number;
  providerId: number;
  costUsd: string;
  createdAt: Date;
}) {
  const [row] = await db
    .insert(messageRequest)
    .values({
      key: params.key,
      userId: params.userId,
      providerId: params.providerId,
      model: "test-model",
      originalModel: "test-model",
      endpoint: "/v1/messages",
      apiType: "response",
      statusCode: 200,
      costUsd: params.costUsd,
      createdAt: params.createdAt,
    })
    .returning({ id: messageRequest.id });

  if (!row) {
    throw new Error("failed to insert message_request test row");
  }
  return row.id;
}

async function cleanupDbRows() {
  const keyLike = `${TEST_PREFIX}%`;
  await db.delete(messageRequest).where(sql`${messageRequest.key} LIKE ${keyLike}`);
  await db.delete(usageLedger).where(sql`${usageLedger.key} LIKE ${keyLike}`);
  await db.delete(users).where(sql`${users.name} LIKE ${keyLike}`);
}

async function cleanupRedisKeys(args: { providerIds: number[]; userIds: number[] }) {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status === "end") return;

  if (redis.status !== "ready") {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      redis.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }
  if (redis.status !== "ready") return;

  const patterns: string[] = [];
  for (const providerId of args.providerIds) {
    patterns.push(buildCostDisplayCacheScanPattern("provider", providerId));
  }
  for (const userId of args.userIds) {
    patterns.push(buildCostDisplayCacheScanPattern("user", userId));
  }

  const matched = await Promise.all(patterns.map((p) => scanPattern(redis, p)));
  const allKeys = matched.flat();
  if (allKeys.length > 0) {
    await redis.del(...allKeys);
  }
}

run("cost-cache rolling display integration (M1 + M2 regression)", () => {
  const createdProviderIds = new Set<number>();
  const createdUserIds = new Set<number>();

  // Defensive: vitest's describe.skipIf skips the inner test() blocks but
  // still executes the describe body's hooks. Re-check HAS_DB/HAS_REDIS in
  // each hook so a file picked up by the runner cannot block the suite when
  // the env points to an unreachable host.
  beforeAll(async () => {
    if (!HAS_DB || !HAS_REDIS) return;
    await cleanupDbRows();
    await waitForRedisReady();
  });

  afterAll(async () => {
    if (!HAS_DB || !HAS_REDIS) return;
    await cleanupDbRows();
    await cleanupRedisKeys({
      providerIds: Array.from(createdProviderIds),
      userIds: Array.from(createdUserIds),
    });
  });

  test("M1: batch warm correctly populates per-provider 5h + daily rolling caches in parallel", async () => {
    const N = 5;
    const providerIds = Array.from({ length: N }, () => nextProviderId());
    const userId = nextUserId();
    providerIds.forEach((id) => createdProviderIds.add(id));
    createdUserIds.add(userId);

    const now = new Date();
    // Each provider gets a deterministic, distinct cost so a swapped mapping
    // shows up immediately as an off-by-one in the cache value.
    const expectedByProvider = new Map<number, number>();
    for (let i = 0; i < N; i++) {
      const providerId = providerIds[i];
      const cost = (i + 1) * 0.5; // 0.5, 1.0, 1.5, 2.0, 2.5
      expectedByProvider.set(providerId, cost);

      // Single ledger row per provider, in the past hour so it stays inside
      // both the 5h and daily rolling windows.
      await insertBillingRow({
        key: nextKey(`batch-${providerId}`),
        userId,
        providerId,
        costUsd: cost.toFixed(4),
        createdAt: new Date(now.getTime() - 60 * 60 * 1000),
      });
    }

    const redis = await waitForRedisReady();

    // Pre-condition: no rolling cache populated.
    for (const providerId of providerIds) {
      expect(await redis.exists(buildCostDisplayCacheKey("provider", providerId, "5h"))).toBe(0);
      expect(await redis.exists(buildCostDisplayCacheKey("provider", providerId, "daily"))).toBe(0);
    }

    // Configure ALL providers as daily rolling so both batch warm branches fire.
    const dailyConfigs = new Map(
      providerIds.map((id) => [id, { resetTime: "00:00", resetMode: "rolling" as const }])
    );

    const result = await RateLimitService.getCurrentCostBatch(providerIds, dailyConfigs);

    // Every provider's returned map value matches the inserted ledger sum.
    for (const providerId of providerIds) {
      const expected = expectedByProvider.get(providerId)!;
      expect(result.get(providerId)?.cost5h).toBeCloseTo(expected, 10);
      expect(result.get(providerId)?.costDaily).toBeCloseTo(expected, 10);
    }

    // Every provider's rolling cache key is now populated with the same value.
    for (const providerId of providerIds) {
      const expected = expectedByProvider.get(providerId)!;
      const cached5h = await redis.get(buildCostDisplayCacheKey("provider", providerId, "5h"));
      const cachedDaily = await redis.get(
        buildCostDisplayCacheKey("provider", providerId, "daily")
      );
      expect(Number(cached5h)).toBeCloseTo(expected, 10);
      expect(Number(cachedDaily)).toBeCloseTo(expected, 10);
    }

    // A second batch call returns the same values out of the cache (functional
    // assertion only — we cannot directly count DB queries in real PG without
    // pg_stat_statements, but stable-equal results after cache warm prove the
    // happy path still composes correctly).
    const second = await RateLimitService.getCurrentCostBatch(providerIds, dailyConfigs);
    for (const providerId of providerIds) {
      const expected = expectedByProvider.get(providerId)!;
      expect(second.get(providerId)?.cost5h).toBeCloseTo(expected, 10);
      expect(second.get(providerId)?.costDaily).toBeCloseTo(expected, 10);
    }
  });

  test("M2: concurrent getCurrentCost rolling miss returns identical correct value to all callers", async () => {
    const providerId = nextProviderId();
    createdProviderIds.add(providerId);
    const userId = nextUserId();
    createdUserIds.add(userId);

    const now = new Date();
    // A few rows inside the 5h rolling window with mixed timestamps. The
    // expected sum is the deciding signal — singleflight must not corrupt it.
    const costs = [0.3, 0.7, 1.1, 0.4];
    const expectedSum = costs.reduce((a, b) => a + b, 0);

    for (let i = 0; i < costs.length; i++) {
      await insertBillingRow({
        key: nextKey(`sf-${providerId}-${i}`),
        userId,
        providerId,
        costUsd: costs[i].toFixed(4),
        createdAt: new Date(now.getTime() - (i + 1) * 30 * 60 * 1000),
      });
    }

    const redis = await waitForRedisReady();
    // Make sure we start cold so every caller hits the miss path.
    await redis.del(buildCostDisplayCacheKey("provider", providerId, "5h"));
    expect(await redis.exists(buildCostDisplayCacheKey("provider", providerId, "5h"))).toBe(0);

    // 50 concurrent miss callers for the same (type, id, period).
    const concurrency = 50;
    const calls = Array.from({ length: concurrency }, () =>
      RateLimitService.getCurrentCost(providerId, "provider", "5h", "00:00", "rolling")
    );
    const results = await Promise.all(calls);

    // Every caller sees the same correct value.
    for (const value of results) {
      expect(value).toBeCloseTo(expectedSum, 10);
    }

    // After the storm settles, the cache is populated with the SUM (proves
    // the warm side-effect happened exactly through the singleflight loader).
    const cached = await redis.get(buildCostDisplayCacheKey("provider", providerId, "5h"));
    expect(Number(cached)).toBeCloseTo(expectedSum, 10);
  });
});
