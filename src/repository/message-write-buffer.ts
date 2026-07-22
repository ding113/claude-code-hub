import "server-only";

import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { findSafeDatabaseError } from "@/drizzle/admitted-client";
import { getMessageWriterDb } from "@/drizzle/db";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import type { StoredCostBreakdown } from "@/types/cost-breakdown";
import type { CreateMessageRequestData } from "@/types/message";

export type MessageRequestUpdatePatch = {
  durationMs?: number;
  costUsd?: string;
  statusCode?: number;
  inputTokens?: number;
  outputTokens?: number;
  ttfbMs?: number | null;
  cacheCreationInputTokens?: number;
  cacheReadInputTokens?: number;
  cacheCreation5mInputTokens?: number;
  cacheCreation1hInputTokens?: number;
  cacheTtlApplied?: string | null;
  providerChain?: CreateMessageRequestData["provider_chain"];
  errorMessage?: string;
  errorStack?: string;
  errorCause?: string;
  model?: string;
  /** 上游响应中实际返回的模型名(audit);null 显式清空,undefined 不动 */
  actualResponseModel?: string | null;
  providerId?: number;
  context1mApplied?: boolean;
  swapCacheTtlApplied?: boolean;
  specialSettings?: CreateMessageRequestData["special_settings"];
  /**
   * undefined = do not update the column.
   * null = clear the column explicitly.
   */
  costBreakdown?: StoredCostBreakdown | null;
  // F3b 缓存效果计费模拟（可空列）
  cacheCompatibilityKey?: string | null;
  cacheScoreEligible?: boolean | null;
  cacheScoreExcludedReason?: string | null;
  theoreticalCacheTokens?: number | null;
  cacheTtlBucket?: string | null;
};

export type MessageRequestUpdateRecord = {
  id: number;
  patch: MessageRequestUpdatePatch;
};

export type DurableMessageRequestUpdateOptions = {
  timeoutMs?: number;
  onCommitted?: (patch: Readonly<MessageRequestUpdatePatch>) => void | Promise<void>;
};

type DurableAcknowledgement = {
  id: number;
  promise: Promise<void>;
  resolve: () => void;
  reject: (error: Error) => void;
  state: "pending" | "in-flight";
  settled: boolean;
  timeoutId: NodeJS.Timeout | null;
  commitNotified: boolean;
  onCommittedCallbacks: Set<NonNullable<DurableMessageRequestUpdateOptions["onCommitted"]>>;
};

type PendingMessageRequestUpdate = {
  patch: MessageRequestUpdatePatch;
  durableAcknowledgement?: DurableAcknowledgement;
};

type MessageRequestUpdateBatchRecord = MessageRequestUpdateRecord & {
  durableAcknowledgement?: DurableAcknowledgement;
};

type WriterConfig = {
  flushIntervalMs: number;
  batchSize: number;
  maxPending: number;
};

const DEFAULT_DURABLE_ACK_TIMEOUT_MS = 120_000;
const OVERFLOW_LOG_AGGREGATION_MS = 1_000;

type EvictablePendingEntry = {
  id: number;
  priority: number;
  order: number;
};

class EvictablePendingIndex {
  private readonly heap: EvictablePendingEntry[] = [];
  private readonly positions = new Map<number, number>();
  private nextOrder = 0;

  upsert(id: number, priority: number): void {
    const position = this.positions.get(id);
    if (position === undefined) {
      const entry = { id, priority, order: this.nextOrder++ };
      this.heap.push(entry);
      this.positions.set(id, this.heap.length - 1);
      this.bubbleUp(this.heap.length - 1);
      return;
    }

    const entry = this.heap[position];
    if (!entry || entry.priority === priority) {
      return;
    }

    const previousPriority = entry.priority;
    entry.priority = priority;
    if (priority < previousPriority) {
      this.bubbleUp(position);
    } else {
      this.bubbleDown(position);
    }
  }

  remove(id: number): EvictablePendingEntry | undefined {
    const position = this.positions.get(id);
    if (position === undefined) {
      return undefined;
    }
    return this.removeAt(position);
  }

  popLowestPriority(): EvictablePendingEntry | undefined {
    if (this.heap.length === 0) {
      return undefined;
    }
    return this.removeAt(0);
  }

  clear(): void {
    this.heap.length = 0;
    this.positions.clear();
  }

  private removeAt(position: number): EvictablePendingEntry | undefined {
    const removed = this.heap[position];
    if (!removed) {
      return undefined;
    }

    const last = this.heap.pop();
    this.positions.delete(removed.id);
    if (last && position < this.heap.length) {
      this.heap[position] = last;
      this.positions.set(last.id, position);
      const parentPosition = Math.floor((position - 1) / 2);
      if (position > 0 && this.isLowerPriority(last, this.heap[parentPosition])) {
        this.bubbleUp(position);
      } else {
        this.bubbleDown(position);
      }
    }
    return removed;
  }

  private bubbleUp(startPosition: number): void {
    let position = startPosition;
    while (position > 0) {
      const parentPosition = Math.floor((position - 1) / 2);
      const entry = this.heap[position];
      const parent = this.heap[parentPosition];
      if (!entry || !parent || !this.isLowerPriority(entry, parent)) {
        break;
      }
      this.swap(position, parentPosition);
      position = parentPosition;
    }
  }

  private bubbleDown(startPosition: number): void {
    let position = startPosition;
    while (true) {
      const leftPosition = position * 2 + 1;
      const rightPosition = leftPosition + 1;
      let lowestPosition = position;

      if (
        this.heap[leftPosition] &&
        this.heap[lowestPosition] &&
        this.isLowerPriority(this.heap[leftPosition], this.heap[lowestPosition])
      ) {
        lowestPosition = leftPosition;
      }
      if (
        this.heap[rightPosition] &&
        this.heap[lowestPosition] &&
        this.isLowerPriority(this.heap[rightPosition], this.heap[lowestPosition])
      ) {
        lowestPosition = rightPosition;
      }
      if (lowestPosition === position) {
        return;
      }
      this.swap(position, lowestPosition);
      position = lowestPosition;
    }
  }

  private swap(firstPosition: number, secondPosition: number): void {
    const first = this.heap[firstPosition];
    const second = this.heap[secondPosition];
    if (!first || !second) {
      return;
    }
    this.heap[firstPosition] = second;
    this.heap[secondPosition] = first;
    this.positions.set(first.id, secondPosition);
    this.positions.set(second.id, firstPosition);
  }

  private isLowerPriority(first: EvictablePendingEntry, second: EvictablePendingEntry): boolean {
    return (
      first.priority < second.priority ||
      (first.priority === second.priority && first.order < second.order)
    );
  }
}

const COLUMN_MAP: Record<keyof MessageRequestUpdatePatch, string> = {
  durationMs: "duration_ms",
  costUsd: "cost_usd",
  statusCode: "status_code",
  inputTokens: "input_tokens",
  outputTokens: "output_tokens",
  ttfbMs: "ttfb_ms",
  cacheCreationInputTokens: "cache_creation_input_tokens",
  cacheReadInputTokens: "cache_read_input_tokens",
  cacheCreation5mInputTokens: "cache_creation_5m_input_tokens",
  cacheCreation1hInputTokens: "cache_creation_1h_input_tokens",
  cacheTtlApplied: "cache_ttl_applied",
  providerChain: "provider_chain",
  errorMessage: "error_message",
  errorStack: "error_stack",
  errorCause: "error_cause",
  model: "model",
  actualResponseModel: "actual_response_model",
  providerId: "provider_id",
  context1mApplied: "context_1m_applied",
  swapCacheTtlApplied: "swap_cache_ttl_applied",
  specialSettings: "special_settings",
  costBreakdown: "cost_breakdown",
  cacheCompatibilityKey: "cache_compatibility_key",
  cacheScoreEligible: "cache_score_eligible",
  cacheScoreExcludedReason: "cache_score_excluded_reason",
  theoreticalCacheTokens: "theoretical_cache_tokens",
  cacheTtlBucket: "cache_ttl_bucket",
};

function loadWriterConfig(): WriterConfig {
  const env = getEnvConfig();
  return {
    flushIntervalMs: env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS ?? 250,
    batchSize: env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE ?? 200,
    maxPending: env.MESSAGE_REQUEST_ASYNC_MAX_PENDING ?? 5000,
  };
}

function takeBatch(
  map: Map<number, PendingMessageRequestUpdate>,
  evictableIndex: EvictablePendingIndex,
  batchSize: number
): MessageRequestUpdateBatchRecord[] {
  const items: MessageRequestUpdateBatchRecord[] = [];
  for (const [id, pending] of map) {
    if (pending.durableAcknowledgement && !pending.durableAcknowledgement.settled) {
      pending.durableAcknowledgement.state = "in-flight";
    }
    items.push({
      id,
      patch: pending.patch,
      durableAcknowledgement: pending.durableAcknowledgement,
    });
    evictableIndex.remove(id);
    map.delete(id);
    if (items.length >= batchSize) {
      break;
    }
  }
  return items;
}

export function buildBatchUpdateSql(
  updates: MessageRequestUpdateRecord[],
  options: { returnUpdatedIds?: boolean; durableIds?: readonly number[] } = {}
): SQL | null {
  if (updates.length === 0) {
    return null;
  }

  const ids = updates.map((u) => u.id);

  const setClauses: SQL[] = [];
  for (const [key, columnName] of Object.entries(COLUMN_MAP) as Array<
    [keyof MessageRequestUpdatePatch, string]
  >) {
    const cases: SQL[] = [];
    for (const update of updates) {
      const value = update.patch[key];
      if (value === undefined) {
        continue;
      }

      if (key === "providerChain" || key === "specialSettings" || key === "costBreakdown") {
        if (value === null) {
          cases.push(sql`WHEN ${update.id} THEN NULL`);
          continue;
        }
        const json = JSON.stringify(value);
        cases.push(sql`WHEN ${update.id} THEN ${json}::jsonb`);
        continue;
      }

      if (key === "costUsd") {
        // numeric 类型，显式 cast 避免隐式类型推断异常
        cases.push(sql`WHEN ${update.id} THEN ${value}::numeric`);
        continue;
      }

      cases.push(sql`WHEN ${update.id} THEN ${value}`);
    }

    if (cases.length === 0) {
      continue;
    }

    const col = sql.identifier(columnName);
    setClauses.push(sql`${col} = CASE id ${sql.join(cases, sql` `)} ELSE ${col} END`);
  }

  // 没有任何可更新字段时跳过（避免无意义写入）
  if (setClauses.length === 0) {
    return null;
  }

  // 所有更新统一刷新 updated_at
  setClauses.push(sql`${sql.identifier("updated_at")} = NOW()`);

  const idList = sql.join(
    ids.map((id) => sql`${id}`),
    sql`, `
  );
  const updateIds = new Set(ids);
  const durableIds = Array.from(new Set(options.durableIds ?? [])).filter((id) =>
    updateIds.has(id)
  );
  const durableFence =
    durableIds.length === 0
      ? sql``
      : durableIds.length === ids.length
        ? sql` AND ${sql.identifier("status_code")} IS NULL`
        : sql` AND (id NOT IN (${sql.join(
            durableIds.map((id) => sql`${id}`),
            sql`, `
          )}) OR ${sql.identifier("status_code")} IS NULL)`;

  const query = sql`
    UPDATE message_request
    SET ${sql.join(setClauses, sql`, `)}
    WHERE id IN (${idList}) AND deleted_at IS NULL${durableFence}
  `;
  return options.returnUpdatedIds ? sql`${query} RETURNING id` : query;
}

/**
 * Merge `incoming` into `base`, returning a new patch (replacement semantics:
 * non-undefined incoming fields win). Hedge cost writes do NOT flow through this
 * buffer — the winner uses a direct loser-sum-aware replacement and losers use a
 * direct idempotent additive write — so there is no additive field to accumulate.
 */
export function mergePatch(
  base: MessageRequestUpdatePatch,
  incoming: MessageRequestUpdatePatch
): MessageRequestUpdatePatch {
  const merged: MessageRequestUpdatePatch = { ...base };
  for (const [k, v] of Object.entries(incoming) as Array<
    [keyof MessageRequestUpdatePatch, MessageRequestUpdatePatch[keyof MessageRequestUpdatePatch]]
  >) {
    if (v !== undefined) {
      merged[k] = v as never;
    }
  }
  return merged;
}

function getPatchRetentionPriority(patch: MessageRequestUpdatePatch): number {
  if (patch.statusCode !== undefined) {
    return 3;
  }

  if (patch.durationMs !== undefined) {
    return 2;
  }

  return 1;
}

class MessageRequestWriteBuffer {
  private readonly config: WriterConfig;
  private readonly pending = new Map<number, PendingMessageRequestUpdate>();
  private readonly evictableIndex = new EvictablePendingIndex();
  private readonly durableAcknowledgements = new Map<number, DurableAcknowledgement>();
  private flushTimer: NodeJS.Timeout | null = null;
  private overflowLogTimer: NodeJS.Timeout | null = null;
  private overflowDroppedCount = 0;
  private overflowDroppedWithDurationMs = 0;
  private overflowDroppedWithStatusCode = 0;
  private overflowLowestPriority = Number.POSITIVE_INFINITY;
  private overflowLastDroppedId: number | undefined;
  private flushAgainAfterCurrent = false;
  private flushInFlight: Promise<void> | null = null;
  private readonly commitCallbacksInFlight = new Set<Promise<void>>();
  private stopping = false;

  constructor(config: WriterConfig) {
    this.config = config;
  }

  enqueue(id: number, patch: MessageRequestUpdatePatch): void {
    const existing = this.pending.get(id);
    // existing is older, patch is newer -> for replacement fields newer wins.
    this.setPending(id, mergePatch(existing?.patch ?? {}, patch), existing?.durableAcknowledgement);

    this.enforcePendingLimit();
    this.scheduleFlushIfNeeded();
  }

  enqueueDurably(
    id: number,
    patch: MessageRequestUpdatePatch,
    options: DurableMessageRequestUpdateOptions = {}
  ): Promise<boolean> {
    if (this.stopping) {
      return Promise.reject(new Error("message_request writer is stopping"));
    }

    const activeAcknowledgement = this.durableAcknowledgements.get(id);
    if (activeAcknowledgement && !activeAcknowledgement.settled) {
      // The first durable claimant owns both the terminal patch and its commit
      // callback. Later contenders may observe its SQL acknowledgement, but
      // must not merge a contradictory terminal outcome or publish side effects.
      return activeAcknowledgement.promise.then(() => false);
    }

    if (this.durableAcknowledgements.size >= this.config.maxPending) {
      return Promise.reject(new Error("durable message_request queue is full"));
    }

    const acknowledgement = this.createDurableAcknowledgement(id, options);
    const existing = this.pending.get(id);
    this.setPending(id, mergePatch(existing?.patch ?? {}, patch), acknowledgement);

    if (!this.enforcePendingLimit()) {
      this.deletePending(id);
      this.rejectDurableAcknowledgement(
        acknowledgement,
        new Error("durable message_request queue is full")
      );
      return acknowledgement.promise.then(() => true);
    }

    this.scheduleFlushIfNeeded();
    return acknowledgement.promise.then(() => true);
  }

  private createDurableAcknowledgement(
    id: number,
    options: DurableMessageRequestUpdateOptions
  ): DurableAcknowledgement {
    let resolvePromise!: () => void;
    let rejectPromise!: (error: Error) => void;
    const promise = new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    });
    const acknowledgement: DurableAcknowledgement = {
      id,
      promise,
      resolve: resolvePromise,
      reject: rejectPromise,
      state: "pending",
      settled: false,
      timeoutId: null,
      commitNotified: false,
      onCommittedCallbacks: new Set(options.onCommitted ? [options.onCommitted] : []),
    };

    const timeoutMs = options.timeoutMs ?? DEFAULT_DURABLE_ACK_TIMEOUT_MS;
    const effectiveTimeoutMs =
      Number.isFinite(timeoutMs) && timeoutMs > 0 ? timeoutMs : DEFAULT_DURABLE_ACK_TIMEOUT_MS;
    acknowledgement.timeoutId = setTimeout(() => {
      const pending = this.pending.get(id);
      if (pending?.durableAcknowledgement === acknowledgement) {
        this.deletePending(id);
      }
      this.rejectDurableAcknowledgement(
        acknowledgement,
        new Error("durable message_request acknowledgement timed out")
      );
    }, effectiveTimeoutMs);
    acknowledgement.timeoutId.unref?.();

    this.durableAcknowledgements.set(id, acknowledgement);
    return acknowledgement;
  }

  private notifyDurableCommit(
    acknowledgement: DurableAcknowledgement | undefined,
    patch: Readonly<MessageRequestUpdatePatch>
  ): void {
    if (!acknowledgement || acknowledgement.commitNotified) return;
    acknowledgement.commitNotified = true;

    for (const callback of acknowledgement.onCommittedCallbacks) {
      try {
        const result = callback(patch);
        if (result && typeof result.then === "function") {
          let callbackPromise: Promise<void>;
          callbackPromise = Promise.resolve(result)
            .catch((error: unknown) => {
              logger.error("[MessageRequestWriteBuffer] Durable commit callback failed", {
                error: error instanceof Error ? error.message : String(error),
                messageRequestId: acknowledgement.id,
              });
            })
            .finally(() => {
              this.commitCallbacksInFlight.delete(callbackPromise);
            });
          this.commitCallbacksInFlight.add(callbackPromise);
        }
      } catch (error) {
        logger.error("[MessageRequestWriteBuffer] Durable commit callback failed", {
          error: error instanceof Error ? error.message : String(error),
          messageRequestId: acknowledgement.id,
        });
      }
    }
    acknowledgement.onCommittedCallbacks.clear();
  }

  private resolveDurableAcknowledgement(acknowledgement?: DurableAcknowledgement): void {
    if (!acknowledgement || acknowledgement.settled) return;
    acknowledgement.settled = true;
    if (acknowledgement.timeoutId) {
      clearTimeout(acknowledgement.timeoutId);
      acknowledgement.timeoutId = null;
    }
    if (this.durableAcknowledgements.get(acknowledgement.id) === acknowledgement) {
      this.durableAcknowledgements.delete(acknowledgement.id);
    }
    acknowledgement.resolve();
  }

  private rejectDurableAcknowledgement(
    acknowledgement: DurableAcknowledgement | undefined,
    error: Error
  ): void {
    if (!acknowledgement || acknowledgement.settled) return;
    acknowledgement.settled = true;
    if (acknowledgement.timeoutId) {
      clearTimeout(acknowledgement.timeoutId);
      acknowledgement.timeoutId = null;
    }
    if (this.durableAcknowledgements.get(acknowledgement.id) === acknowledgement) {
      this.durableAcknowledgements.delete(acknowledgement.id);
    }
    acknowledgement.reject(error);
  }

  private rejectAllDurableAcknowledgements(error: Error): void {
    for (const acknowledgement of this.durableAcknowledgements.values()) {
      this.rejectDurableAcknowledgement(acknowledgement, error);
    }
  }

  private setPending(
    id: number,
    patch: MessageRequestUpdatePatch,
    durableAcknowledgement?: DurableAcknowledgement
  ): void {
    const activeDurableAcknowledgement =
      durableAcknowledgement && !durableAcknowledgement.settled
        ? durableAcknowledgement
        : undefined;
    this.pending.set(id, {
      patch,
      durableAcknowledgement: activeDurableAcknowledgement,
    });
    if (activeDurableAcknowledgement) {
      this.evictableIndex.remove(id);
    } else {
      this.evictableIndex.upsert(id, getPatchRetentionPriority(patch));
    }
  }

  private deletePending(id: number): PendingMessageRequestUpdate | undefined {
    const pending = this.pending.get(id);
    if (!pending) {
      return undefined;
    }
    this.pending.delete(id);
    this.evictableIndex.remove(id);
    return pending;
  }

  private enforcePendingLimit(): boolean {
    while (this.pending.size > this.config.maxPending) {
      const droppedEntry = this.evictableIndex.popLowestPriority();
      if (!droppedEntry) {
        return false;
      }
      const dropped = this.pending.get(droppedEntry.id);
      if (!dropped || (dropped.durableAcknowledgement && !dropped.durableAcknowledgement.settled)) {
        continue;
      }

      this.pending.delete(droppedEntry.id);
      this.recordOverflowDrop(droppedEntry, dropped.patch);
    }

    return true;
  }

  private recordOverflowDrop(
    droppedEntry: EvictablePendingEntry,
    droppedPatch: MessageRequestUpdatePatch
  ): void {
    this.overflowDroppedCount++;
    this.overflowLastDroppedId = droppedEntry.id;
    this.overflowLowestPriority = Math.min(this.overflowLowestPriority, droppedEntry.priority);
    if (droppedPatch.durationMs !== undefined) {
      this.overflowDroppedWithDurationMs++;
    }
    if (droppedPatch.statusCode !== undefined) {
      this.overflowDroppedWithStatusCode++;
    }
    if (this.overflowLogTimer) {
      return;
    }
    this.overflowLogTimer = setTimeout(() => {
      this.overflowLogTimer = null;
      this.flushOverflowLog();
    }, OVERFLOW_LOG_AGGREGATION_MS);
    this.overflowLogTimer.unref?.();
  }

  private flushOverflowLog(): void {
    if (this.overflowDroppedCount === 0) {
      return;
    }
    logger.warn("[MessageRequestWriteBuffer] Pending queue overflow, dropping updates", {
      maxPending: this.config.maxPending,
      droppedCount: this.overflowDroppedCount,
      lowestDroppedPriority: this.overflowLowestPriority,
      droppedWithDurationMs: this.overflowDroppedWithDurationMs,
      droppedWithStatusCode: this.overflowDroppedWithStatusCode,
      lastDroppedId: this.overflowLastDroppedId,
      currentPending: this.pending.size,
    });
    this.overflowDroppedCount = 0;
    this.overflowDroppedWithDurationMs = 0;
    this.overflowDroppedWithStatusCode = 0;
    this.overflowLowestPriority = Number.POSITIVE_INFINITY;
    this.overflowLastDroppedId = undefined;
  }

  private clearOverflowLogTimer(): void {
    if (!this.overflowLogTimer) {
      return;
    }
    clearTimeout(this.overflowLogTimer);
    this.overflowLogTimer = null;
  }

  private scheduleFlushIfNeeded(): void {
    // flush 过程中有新任务：标记需要再跑一轮（避免刚好 flush 完成时遗漏）
    if (this.flushInFlight) {
      this.flushAgainAfterCurrent = true;
      return;
    }

    // 停止阶段不再调度 timer，避免阻止进程退出
    if (!this.stopping) {
      this.ensureFlushTimer();
    }

    // 达到批量阈值时尽快 flush，降低 durationMs 为空的“悬挂时间”
    if (this.pending.size >= this.config.batchSize) {
      void this.flush();
    }
  }

  private ensureFlushTimer(): void {
    if (this.stopping || this.flushTimer) {
      return;
    }

    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flush();
    }, this.config.flushIntervalMs);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) {
      this.flushAgainAfterCurrent = true;
      return this.flushInFlight;
    }

    // 进入 flush：先清理 timer，避免重复调度
    this.clearFlushTimer();

    this.flushInFlight = (async () => {
      do {
        this.flushAgainAfterCurrent = false;

        while (this.pending.size > 0) {
          const batch = takeBatch(this.pending, this.evictableIndex, this.config.batchSize);
          const requiresUpdatedIds = batch.some(
            (item) => item.durableAcknowledgement && !item.durableAcknowledgement.settled
          );
          const durableIds = batch.flatMap((item) =>
            item.durableAcknowledgement ? [item.id] : []
          );
          const query = buildBatchUpdateSql(batch, {
            returnUpdatedIds: requiresUpdatedIds,
            durableIds,
          });
          if (!query) {
            for (const item of batch) {
              this.rejectDurableAcknowledgement(
                item.durableAcknowledgement,
                new Error("durable message_request update contains no writable fields")
              );
            }
            continue;
          }

          try {
            const result = await getMessageWriterDb().execute(query);
            const updatedIds = new Set(
              requiresUpdatedIds
                ? Array.from(result, (row) => Number((row as { id?: unknown }).id))
                : []
            );
            for (const item of batch) {
              const acknowledgement = item.durableAcknowledgement;
              if (!acknowledgement) {
                continue;
              }
              if (updatedIds.has(item.id)) {
                this.notifyDurableCommit(acknowledgement, item.patch);
                if (!acknowledgement.settled) {
                  this.resolveDurableAcknowledgement(acknowledgement);
                }
              } else if (!acknowledgement.settled) {
                this.rejectDurableAcknowledgement(
                  acknowledgement,
                  new Error(`durable message_request update did not persist id ${item.id}`)
                );
              }
            }
          } catch (error) {
            // 失败重试：将 batch 放回队列
            // 合并策略：保留“更新更晚”的字段（existing 优先），避免覆盖新数据。
            for (const item of batch) {
              if (item.durableAcknowledgement?.settled) {
                continue;
              }
              const existing = this.pending.get(item.id);
              const durableAcknowledgement =
                item.durableAcknowledgement && !item.durableAcknowledgement.settled
                  ? item.durableAcknowledgement
                  : existing?.durableAcknowledgement;
              if (durableAcknowledgement) {
                durableAcknowledgement.state = "pending";
              }
              this.setPending(
                item.id,
                mergePatch(item.patch, existing?.patch ?? {}),
                durableAcknowledgement
              );
            }
            this.enforcePendingLimit();

            const databaseError = findSafeDatabaseError(error);
            logger.error("[MessageRequestWriteBuffer] Flush failed, will retry later", {
              error:
                databaseError?.message ?? (error instanceof Error ? error.message : String(error)),
              databaseCode: databaseError?.code,
              admissionPool: databaseError?.pool,
              admissionMaxOutstanding: databaseError?.maxOutstanding,
              pending: this.pending.size,
              batchSize: batch.length,
            });

            // DB 异常时不在当前循环内死磕，留待下一次 timer/手动 flush
            break;
          }
        }
      } while (this.flushAgainAfterCurrent);
    })().finally(() => {
      this.flushInFlight = null;
      // 如果还有积压：运行态下继续用 timer 退避重试；停止阶段不再调度 timer
      if (this.pending.size > 0 && !this.stopping) {
        this.ensureFlushTimer();
      }
    });

    await this.flushInFlight;
  }

  async stop(): Promise<void> {
    this.stopping = true;
    this.clearFlushTimer();
    await this.flush();
    // stop 期间尽量补刷一次，避免极小概率竞态导致的 tail 更新残留
    if (this.pending.size > 0) {
      await this.flush();
    }
    if (this.pending.size > 0) {
      const error = new Error("message_request writer shutdown persistence failed");
      this.rejectAllDurableAcknowledgements(error);
      this.clearOverflowLogTimer();
      this.flushOverflowLog();
      this.pending.clear();
      this.evictableIndex.clear();
      throw error;
    }
    if (this.durableAcknowledgements.size > 0) {
      this.rejectAllDurableAcknowledgements(
        new Error("message_request writer stopped before durable commit")
      );
    }
    while (this.commitCallbacksInFlight.size > 0) {
      await Promise.allSettled([...this.commitCallbacksInFlight]);
    }
    this.clearOverflowLogTimer();
    this.flushOverflowLog();
    this.pending.clear();
    this.evictableIndex.clear();
  }
}

let _buffer: MessageRequestWriteBuffer | null = null;
let _bufferState: "running" | "stopping" | "stopped" = "running";
let _stopPromise: Promise<void> | null = null;

function getBuffer(): MessageRequestWriteBuffer | null {
  if (_bufferState !== "running") {
    return null;
  }
  if (!_buffer) {
    _buffer = new MessageRequestWriteBuffer(loadWriterConfig());
  }
  return _buffer;
}

export function enqueueMessageRequestUpdate(id: number, patch: MessageRequestUpdatePatch): void {
  // 只在 async 模式下启用队列，避免额外内存/定时器开销
  if (getEnvConfig().MESSAGE_REQUEST_WRITE_MODE !== "async") {
    return;
  }
  const buffer = getBuffer();
  if (!buffer) {
    return;
  }
  buffer.enqueue(id, patch);
}

export function enqueueMessageRequestUpdateDurably(
  id: number,
  patch: MessageRequestUpdatePatch,
  options?: DurableMessageRequestUpdateOptions
): Promise<boolean> {
  if (getEnvConfig().MESSAGE_REQUEST_WRITE_MODE !== "async") {
    return Promise.reject(
      new Error("durable message_request buffer API requires async write mode")
    );
  }
  const buffer = getBuffer();
  if (!buffer) {
    return Promise.reject(new Error("message_request writer is not running"));
  }
  return buffer.enqueueDurably(id, patch, options);
}

export async function flushMessageRequestWriteBuffer(): Promise<void> {
  if (!_buffer) {
    return;
  }
  await _buffer.flush();
}

export function stopMessageRequestWriteBuffer(): Promise<void> {
  if (_stopPromise) {
    return _stopPromise;
  }
  _bufferState = "stopping";
  const buffer = _buffer;

  let resolveStop!: () => void;
  let rejectStop!: (reason?: unknown) => void;
  const stopPromise = new Promise<void>((resolve, reject) => {
    resolveStop = resolve;
    rejectStop = reject;
  });
  _stopPromise = stopPromise;

  void (async () => {
    if (buffer) {
      await buffer.stop();
      if (_buffer === buffer) {
        _buffer = null;
      }
    }
    _bufferState = "stopped";
  })().then(resolveStop, rejectStop);

  return stopPromise;
}
