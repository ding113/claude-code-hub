import { randomUUID } from "node:crypto";
import { performance } from "node:perf_hooks";
import { like } from "drizzle-orm";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { messageRequest, usageLedger } from "@/drizzle/schema";

const ENV_KEYS = [
  "DSN",
  "DB_POOL_MAX",
  "DB_LOCK_TIMEOUT_MS",
  "DB_STATEMENT_TIMEOUT_MS",
  "MESSAGE_REQUEST_WRITE_MODE",
  "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS",
  "MESSAGE_REQUEST_ASYNC_BATCH_SIZE",
  "MESSAGE_REQUEST_ASYNC_MAX_PENDING",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]] as const));
const dsn = process.env.DSN ?? process.env.DATABASE_URL;

if (dsn) {
  process.env.DSN = dsn;
  process.env.DB_POOL_MAX = "4";
  process.env.DB_LOCK_TIMEOUT_MS = "100";
  process.env.DB_STATEMENT_TIMEOUT_MS = "5000";
  process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
  process.env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS = "50";
  process.env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = "200";
  process.env.MESSAGE_REQUEST_ASYNC_MAX_PENDING = "5000";
}
vi.resetModules();

const run = describe.skipIf(!dsn);
const KEY_PREFIX = `it-message-buffer-recovery-${randomUUID()}`;

run.sequential("message write buffer PostgreSQL recovery", () => {
  let dbModule: typeof import("@/drizzle/db");
  let messageRepository: typeof import("@/repository/message");
  let writeBuffer: typeof import("@/repository/message-write-buffer");
  let lockClient: ReturnType<typeof postgres>;

  async function createRequest(tag: string, costUsd = "0.250000000000000"): Promise<number> {
    const request = await messageRepository.createMessageRequest({
      provider_id: 910_000_001,
      user_id: 920_000_001,
      key: `${KEY_PREFIX}-${tag}`,
      model: "integration-model",
      original_model: "integration-model",
      endpoint: "/v1/messages",
      cost_usd: costUsd,
    });
    return request.id;
  }

  async function cleanupTestRows(): Promise<void> {
    const keyPattern = `${KEY_PREFIX}%`;
    await dbModule.getDb().delete(messageRequest).where(like(messageRequest.key, keyPattern));
    await dbModule.getDb().delete(usageLedger).where(like(usageLedger.key, keyPattern));
  }

  async function expectRequest(
    id: number,
    expected: Readonly<Record<string, unknown>>
  ): Promise<void> {
    await expect(messageRepository.findMessageRequestById(id)).resolves.toMatchObject(expected);
  }

  function restoreEnvironment(): void {
    for (const [key, value] of originalEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }

  beforeAll(async () => {
    if (!dsn) throw new TypeError("DSN or DATABASE_URL is required");

    const harnessDb = await import("@/drizzle/db");
    await harnessDb.closeDbPools();
    vi.resetModules();

    [dbModule, messageRepository, writeBuffer] = await Promise.all([
      import("@/drizzle/db"),
      import("@/repository/message"),
      import("@/repository/message-write-buffer"),
    ]);
    lockClient = postgres(dsn, {
      max: 1,
      connect_timeout: 5,
      connection: { application_name: "cch-message-buffer-recovery:lock" },
    });

    const [{ databaseName }] = await lockClient<{ databaseName: string }[]>`
      SELECT current_database() AS "databaseName"
    `;
    expect(databaseName).toMatch(/test/i);
    await cleanupTestRows();
  });

  afterAll(async () => {
    const failures: unknown[] = [];
    for (const cleanup of [
      () => writeBuffer.stopMessageRequestWriteBuffer(),
      cleanupTestRows,
      () => lockClient.end({ timeout: 5 }),
      () => dbModule.closeDbPools(),
    ]) {
      try {
        await cleanup();
      } catch (error) {
        failures.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    restoreEnvironment();
    if (failures.length > 0) throw new AggregateError(failures, "integration cleanup failed");
  });

  test("settles a mixed durable batch only after PostgreSQL commits", async () => {
    const ordinaryId = await createRequest("mixed-ordinary");
    const durableId = await createRequest("mixed-durable");

    const operations = await lockClient.begin(async (transaction) => {
      await transaction`SELECT id FROM message_request WHERE id = ${durableId} FOR UPDATE`;
      writeBuffer.enqueueMessageRequestUpdate(ordinaryId, { durationMs: 450 });
      const durable = writeBuffer.enqueueMessageRequestUpdateDurably(durableId, {
        durationMs: 900,
        statusCode: 200,
        costUsd: "0.375000000000000",
      });
      const flush = writeBuffer.flushMessageRequestWriteBuffer();

      await expect(
        Promise.race([durable.then(() => "settled"), Promise.resolve("pending")])
      ).resolves.toBe("pending");
      await expectRequest(ordinaryId, { durationMs: null });
      return { durable, flush };
    });

    await Promise.all([operations.flush, operations.durable]);
    await expectRequest(ordinaryId, { durationMs: 450 });
    await expectRequest(durableId, {
      durationMs: 900,
      statusCode: 200,
      costUsd: "0.375000000000000",
    });
    await messageRepository.updateMessageRequestDetailsIfUnfinalized(durableId, {
      durationMs: 1_800,
      statusCode: 503,
    });
    await expectRequest(durableId, { durationMs: 900, statusCode: 200 });
  });

  test("keeps fallback ownership when a timed-out primary commits late", async () => {
    const requestId = await createRequest("fallback-first");
    let committedReceipts = 0;

    const { flush } = await lockClient.begin(async (transaction) => {
      await transaction`SELECT id FROM message_request WHERE id = ${requestId} FOR UPDATE`;
      const primary = writeBuffer.enqueueMessageRequestUpdateDurably(
        requestId,
        {
          durationMs: 300,
          statusCode: 200,
          costUsd: "0.100000000000000",
          errorMessage: "retired-primary",
        },
        {
          timeoutMs: 20,
          onCommitted: () => {
            committedReceipts++;
          },
        }
      );
      const flush = writeBuffer.flushMessageRequestWriteBuffer();

      await expect(primary).rejects.toThrow("durable message_request acknowledgement timed out");
      const fallbackReceipts = await transaction<{ id: number }[]>`
        UPDATE message_request
        SET duration_ms = 2_400,
            status_code = 504,
            cost_usd = 0.625,
            error_message = 'fallback-owner',
            updated_at = NOW()
        WHERE id = ${requestId} AND status_code IS NULL
        RETURNING id
      `;
      expect(fallbackReceipts).toEqual([{ id: requestId }]);
      return { flush };
    });

    await flush;
    expect(committedReceipts).toBe(0);
    await expectRequest(requestId, {
      durationMs: 2_400,
      statusCode: 504,
      costUsd: "0.625000000000000",
      errorMessage: "fallback-owner",
    });
  });

  test("reinserted generation excludes a retired pending patch", async () => {
    const requestId = await createRequest("generation-reinsert");
    const retired = writeBuffer.enqueueMessageRequestUpdateDurably(
      requestId,
      { statusCode: 500, costUsd: "0.100000000000000", errorMessage: "retired-pending" },
      { timeoutMs: 20 }
    );

    await expect(retired).rejects.toThrow("durable message_request acknowledgement timed out");
    const current = writeBuffer.enqueueMessageRequestUpdateDurably(requestId, {
      durationMs: 700,
      statusCode: 201,
      costUsd: "0.450000000000000",
      errorMessage: "current-generation",
    });
    await Promise.all([writeBuffer.flushMessageRequestWriteBuffer(), current]);

    await expectRequest(requestId, {
      durationMs: 700,
      statusCode: 201,
      costUsd: "0.450000000000000",
      errorMessage: "current-generation",
    });
  });

  test("bounds a saturated 5,000-entry queue while retaining terminal priority", async () => {
    const lockedId = await createRequest("saturation-lock");
    const terminalId = await createRequest("saturation-terminal");
    const evictedId = await createRequest("saturation-evicted");
    const retainedId = await createRequest("saturation-retained");

    const { flush } = await lockClient.begin(async (transaction) => {
      await transaction`SELECT id FROM message_request WHERE id = ${lockedId} FOR UPDATE`;
      writeBuffer.enqueueMessageRequestUpdate(lockedId, { durationMs: 1 });
      for (let index = 0; index < 199; index++) {
        writeBuffer.enqueueMessageRequestUpdate(-1_000_000 - index, { durationMs: index });
      }

      writeBuffer.enqueueMessageRequestUpdate(terminalId, { statusCode: 202 });
      writeBuffer.enqueueMessageRequestUpdate(evictedId, { model: "evicted-model" });
      for (let index = 0; index < 4_998; index++) {
        writeBuffer.enqueueMessageRequestUpdate(-2_000_000 - index, { model: `filler-${index}` });
      }
      writeBuffer.enqueueMessageRequestUpdate(retainedId, { model: "retained-model" });
      return { flush: writeBuffer.flushMessageRequestWriteBuffer() };
    });

    await flush;
    await expectRequest(lockedId, { durationMs: 1 });
    await expectRequest(terminalId, { statusCode: 202 });
    await expectRequest(evictedId, { model: "integration-model" });
    await expectRequest(retainedId, { model: "retained-model" });
  });

  test("retries at bounded cadence and retains authoritative loser costs", async () => {
    const requestId = await createRequest("cost-retry", "0");
    await messageRepository.addMessageRequestHedgeLoserCost(requestId, "0.02", {
      providerId: 31,
      providerName: "first-loser",
      attemptNumber: 1,
      costUsd: "0.02",
    });

    const startedAt = performance.now();
    await lockClient.begin(async (transaction) => {
      await transaction`SELECT id FROM message_request WHERE id = ${requestId} FOR UPDATE`;
      await expect(
        messageRepository.updateMessageRequestWinnerCost(requestId, "0.10")
      ).rejects.toMatchObject({ cause: { code: "55P03" } });
    });
    expect(performance.now() - startedAt).toBeGreaterThanOrEqual(350);

    await messageRepository.updateMessageRequestWinnerCost(requestId, "0.10");
    await messageRepository.addMessageRequestHedgeLoserCost(requestId, "0.03", {
      providerId: 32,
      providerName: "second-loser",
      attemptNumber: 2,
      costUsd: "0.03",
    });
    await messageRepository.updateMessageRequestWinnerCost(requestId, "0.10");
    await expectRequest(requestId, { costUsd: "0.150000000000000" });
  });
});
