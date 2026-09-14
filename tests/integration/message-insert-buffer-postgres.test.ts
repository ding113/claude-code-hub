import { randomUUID } from "node:crypto";
import { eq, inArray, like } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { messageRequest, usageLedger } from "@/drizzle/schema";

const ENV_KEYS = [
  "DSN",
  "DB_POOL_MAX",
  "MESSAGE_REQUEST_WRITE_MODE",
  "MESSAGE_REQUEST_INSERT_MODE",
  "MESSAGE_REQUEST_INSERT_ID_CHUNK_SIZE",
  "MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS",
  "MESSAGE_REQUEST_ASYNC_BATCH_SIZE",
] as const;
const originalEnv = new Map(ENV_KEYS.map((key) => [key, process.env[key]] as const));
const dsn = process.env.DSN ?? process.env.DATABASE_URL;

if (dsn) {
  process.env.DSN = dsn;
  process.env.DB_POOL_MAX = "4";
  process.env.MESSAGE_REQUEST_WRITE_MODE = "async";
  process.env.MESSAGE_REQUEST_INSERT_MODE = "async";
  process.env.MESSAGE_REQUEST_INSERT_ID_CHUNK_SIZE = "16";
  // Long interval so tests observe rows before the timer flushes them.
  process.env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS = "60000";
  process.env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = "500";
}
vi.resetModules();

const run = describe.skipIf(!dsn);
const KEY_PREFIX = `it-message-insert-buffer-${randomUUID()}`;

run.sequential("message_request buffered inserts on PostgreSQL", () => {
  let dbModule: typeof import("@/drizzle/db");
  let messageRepository: typeof import("@/repository/message");
  let insertBuffer: typeof import("@/repository/message-insert-buffer");
  let writeBuffer: typeof import("@/repository/message-write-buffer");

  async function createRequest(tag: string) {
    return messageRepository.createMessageRequest({
      provider_id: 930_000_001,
      user_id: 940_000_001,
      key: `${KEY_PREFIX}-${tag}`,
      model: "integration-model",
      original_model: "integration-model",
      endpoint: "/v1/messages",
    });
  }

  async function rowExists(id: number): Promise<boolean> {
    const rows = await dbModule
      .getDb()
      .select({ id: messageRequest.id })
      .from(messageRequest)
      .where(eq(messageRequest.id, id));
    return rows.length === 1;
  }

  async function reserveIds(): Promise<void> {
    // The first call reserves a chunk of ids in the background and inserts synchronously.
    await createRequest("warmup");
    for (
      let i = 0;
      i < 50 && insertBuffer.getMessageRequestInsertBufferStats().availableIds === 0;
      i++
    ) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(insertBuffer.getMessageRequestInsertBufferStats().availableIds).toBeGreaterThan(0);
  }

  beforeAll(async () => {
    if (!dsn) throw new TypeError("DSN or DATABASE_URL is required");
    expect(new URL(dsn).pathname).toMatch(/test/i);

    const harnessDb = await import("@/drizzle/db");
    await harnessDb.closeDbPools();
    vi.resetModules();
    [dbModule, messageRepository, insertBuffer, writeBuffer] = await Promise.all([
      import("@/drizzle/db"),
      import("@/repository/message"),
      import("@/repository/message-insert-buffer"),
      import("@/repository/message-write-buffer"),
    ]);
    await reserveIds();
  });

  afterAll(async () => {
    try {
      await writeBuffer.stopMessageRequestWriteBuffer();
      const keyPattern = `${KEY_PREFIX}%`;
      await dbModule.getDb().delete(messageRequest).where(like(messageRequest.key, keyPattern));
      await dbModule.getDb().delete(usageLedger).where(like(usageLedger.key, keyPattern));
    } finally {
      await dbModule.closeDbPools();
      for (const [key, value] of originalEnv) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  });

  test("returns an id without a round trip and commits the insert before the terminal update", async () => {
    const request = await createRequest("terminal");
    expect(insertBuffer.isMessageRequestInsertPending(request.id)).toBe(true);
    expect(await rowExists(request.id)).toBe(false);

    const durable = writeBuffer.enqueueMessageRequestUpdateDurably(request.id, {
      statusCode: 200,
      durationMs: 321,
      costUsd: "0.500000000000000",
    });
    await writeBuffer.flushMessageRequestWriteBuffer();
    await expect(durable).resolves.toBe(true);

    const [row] = await dbModule
      .getDb()
      .select({ statusCode: messageRequest.statusCode, durationMs: messageRequest.durationMs })
      .from(messageRequest)
      .where(eq(messageRequest.id, request.id));
    expect(row).toEqual({ statusCode: 200, durationMs: 321 });

    const ledgerRows = await dbModule
      .getDb()
      .select({ costUsd: usageLedger.costUsd })
      .from(usageLedger)
      .where(eq(usageLedger.requestId, request.id));
    expect(ledgerRows).toHaveLength(1);
    expect(Number(ledgerRows[0]?.costUsd)).toBeCloseTo(0.5, 10);
  });

  test("direct writers wait for the buffered insert", async () => {
    const hedged = await createRequest("hedge-loser");
    const fenced = await createRequest("unfinalized-fallback");
    expect(await rowExists(hedged.id)).toBe(false);

    await messageRepository.addMessageRequestHedgeLoserCost(hedged.id, "0.250000000000000", {
      providerId: 1,
      providerName: "loser",
      attemptNumber: 2,
      costUsd: "0.250000000000000",
    } as never);
    const updated = await messageRepository.updateMessageRequestDetails(
      fenced.id,
      { statusCode: 502, errorMessage: "upstream failed" },
      { onlyIfUnfinalized: true }
    );

    expect(updated).toBe(true);
    const rows = await dbModule
      .getDb()
      .select({
        id: messageRequest.id,
        costUsd: messageRequest.costUsd,
        statusCode: messageRequest.statusCode,
      })
      .from(messageRequest)
      .where(inArray(messageRequest.id, [hedged.id, fenced.id]));
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(Number(byId.get(hedged.id)?.costUsd)).toBeCloseTo(0.25, 10);
    expect(byId.get(fenced.id)?.statusCode).toBe(502);
  });

  test("concurrent creates get unique ids and every row lands in one flush", async () => {
    const requests = await Promise.all(
      Array.from({ length: 12 }, (_, index) => createRequest(`burst-${index}`))
    );
    const ids = requests.map((request) => request.id);
    expect(new Set(ids).size).toBe(ids.length);

    await insertBuffer.flushMessageRequestInserts();
    const rows = await dbModule
      .getDb()
      .select({ id: messageRequest.id })
      .from(messageRequest)
      .where(inArray(messageRequest.id, ids));
    expect(rows).toHaveLength(ids.length);
  });
});
