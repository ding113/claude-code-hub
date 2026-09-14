import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const envState = vi.hoisted(() => ({
  MESSAGE_REQUEST_WRITE_MODE: "async",
  MESSAGE_REQUEST_INSERT_MODE: "async",
  MESSAGE_REQUEST_INSERT_ID_CHUNK_SIZE: 8,
  MESSAGE_REQUEST_INSERT_MAX_PENDING: 100,
  MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS: 250,
  MESSAGE_REQUEST_ASYNC_BATCH_SIZE: 3,
}));

const dbState = vi.hoisted(() => ({
  nextId: 1000,
  reserveError: null as Error | null,
  insertError: null as Error | null,
  insertGate: null as Promise<void> | null,
  insertedBatches: [] as Array<Array<Record<string, unknown>>>,
  conflictTargets: [] as unknown[],
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => envState,
  isDevelopment: () => false,
}));
vi.mock("@/lib/logger", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));
vi.mock("@/drizzle/db", () => ({
  getMessageWriterDb: () => ({
    execute: vi.fn(async () => {
      if (dbState.reserveError) throw dbState.reserveError;
      return Array.from({ length: envState.MESSAGE_REQUEST_INSERT_ID_CHUNK_SIZE }, () => ({
        id: String(dbState.nextId++),
      }));
    }),
    insert: vi.fn(() => ({
      values: (rows: Array<Record<string, unknown>>) => ({
        onConflictDoNothing: async (config: { target: unknown }) => {
          if (dbState.insertGate) await dbState.insertGate;
          if (dbState.insertError) throw dbState.insertError;
          dbState.insertedBatches.push(rows);
          dbState.conflictTargets.push(config.target);
        },
      }),
    })),
  }),
}));

import {
  awaitMessageRequestInserted,
  enqueueMessageRequestInsert,
  flushMessageRequestInserts,
  getMessageRequestInsertBufferStats,
  hasBufferedMessageRequestInserts,
  hasFailedMessageRequestInserts,
  isMessageRequestInsertBufferEnabled,
  isMessageRequestInsertPending,
  resetMessageRequestInsertBufferForTests,
  stopMessageRequestInsertBuffer,
  takeFailedMessageRequestInsert,
} from "@/repository/message-insert-buffer";

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

async function primeIds(): Promise<void> {
  // First call triggers the id reservation and falls back to a synchronous insert.
  expect(enqueueMessageRequestInsert({ userId: 1, providerId: 1, key: "k" })).toBeNull();
  await flushMicrotasks();
}

describe("message_request insert buffer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMessageRequestInsertBufferForTests();
    Object.assign(envState, {
      MESSAGE_REQUEST_WRITE_MODE: "async",
      MESSAGE_REQUEST_INSERT_MODE: "async",
      MESSAGE_REQUEST_INSERT_MAX_PENDING: 100,
      MESSAGE_REQUEST_ASYNC_BATCH_SIZE: 3,
    });
    Object.assign(dbState, {
      nextId: 1000,
      reserveError: null,
      insertError: null,
      insertGate: null,
      insertedBatches: [],
      conflictTargets: [],
    });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("is disabled unless both write and insert modes are async", () => {
    envState.MESSAGE_REQUEST_INSERT_MODE = "sync";
    expect(isMessageRequestInsertBufferEnabled()).toBe(false);
    expect(enqueueMessageRequestInsert({ userId: 1, providerId: 1, key: "k" })).toBeNull();

    envState.MESSAGE_REQUEST_INSERT_MODE = "async";
    envState.MESSAGE_REQUEST_WRITE_MODE = "sync";
    expect(isMessageRequestInsertBufferEnabled()).toBe(false);
  });

  it("reserves ids in ascending order and returns them without waiting for the database", async () => {
    await primeIds();

    const first = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    const second = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "b" });

    expect(first?.id).toBe(1000);
    expect(second?.id).toBe(1001);
    expect(first?.createdAt).toBeInstanceOf(Date);
    expect(isMessageRequestInsertPending(1000)).toBe(true);
    expect(hasBufferedMessageRequestInserts()).toBe(true);
    expect(dbState.insertedBatches).toHaveLength(0);
  });

  it("flushes on the timer with one multi-row insert and ON CONFLICT (id) DO NOTHING", async () => {
    await primeIds();
    enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "b" });

    await vi.advanceTimersByTimeAsync(250);

    expect(dbState.insertedBatches).toHaveLength(1);
    expect(dbState.insertedBatches[0].map((row) => row.id)).toEqual([1000, 1001]);
    expect(dbState.insertedBatches[0][0]).toMatchObject({ key: "a", createdAt: expect.any(Date) });
    expect(dbState.conflictTargets[0]).toBeDefined();
    expect(isMessageRequestInsertPending(1000)).toBe(false);
  });

  it("flushes immediately when a batch fills up and splits larger queues", async () => {
    await primeIds();
    for (const key of ["a", "b", "c"]) {
      enqueueMessageRequestInsert({ userId: 1, providerId: 2, key });
    }
    await flushMicrotasks();

    expect(dbState.insertedBatches).toHaveLength(1);
    expect(dbState.insertedBatches[0]).toHaveLength(3);
  });

  it("falls back to synchronous inserts when no id is available", async () => {
    envState.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = 1000;
    await primeIds();
    // Later refills fail, so the first chunk of 8 ids is all this process gets.
    dbState.reserveError = new Error("sequence unavailable");
    for (let i = 0; i < 8; i++) {
      expect(
        enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: `k${i}` })
      ).not.toBeNull();
      await flushMicrotasks();
    }

    expect(enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "no-id" })).toBeNull();
    expect(getMessageRequestInsertBufferStats().availableIds).toBe(0);
  });

  it("falls back to synchronous inserts when the queue is full", async () => {
    envState.MESSAGE_REQUEST_ASYNC_BATCH_SIZE = 1000;
    envState.MESSAGE_REQUEST_INSERT_MAX_PENDING = 2;
    await primeIds();

    expect(enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" })).not.toBeNull();
    expect(enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "b" })).not.toBeNull();
    expect(enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "full" })).toBeNull();
    expect(getMessageRequestInsertBufferStats().fallbackCount).toBe(2);
  });

  it("retries failed flushes and marks rows failed after the attempt limit", async () => {
    await primeIds();
    const reserved = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    dbState.insertError = new Error("connection reset");

    for (let attempt = 0; attempt < 5; attempt++) {
      await vi.advanceTimersByTimeAsync(250);
    }

    expect(isMessageRequestInsertPending(reserved!.id)).toBe(false);
    expect(hasFailedMessageRequestInserts()).toBe(true);
    expect(takeFailedMessageRequestInsert(reserved!.id)).toBe(true);
    expect(takeFailedMessageRequestInsert(reserved!.id)).toBe(false);
  });

  it("succeeds on retry after a transient failure", async () => {
    await primeIds();
    const reserved = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    dbState.insertError = new Error("transient");
    await vi.advanceTimersByTimeAsync(250);
    expect(isMessageRequestInsertPending(reserved!.id)).toBe(true);

    dbState.insertError = null;
    await vi.advanceTimersByTimeAsync(250);
    expect(isMessageRequestInsertPending(reserved!.id)).toBe(false);
    expect(hasFailedMessageRequestInserts()).toBe(false);
  });

  it("awaitMessageRequestInserted resolves immediately for unknown ids and after commit otherwise", async () => {
    await expect(awaitMessageRequestInserted(42)).resolves.toBeUndefined();

    await primeIds();
    const reserved = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    let release!: () => void;
    dbState.insertGate = new Promise<void>((resolve) => {
      release = resolve;
    });

    let done = false;
    const waiting = awaitMessageRequestInserted(reserved!.id).then(() => {
      done = true;
    });
    await flushMicrotasks();
    expect(done).toBe(false);

    release();
    await waiting;
    expect(done).toBe(true);
    expect(dbState.insertedBatches).toHaveLength(1);
  });

  it("awaitMessageRequestInserted gives up after the timeout", async () => {
    await primeIds();
    const reserved = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    dbState.insertGate = new Promise<void>(() => undefined);

    const waiting = awaitMessageRequestInserted(reserved!.id, 1_000);
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(waiting).resolves.toBeUndefined();
  });

  it("stop drains queued rows and later enqueues fall back to synchronous inserts", async () => {
    await primeIds();
    enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });

    const stopping = stopMessageRequestInsertBuffer();
    expect(stopping).not.toBeNull();
    await stopping;

    expect(dbState.insertedBatches).toHaveLength(1);
    expect(enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "late" })).toBeNull();
    expect(stopMessageRequestInsertBuffer()).toBeNull();
  });

  it("stop marks rows that still cannot be written as failed", async () => {
    await primeIds();
    const reserved = enqueueMessageRequestInsert({ userId: 1, providerId: 2, key: "a" });
    dbState.insertError = new Error("database down");

    await stopMessageRequestInsertBuffer();

    expect(isMessageRequestInsertPending(reserved!.id)).toBe(false);
    expect(takeFailedMessageRequestInsert(reserved!.id)).toBe(true);
  });

  it("flush is a no-op without queued rows", async () => {
    await expect(flushMessageRequestInserts()).resolves.toBeUndefined();
    expect(dbState.insertedBatches).toHaveLength(0);
  });
});
