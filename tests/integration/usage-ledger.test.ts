import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { and, eq, inArray, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { db } from "@/drizzle/db";
import { messageRequest, usageLedger } from "@/drizzle/schema";
import { backfillUsageLedger } from "@/lib/ledger-backfill";
import { isLedgerOnlyMode } from "@/lib/ledger-fallback";
import { findUsageLogs } from "@/repository/message";
import { sumProviderTotalCost, sumUserTotalCost } from "@/repository/statistics";

if (!process.env.DSN && process.env.DATABASE_URL) {
  process.env.DSN = process.env.DATABASE_URL;
}

const HAS_DB = Boolean(process.env.DSN);
const run = describe.skipIf(!HAS_DB);

const KEY_PREFIX = `it-usage-ledger-${Date.now()}-${Math.random().toString(16).slice(2)}`;
const ID_SEED = Math.floor(Date.now() / 1000) % 1_000_000;

let idCursor = 0;
let keyCursor = 0;

function nextUserId() {
  idCursor += 1;
  return 700_000_000 + ID_SEED * 10 + idCursor;
}

function nextProviderId() {
  idCursor += 1;
  return 800_000_000 + ID_SEED * 10 + idCursor;
}

function nextKey(tag: string) {
  keyCursor += 1;
  return `${KEY_PREFIX}-${tag}-${keyCursor}`;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

type InsertRequestInput = {
  key: string;
  userId: number;
  providerId: number;
  model?: string | null;
  originalModel?: string | null;
  endpoint?: string | null;
  apiType?: string | null;
  statusCode?: number | null;
  blockedBy?: string | null;
  errorMessage?: string | null;
  costUsd?: string | null;
  costMultiplier?: string | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  providerChain?: Array<{ id: number; name: string }> | null;
  createdAt?: Date;
};

async function insertMessageRequestRow(input: InsertRequestInput) {
  const [row] = await db
    .insert(messageRequest)
    .values({
      key: input.key,
      userId: input.userId,
      providerId: input.providerId,
      model: input.model,
      originalModel: input.originalModel,
      endpoint: input.endpoint,
      apiType: input.apiType,
      statusCode: input.statusCode,
      blockedBy: input.blockedBy,
      errorMessage: input.errorMessage,
      costUsd: input.costUsd,
      costMultiplier: input.costMultiplier,
      inputTokens: input.inputTokens,
      outputTokens: input.outputTokens,
      providerChain: input.providerChain,
      createdAt: input.createdAt,
    })
    .returning({ id: messageRequest.id });

  if (!row) {
    throw new Error("failed to insert message_request test row");
  }

  return row.id;
}

async function selectLedgerRowByRequestId(requestId: number) {
  const [row] = await db
    .select({
      id: usageLedger.id,
      requestId: usageLedger.requestId,
      userId: usageLedger.userId,
      key: usageLedger.key,
      providerId: usageLedger.providerId,
      finalProviderId: usageLedger.finalProviderId,
      model: usageLedger.model,
      originalModel: usageLedger.originalModel,
      endpoint: usageLedger.endpoint,
      apiType: usageLedger.apiType,
      statusCode: usageLedger.statusCode,
      isSuccess: usageLedger.isSuccess,
      blockedBy: usageLedger.blockedBy,
      costUsd: usageLedger.costUsd,
      costMultiplier: usageLedger.costMultiplier,
      inputTokens: usageLedger.inputTokens,
      outputTokens: usageLedger.outputTokens,
      createdAt: usageLedger.createdAt,
    })
    .from(usageLedger)
    .where(eq(usageLedger.requestId, requestId))
    .limit(1);

  return row ?? null;
}

async function cleanupTestRows() {
  const keyLike = `${KEY_PREFIX}%`;
  await db.delete(messageRequest).where(sql`${messageRequest.key} LIKE ${keyLike}`);
  await db.delete(usageLedger).where(sql`${usageLedger.key} LIKE ${keyLike}`);
}

run("usage ledger integration", () => {
  beforeAll(async () => {
    await cleanupTestRows();
  });

  afterAll(async () => {
    await cleanupTestRows();
  });

  describe("trigger", () => {
    test("inserts usage_ledger row after inserting message_request", async () => {
      const key = nextKey("trigger-insert");
      const userId = nextUserId();
      const providerId = nextProviderId();
      const createdAt = new Date("2026-02-19T03:00:00.000Z");

      const requestId = await insertMessageRequestRow({
        key,
        userId,
        providerId,
        model: "model-a",
        originalModel: "model-a-original",
        endpoint: "/v1/messages",
        apiType: "response",
        statusCode: 200,
        costUsd: "1.250000000000000",
        costMultiplier: "1.1000",
        inputTokens: 12,
        outputTokens: 34,
        createdAt,
      });

      const ledgerRow = await selectLedgerRowByRequestId(requestId);
      expect(ledgerRow).not.toBeNull();
      expect(ledgerRow?.requestId).toBe(requestId);
      expect(ledgerRow?.key).toBe(key);
      expect(ledgerRow?.userId).toBe(userId);
      expect(ledgerRow?.providerId).toBe(providerId);
      expect(ledgerRow?.finalProviderId).toBe(providerId);
      expect(ledgerRow?.model).toBe("model-a");
      expect(ledgerRow?.originalModel).toBe("model-a-original");
      expect(ledgerRow?.endpoint).toBe("/v1/messages");
      expect(ledgerRow?.apiType).toBe("response");
      expect(ledgerRow?.statusCode).toBe(200);
      expect(ledgerRow?.isSuccess).toBe(true);
      expect(toNumber(ledgerRow?.costUsd)).toBeCloseTo(1.25, 10);
      expect(ledgerRow?.inputTokens).toBe(12);
      expect(ledgerRow?.outputTokens).toBe(34);
      expect(ledgerRow?.createdAt).toEqual(createdAt);
    });

    test("updates usage_ledger row on message_request update (UPSERT)", async () => {
      const key = nextKey("trigger-update");
      const userId = nextUserId();
      const providerId = nextProviderId();

      const requestId = await insertMessageRequestRow({
        key,
        userId,
        providerId,
        model: "model-before",
        costUsd: "0",
      });

      await db
        .update(messageRequest)
        .set({
          model: "model-after",
          costUsd: "3.500000000000000",
          inputTokens: 101,
          outputTokens: 202,
          statusCode: 201,
        })
        .where(eq(messageRequest.id, requestId));

      const rows = await db
        .select({
          id: usageLedger.id,
          model: usageLedger.model,
          costUsd: usageLedger.costUsd,
          inputTokens: usageLedger.inputTokens,
          outputTokens: usageLedger.outputTokens,
          statusCode: usageLedger.statusCode,
        })
        .from(usageLedger)
        .where(eq(usageLedger.requestId, requestId));

      expect(rows).toHaveLength(1);
      expect(rows[0]?.model).toBe("model-after");
      expect(toNumber(rows[0]?.costUsd)).toBeCloseTo(3.5, 10);
      expect(rows[0]?.inputTokens).toBe(101);
      expect(rows[0]?.outputTokens).toBe(202);
      expect(rows[0]?.statusCode).toBe(201);
    });

    test("does not insert usage_ledger row for warmup requests", async () => {
      const requestId = await insertMessageRequestRow({
        key: nextKey("trigger-warmup"),
        userId: nextUserId(),
        providerId: nextProviderId(),
        blockedBy: "warmup",
        costUsd: "8.900000000000000",
      });

      const ledgerRow = await selectLedgerRowByRequestId(requestId);
      expect(ledgerRow).toBeNull();
    });

    test("extracts final_provider_id from provider_chain", async () => {
      const providerId = nextProviderId();
      const requestId = await insertMessageRequestRow({
        key: nextKey("trigger-provider-chain"),
        userId: nextUserId(),
        providerId,
        providerChain: [
          { id: providerId, name: "origin" },
          { id: providerId + 777, name: "final" },
        ],
      });

      const ledgerRow = await selectLedgerRowByRequestId(requestId);
      expect(ledgerRow).not.toBeNull();
      expect(ledgerRow?.finalProviderId).toBe(providerId + 777);
    });

    test("sets is_success=false when error_message exists", async () => {
      const requestId = await insertMessageRequestRow({
        key: nextKey("trigger-error"),
        userId: nextUserId(),
        providerId: nextProviderId(),
        errorMessage: "upstream failed",
        statusCode: 500,
      });

      const ledgerRow = await selectLedgerRowByRequestId(requestId);
      expect(ledgerRow?.isSuccess).toBe(false);
    });

    test("sets is_success=true when error_message is absent", async () => {
      const requestId = await insertMessageRequestRow({
        key: nextKey("trigger-success"),
        userId: nextUserId(),
        providerId: nextProviderId(),
        statusCode: 200,
      });

      const ledgerRow = await selectLedgerRowByRequestId(requestId);
      expect(ledgerRow?.isSuccess).toBe(true);
    });
  });

  describe("backfill", () => {
    test(
      "backfill copies non-warmup message_request rows when ledger rows are missing",
      { timeout: 60_000 },
      async () => {
        const userId = nextUserId();
        const providerId = nextProviderId();
        const keepA = await insertMessageRequestRow({
          key: nextKey("backfill-a"),
          userId,
          providerId,
          costUsd: "1.100000000000000",
        });
        const keepB = await insertMessageRequestRow({
          key: nextKey("backfill-b"),
          userId,
          providerId,
          costUsd: "2.200000000000000",
        });
        const warmup = await insertMessageRequestRow({
          key: nextKey("backfill-warmup"),
          userId,
          providerId,
          blockedBy: "warmup",
        });

        await db.delete(usageLedger).where(inArray(usageLedger.requestId, [keepA, keepB, warmup]));

        const summary = await backfillUsageLedger();
        expect(summary.totalProcessed).toBeGreaterThanOrEqual(2);

        const rows = await db
          .select({ requestId: usageLedger.requestId })
          .from(usageLedger)
          .where(inArray(usageLedger.requestId, [keepA, keepB, warmup]));
        const requestIds = rows.map((row) => row.requestId);

        expect(requestIds).toContain(keepA);
        expect(requestIds).toContain(keepB);
        expect(requestIds).not.toContain(warmup);
      }
    );

    test("backfill is idempotent when running twice", { timeout: 60_000 }, async () => {
      const requestId = await insertMessageRequestRow({
        key: nextKey("backfill-idempotent"),
        userId: nextUserId(),
        providerId: nextProviderId(),
        costUsd: "6.600000000000000",
      });

      await db.delete(usageLedger).where(eq(usageLedger.requestId, requestId));

      await backfillUsageLedger();
      const countAfterFirst = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(usageLedger)
        .where(eq(usageLedger.requestId, requestId));

      await backfillUsageLedger();
      const countAfterSecond = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(usageLedger)
        .where(eq(usageLedger.requestId, requestId));

      expect(countAfterFirst[0]?.count ?? 0).toBe(1);
      expect(countAfterSecond[0]?.count ?? 0).toBe(1);
    });
  });

  describe("read path consistency", () => {
    test("sumUserTotalCost matches expected cost from trigger-written ledger data", async () => {
      const userId = nextUserId();
      const providerId = nextProviderId();

      await insertMessageRequestRow({
        key: nextKey("read-match-a"),
        userId,
        providerId,
        costUsd: "1.110000000000000",
      });
      await insertMessageRequestRow({
        key: nextKey("read-match-b"),
        userId,
        providerId,
        costUsd: "2.220000000000000",
      });

      const total = await sumUserTotalCost(userId, Number.POSITIVE_INFINITY);
      expect(total).toBeCloseTo(3.33, 10);
    });

    test("ledger totals remain stable after deleting message_request rows", async () => {
      const userId = nextUserId();
      const providerId = nextProviderId();

      const requestA = await insertMessageRequestRow({
        key: nextKey("read-delete-a"),
        userId,
        providerId,
        costUsd: "4.440000000000000",
      });
      const requestB = await insertMessageRequestRow({
        key: nextKey("read-delete-b"),
        userId,
        providerId,
        costUsd: "5.550000000000000",
      });

      const beforeUserCost = await sumUserTotalCost(userId, Number.POSITIVE_INFINITY);
      const beforeProviderCost = await sumProviderTotalCost(providerId);

      await db
        .delete(messageRequest)
        .where(
          and(eq(messageRequest.userId, userId), inArray(messageRequest.id, [requestA, requestB]))
        );

      const afterUserCost = await sumUserTotalCost(userId, Number.POSITIVE_INFINITY);
      const afterProviderCost = await sumProviderTotalCost(providerId);

      expect(afterUserCost).toBeCloseTo(beforeUserCost, 10);
      expect(afterProviderCost).toBeCloseTo(beforeProviderCost, 10);
    });
  });

  describe("ledger-only mode", () => {
    test("isLedgerOnlyMode returns boolean", async () => {
      const result = await isLedgerOnlyMode();
      expect(typeof result).toBe("boolean");
    });

    test("log listing has ledger fallback path", async () => {
      const key = nextKey("ledger-only-logs");
      const userId = nextUserId();
      const providerId = nextProviderId();
      const requestId = await insertMessageRequestRow({
        key,
        userId,
        providerId,
        costUsd: "7.770000000000000",
      });

      await db.delete(messageRequest).where(eq(messageRequest.id, requestId));

      const [remaining] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(messageRequest);

      if ((remaining?.count ?? 0) > 0) {
        const source = await readFile(resolve(process.cwd(), "src/repository/message.ts"), "utf8");
        expect(source).toContain("if (!(await isLedgerOnlyMode()))");
        expect(source).toContain(".from(usageLedger)");
        return;
      }

      vi.resetModules();
      const { findUsageLogs: findUsageLogsFresh } = await import("@/repository/message");
      const result = await findUsageLogsFresh({ userId, page: 1, pageSize: 20 });

      expect(result.logs.some((row) => row.id === requestId)).toBe(true);
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  test("findUsageLogs remains callable for compatibility", async () => {
    const key = nextKey("compat-call");
    const userId = nextUserId();
    const providerId = nextProviderId();

    await insertMessageRequestRow({
      key,
      userId,
      providerId,
      costUsd: "0.010000000000000",
    });

    const result = await findUsageLogs({ userId, page: 1, pageSize: 5 });
    expect(Array.isArray(result.logs)).toBe(true);
  });
});
