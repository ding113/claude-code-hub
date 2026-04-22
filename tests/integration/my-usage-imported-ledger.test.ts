import { afterAll, describe, expect, test, vi } from "vitest";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, usageLedger, users } from "@/drizzle/schema";
import "@/lib/auth-session-storage.node";
import { runWithAuthSession } from "@/lib/auth";
import { findKeyById } from "@/repository/key";
import { findUserById } from "@/repository/user";
import { findUsageLogsBatch } from "@/repository/usage-logs";

vi.mock("next/headers", () => ({
  cookies: () => {
    throw new Error("不应在 imported-ledger 集成测试中读取 next/headers.cookies()");
  },
  headers: () => ({
    get: () => null,
  }),
}));

vi.mock("next-intl/server", () => ({
  getLocale: vi.fn(async () => "en"),
  getTranslations: vi.fn(async () => (key: string) => key),
}));

type TestUser = { id: number; name: string };
type TestKey = { id: number; userId: number; key: string; name: string };

const KEY_PREFIX = `it-imported-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`;

let requestCursor = 900_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 10;
let providerCursor = 950_000_000 + (Math.floor(Date.now() / 1000) % 1_000_000) * 10;

const createdUserIds: number[] = [];
const createdKeyIds: number[] = [];
const createdMessageIds: number[] = [];

function nextRequestId() {
  requestCursor += 1;
  return requestCursor;
}

function nextProviderId() {
  providerCursor += 1;
  return providerCursor;
}

function getStableRecentUtcTimestamp(): number {
  const now = new Date();
  return Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
    now.getUTCHours(),
    now.getUTCMinutes(),
    0,
    0
  );
}

async function createTestUser(name: string): Promise<TestUser> {
  const [row] = await db
    .insert(users)
    .values({ name })
    .returning({ id: users.id, name: users.name });

  if (!row) {
    throw new Error("failed to create test user");
  }

  createdUserIds.push(row.id);
  return row;
}

async function createTestKey(params: {
  userId: number;
  key: string;
  name: string;
  canLoginWebUi?: boolean;
}): Promise<TestKey> {
  const [row] = await db
    .insert(keys)
    .values({
      userId: params.userId,
      key: params.key,
      name: params.name,
      canLoginWebUi: params.canLoginWebUi ?? false,
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
      limit5hResetMode: "rolling",
    })
    .returning({ id: keys.id, userId: keys.userId, key: keys.key, name: keys.name });

  if (!row) {
    throw new Error("failed to create test key");
  }

  createdKeyIds.push(row.id);
  return row;
}

async function createMessage(params: {
  userId: number;
  key: string;
  model: string;
  endpoint?: string | null;
  originalModel?: string | null;
  costUsd?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  clientIp?: string | null;
  createdAt: Date;
}) {
  const providerId = nextProviderId();
  const [row] = await db
    .insert(messageRequest)
    .values({
      providerId,
      userId: params.userId,
      key: params.key,
      model: params.model,
      originalModel: params.originalModel ?? params.model,
      endpoint: params.endpoint ?? "/v1/messages",
      costUsd: params.costUsd ?? "0.000000000000000",
      inputTokens: params.inputTokens ?? 0,
      outputTokens: params.outputTokens ?? 0,
      clientIp: params.clientIp ?? null,
      createdAt: params.createdAt,
      updatedAt: params.createdAt,
    })
    .returning({ id: messageRequest.id });

  if (!row?.id) {
    throw new Error("failed to create message_request row");
  }

  createdMessageIds.push(row.id);
  return row.id;
}

async function insertLedgerOnlyRow(params: {
  requestId?: number;
  userId: number;
  key: string;
  model: string;
  endpoint: string;
  costUsd: string;
  inputTokens: number;
  outputTokens: number;
  createdAt: Date;
  clientIp?: string | null;
  sessionId?: string | null;
}) {
  const requestId = params.requestId ?? nextRequestId();
  const providerId = nextProviderId();

  await db.insert(usageLedger).values({
    requestId,
    userId: params.userId,
    key: params.key,
    providerId,
    finalProviderId: providerId,
    model: params.model,
    originalModel: params.model,
    endpoint: params.endpoint,
    apiType: "openai",
    sessionId: params.sessionId ?? null,
    statusCode: 200,
    isSuccess: true,
    blockedBy: null,
    costUsd: params.costUsd,
    inputTokens: params.inputTokens,
    outputTokens: params.outputTokens,
    clientIp: params.clientIp ?? null,
    createdAt: params.createdAt,
  });

  return requestId;
}

async function cleanupTestRows() {
  const keyLike = `${KEY_PREFIX}%`;
  await db.delete(usageLedger).where(sql`${usageLedger.key} LIKE ${keyLike}`);
  await db.delete(messageRequest).where(sql`${messageRequest.key} LIKE ${keyLike}`);

  const now = new Date();
  if (createdKeyIds.length > 0) {
    await db
      .update(keys)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(keys.id, createdKeyIds));
  }

  if (createdUserIds.length > 0) {
    await db
      .update(users)
      .set({ deletedAt: now, updatedAt: now })
      .where(inArray(users.id, createdUserIds));
  }
}

async function runAsSession<T>(userId: number, keyId: number, fn: () => Promise<T>): Promise<T> {
  const user = await findUserById(userId);
  const key = await findKeyById(keyId);

  if (!user || !key) {
    throw new Error("failed to load auth session fixture");
  }

  return runWithAuthSession({ user, key }, fn, { allowReadOnlyAccess: true });
}

describe.skipIf(!process.env.DSN)("my-usage imported ledger recovery", () => {
  afterAll(async () => {
    await cleanupTestRows();
  });

  test("ledger-only imported history still drives current-key my-usage while global message_request is non-empty", async () => {
    const {
      getMyAvailableEndpoints,
      getMyAvailableModels,
      getMyQuota,
      getMyStatsSummary,
      getMyUsageLogsBatch,
      getMyUsageLogsBatchFull,
    } = await import("@/actions/my-usage");

    const unique = `${KEY_PREFIX}-ledger-only-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Imported Ledger ${unique}`);
    const key = await createTestKey({
      userId: user.id,
      key: `${KEY_PREFIX}-primary-${unique}`,
      name: `primary-${unique}`,
    });
    const secondaryKey = await createTestKey({
      userId: user.id,
      key: `${KEY_PREFIX}-secondary-${unique}`,
      name: `secondary-${unique}`,
    });
    const anotherUser = await createTestUser(`Other ${unique}`);
    const anotherKey = await createTestKey({
      userId: anotherUser.id,
      key: `${KEY_PREFIX}-other-${unique}`,
      name: `other-${unique}`,
    });

    const now = getStableRecentUtcTimestamp();
    const today = new Date(now).toISOString().slice(0, 10);
    const visibleIp = "203.0.113.19";

    const oldA = await insertLedgerOnlyRow({
      userId: user.id,
      key: key.key,
      model: "ledger-model-a",
      endpoint: "/v1/messages",
      costUsd: "1.250000000000000",
      inputTokens: 120,
      outputTokens: 30,
      createdAt: new Date(now),
      clientIp: visibleIp,
    });
    const oldB = await insertLedgerOnlyRow({
      userId: user.id,
      key: key.key,
      model: "ledger-model-b",
      endpoint: "/v1/chat/completions",
      costUsd: "0.750000000000000",
      inputTokens: 80,
      outputTokens: 40,
      createdAt: new Date(now),
    });
    await insertLedgerOnlyRow({
      userId: user.id,
      key: secondaryKey.key,
      model: "ledger-model-c",
      endpoint: "/v1/responses",
      costUsd: "0.500000000000000",
      inputTokens: 60,
      outputTokens: 20,
      createdAt: new Date(now),
    });

    await createMessage({
      userId: anotherUser.id,
      key: anotherKey.key,
      model: "other-live-model",
      endpoint: "/v1/messages",
      costUsd: "0.330000000000000",
      inputTokens: 33,
      outputTokens: 11,
      createdAt: new Date(now),
    });

    const batch = await runAsSession(user.id, key.id, () => getMyUsageLogsBatch({ limit: 20 }));
    expect(batch.ok).toBe(true);
    expect(batch.ok && batch.data.logs.map((log) => log.id)).toEqual([oldB, oldA]);

    const full = await runAsSession(user.id, key.id, () => getMyUsageLogsBatchFull({ limit: 20 }));
    expect(full.ok).toBe(true);
    expect(full.ok && full.data.logs.map((log) => log.id)).toEqual([oldB, oldA]);

    const models = await runAsSession(user.id, key.id, () => getMyAvailableModels());
    expect(models).toMatchObject({ ok: true });
    expect(models.ok && models.data).toEqual(["ledger-model-a", "ledger-model-b"]);

    const endpoints = await runAsSession(user.id, key.id, () => getMyAvailableEndpoints());
    expect(endpoints).toMatchObject({ ok: true });
    expect(endpoints.ok && endpoints.data).toEqual(["/v1/chat/completions", "/v1/messages"]);

    const summary = await runAsSession(user.id, key.id, () =>
      getMyStatsSummary({ startDate: today, endDate: today })
    );
    expect(summary.ok).toBe(true);
    expect(summary.ok && summary.data.totalRequests).toBe(2);
    expect(summary.ok && summary.data.totalCost).toBeCloseTo(2.0, 10);
    expect(summary.ok && summary.data.keyModelBreakdown.map((row) => row.model)).toEqual([
      "ledger-model-a",
      "ledger-model-b",
    ]);
    expect(summary.ok && summary.data.userModelBreakdown.map((row) => row.model)).toEqual([
      "ledger-model-a",
      "ledger-model-b",
      "ledger-model-c",
    ]);

    const quota = await runAsSession(user.id, key.id, () => getMyQuota());
    expect(quota.ok).toBe(true);
    expect(quota.ok && quota.data.keyCurrent5hUsd).toBeCloseTo(2.0, 10);
    expect(quota.ok && quota.data.userCurrent5hUsd).toBeCloseTo(2.5, 10);
  });

  test("mixed imported ledger and new live requests merge without duplicate counting and do not change admin/global batch semantics", async () => {
    const {
      getMyAvailableModels,
      getMyQuota,
      getMyStatsSummary,
      getMyUsageLogsBatch,
      getMyUsageLogsBatchFull,
    } = await import("@/actions/my-usage");

    const unique = `${KEY_PREFIX}-mixed-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Mixed ${unique}`);
    const key = await createTestKey({
      userId: user.id,
      key: `${KEY_PREFIX}-mixed-key-${unique}`,
      name: `mixed-${unique}`,
    });

    const now = getStableRecentUtcTimestamp();
    const today = new Date(now).toISOString().slice(0, 10);

    const importedRequestId = await insertLedgerOnlyRow({
      userId: user.id,
      key: key.key,
      model: "imported-only-model",
      endpoint: "/v1/messages",
      costUsd: "1.100000000000000",
      inputTokens: 110,
      outputTokens: 55,
      createdAt: new Date(now),
    });

    const liveRequestId = await createMessage({
      userId: user.id,
      key: key.key,
      model: "live-model",
      endpoint: "/v1/responses",
      costUsd: "0.900000000000000",
      inputTokens: 90,
      outputTokens: 45,
      createdAt: new Date(now),
    });

    const batch = await runAsSession(user.id, key.id, () => getMyUsageLogsBatch({ limit: 20 }));
    expect(batch.ok).toBe(true);
    expect(batch.ok && batch.data.logs.map((log) => log.id)).toEqual([
      importedRequestId,
      liveRequestId,
    ]);

    const full = await runAsSession(user.id, key.id, () => getMyUsageLogsBatchFull({ limit: 20 }));
    expect(full.ok).toBe(true);
    expect(full.ok && full.data.logs.map((log) => log.id)).toEqual([
      importedRequestId,
      liveRequestId,
    ]);

    const summary = await runAsSession(user.id, key.id, () =>
      getMyStatsSummary({ startDate: today, endDate: today })
    );
    expect(summary.ok).toBe(true);
    expect(summary.ok && summary.data.totalRequests).toBe(2);
    expect(summary.ok && summary.data.totalCost).toBeCloseTo(2.0, 10);
    expect(summary.ok && summary.data.keyModelBreakdown.map((row) => row.model)).toEqual([
      "imported-only-model",
      "live-model",
    ]);

    const quota = await runAsSession(user.id, key.id, () => getMyQuota());
    expect(quota.ok).toBe(true);
    expect(quota.ok && quota.data.keyCurrent5hUsd).toBeCloseTo(2.0, 10);
    expect(quota.ok && quota.data.keyCurrentTotalUsd).toBeCloseTo(2.0, 10);

    const models = await runAsSession(user.id, key.id, () => getMyAvailableModels());
    expect(models).toMatchObject({ ok: true });
    expect(models.ok && models.data).toEqual(["imported-only-model", "live-model"]);

    const adminBatch = await findUsageLogsBatch({ keyId: key.id, limit: 20 });
    expect(adminBatch.logs.map((log) => log.id)).toEqual([liveRequestId]);
  });

  test("cursor pagination remains stable across merged key history when rows share the same createdAt", async () => {
    const { getMyUsageLogsBatch, getMyUsageLogsBatchFull } = await import("@/actions/my-usage");

    const unique = `${KEY_PREFIX}-cursor-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Cursor ${unique}`);
    const key = await createTestKey({
      userId: user.id,
      key: `${KEY_PREFIX}-cursor-key-${unique}`,
      name: `cursor-${unique}`,
    });

    const createdAt = new Date(getStableRecentUtcTimestamp());
    const importedRequestId = await insertLedgerOnlyRow({
      userId: user.id,
      key: key.key,
      model: "cursor-imported-model",
      endpoint: "/v1/messages",
      costUsd: "0.700000000000000",
      inputTokens: 70,
      outputTokens: 14,
      createdAt,
    });
    const liveRequestId = await createMessage({
      userId: user.id,
      key: key.key,
      model: "cursor-live-model",
      endpoint: "/v1/responses",
      costUsd: "0.600000000000000",
      inputTokens: 60,
      outputTokens: 12,
      createdAt,
    });

    const firstBatch = await runAsSession(user.id, key.id, () => getMyUsageLogsBatch({ limit: 1 }));
    expect(firstBatch.ok).toBe(true);
    expect(firstBatch.ok && firstBatch.data.hasMore).toBe(true);
    expect(firstBatch.ok && firstBatch.data.logs.map((log) => log.id)).toEqual([importedRequestId]);

    const secondBatch = await runAsSession(user.id, key.id, () =>
      getMyUsageLogsBatch({
        limit: 1,
        cursor: firstBatch.ok ? (firstBatch.data.nextCursor ?? undefined) : undefined,
      })
    );
    expect(secondBatch.ok).toBe(true);
    expect(secondBatch.ok && secondBatch.data.logs.map((log) => log.id)).toEqual([liveRequestId]);

    const firstFull = await runAsSession(user.id, key.id, () =>
      getMyUsageLogsBatchFull({ limit: 1 })
    );
    expect(firstFull.ok).toBe(true);
    expect(firstFull.ok && firstFull.data.hasMore).toBe(true);
    expect(firstFull.ok && firstFull.data.logs.map((log) => log.id)).toEqual([importedRequestId]);

    const secondFull = await runAsSession(user.id, key.id, () =>
      getMyUsageLogsBatchFull({
        limit: 1,
        cursor: firstFull.ok ? (firstFull.data.nextCursor ?? undefined) : undefined,
      })
    );
    expect(secondFull.ok).toBe(true);
    expect(secondFull.ok && secondFull.data.logs.map((log) => log.id)).toEqual([liveRequestId]);
  });

  test("ledger rows that reference an active live message_request are deduped from my-usage batch and full views", async () => {
    const { getMyUsageLogsBatch, getMyUsageLogsBatchFull } = await import("@/actions/my-usage");

    const unique = `${KEY_PREFIX}-dedupe-${Math.random().toString(16).slice(2)}`;
    const user = await createTestUser(`Dedupe ${unique}`);
    const key = await createTestKey({
      userId: user.id,
      key: `${KEY_PREFIX}-dedupe-key-${unique}`,
      name: `dedupe-${unique}`,
    });

    const createdAt = new Date(getStableRecentUtcTimestamp());
    const liveRequestId = await createMessage({
      userId: user.id,
      key: key.key,
      model: "dedupe-live-model",
      endpoint: "/v1/responses",
      costUsd: "0.800000000000000",
      inputTokens: 80,
      outputTokens: 16,
      createdAt,
    });

    const batch = await runAsSession(user.id, key.id, () => getMyUsageLogsBatch({ limit: 20 }));
    expect(batch.ok).toBe(true);
    expect(batch.ok && batch.data.logs.map((log) => log.id)).toEqual([liveRequestId]);

    const full = await runAsSession(user.id, key.id, () => getMyUsageLogsBatchFull({ limit: 20 }));
    expect(full.ok).toBe(true);
    expect(full.ok && full.data.logs.map((log) => log.id)).toEqual([liveRequestId]);
  });
});
