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
  specialSettings?: CreateMessageRequestData["special_settings"];
};

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
  specialSettings: "special_settings",
};

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

  return sql`
    UPDATE message_request
    SET ${sql.join(setClauses, sql`, `)}
    WHERE id IN (${idList}) AND deleted_at IS NULL
  `;
}

class MessageRequestWriteBuffer {
  private readonly config: WriterConfig;
  private readonly pending = new Map<number, MessageRequestUpdatePatch>();
  private flushTimer: NodeJS.Timeout | null = null;
  private flushAgainAfterCurrent = false;
  private flushInFlight: Promise<void> | null = null;
  private stopping = false;

  constructor(config: WriterConfig) {
    this.config = config;
  }

  enqueue(id: number, patch: MessageRequestUpdatePatch): void {
    const existing = this.pending.get(id) ?? {};
    const merged: MessageRequestUpdatePatch = { ...existing };
    for (const [k, v] of Object.entries(patch) as Array<
      [keyof MessageRequestUpdatePatch, MessageRequestUpdatePatch[keyof MessageRequestUpdatePatch]]
    >) {
      if (v !== undefined) {
        merged[k] = v as never;
      }
    }
    this.pending.set(id, merged);

    // 队列上限保护：DB 异常时避免无限增长导致 OOM
    if (this.pending.size > this.config.maxPending) {
      // 优先丢弃非“终态”更新（没有 durationMs 的条目），尽量保留请求完成信息
      let droppedId: number | undefined;
      let droppedPatch: MessageRequestUpdatePatch | undefined;

      for (const [candidateId, candidatePatch] of this.pending) {
        if (candidatePatch.durationMs === undefined) {
          droppedId = candidateId;
          droppedPatch = candidatePatch;
          break;
        }
      }

      if (droppedId === undefined) {
        const first = this.pending.entries().next().value as
          | [number, MessageRequestUpdatePatch]
          | undefined;
        if (first) {
          droppedId = first[0];
          droppedPatch = first[1];
        }
      }

      if (droppedId !== undefined) {
        this.pending.delete(droppedId);
        logger.warn("[MessageRequestWriteBuffer] Pending queue overflow, dropping update", {
          maxPending: this.config.maxPending,
          droppedId,
          droppedHasDurationMs: droppedPatch?.durationMs !== undefined,
          currentPending: this.pending.size,
        });
      }
    }

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
          const batch = takeBatch(this.pending, this.config.batchSize);
          const query = buildBatchUpdateSql(batch);
          if (!query) {
            continue;
          }

          try {
            await db.execute(query);
          } catch (error) {
            // 失败重试：将 batch 放回队列
            // 合并策略：保留“更新更晚”的字段（existing 优先），避免覆盖新数据
            for (const item of batch) {
              const existing = this.pending.get(item.id) ?? {};
              this.pending.set(item.id, { ...item.patch, ...existing });
            }

            logger.error("[MessageRequestWriteBuffer] Flush failed, will retry later", {
              error: error instanceof Error ? error.message : String(error),
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
  }
}

let _buffer: MessageRequestWriteBuffer | null = null;
let _bufferState: "running" | "stopping" | "stopped" = "running";

function getBuffer(): MessageRequestWriteBuffer | null {
  if (!_buffer) {
    if (_bufferState !== "running") {
      return null;
    }
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
