import "server-only";

import { sql } from "drizzle-orm";
import { findSafeDatabaseError } from "@/drizzle/admitted-client";
import { getMessageWriterDb } from "@/drizzle/db";
import { messageRequest } from "@/drizzle/schema";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";

/**
 * Buffered multi-row INSERT for message_request (MESSAGE_REQUEST_INSERT_MODE=async).
 *
 * The synchronous insert used to be the only per-request statement on the proxy hot path that did
 * not go through the async writer. In async mode:
 *
 * - ids are reserved in chunks from the table's own sequence (never ALTER SEQUENCE), so the caller
 *   gets {id, createdAt} without a database round trip
 * - rows are inserted in batches on the writer lane with ON CONFLICT (id) DO NOTHING, which keeps
 *   retries after ambiguous failures idempotent
 * - the update buffer flushes pending inserts before updates and skips ids whose insert has not
 *   committed, so an UPDATE never targets a row that does not exist yet
 * - direct writers (hedge costs, unfinalized fallbacks, routing traces) wait for the insert first
 * - when no id is available, the queue is full, or the buffer is stopping, callers fall back to
 *   the synchronous insert: overflow is back pressure, never data loss
 *
 * Trade-off: rows become visible up to one flush interval later, and rows still buffered when the
 * process crashes are lost together with their updates.
 */

type InsertRow = typeof messageRequest.$inferInsert;
export type MessageRequestInsertValues = Omit<InsertRow, "id" | "createdAt" | "updatedAt">;

type PendingInsert = {
  row: InsertRow;
  attempts: number;
  waiters: Array<() => void>;
};

const MAX_INSERT_ATTEMPTS = 5;
const DEFAULT_AWAIT_INSERT_TIMEOUT_MS = 5_000;
const FAILED_ID_RETENTION_LIMIT = 10_000;

type InsertBufferState = {
  availableIds: number[];
  refillPromise: Promise<void> | null;
  pending: Map<number, PendingInsert>;
  inFlight: Map<number, PendingInsert>;
  failedIds: Set<number>;
  flushPromise: Promise<void> | null;
  flushAgain: boolean;
  flushTimer: NodeJS.Timeout | null;
  stopping: boolean;
  fallbackCount: number;
};

function createState(): InsertBufferState {
  return {
    availableIds: [],
    refillPromise: null,
    pending: new Map(),
    inFlight: new Map(),
    failedIds: new Set(),
    flushPromise: null,
    flushAgain: false,
    flushTimer: null,
    stopping: false,
    fallbackCount: 0,
  };
}

let state = createState();

function loadConfig() {
  const env = getEnvConfig();
  return {
    enabled:
      env.MESSAGE_REQUEST_WRITE_MODE === "async" && env.MESSAGE_REQUEST_INSERT_MODE === "async",
    chunkSize: env.MESSAGE_REQUEST_INSERT_ID_CHUNK_SIZE,
    maxPending: env.MESSAGE_REQUEST_INSERT_MAX_PENDING,
    flushIntervalMs: env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS ?? 250,
    batchSize: env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE ?? 200,
  };
}

export function isMessageRequestInsertBufferEnabled(): boolean {
  return loadConfig().enabled;
}

function refillIdsIfNeeded(chunkSize: number): void {
  if (state.stopping || state.refillPromise) return;
  if (state.availableIds.length >= Math.max(1, Math.floor(chunkSize / 4))) return;

  const current = state;
  current.refillPromise = (async () => {
    try {
      const rows = await getMessageWriterDb().execute(sql`
        SELECT nextval(pg_get_serial_sequence('message_request', 'id'))::bigint AS id
        FROM generate_series(1, ${chunkSize})
      `);
      const ids = Array.from(rows as Iterable<{ id: unknown }>, (row) => Number(row.id)).filter(
        (id) => Number.isSafeInteger(id) && id > 0
      );
      // Pop from the end: keep ascending allocation order within this process.
      current.availableIds.push(...ids.reverse());
    } catch (error) {
      const databaseError = findSafeDatabaseError(error);
      logger.warn("[MessageRequestInsertBuffer] Failed to reserve ids, using synchronous inserts", {
        error: databaseError?.message ?? (error instanceof Error ? error.message : String(error)),
      });
    } finally {
      current.refillPromise = null;
    }
  })();
}

/**
 * Reserve an id and queue the row. Returns null when the caller must insert synchronously.
 */
export function enqueueMessageRequestInsert(
  values: MessageRequestInsertValues
): { id: number; createdAt: Date } | null {
  const config = loadConfig();
  if (!config.enabled || state.stopping) return null;

  refillIdsIfNeeded(config.chunkSize);

  if (state.pending.size + state.inFlight.size >= config.maxPending) {
    state.fallbackCount += 1;
    return null;
  }
  const id = state.availableIds.pop();
  refillIdsIfNeeded(config.chunkSize);
  if (id === undefined) {
    state.fallbackCount += 1;
    return null;
  }

  const createdAt = new Date();
  state.pending.set(id, {
    row: { ...values, id, createdAt, updatedAt: createdAt },
    attempts: 0,
    waiters: [],
  });

  if (state.pending.size >= config.batchSize) {
    void flushMessageRequestInserts();
  } else {
    scheduleFlush(config.flushIntervalMs);
  }
  return { id, createdAt };
}

function scheduleFlush(delayMs: number): void {
  if (state.flushTimer || state.stopping) return;
  const current = state;
  current.flushTimer = setTimeout(() => {
    current.flushTimer = null;
    void flushMessageRequestInserts();
  }, delayMs);
  current.flushTimer.unref?.();
}

/** True when buffered inserts are queued or in flight (cheap synchronous check). */
export function hasBufferedMessageRequestInserts(): boolean {
  return state.pending.size > 0 || state.inFlight.size > 0 || state.flushPromise !== null;
}

/** True when some buffered insert permanently failed and its updates still need dropping. */
export function hasFailedMessageRequestInserts(): boolean {
  return state.failedIds.size > 0;
}

/** True while the row's insert has not committed (queued or in flight). */
export function isMessageRequestInsertPending(id: number): boolean {
  return state.pending.has(id) || state.inFlight.has(id);
}

/**
 * True (once) when the row's insert permanently failed. Queued updates for that id can never apply
 * and should be dropped.
 */
export function takeFailedMessageRequestInsert(id: number): boolean {
  return state.failedIds.delete(id);
}

function settle(entry: PendingInsert): void {
  const waiters = entry.waiters.splice(0);
  for (const resolve of waiters) resolve();
}

function markFailed(id: number): void {
  if (state.failedIds.size >= FAILED_ID_RETENTION_LIMIT) {
    const oldest = state.failedIds.values().next().value;
    if (oldest !== undefined) state.failedIds.delete(oldest);
  }
  state.failedIds.add(id);
}

export async function flushMessageRequestInserts(): Promise<void> {
  if (state.flushPromise) {
    state.flushAgain = true;
    return state.flushPromise;
  }

  const current = state;
  if (current.flushTimer) {
    clearTimeout(current.flushTimer);
    current.flushTimer = null;
  }
  if (current.pending.size === 0) return;

  const { batchSize, flushIntervalMs } = loadConfig();
  current.flushPromise = (async () => {
    do {
      current.flushAgain = false;
      while (current.pending.size > 0) {
        const batch: Array<[number, PendingInsert]> = [];
        for (const [id, entry] of current.pending) {
          batch.push([id, entry]);
          if (batch.length >= batchSize) break;
        }
        for (const [id, entry] of batch) {
          current.pending.delete(id);
          current.inFlight.set(id, entry);
        }

        try {
          await getMessageWriterDb()
            .insert(messageRequest)
            .values(batch.map(([, entry]) => entry.row))
            .onConflictDoNothing({ target: messageRequest.id });
          for (const [id, entry] of batch) {
            current.inFlight.delete(id);
            settle(entry);
          }
        } catch (error) {
          let dropped = 0;
          for (const [id, entry] of batch) {
            current.inFlight.delete(id);
            entry.attempts += 1;
            if (entry.attempts >= MAX_INSERT_ATTEMPTS) {
              dropped += 1;
              markFailed(id);
              settle(entry);
            } else {
              current.pending.set(id, entry);
            }
          }
          const databaseError = findSafeDatabaseError(error);
          logger.error("[MessageRequestInsertBuffer] Insert flush failed", {
            error:
              databaseError?.message ?? (error instanceof Error ? error.message : String(error)),
            databaseCode: databaseError?.code,
            batchSize: batch.length,
            dropped,
            pending: current.pending.size,
          });
          // Back off until the next timer instead of retrying in a tight loop.
          return;
        }
      }
    } while (current.flushAgain && current.pending.size > 0);
  })().finally(() => {
    current.flushPromise = null;
    if (current.pending.size > 0 && !current.stopping) {
      scheduleFlush(flushIntervalMs);
    }
  });

  return current.flushPromise;
}

/**
 * Wait until the row exists (or its insert permanently failed) before a direct UPDATE by id.
 * Resolves immediately for rows that were inserted synchronously or already committed.
 */
export async function awaitMessageRequestInserted(
  id: number,
  timeoutMs: number = DEFAULT_AWAIT_INSERT_TIMEOUT_MS
): Promise<void> {
  const entry = state.pending.get(id) ?? state.inFlight.get(id);
  if (!entry) return;

  await new Promise<void>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      logger.warn("[MessageRequestInsertBuffer] Timed out waiting for buffered insert", { id });
      resolve();
    }, timeoutMs);
    timer.unref?.();
    entry.waiters.push(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve();
    });
    void flushMessageRequestInserts();
  });
}

/**
 * Stop accepting buffered inserts (callers fall back to synchronous inserts) and drain the queue.
 */
export function stopMessageRequestInsertBuffer(): Promise<void> | null {
  const current = state;
  current.stopping = true;
  if (current.flushTimer) {
    clearTimeout(current.flushTimer);
    current.flushTimer = null;
  }
  if (!hasBufferedMessageRequestInserts()) {
    return null;
  }
  return drainForShutdown(current);
}

async function drainForShutdown(current: InsertBufferState): Promise<void> {
  for (let attempt = 0; attempt < 2 && current.pending.size > 0; attempt++) {
    await flushMessageRequestInserts();
  }
  if (current.flushPromise) {
    await current.flushPromise;
  }

  if (current.pending.size > 0) {
    logger.error("[MessageRequestInsertBuffer] Buffered inserts lost during shutdown", {
      lost: current.pending.size,
    });
    for (const [id, entry] of current.pending) {
      markFailed(id);
      settle(entry);
    }
    current.pending.clear();
  }
}

export function getMessageRequestInsertBufferStats() {
  return {
    availableIds: state.availableIds.length,
    pending: state.pending.size,
    inFlight: state.inFlight.size,
    failed: state.failedIds.size,
    fallbackCount: state.fallbackCount,
    stopping: state.stopping,
  };
}

export function resetMessageRequestInsertBufferForTests(): void {
  if (state.flushTimer) clearTimeout(state.flushTimer);
  state = createState();
}
