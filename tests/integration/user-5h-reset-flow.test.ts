import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { db } from "@/drizzle/db";
import { messageRequest, usageLedger, users } from "@/drizzle/schema";
import { buildLeaseKey } from "@/lib/rate-limit/lease";
import { RateLimitService } from "@/lib/rate-limit/service";
import { getRedisClient } from "@/lib/redis/client";
import { findUserById } from "@/repository/user";

config({ path: ".env.test", quiet: true });
config({ path: ".env", quiet: true });

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

const TEST_PREFIX = `it-user-5h-reset-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let requestCursor = 0;

function nextKey(tag: string) {
  requestCursor += 1;
  return `${TEST_PREFIX}-${tag}-${requestCursor}`;
}

async function waitForRedisReady() {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis) {
    throw new Error("Redis client unavailable for integration test");
  }

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

async function createUserRow(limit5hResetMode: "fixed" | "rolling") {
  const [row] = await db
    .insert(users)
    .values({
      name: `${TEST_PREFIX}-${limit5hResetMode}`,
      description: "integration test user",
      role: "user",
      limit5hUsd: "10",
      limit5hResetMode,
      dailyResetMode: "fixed",
      dailyResetTime: "00:00",
      isEnabled: true,
    })
    .returning({ id: users.id });

  if (!row) {
    throw new Error("failed to create integration test user");
  }

  return row.id;
}

async function insertUserUsage(params: {
  userId: number;
  key: string;
  costUsd: string;
  createdAt: Date;
}) {
  const [row] = await db
    .insert(messageRequest)
    .values({
      key: params.key,
      userId: params.userId,
      providerId: 910000000,
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

async function cleanupRedisKeys(userIds: number[]) {
  const redis = getRedisClient({ allowWhenRateLimitDisabled: true });
  if (!redis || redis.status === "end") {
    return;
  }

  if (redis.status !== "ready") {
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(resolve, 2000);
      redis.once("ready", () => {
        clearTimeout(timeout);
        resolve();
      });
    });
  }

  if (redis.status !== "ready") {
    return;
  }

  const keys = userIds.flatMap((userId) => [
    `user:${userId}:cost_5h_rolling`,
    `user:${userId}:cost_5h_fixed`,
    buildLeaseKey("user", userId, "5h", "rolling"),
    buildLeaseKey("user", userId, "5h", "fixed"),
  ]);

  if (keys.length > 0) {
    await redis.del(...keys);
  }
}

run("user 5h reset flow integration", () => {
  const createdUserIds = new Set<number>();

  beforeAll(async () => {
    await cleanupDbRows();
    await cleanupRedisKeys([]);
    await waitForRedisReady();
  });

  afterAll(async () => {
    await cleanupDbRows();
    await cleanupRedisKeys(Array.from(createdUserIds));
  });

  test("rolling reset clears current 5h usage but keeps longer windows intact", async () => {
    const { getUserAllLimitUsage } = await import("@/actions/users");
    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );

    const userId = await createUserRow("rolling");
    createdUserIds.add(userId);

    const now = new Date();
    await insertUserUsage({
      userId,
      key: nextKey("rolling-before-1"),
      costUsd: "4",
      createdAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
    });
    await insertUserUsage({
      userId,
      key: nextKey("rolling-before-2"),
      costUsd: "3",
      createdAt: new Date(now.getTime() - 60 * 60 * 1000),
    });

    const before = await getUserAllLimitUsage(userId);
    expect(before.ok).toBe(true);
    if (!before.ok) {
      throw new Error(before.error);
    }
    expect(before.data.limit5h.usage).toBe(7);
    expect(before.data.limitDaily.usage).toBe(7);

    const redis = await waitForRedisReady();
    await redis.set(buildLeaseKey("user", userId, "5h", "rolling"), "lease", "EX", 300);

    const resetResult = await resetUser5hLimitOnly(userId);
    expect(resetResult.ok).toBe(true);

    const afterReset = await getUserAllLimitUsage(userId);
    expect(afterReset.ok).toBe(true);
    if (!afterReset.ok) {
      throw new Error(afterReset.error);
    }
    expect(afterReset.data.limit5h.usage).toBe(0);
    expect(afterReset.data.limitDaily.usage).toBe(7);
    expect(afterReset.data.limitWeekly.usage).toBe(7);
    expect(afterReset.data.limitMonthly.usage).toBe(7);
    expect(afterReset.data.limitTotal.usage).toBe(7);

    const userAfterReset = await findUserById(userId);
    expect(userAfterReset?.limit5hCostResetAt).toBeInstanceOf(Date);
    expect(await redis.exists(`user:${userId}:cost_5h_rolling`)).toBe(0);
    expect(await redis.exists(buildLeaseKey("user", userId, "5h", "rolling"))).toBe(0);

    await insertUserUsage({
      userId,
      key: nextKey("rolling-after"),
      costUsd: "2",
      createdAt: new Date(),
    });

    const afterNewUsage = await getUserAllLimitUsage(userId);
    expect(afterNewUsage.ok).toBe(true);
    if (!afterNewUsage.ok) {
      throw new Error(afterNewUsage.error);
    }
    expect(afterNewUsage.data.limit5h.usage).toBe(2);
    expect(afterNewUsage.data.limitDaily.usage).toBe(9);
    expect(afterNewUsage.data.limitTotal.usage).toBe(9);
  });

  test("fixed reset clears the current fixed 5h Redis window without touching DB marker", async () => {
    const { getUserAllLimitUsage, resetUserLimitsOnly } = await import("@/actions/users");
    const { resetUser5hLimitOnly } = await import(
      "@/app/[locale]/dashboard/_components/user/actions/reset-user-5h-limit"
    );

    const userId = await createUserRow("fixed");
    createdUserIds.add(userId);

    const redis = await waitForRedisReady();
    await insertUserUsage({
      userId,
      key: nextKey("fixed-before-reset"),
      costUsd: "6",
      createdAt: new Date(),
    });
    await redis.set(`user:${userId}:cost_5h_fixed`, "6", "EX", 300);
    await redis.set(buildLeaseKey("user", userId, "5h", "fixed"), "lease", "EX", 300);

    expect(await RateLimitService.getCurrentCost(userId, "user", "5h", "00:00", "fixed")).toBe(6);

    const resetResult = await resetUser5hLimitOnly(userId);
    expect(resetResult.ok).toBe(true);
    expect(resetResult).toEqual({
      ok: true,
      data: {
        resetMode: "fixed",
      },
    });

    expect(await redis.exists(`user:${userId}:cost_5h_fixed`)).toBe(0);
    expect(await redis.exists(buildLeaseKey("user", userId, "5h", "fixed"))).toBe(0);
    expect(await RateLimitService.getCurrentCost(userId, "user", "5h", "00:00", "fixed")).toBe(0);

    const after5hOnlyReset = await getUserAllLimitUsage(userId);
    expect(after5hOnlyReset.ok).toBe(true);
    if (!after5hOnlyReset.ok) {
      throw new Error(after5hOnlyReset.error);
    }
    expect(after5hOnlyReset.data.limit5h.usage).toBe(0);
    expect(after5hOnlyReset.data.limitDaily.usage).toBe(6);
    expect(after5hOnlyReset.data.limitTotal.usage).toBe(6);

    const userAfterReset = await findUserById(userId);
    expect(userAfterReset?.limit5hCostResetAt ?? null).toBeNull();

    await redis.set(`user:${userId}:cost_5h_fixed`, "6", "EX", 300);
    await redis.set(buildLeaseKey("user", userId, "5h", "fixed"), "lease", "EX", 300);

    const beforeFullReset = await getUserAllLimitUsage(userId);
    expect(beforeFullReset.ok).toBe(true);
    if (!beforeFullReset.ok) {
      throw new Error(beforeFullReset.error);
    }
    expect(beforeFullReset.data.limit5h.usage).toBe(6);
    expect(beforeFullReset.data.limitDaily.usage).toBe(6);
    expect(beforeFullReset.data.limitTotal.usage).toBe(6);

    const fullReset = await resetUserLimitsOnly(userId);
    expect(fullReset.ok).toBe(true);

    const afterFullReset = await getUserAllLimitUsage(userId);
    expect(afterFullReset.ok).toBe(true);
    if (!afterFullReset.ok) {
      throw new Error(afterFullReset.error);
    }
    expect(afterFullReset.data.limit5h.usage).toBe(0);
    expect(afterFullReset.data.limitDaily.usage).toBe(0);
    expect(afterFullReset.data.limitTotal.usage).toBe(0);
  });
});
