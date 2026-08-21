import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import type { ProxySession } from "../session";
import { captureReplayResponseHeaders } from "./replay-headers";
import { isReplayEnabled, type ReplayIdentity } from "./replay-identity";
import {
  getReplayStore,
  type ReplayDelivery,
  ReplayDurableConflictError,
  type ReplayMeta,
} from "./replay-store";

/**
 * F2 owner 侧 spool：把客户端可见字节（pump 处理后流）以 write-behind 方式
 * 喂入 Redis 热层，供并发/断线的相同请求 attach 跟尾。
 *
 * - observe() 在流热路径同步调用：只做累积与调度，绝不阻塞；
 *   实际写 Redis 走串行 promise 链（保序）。
 * - 冲刷条件：累积 >= 64KB 或 100ms 定时；每次冲刷同时续 meta 心跳与 owner 租约。
 * - 超出 REPLAY_MAX_PAYLOAD_BYTES：自失效（删除已写块，后续 attach 视为 miss），
 *   fail-open 不影响主流。
 * - completeAfterBilling()：计费持久化成功后才调用（终态屏障不变量），
 *   冲刷尾部 -> 写 PG 持久层 -> meta 置 completed（PG 不 durable 绝不置 completed）。
 * - abort()：meta 置 aborted + 删除块，绝不被已完成重放命中。
 * - 续租 compare 失败（所有权被接管）-> halt：停止 spool 但不删条目。
 */

const FLUSH_INTERVAL_MS = 100;
const FLUSH_BYTES_THRESHOLD = 64 * 1024;
const MAX_QUEUED_WRITE_BYTES = 1024 * 1024;
const OWNER_HEARTBEAT_INTERVAL_MS = 15_000;
const PRE_SPOOL_ABORT_WAIT_MS = 100;

let activeSpoolCount = 0;
let durablePersistenceChain: Promise<void> = Promise.resolve();

function serializeDurablePersistence<T>(operation: () => Promise<T>): Promise<T> {
  const result = durablePersistenceChain.then(operation);
  durablePersistenceChain = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export interface ReplaySpoolOptions {
  /** Shortens the detached window when the spool loses its active write role. */
  onInactive?: () => void;
  /** Runs once after completed, aborted, or disabled cleanup releases the spool. */
  onTerminal?: () => void;
}

export function getActiveReplaySpoolCount(): number {
  return activeSpoolCount;
}

export class ReplaySpool {
  private readonly store = getReplayStore();
  private readonly decoder = new TextDecoder("utf-8");
  private readonly queuedBatches = new Set<string[]>();
  private pending: string[] = [];
  private pendingBytes = 0;
  private queuedWriteBytes = 0;
  private totalBytes = 0;
  private chunkCount = 0;
  private disabled = false;
  private terminal = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private ownerHeartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private ownerHeartbeatInFlight = false;
  private writeChain: Promise<void> = Promise.resolve();
  private metaWritten = false;

  constructor(
    private readonly identity: ReplayIdentity,
    private readonly ownerToken: string,
    private readonly statusCode: number,
    private readonly headers: Record<string, string>,
    private readonly delivery: ReplayDelivery = "stream",
    private readonly options: ReplaySpoolOptions = {}
  ) {
    activeSpoolCount++;
    this.startOwnerHeartbeat();
  }

  /** 已达终态（complete/abort）或已失效（disable/halt）：调用方兜底判断用。 */
  get isTerminal(): boolean {
    return this.terminal || this.disabled;
  }

  /** 流热路径同步观察：累积并调度冲刷。 */
  observe(chunk: Uint8Array): void {
    if (this.disabled || this.terminal || chunk.byteLength === 0) return;
    try {
      this.totalBytes += chunk.byteLength;
      const env = getEnvConfig();
      if (this.totalBytes > env.REPLAY_MAX_PAYLOAD_BYTES) {
        this.disable("payload_too_large");
        return;
      }
      this.pendingBytes += chunk.byteLength;
      const text = this.decoder.decode(chunk, { stream: true });
      if (text.length === 0) return;
      this.pending.push(text);

      if (this.pendingBytes >= FLUSH_BYTES_THRESHOLD) {
        this.scheduleFlush(0);
      } else {
        this.scheduleFlush(FLUSH_INTERVAL_MS);
      }
    } catch (error) {
      logger.debug("[ReplaySpool] observe failed, disabling spool", {
        error: error instanceof Error ? error.message : String(error),
      });
      this.disable("observe_error");
    }
  }

  private scheduleFlush(delayMs: number): void {
    if (this.flushTimer) {
      if (delayMs > 0) return;
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (delayMs <= 0) {
      this.enqueueFlush();
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.enqueueFlush();
    }, delayMs);
    // 不阻止进程退出
    this.flushTimer.unref?.();
  }

  private enqueueFlush(): void {
    const batch = this.pending;
    if (batch.length === 0) return;
    const batchBytes = this.pendingBytes;
    this.pending = [];
    this.pendingBytes = 0;
    if (!this.reserveQueuedBatch(batch, batchBytes)) return;
    // 续接体自带 try/catch：链永不 rejected；每个 await 之后复查 disabled，
    // 防止与 disable/halt 竞态时在清理之后又写回 owning meta
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (this.disabled || this.aborting) return;
        const expectedChunkCount = this.chunkCount + batch.length;
        const appended = await this.store.writeOwned(
          this.identity.replayId,
          this.ownerToken,
          this.buildMeta("owning", { chunkCount: expectedChunkCount }),
          batch
        );
        if (this.disabled || this.aborting) return;
        if (appended === null) {
          // Redis 不可用：本次 replay 放弃（热层写是原子的，不会留下半批数据）
          this.disable("redis_unavailable");
          return;
        }
        if (appended === false) {
          this.halt("owner_lease_lost");
          return;
        }
        this.chunkCount = appended;
        this.metaWritten = true;
      } catch (error) {
        if (this.aborting) return;
        logger.debug("[ReplaySpool] flush failed, disabling spool", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.disable("flush_error");
      } finally {
        this.queuedBatches.delete(batch);
        this.queuedWriteBytes = Math.max(0, this.queuedWriteBytes - batchBytes);
      }
    });
  }

  private reserveQueuedBatch(batch: string[], batchBytes: number): boolean {
    if (this.queuedWriteBytes + batchBytes > MAX_QUEUED_WRITE_BYTES) {
      batch.length = 0;
      this.disable("write_backlog_too_large");
      return false;
    }
    this.queuedWriteBytes += batchBytes;
    this.queuedBatches.add(batch);
    return true;
  }

  private buildMeta(status: ReplayMeta["status"], extra?: Partial<ReplayMeta>): ReplayMeta {
    return {
      status,
      verifier: this.identity.verifier,
      scopeTag: this.identity.scopeTag,
      statusCode: this.statusCode,
      headers: this.headers,
      delivery: this.delivery,
      format: this.identity.format,
      model: this.identity.model,
      chunkCount: this.chunkCount,
      byteSize: this.totalBytes,
      heartbeatAt: Date.now(),
      ...extra,
    };
  }

  private startOwnerHeartbeat(): void {
    this.ownerHeartbeatTimer = setInterval(() => {
      if (this.disabled || this.aborting || this.released || this.ownerHeartbeatInFlight) return;
      this.ownerHeartbeatInFlight = true;
      void this.store
        .renewOwnerLease(this.identity.replayId, this.ownerToken)
        .then((leaseHeld) => {
          if (!leaseHeld && !this.aborting && !this.released) this.halt("owner_lease_lost");
        })
        .catch(() => {
          if (!this.aborting && !this.released) this.halt("owner_lease_lost");
        })
        .finally(() => {
          this.ownerHeartbeatInFlight = false;
        });
    }, OWNER_HEARTBEAT_INTERVAL_MS);
    this.ownerHeartbeatTimer.unref?.();
  }

  /** 立即建立 owning meta（handleStream 创建 spool 时调用，供 attach 读者尽早看到状态）。 */
  bootstrap(): void {
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (this.disabled || this.aborting || this.metaWritten) return;
        const chunkCount = await this.store.writeOwned(
          this.identity.replayId,
          this.ownerToken,
          this.buildMeta("owning")
        );
        if (this.disabled || this.aborting) return;
        if (chunkCount === null) {
          this.disable("redis_unavailable");
          return;
        }
        if (chunkCount === false) {
          this.halt("owner_lease_lost");
          return;
        }
        this.chunkCount = chunkCount;
        this.metaWritten = true;
      } catch (error) {
        if (this.aborting) return;
        logger.debug("[ReplaySpool] bootstrap failed, disabling spool", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.disable("flush_error");
      }
    });
  }

  /**
   * 计费持久化成功后的完成屏障：尾部冲刷 -> PG 持久层 -> meta 置 completed。
   * 顺序不变量：completed 只能在 payload 与计费均已 durable 之后出现。
   */
  async completeAfterBilling(messageRequestId: number | null): Promise<void> {
    if (this.disabled || this.terminal) return;
    this.terminal = true;
    this.clearFlushTimer();
    const tail = this.decoder.decode();
    if (tail.length > 0) {
      this.pending.push(tail);
    }
    const batch = this.pending;
    const batchBytes = this.pendingBytes;
    this.pending = [];
    this.pendingBytes = 0;
    if (!this.reserveQueuedBatch(batch, batchBytes)) {
      await this.writeChain;
      return;
    }

    this.writeChain = this.writeChain.then(async () => {
      let pgPersisted = false;
      try {
        if (this.disabled || this.aborting) return;
        const expectedChunkCount = this.chunkCount + batch.length;
        const appended = await this.store.writeOwned(
          this.identity.replayId,
          this.ownerToken,
          this.buildMeta("owning", { chunkCount: expectedChunkCount }),
          batch
        );
        if (appended === false) {
          throw new Error("replay owner lease lost before completion");
        }
        if (appended === null) {
          // 尾批或 owning meta 丢失时热层条目不完整，绝不能置 completed
          throw new Error("final replay flush failed");
        }
        this.chunkCount = appended;
        this.metaWritten = true;
        // Redis 是活跃正文的唯一长期副本。大 payload 的读取、拼接和 PG 写入串行执行，
        // 避免多个流同秒终态时在 V8 heap 中并发重建完整响应。
        const persistResult = await serializeDurablePersistence(async () => {
          const chunks = await this.store.readChunks(this.identity.replayId, 0);
          if (!chunks || chunks.length !== this.chunkCount) {
            throw new Error("replay chunks unavailable before durable persistence");
          }
          return this.store.persistCompleted({
            replayId: this.identity.replayId,
            verifier: this.identity.verifier,
            scopeTag: this.identity.scopeTag,
            keyId: this.identity.keyId,
            userId: this.identity.userId,
            format: this.identity.format,
            model: this.identity.model,
            statusCode: this.statusCode,
            headers: this.headers,
            payload: chunks.join(""),
            byteSize: this.totalBytes,
            sourceMessageRequestId: messageRequestId,
          });
        });
        pgPersisted = true;
        const completed = await this.store.completeOwned(
          this.identity.replayId,
          this.ownerToken,
          this.buildMeta("completed", { messageRequestId })
        );
        if (!completed) {
          throw new Error("replay owner lease lost before completed meta");
        }
        if (persistResult === "existing") {
          logger.info("[ReplaySpool] reused existing durable replay winner", {
            replayId: this.identity.replayId.slice(0, 12),
          });
        } else {
          logger.info("[ReplaySpool] replay entry completed", {
            replayId: this.identity.replayId.slice(0, 12),
            chunkCount: this.chunkCount,
            byteSize: this.totalBytes,
          });
        }
      } catch (error) {
        if (error instanceof ReplayDurableConflictError) {
          logger.warn("[ReplaySpool] discarded conflicting durable replay candidate", {
            replayId: this.identity.replayId.slice(0, 12),
          });
          await this.store.discardOwned(this.identity.replayId, this.ownerToken).catch(() => false);
          return;
        }
        // pgPersisted=true：payload 已 durable，仅 completed 翻转失败——热层封死为
        // aborted 仍正确（meta 过期后可由 PG 持久层继续服务）；false 则未持久化，整体作废
        logger.warn("[ReplaySpool] complete failed, aborting entry", {
          error: error instanceof Error ? error.message : String(error),
          pgPersisted,
        });
        await this.store
          .abortOwned(
            this.identity.replayId,
            this.ownerToken,
            this.buildMeta("aborted", { abortReason: "complete_failed" })
          )
          .catch(() => false);
      } finally {
        this.queuedBatches.delete(batch);
        this.queuedWriteBytes = Math.max(0, this.queuedWriteBytes - batchBytes);
        this.release();
      }
    });
    await this.writeChain;
  }

  /** 终态失败：meta 置 aborted + 删块；已 aborted 的条目绝不被重放命中。 */
  async abort(reason: string): Promise<void> {
    if (this.abortPromise) {
      await this.abortPromise;
      return;
    }
    if (this.terminal) return;
    this.terminal = true;
    this.aborting = true;
    this.notifyInactive();
    this.clearTimer();
    this.pending = [];
    this.pendingBytes = 0;
    this.clearQueuedBatches();
    this.abortPromise = this.writeChain.then(async () => {
      try {
        // 已失效（disable 已清理 / halt 已让渡所有权）：不得再写 meta 覆盖新 owner
        if (this.disabled) return;
        await this.store.abortOwned(
          this.identity.replayId,
          this.ownerToken,
          this.buildMeta("aborted", { abortReason: reason })
        );
      } catch {
        // 热层清理失败靠 TTL 兜底
      } finally {
        this.release();
      }
    });
    this.writeChain = this.abortPromise;
    await this.abortPromise;
  }

  /** 失效并删除条目（payload 超限 / Redis 不可用 / 冲刷异常等本 spool 自身的失败）。 */
  private disable(reason: string): void {
    this.teardown(reason, true);
  }

  /** 所有权已失（续租 compare 失败）：停止 spool 但绝不删条目——新 owner 可能已在写同一 LIST。 */
  private halt(reason: string): void {
    this.teardown(reason, false);
  }

  private teardown(reason: string, deleteEntry: boolean): void {
    if (this.disabled) return;
    this.disabled = true;
    this.notifyInactive();
    this.clearTimer();
    this.pending = [];
    this.pendingBytes = 0;
    this.clearQueuedBatches();
    // 清理顺着 writeChain 串行：与 in-flight append 竞态时绝不出现「删除后又写回」
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (deleteEntry) {
          await this.store
            .abortOwned(
              this.identity.replayId,
              this.ownerToken,
              this.buildMeta("aborted", { abortReason: reason })
            )
            .catch(() => false);
        } else {
          // compare-delete 只删自己的 token：所有权已失时为安全 no-op
          await this.store
            .releaseOwner(this.identity.replayId, this.ownerToken)
            .catch(() => undefined);
        }
      } finally {
        this.release();
      }
    });
    logger.debug("[ReplaySpool] spool disabled", {
      replayId: this.identity.replayId.slice(0, 12),
      reason,
    });
  }

  private released = false;
  private aborting = false;
  private abortPromise: Promise<void> | null = null;

  private release(): void {
    if (this.released) return;
    this.released = true;
    this.clearOwnerHeartbeat();
    activeSpoolCount = Math.max(0, activeSpoolCount - 1);
    try {
      this.options.onTerminal?.();
    } catch (error) {
      logger.debug("[ReplaySpool] terminal callback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private clearFlushTimer(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private clearOwnerHeartbeat(): void {
    if (!this.ownerHeartbeatTimer) return;
    clearInterval(this.ownerHeartbeatTimer);
    this.ownerHeartbeatTimer = null;
  }

  private clearTimer(): void {
    this.clearFlushTimer();
    this.clearOwnerHeartbeat();
  }

  private clearQueuedBatches(): void {
    for (const batch of this.queuedBatches) batch.length = 0;
    this.queuedBatches.clear();
    this.queuedWriteBytes = 0;
  }

  private inactiveNotified = false;

  private notifyInactive(): void {
    if (this.inactiveNotified) return;
    this.inactiveNotified = true;
    try {
      this.options.onInactive?.();
    } catch (error) {
      logger.debug("[ReplaySpool] inactive callback failed", {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/** Forwarder 在 spool 创建前终止时，以 owner token 原子封死 Replay 条目。 */
export async function abortReplayOwnership(session: ProxySession, reason: string): Promise<void> {
  const replayState = session.replayState;
  if (replayState?.role !== "owner") return;

  // 先清本地角色形成幂等门；Redis 失败时保留 fail-open，租约最终由 TTL 回收。
  session.replayState = null;
  const { identity, ownerToken } = replayState;
  const meta: ReplayMeta = {
    status: "aborted",
    verifier: identity.verifier,
    scopeTag: identity.scopeTag,
    statusCode: 502,
    headers: {},
    format: identity.format,
    model: identity.model,
    chunkCount: 0,
    byteSize: 0,
    heartbeatAt: Date.now(),
    abortReason: reason,
  };
  const store = getReplayStore();
  const cleanup = (async () => {
    const aborted = await store.abortOwned(identity.replayId, ownerToken, meta).catch(() => false);
    if (aborted) return;

    logger.warn("[ReplaySpool] failed to abort pre-spool replay ownership", {
      replayId: identity.replayId.slice(0, 12),
      reason,
    });
    await store.releaseOwner(identity.replayId, ownerToken).catch(() => undefined);
  })();

  let timer: ReturnType<typeof setTimeout> | null = null;
  const deadline = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, PRE_SPOOL_ABORT_WAIT_MS);
    timer.unref?.();
  });
  await Promise.race([cleanup, deadline]);
  if (timer) clearTimeout(timer);
}

/**
 * 不会建 spool 的路径统一释放 owner 租约并清角色——
 * 否则相同请求的重试会被残留租约挡满 45s。
 */
export function releaseReplayOwnership(session: ProxySession): void {
  const replayState = session.replayState;
  if (replayState?.role !== "owner") return;
  void getReplayStore()
    .releaseOwner(replayState.identity.replayId, replayState.ownerToken)
    .catch(() => undefined);
  session.replayState = null;
}

/**
 * handleStream 建 pump 时创建 owner spool。
 * 前置：guard 阶段已成功 claim owner（session.replayState.role === "owner"）。
 * 并发 spool 超上限 / 非 2xx / 响应类型与 delivery 不匹配 / 开关关闭 / 异常时返回
 * null（本请求不做 replay），并立即释放 owner 租约。
 */
export function createReplaySpoolIfOwner(
  session: ProxySession,
  response: Response,
  delivery: ReplayDelivery = "stream",
  options: ReplaySpoolOptions = {}
): ReplaySpool | null {
  if (typeof session.shouldUseRequestReplay === "function" && !session.shouldUseRequestReplay()) {
    return null;
  }

  const replayState = session.replayState;
  if (replayState?.role !== "owner") return null;
  const declineOwnership = (): null => {
    releaseReplayOwnership(session);
    return null;
  };
  try {
    const env = getEnvConfig();
    if (!isReplayEnabled()) return declineOwnership();
    if (activeSpoolCount >= env.REPLAY_MAX_CONCURRENT_SPOOLS) {
      logger.debug("[ReplaySpool] concurrent spool cap reached, skipping replay", {
        active: activeSpoolCount,
      });
      return declineOwnership();
    }
    if (response.status < 200 || response.status >= 300) return declineOwnership();
    const contentType = response.headers.get("content-type");
    const isSse = contentType
      ? contentType.toLowerCase().includes("text/event-stream")
      : delivery === "stream";
    if ((delivery === "stream" && !isSse) || (delivery === "buffered" && isSse)) {
      return declineOwnership();
    }
    const headers = captureReplayResponseHeaders(
      response.headers,
      delivery === "stream" ? "text/event-stream" : undefined
    );

    const spool = new ReplaySpool(
      replayState.identity,
      replayState.ownerToken,
      response.status,
      headers,
      delivery,
      options
    );
    spool.bootstrap();
    return spool;
  } catch (error) {
    logger.debug("[ReplaySpool] create failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return declineOwnership();
  }
}
