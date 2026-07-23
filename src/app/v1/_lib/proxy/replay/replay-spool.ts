import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import type { ProxySession } from "../session";
import type { ReplayIdentity } from "./replay-identity";
import { getReplayStore, type ReplayMeta } from "./replay-store";

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

let activeSpoolCount = 0;

export function getActiveReplaySpoolCount(): number {
  return activeSpoolCount;
}

export class ReplaySpool {
  private readonly store = getReplayStore();
  private readonly decoder = new TextDecoder("utf-8");
  private readonly parts: string[] = [];
  private pending: string[] = [];
  private pendingBytes = 0;
  private totalBytes = 0;
  private chunkCount = 0;
  private disabled = false;
  private terminal = false;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private writeChain: Promise<void> = Promise.resolve();
  private metaWritten = false;

  constructor(
    private readonly identity: ReplayIdentity,
    private readonly ownerToken: string,
    private readonly statusCode: number,
    private readonly contentType: string
  ) {
    activeSpoolCount++;
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
      const text = this.decoder.decode(chunk, { stream: true });
      if (text.length === 0) return;
      this.pending.push(text);
      this.parts.push(text);
      this.pendingBytes += chunk.byteLength;

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
    this.pending = [];
    this.pendingBytes = 0;
    // 续接体自带 try/catch：链永不 rejected；每个 await 之后复查 disabled，
    // 防止与 disable/halt 竞态时在清理之后又写回 owning meta
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (this.disabled) return;
        const appended = await this.store.appendChunks(this.identity.replayId, batch);
        if (this.disabled) return;
        if (appended === null) {
          // Redis 不可用：本次 replay 放弃（已写块靠 TTL 清理）
          this.disable("redis_unavailable");
          return;
        }
        this.chunkCount = appended;
        await this.writeMeta("owning");
        if (this.disabled) return;
        const leaseHeld = await this.store.renewOwnerLease(this.identity.replayId, this.ownerToken);
        if (!leaseHeld) {
          // 所有权已失（租约被他人接管）：停止 spool，但绝不删条目
          this.halt("owner_lease_lost");
        }
      } catch (error) {
        logger.debug("[ReplaySpool] flush failed, disabling spool", {
          error: error instanceof Error ? error.message : String(error),
        });
        this.disable("flush_error");
      }
    });
  }

  private async writeMeta(
    status: ReplayMeta["status"],
    extra?: Partial<ReplayMeta>
  ): Promise<void> {
    const meta: ReplayMeta = {
      status,
      verifier: this.identity.verifier,
      scopeTag: this.identity.scopeTag,
      statusCode: this.statusCode,
      headers: { "content-type": this.contentType },
      format: this.identity.format,
      model: this.identity.model,
      chunkCount: this.chunkCount,
      byteSize: this.totalBytes,
      heartbeatAt: Date.now(),
      ...extra,
    };
    await this.store.setMeta(this.identity.replayId, meta);
    this.metaWritten = true;
  }

  /** 立即建立 owning meta（handleStream 创建 spool 时调用，供 attach 读者尽早看到状态）。 */
  bootstrap(): void {
    this.writeChain = this.writeChain.then(async () => {
      try {
        if (this.disabled || this.metaWritten) return;
        await this.writeMeta("owning");
      } catch (error) {
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
    this.clearTimer();
    const tail = this.decoder.decode();
    if (tail.length > 0) {
      this.pending.push(tail);
      this.parts.push(tail);
    }
    const batch = this.pending;
    this.pending = [];
    this.pendingBytes = 0;

    this.writeChain = this.writeChain.then(async () => {
      let pgPersisted = false;
      try {
        if (this.disabled) return;
        if (batch.length > 0) {
          const appended = await this.store.appendChunks(this.identity.replayId, batch);
          if (appended === null) {
            // 尾批丢失则热层条目不完整，绝不能置 completed
            throw new Error("final replay flush failed");
          }
          this.chunkCount = appended;
        }
        // 先写 PG（持久 payload），再翻 Redis meta 为 completed（热层可服务）
        await this.store.persistCompleted({
          replayId: this.identity.replayId,
          verifier: this.identity.verifier,
          scopeTag: this.identity.scopeTag,
          keyId: this.identity.keyId,
          userId: this.identity.userId,
          format: this.identity.format,
          model: this.identity.model,
          statusCode: this.statusCode,
          headers: { "content-type": this.contentType },
          payload: this.parts.join(""),
          byteSize: this.totalBytes,
          sourceMessageRequestId: messageRequestId,
        });
        pgPersisted = true;
        await this.writeMeta("completed", { messageRequestId });
        logger.info("[ReplaySpool] replay entry completed", {
          replayId: this.identity.replayId.slice(0, 12),
          chunkCount: this.chunkCount,
          byteSize: this.totalBytes,
        });
      } catch (error) {
        // pgPersisted=true：payload 已 durable，仅 completed 翻转失败——热层封死为
        // aborted 仍正确（meta 过期后可由 PG 持久层继续服务）；false 则未持久化，整体作废
        logger.warn("[ReplaySpool] complete failed, aborting entry", {
          error: error instanceof Error ? error.message : String(error),
          pgPersisted,
        });
        await this.writeMeta("aborted", { abortReason: "complete_failed" }).catch(() => undefined);
        await this.store.deleteChunks(this.identity.replayId).catch(() => undefined);
      } finally {
        await this.store.releaseOwner(this.identity.replayId, this.ownerToken);
        this.release();
      }
    });
    await this.writeChain;
  }

  /** 终态失败：meta 置 aborted + 删块；已 aborted 的条目绝不被重放命中。 */
  async abort(reason: string): Promise<void> {
    if (this.terminal) return;
    this.terminal = true;
    this.clearTimer();
    this.pending = [];
    this.pendingBytes = 0;
    this.writeChain = this.writeChain.then(async () => {
      try {
        // 已失效（disable 已清理 / halt 已让渡所有权）：不得再写 meta 覆盖新 owner
        if (this.disabled) return;
        // aborted meta 保留（短 TTL）供 attach 读者感知终态；块立即删除
        await this.writeMeta("aborted", { abortReason: reason });
        await this.store.deleteChunks(this.identity.replayId);
      } catch {
        // 热层清理失败靠 TTL 兜底
      } finally {
        await this.store.releaseOwner(this.identity.replayId, this.ownerToken);
        this.release();
      }
    });
    await this.writeChain;
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
    this.clearTimer();
    this.pending = [];
    this.parts.length = 0;
    this.pendingBytes = 0;
    // 清理顺着 writeChain 串行：与 in-flight append 竞态时绝不出现「删除后又写回」
    this.writeChain = this.writeChain.then(async () => {
      if (deleteEntry) {
        await this.store.deleteEntry(this.identity.replayId).catch(() => undefined);
      }
      // compare-delete 只删自己的 token：所有权已失时为安全 no-op
      await this.store.releaseOwner(this.identity.replayId, this.ownerToken).catch(() => undefined);
    });
    logger.debug("[ReplaySpool] spool disabled", {
      replayId: this.identity.replayId.slice(0, 12),
      reason,
    });
    this.release();
  }

  private released = false;

  private release(): void {
    if (this.released) return;
    this.released = true;
    activeSpoolCount = Math.max(0, activeSpoolCount - 1);
  }

  private clearTimer(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
  }
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
 * 并发 spool 超上限 / 非 2xx / 非 SSE / 开关关闭 / 异常时返回 null（本请求不做
 * replay），并立即释放 owner 租约。
 */
export function createReplaySpoolIfOwner(
  session: ProxySession,
  response: Response
): ReplaySpool | null {
  const replayState = session.replayState;
  if (replayState?.role !== "owner") return null;
  const declineOwnership = (): null => {
    releaseReplayOwnership(session);
    return null;
  };
  try {
    const env = getEnvConfig();
    if (!env.ENABLE_REQUEST_REPLAY) return declineOwnership();
    if (activeSpoolCount >= env.REPLAY_MAX_CONCURRENT_SPOOLS) {
      logger.debug("[ReplaySpool] concurrent spool cap reached, skipping replay", {
        active: activeSpoolCount,
      });
      return declineOwnership();
    }
    if (response.status < 200 || response.status >= 300) return declineOwnership();
    const contentType = response.headers.get("content-type") ?? "text/event-stream";
    if (!contentType.toLowerCase().includes("text/event-stream")) return declineOwnership();

    const spool = new ReplaySpool(
      replayState.identity,
      replayState.ownerToken,
      response.status,
      contentType
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
