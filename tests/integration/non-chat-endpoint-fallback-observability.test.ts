import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { keys, messageRequest, usageLedger, users } from "@/drizzle/schema";
import { findUsageLogsBatch, findUsageLogsStats } from "@/repository/usage-logs";
import { getSystemSettings, updateSystemSettings } from "@/repository/system-config";

if (!process.env.DSN && process.env.DATABASE_URL) {
  process.env.DSN = process.env.DATABASE_URL;
}

const HAS_DB = Boolean(process.env.DSN);
const run = describe.skipIf(!HAS_DB);

const KEY_PREFIX = `it-non-chat-fallback-${Date.now()}-${Math.random().toString(16).slice(2)}`;
let cursor = 0;
const createdUserIds: number[] = [];
const createdKeyIds: number[] = [];
const createdMessageIds: number[] = [];

function nextId(base: number) {
  cursor += 1;
  return base + cursor;
}

async function createTestUser(name: string) {
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

async function createTestKey(userId: number, name: string) {
  const [row] = await db
    .insert(keys)
    .values({
      userId,
      key: `${KEY_PREFIX}-${name}`,
      name,
      canLoginWebUi: false,
      dailyResetMode: "rolling",
      dailyResetTime: "00:00",
      limit5hResetMode: "rolling",
    })
    .returning({ id: keys.id, key: keys.key, name: keys.name });

  if (!row) {
    throw new Error("failed to create test key");
  }

  createdKeyIds.push(row.id);
  return row;
}

async function insertNonChatMessageRequest(params: {
  userId: number;
  key: string;
  endpoint: "/v1/messages/count_tokens" | "/v1/responses/compact";
  sessionId: string;
  providerChain: Array<Record<string, unknown>>;
  model: string;
  statusCode?: number;
  errorMessage?: string | null;
}) {
  const providerId = nextId(900_000_000);
  const [row] = await db
    .insert(messageRequest)
    .values({
      userId: params.userId,
      key: params.key,
      providerId,
      model: params.model,
      originalModel: params.model,
      endpoint: params.endpoint,
      apiType: params.endpoint === "/v1/responses/compact" ? "response" : "claude",
      sessionId: params.sessionId,
      requestSequence: 1,
      statusCode: params.statusCode ?? 200,
      errorMessage: params.errorMessage ?? null,
      providerChain: params.providerChain,
      inputTokens: 10,
      outputTokens: 0,
      costUsd: "1.500000000000000",
    })
    .returning({ id: messageRequest.id });

  if (!row) {
    throw new Error("failed to insert non-chat message_request row");
  }

  createdMessageIds.push(row.id);
  return row.id;
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

let originalAllowNonConversationEndpointProviderFallback: boolean | null | undefined;

run("non-chat endpoint fallback observability", () => {
  beforeAll(async () => {
    await cleanupTestRows();
    const settings = await getSystemSettings();
    originalAllowNonConversationEndpointProviderFallback =
      settings.allowNonConversationEndpointProviderFallback;
  });

  afterAll(async () => {
    await cleanupTestRows();
    if (originalAllowNonConversationEndpointProviderFallback !== undefined) {
      await updateSystemSettings({
        allowNonConversationEndpointProviderFallback:
          originalAllowNonConversationEndpointProviderFallback,
      });
    }
  });

  test("enabled setting keeps non-chat rows non-billing and hidden by default while explicit endpoint filters can reveal them", async () => {
    await updateSystemSettings({ allowNonConversationEndpointProviderFallback: true });
    const settings = await getSystemSettings();
    expect(settings.allowNonConversationEndpointProviderFallback).toBe(true);

    const user = await createTestUser(`${KEY_PREFIX}-enabled-user`);
    const key = await createTestKey(user.id, "enabled-key");

    const countTokensRequestId = await insertNonChatMessageRequest({
      userId: user.id,
      key: key.key,
      endpoint: "/v1/messages/count_tokens",
      sessionId: `${KEY_PREFIX}-session-count`,
      model: "claude-sonnet-4-5",
      providerChain: [
        { id: 11, name: "provider-a", reason: "retry_failed", statusCode: 500 },
        { id: 12, name: "provider-b", reason: "retry_success", statusCode: 200 },
      ],
    });
    const compactRequestId = await insertNonChatMessageRequest({
      userId: user.id,
      key: key.key,
      endpoint: "/v1/responses/compact",
      sessionId: `${KEY_PREFIX}-session-compact`,
      model: "gpt-5",
      providerChain: [
        { id: 21, name: "provider-c", reason: "retry_failed", statusCode: 500 },
        { id: 22, name: "provider-d", reason: "retry_success", statusCode: 200 },
      ],
    });

    const ledgerRows = await db
      .select({ requestId: usageLedger.requestId })
      .from(usageLedger)
      .where(inArray(usageLedger.requestId, [countTokensRequestId, compactRequestId]));
    expect(ledgerRows).toHaveLength(0);

    const hiddenBatch = await findUsageLogsBatch({ userId: user.id, limit: 20 });
    expect(hiddenBatch.logs.find((log) => log.id === countTokensRequestId)).toBeUndefined();
    expect(hiddenBatch.logs.find((log) => log.id === compactRequestId)).toBeUndefined();

    const hiddenStats = await findUsageLogsStats({ userId: user.id });
    expect(hiddenStats.totalRequests).toBe(0);

    const revealedCountTokens = await findUsageLogsBatch({
      userId: user.id,
      endpoint: "/v1/messages/count_tokens",
      limit: 20,
    });
    expect(revealedCountTokens.logs.some((log) => log.id === countTokensRequestId)).toBe(true);

    const revealedCompact = await findUsageLogsBatch({
      userId: user.id,
      endpoint: "/v1/responses/compact",
      limit: 20,
    });
    expect(revealedCompact.logs.some((log) => log.id === compactRequestId)).toBe(true);

    const countTokensStats = await findUsageLogsStats({
      userId: user.id,
      endpoint: "/v1/messages/count_tokens",
    });
    const compactStats = await findUsageLogsStats({
      userId: user.id,
      endpoint: "/v1/responses/compact",
    });
    expect(countTokensStats.totalRequests).toBeGreaterThanOrEqual(1);
    expect(compactStats.totalRequests).toBeGreaterThanOrEqual(1);
  });

  test("disabled setting still keeps non-chat rows non-billing and hidden by default", async () => {
    await updateSystemSettings({ allowNonConversationEndpointProviderFallback: false });
    const settings = await getSystemSettings();
    expect(settings.allowNonConversationEndpointProviderFallback).toBe(false);

    const user = await createTestUser(`${KEY_PREFIX}-disabled-user`);
    const key = await createTestKey(user.id, "disabled-key");

    const requestId = await insertNonChatMessageRequest({
      userId: user.id,
      key: key.key,
      endpoint: "/v1/messages/count_tokens",
      sessionId: `${KEY_PREFIX}-session-disabled`,
      model: "claude-sonnet-4-5",
      statusCode: 500,
      errorMessage: "upstream failed",
      providerChain: [{ id: 31, name: "provider-only", reason: "retry_failed", statusCode: 500 }],
    });

    const hiddenBatch = await findUsageLogsBatch({ userId: user.id, limit: 20 });
    expect(hiddenBatch.logs.find((log) => log.id === requestId)).toBeUndefined();

    const revealedBatch = await findUsageLogsBatch({
      userId: user.id,
      endpoint: "/v1/messages/count_tokens",
      limit: 20,
    });
    const revealedRow = revealedBatch.logs.find((log) => log.id === requestId);
    expect(revealedRow).toBeDefined();
    expect(revealedRow?.providerChain).toHaveLength(1);

    const ledgerRow = await db
      .select({ requestId: usageLedger.requestId })
      .from(usageLedger)
      .where(and(eq(usageLedger.requestId, requestId), eq(usageLedger.key, key.key)));
    expect(ledgerRow).toHaveLength(0);
  });
});
