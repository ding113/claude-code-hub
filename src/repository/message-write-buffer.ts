import "server-only";

import type { SQL } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { db } from "@/drizzle/db";
import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
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
  providerId?: number;
  context1mApplied?: boolean;
  swapCacheTtlApplied?: boolean;
  specialSettings?: CreateMessageRequestData["special_settings"];
};

export type MessageRequestUpdateEnqueueResult =
  | { kind: "enqueued" }
  | { kind: "rejected_invalid" }
  | { kind: "buffer_unavailable" }
  | { kind: "dropped_overflow"; patch: MessageRequestUpdatePatch };

type MessageRequestUpdateRecord = {
  id: number;
  patch: MessageRequestUpdatePatch;
};

type WriterConfig = {
  flushIntervalMs: number;
  batchSize: number;
  maxPending: number;
};

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
  providerId: "provider_id",
  context1mApplied: "context_1m_applied",
  swapCacheTtlApplied: "swap_cache_ttl_applied",
  specialSettings: "special_settings",
};

const INT32_MAX = 2147483647;
const NUMERIC_LIKE_RE = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/;

const REJECTED_INVALID_LOG_THROTTLE_MS = 60_000;
let _lastRejectedInvalidLogAt = 0;

// 终态 patch（duration/status）尽快刷库，但仍保留极短延迟以便 micro-batch，避免高并发下频繁 flush。
const TERMINAL_FLUSH_DELAY_MS = 10;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!NUMERIC_LIKE_RE.test(trimmed)) {
    return null;
  }

  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function summarizePatchTypes(patch: MessageRequestUpdatePatch): Record<string, string> {
  const summary: Record<string, string> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      summary[key] = "null";
    } else if (Array.isArray(value)) {
      summary[key] = "array";
    } else {
      summary[key] = typeof value;
    }
  }
  return summary;
}

function sanitizeInt32(
  value: unknown,
  options?: { min?: number; max?: number }
): number | undefined {
  const numeric = toFiniteNumber(value);
  if (numeric === null) {
    return undefined;
  }

  const truncated = Math.trunc(numeric);
  const min = options?.min ?? -INT32_MAX - 1;
  const max = options?.max ?? INT32_MAX;

  if (truncated < min) {
    return min;
  }
  if (truncated > max) {
    return max;
  }
  return truncated;
}

function sanitizeNullableInt32(
  value: unknown,
  options?: { min?: number; max?: number }
): number | null | undefined {
  if (value === null) {
    return null;
  }
  return sanitizeInt32(value, options);
}

function sanitizeNumericString(value: unknown): string | undefined {
  let raw: string | undefined;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      return undefined;
    }
    raw = String(value);
  } else if (typeof value === "string") {
    raw = value;
  } else {
    return undefined;
  }

  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return undefined;
  }

  // 允许常见十进制与科学计数法，拒绝 NaN/Infinity/空白/十六进制等异常输入
  if (!NUMERIC_LIKE_RE.test(trimmed)) {
    return undefined;
  }

  // 数值过大（例如 1e309）会变成 Infinity；这种输入对 numeric 列也大概率不可用，直接拒绝。
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) {
    return undefined;
  }

  // 目前仅用于 costUsd（schema: numeric(21, 15)，整数部分最多 6 位：< 1,000,000）
  if (parsed < 0 || parsed >= 1_000_000) {
    return undefined;
  }

  return trimmed;
}

function sanitizePatch(patch: MessageRequestUpdatePatch): MessageRequestUpdatePatch {
  const sanitized: MessageRequestUpdatePatch = {};

  const durationMs = sanitizeInt32(patch.durationMs, { min: 0, max: INT32_MAX });
  if (durationMs !== undefined) {
    sanitized.durationMs = durationMs;
  }

  const statusCode = sanitizeInt32(patch.statusCode, { min: 0, max: 999 });
  if (statusCode !== undefined) {
    sanitized.statusCode = statusCode;
  }

  const inputTokens = sanitizeInt32(patch.inputTokens, { min: 0, max: INT32_MAX });
  if (inputTokens !== undefined) {
    sanitized.inputTokens = inputTokens;
  }

  const outputTokens = sanitizeInt32(patch.outputTokens, { min: 0, max: INT32_MAX });
  if (outputTokens !== undefined) {
    sanitized.outputTokens = outputTokens;
  }

  const ttfbMs = sanitizeNullableInt32(patch.ttfbMs, { min: 0, max: INT32_MAX });
  if (ttfbMs !== undefined) {
    sanitized.ttfbMs = ttfbMs;
  }

  const cacheCreationInputTokens = sanitizeInt32(patch.cacheCreationInputTokens, {
    min: 0,
    max: INT32_MAX,
  });
  if (cacheCreationInputTokens !== undefined) {
    sanitized.cacheCreationInputTokens = cacheCreationInputTokens;
  }

  const cacheReadInputTokens = sanitizeInt32(patch.cacheReadInputTokens, {
    min: 0,
    max: INT32_MAX,
  });
  if (cacheReadInputTokens !== undefined) {
    sanitized.cacheReadInputTokens = cacheReadInputTokens;
  }

  const cacheCreation5mInputTokens = sanitizeInt32(patch.cacheCreation5mInputTokens, {
    min: 0,
    max: INT32_MAX,
  });
  if (cacheCreation5mInputTokens !== undefined) {
    sanitized.cacheCreation5mInputTokens = cacheCreation5mInputTokens;
  }

  const cacheCreation1hInputTokens = sanitizeInt32(patch.cacheCreation1hInputTokens, {
    min: 0,
    max: INT32_MAX,
  });
  if (cacheCreation1hInputTokens !== undefined) {
    sanitized.cacheCreation1hInputTokens = cacheCreation1hInputTokens;
  }

  if (patch.cacheTtlApplied === null) {
    sanitized.cacheTtlApplied = null;
  } else if (typeof patch.cacheTtlApplied === "string") {
    sanitized.cacheTtlApplied = patch.cacheTtlApplied;
  } else if (patch.cacheTtlApplied !== undefined) {
    logger.warn("[MessageRequestWriteBuffer] Invalid cacheTtlApplied type, skipping", {
      cacheTtlAppliedType: typeof patch.cacheTtlApplied,
    });
  }

  const costUsd = sanitizeNumericString(patch.costUsd);
  if (costUsd !== undefined) {
    sanitized.costUsd = costUsd;
  }

  if (patch.providerChain !== undefined) {
    if (!Array.isArray(patch.providerChain)) {
      logger.warn("[MessageRequestWriteBuffer] Invalid providerChain type, skipping", {
        providerChainType: typeof patch.providerChain,
      });
    } else {
      try {
        const json = JSON.stringify(patch.providerChain);
        sanitized.providerChain = JSON.parse(json) as CreateMessageRequestData["provider_chain"];
      } catch (error) {
        logger.warn("[MessageRequestWriteBuffer] Invalid providerChain, skipping", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (typeof patch.errorMessage === "string") {
    sanitized.errorMessage = patch.errorMessage;
  }
  if (typeof patch.errorStack === "string") {
    sanitized.errorStack = patch.errorStack;
  }
  if (typeof patch.errorCause === "string") {
    sanitized.errorCause = patch.errorCause;
  }
  if (typeof patch.model === "string") {
    sanitized.model = patch.model;
  }

  const providerId = sanitizeInt32(patch.providerId, { min: 0, max: INT32_MAX });
  if (providerId !== undefined) {
    sanitized.providerId = providerId;
  }

  if (typeof patch.context1mApplied === "boolean") {
    sanitized.context1mApplied = patch.context1mApplied;
  } else if (patch.context1mApplied !== undefined) {
    logger.warn("[MessageRequestWriteBuffer] Invalid context1mApplied type, skipping", {
      context1mAppliedType: typeof patch.context1mApplied,
    });
  }
  if (typeof patch.swapCacheTtlApplied === "boolean") {
    sanitized.swapCacheTtlApplied = patch.swapCacheTtlApplied;
  } else if (patch.swapCacheTtlApplied !== undefined) {
    logger.warn("[MessageRequestWriteBuffer] Invalid swapCacheTtlApplied type, skipping", {
      swapCacheTtlAppliedType: typeof patch.swapCacheTtlApplied,
    });
  }

  if (patch.specialSettings === null) {
    sanitized.specialSettings = null;
  } else if (patch.specialSettings !== undefined) {
    if (!Array.isArray(patch.specialSettings)) {
      logger.warn("[MessageRequestWriteBuffer] Invalid specialSettings type, skipping", {
        specialSettingsType: typeof patch.specialSettings,
      });
    } else {
      try {
        const json = JSON.stringify(patch.specialSettings);
        sanitized.specialSettings = JSON.parse(
          json
        ) as CreateMessageRequestData["special_settings"];
      } catch (error) {
        logger.warn("[MessageRequestWriteBuffer] Invalid specialSettings, skipping", {
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  return sanitized;
}

export function sanitizeMessageRequestUpdatePatch(
  patch: MessageRequestUpdatePatch
): MessageRequestUpdatePatch {
  return sanitizePatch(patch);
}

function isTerminalPatch(patch: MessageRequestUpdatePatch): boolean {
  return patch.durationMs !== undefined || patch.statusCode !== undefined;
}

function getErrorCode(error: unknown): string | null {
  const visited = new Set<unknown>();
  let current: unknown = error;

  for (let depth = 0; depth < 5; depth++) {
    if (!current || typeof current !== "object") {
      return null;
    }
    if (visited.has(current)) {
      return null;
    }
    visited.add(current);

    const code = (current as { code?: unknown }).code;
    if (typeof code === "string") {
      return code;
    }

    current = (current as { cause?: unknown }).cause;
  }

  return null;
}

function isDataRelatedDbError(error: unknown): boolean {
  const code = getErrorCode(error);
  if (!code) {
    return false;
  }

  // 仅对“数据/约束类”错误做隔离处理，避免对连接/暂态问题造成额外压力
  return code.startsWith("22") || code.startsWith("23");
}

function getSafePatch(patch: MessageRequestUpdatePatch): MessageRequestUpdatePatch {
  // 刻意排除 costUsd/providerChain/specialSettings：这些字段更容易引发类型/JSON 异常
  const {
    costUsd: _costUsd,
    providerChain: _providerChain,
    specialSettings: _specialSettings,
    ...rest
  } = patch;
  return rest;
}

function getMinimalPatch(patch: MessageRequestUpdatePatch): MessageRequestUpdatePatch {
  const minimal: MessageRequestUpdatePatch = {};
  if (patch.durationMs !== undefined) {
    minimal.durationMs = patch.durationMs;
  }
  if (patch.statusCode !== undefined) {
    minimal.statusCode = patch.statusCode;
  }
  if (patch.errorMessage !== undefined) {
    minimal.errorMessage = patch.errorMessage;
  }
  return minimal;
}

function loadWriterConfig(): WriterConfig {
  const env = getEnvConfig();
  return {
    flushIntervalMs: env.MESSAGE_REQUEST_ASYNC_FLUSH_INTERVAL_MS ?? 250,
    batchSize: env.MESSAGE_REQUEST_ASYNC_BATCH_SIZE ?? 200,
    maxPending: env.MESSAGE_REQUEST_ASYNC_MAX_PENDING ?? 5000,
  };
}

function takeBatch(map: Map<number, MessageRequestUpdatePatch>, batchSize: number) {
  const items: MessageRequestUpdateRecord[] = [];
  for (const [id, patch] of map) {
    items.push({ id, patch });
    map.delete(id);
    if (items.length >= batchSize) {
      break;
    }
  }
  return items;
}

function buildBatchUpdateSql(updates: MessageRequestUpdateRecord[]): SQL | null {
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

      if (key === "providerChain" || key === "specialSettings") {
        if (value === null) {
          cases.push(sql`WHEN ${update.id} THEN NULL`);
          continue;
        }
        try {
          const json = JSON.stringify(value);
          cases.push(sql`WHEN ${update.id} THEN ${json}::jsonb`);
        } catch (error) {
          logger.warn(
            "[MessageRequestWriteBuffer] Failed to stringify JSON patch field, skipping",
            {
              requestId: update.id,
              field: key,
              error: error instanceof Error ? error.message : String(error),
            }
          );
        }
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

  return sql`
    UPDATE message_request
    SET ${sql.join(setClauses, sql`, `)}
    WHERE id IN (${idList}) AND deleted_at IS NULL
  `;
}

class MessageRequestWriteBuffer {
  private readonly config: WriterConfig;
  private readonly pending = new Map<number, MessageRequestUpdatePatch>();
  // 不含终态字段（duration/status）的待写入条目集合；始终与 pending 内合并后的 patch 状态保持一致。
  private readonly nonTerminalIds = new Set<number>();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushTimerDueAt: number | null = null;
  private flushAgainAfterCurrent = false;
  private flushInFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(config: WriterConfig) {
    this.config = config;
  }

  enqueue(id: number, patch: MessageRequestUpdatePatch): MessageRequestUpdateEnqueueResult {
    const sanitized = sanitizePatch(patch);
    if (Object.keys(sanitized).length === 0) {
      const now = Date.now();
      if (now - _lastRejectedInvalidLogAt > REJECTED_INVALID_LOG_THROTTLE_MS) {
        _lastRejectedInvalidLogAt = now;
        logger.warn("[MessageRequestWriteBuffer] Patch rejected: empty after sanitize", {
          requestId: id,
          originalKeys: Object.keys(patch),
          originalTypes: summarizePatchTypes(patch),
        });
      }
      return { kind: "rejected_invalid" };
    }

    const existing = this.pending.get(id) ?? {};
    const merged = { ...existing, ...sanitized };
    this.pending.set(id, merged);
    if (isTerminalPatch(merged)) {
      this.nonTerminalIds.delete(id);
    } else {
      this.nonTerminalIds.add(id);
    }
    let result: MessageRequestUpdateEnqueueResult = { kind: "enqueued" };

    // 队列上限保护：DB 异常时避免无限增长导致 OOM
    if (this.pending.size > this.config.maxPending) {
      // 优先丢弃非“终态”更新（不含 durationMs/statusCode 的条目），尽量保留请求完成信息
      let droppedId: number | undefined;
      let droppedPatch: MessageRequestUpdatePatch | undefined;

      for (const candidateId of this.nonTerminalIds) {
        const candidatePatch = this.pending.get(candidateId);
        if (!candidatePatch) {
          this.nonTerminalIds.delete(candidateId);
          continue;
        }
        droppedId = candidateId;
        droppedPatch = candidatePatch;
        break;
      }

      // 当 pending 全部为终态 patch 时，不应随机淘汰已有终态（会导致其他请求永久缺失完成信息）。
      // 此时优先丢弃“当前” patch，并让调用方按返回值决定是否走同步写入兜底。
      if (droppedId === undefined) {
        droppedId = id;
        droppedPatch = this.pending.get(id);
      }

      if (droppedId !== undefined) {
        this.pending.delete(droppedId);
        this.nonTerminalIds.delete(droppedId);
        if (droppedId === id) {
          result = { kind: "dropped_overflow", patch: droppedPatch ?? sanitized };
        }
        logger.warn("[MessageRequestWriteBuffer] Pending queue overflow, dropping update", {
          maxPending: this.config.maxPending,
          droppedId,
          droppedIsTerminal: droppedPatch ? isTerminalPatch(droppedPatch) : undefined,
          currentPending: this.pending.size,
        });
      }
    }

    // flush 过程中有新任务：标记需要再跑一轮（避免刚好 flush 完成时遗漏）
    if (this.flushInFlight) {
      this.flushAgainAfterCurrent = true;
      return result;
    }

    // 停止阶段不再调度 timer，避免阻止进程退出
    if (!this.stopping) {
      // 终态 patch 尽快落库，减少 duration/status 为空的“悬挂窗口”
      this.ensureFlushTimer(isTerminalPatch(merged) ? TERMINAL_FLUSH_DELAY_MS : undefined);
    }

    // 达到批量阈值时尽快 flush，降低 durationMs 为空的“悬挂时间”
    if (this.pending.size >= this.config.batchSize) {
      void this.flush();
    }

    return result;
  }

  private ensureFlushTimer(delayMs?: number): void {
    if (this.stopping) {
      return;
    }

    const delay = Math.max(0, delayMs ?? this.config.flushIntervalMs);
    const dueAt = Date.now() + delay;

    if (this.flushTimer) {
      if (this.flushTimerDueAt !== null && this.flushTimerDueAt <= dueAt) {
        return;
      }
      this.clearFlushTimer();
    }

    this.flushTimerDueAt = dueAt;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flushTimerDueAt = null;
      void this.flush();
    }, delay);
  }

  private clearFlushTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
      this.flushTimerDueAt = null;
    }
  }

  private requeueBatchForRetry(batch: MessageRequestUpdateRecord[]): void {
    // 合并策略：保留“更新更晚”的字段（existing 优先），避免覆盖新数据
    for (const item of batch) {
      const existing = this.pending.get(item.id) ?? {};
      const merged = { ...item.patch, ...existing };
      this.pending.set(item.id, merged);
      if (isTerminalPatch(merged)) {
        this.nonTerminalIds.delete(item.id);
      } else {
        this.nonTerminalIds.add(item.id);
      }
    }
  }

  private handleTransientPerItemError(
    error: unknown,
    batch: MessageRequestUpdateRecord[],
    startIndex: number,
    logMessage: string
  ): true {
    // 连接/暂态问题：把当前及剩余条目回队列，留待下次 flush
    this.requeueBatchForRetry(batch.slice(startIndex));
    logger.error(logMessage, {
      error: error instanceof Error ? error.message : String(error),
      errorCode: getErrorCode(error),
      pending: this.pending.size,
    });
    return true;
  }

  private async flushBatchPerItem(batch: MessageRequestUpdateRecord[]): Promise<boolean> {
    for (let index = 0; index < batch.length; index++) {
      const item = batch[index];
      if (!item) {
        continue;
      }

      const patchStrategies = [
        { name: "full" as const, patch: item.patch },
        { name: "safe" as const, patch: getSafePatch(item.patch) },
        { name: "minimal" as const, patch: getMinimalPatch(item.patch) },
      ];

      let lastFailure: {
        kind: "build" | "execute";
        strategy: "full" | "safe" | "minimal";
        error: unknown;
      } | null = null;

      for (const { name, patch } of patchStrategies) {
        let singleQuery: SQL | null = null;
        try {
          singleQuery = buildBatchUpdateSql([{ id: item.id, patch }]);
        } catch (error) {
          lastFailure = { kind: "build", strategy: name, error };
          continue;
        }

        if (!singleQuery) {
          lastFailure = null;
          break;
        }

        try {
          await db.execute(singleQuery);
          lastFailure = null;
          break;
        } catch (error) {
          lastFailure = { kind: "execute", strategy: name, error };
          if (!isDataRelatedDbError(error)) {
            return this.handleTransientPerItemError(
              error,
              batch,
              index,
              "[MessageRequestWriteBuffer] Per-item flush hit transient error, will retry"
            );
          }
        }
      }

      if (lastFailure) {
        logger.error("[MessageRequestWriteBuffer] Dropping invalid update to unblock queue", {
          requestId: item.id,
          keys: Object.keys(item.patch),
          failureKind: lastFailure.kind,
          failureStrategy: lastFailure.strategy,
          error:
            lastFailure.error instanceof Error
              ? lastFailure.error.message
              : String(lastFailure.error),
          errorCode: getErrorCode(lastFailure.error),
        });
      }
    }

    return false;
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
        let shouldYieldToTimer = false;

        while (this.pending.size > 0) {
          const batch = takeBatch(this.pending, this.config.batchSize);
          for (const item of batch) {
            this.nonTerminalIds.delete(item.id);
          }
          let query: SQL | null = null;

          try {
            query = buildBatchUpdateSql(batch);
          } catch (error) {
            logger.error(
              "[MessageRequestWriteBuffer] Build batch SQL failed, falling back to per-item writes",
              {
                error: error instanceof Error ? error.message : String(error),
                errorCode: getErrorCode(error),
                pending: this.pending.size,
                batchSize: batch.length,
              }
            );

            // 通过 per-item 写入确保队列可排空，避免 build 失败导致无限重试。
            const shouldRetryLater = await this.flushBatchPerItem(batch);
            if (shouldRetryLater) {
              // 暂态错误：避免 flushAgainAfterCurrent 在高并发下形成忙等/重试风暴，交由 timer 退避重试。
              shouldYieldToTimer = true;
              break;
            }
            continue;
          }

          if (!query) {
            continue;
          }

          try {
            await db.execute(query);
          } catch (error) {
            if (isDataRelatedDbError(error)) {
              logger.error(
                "[MessageRequestWriteBuffer] Flush failed with data error, falling back to per-item writes",
                {
                  error: error instanceof Error ? error.message : String(error),
                  errorCode: getErrorCode(error),
                  pending: this.pending.size,
                  batchSize: batch.length,
                }
              );

              const shouldRetryLater = await this.flushBatchPerItem(batch);

              if (shouldRetryLater) {
                // 暂态错误：避免 flushAgainAfterCurrent 在高并发下形成忙等/重试风暴，交由 timer 退避重试。
                shouldYieldToTimer = true;
                break;
              }

              continue;
            }

            // 失败重试：将 batch 放回队列
            this.requeueBatchForRetry(batch);

            logger.error("[MessageRequestWriteBuffer] Flush failed, will retry later", {
              error: error instanceof Error ? error.message : String(error),
              errorCode: getErrorCode(error),
              pending: this.pending.size,
              batchSize: batch.length,
            });

            // DB 异常时不在当前循环内死磕，留待下一次 timer/手动 flush
            // 同时避免 flushAgainAfterCurrent 在高并发下形成忙等/重试风暴。
            shouldYieldToTimer = true;
            break;
          }
        }
        if (shouldYieldToTimer) {
          break;
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
  }
}

let _buffer: MessageRequestWriteBuffer | null = null;
let _bufferState: "running" | "stopping" | "stopped" = "running";

function getBuffer(): MessageRequestWriteBuffer | null {
  if (_bufferState !== "running") {
    return null;
  }
  if (!_buffer) {
    _buffer = new MessageRequestWriteBuffer(loadWriterConfig());
  }
  return _buffer;
}

export function enqueueMessageRequestUpdate(
  id: number,
  patch: MessageRequestUpdatePatch
): MessageRequestUpdateEnqueueResult {
  // 只在 async 模式下启用队列，避免额外内存/定时器开销
  if (getEnvConfig().MESSAGE_REQUEST_WRITE_MODE !== "async") {
    return { kind: "buffer_unavailable" };
  }
  const buffer = getBuffer();
  if (!buffer) {
    return { kind: "buffer_unavailable" };
  }
  return buffer.enqueue(id, patch);
}

export async function flushMessageRequestWriteBuffer(): Promise<void> {
  if (!_buffer) {
    return;
  }
  await _buffer.flush();
}

export async function stopMessageRequestWriteBuffer(): Promise<void> {
  if (_bufferState === "stopped") {
    return;
  }
  _bufferState = "stopping";

  if (!_buffer) {
    _bufferState = "stopped";
    return;
  }

  await _buffer.stop();
  _buffer = null;
  _bufferState = "stopped";
}
