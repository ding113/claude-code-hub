import {
  isThinkingEnabled,
  resolveAnthropicStreamActualResponseModel,
} from "@/app/v1/_lib/proxy/anthropic-actual-response-model";
import { ResponseFixer } from "@/app/v1/_lib/proxy/response-fixer";
import { findSafeDatabaseError } from "@/drizzle/admitted-client";
import { AsyncTaskManager } from "@/lib/async-task-manager";
import { computeCacheScoreFields } from "@/lib/cache-effectiveness/gate";
import { getEnvConfig } from "@/lib/config/env.schema";
import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { emitProxyLangfuseTrace } from "@/lib/langfuse/emit-proxy-trace";
import { logger } from "@/lib/logger";
import { requestCloudPriceTableSync } from "@/lib/price-sync/cloud-price-updater";
import { ProxyStatusTracker } from "@/lib/proxy-status-tracker";
import { RateLimitService } from "@/lib/rate-limit";
import { deleteLiveChain } from "@/lib/redis/live-chain-store";
import { SessionManager } from "@/lib/session-manager";
import { SessionTracker } from "@/lib/session-tracker";
import { CODEX_1M_CONTEXT_TOKEN_THRESHOLD } from "@/lib/special-attributes";
import type {
  CostBreakdown,
  RequestCostCalculationOptions,
  ResolvedLongContextPricing,
} from "@/lib/utils/cost-calculation";
import {
  calculateRequestCost,
  calculateRequestCostBreakdown,
  matchLongContextPricing,
  sanitizeMultiplier,
} from "@/lib/utils/cost-calculation";
import { COST_SCALE, Decimal } from "@/lib/utils/currency";
import { isNonBillingEndpoint } from "@/lib/utils/performance-formatter";
import { hasValidPriceData } from "@/lib/utils/price-data";
import { isSSEText, parseSSEData } from "@/lib/utils/sse";
import {
  detectUpstreamErrorFromSseOrJsonText,
  inferUpstreamErrorStatusCodeFromText,
} from "@/lib/utils/upstream-error-detection";
import {
  addMessageRequestHedgeLoserCost,
  updateMessageRequestCostWithBreakdown,
  updateMessageRequestDetailsDurably,
  updateMessageRequestDetailsIfUnfinalized,
  updateMessageRequestWinnerCost,
} from "@/repository/message";
import type { HedgeLoserBilling, StoredCostBreakdown } from "@/types/cost-breakdown";
import type { Provider } from "@/types/provider";
import type { SessionUsageUpdate } from "@/types/session";
import type { LongContextPricingSpecialSetting } from "@/types/special-settings";
import { GeminiAdapter } from "../gemini/adapter";
import type { GeminiResponse } from "../gemini/types";
import { extractActualResponseModelForProvider } from "./actual-response-model";
import { recordAffinityWinner, tombstoneAffinityOnFailure } from "./affinity/affinity-recorder";
import { bindClientAbortListener } from "./client-abort-listener";
import {
  createDemandDrivenResponsePump,
  type DemandDrivenResponsePump,
} from "./demand-driven-response-pump";
import { isClientAbortError, isTransportError } from "./errors";
import { createReplaySpoolIfOwner, releaseReplayOwnership } from "./replay/replay-spool";
import type { ProxySession } from "./session";
import {
  consumeDeferredStreamingFinalization,
  peekDeferredStreamingFinalization,
} from "./stream-finalization";
import { mapProviderTypeToFamily } from "./stream-gate/frame-classifier";
import { createShadowGateObserver, resolveStreamGateMode } from "./stream-gate/stream-content-gate";

const CLIENT_ABORT_DRAIN_MAX_MS = 60_000;
const STREAM_STATS_MAX_BUFFER_BYTES = 10 * 1024 * 1024;
const STREAM_STATS_HEAD_BYTES = 1024 * 1024;
const STREAM_STATS_TAIL_BYTES = STREAM_STATS_MAX_BUFFER_BYTES - STREAM_STATS_HEAD_BYTES;
const STREAM_STATS_TAIL_CHUNKS = 8192;
const STREAM_STATS_TRUNCATED_MARKER = "\n\n: [cch_truncated]\n\n";

type BoundedStreamTextSnapshot = {
  text: string;
  truncated: boolean;
  totalBytes: number;
  bufferedBytes: number;
  chunkCount: number;
};

function copyUint8Range(value: Uint8Array, start = 0, end = value.byteLength): Uint8Array {
  return new Uint8Array(value.subarray(start, end));
}

function resolveNonStreamTaskStaleTimeoutMs(provider: Provider): number {
  return provider.requestTimeoutNonStreamingMs > 0
    ? provider.requestTimeoutNonStreamingMs
    : Number.POSITIVE_INFINITY;
}

function resolveStreamTaskStaleTimeoutMs(): number {
  // Streaming liveness is owned by first-byte, Provider-idle, and client-drain
  // timers. The generic watchdog cannot distinguish a stalled Provider from a
  // healthy pending chunk that is deliberately waiting for downstream demand.
  return Number.POSITIVE_INFINITY;
}

const STREAM_FINALIZATION_MAX_MS = 120_000;
const STREAM_FAILURE_PERSISTENCE_MAX_MS = 5_000;
const NON_STREAM_TERMINAL_PERSISTENCE_ERROR = Symbol("non_stream_terminal_persistence_error");

type MessageRequestTerminalDetails = Parameters<typeof updateMessageRequestDetailsDurably>[1];
type NonStreamTerminalPersistenceError = Error & {
  [NON_STREAM_TERMINAL_PERSISTENCE_ERROR]: true;
};

function markNonStreamTerminalPersistenceError(error: unknown): NonStreamTerminalPersistenceError {
  const markedError =
    error instanceof Error
      ? error
      : new Error(error === undefined ? "Unknown error" : String(error));
  Object.defineProperty(markedError, NON_STREAM_TERMINAL_PERSISTENCE_ERROR, {
    configurable: false,
    enumerable: false,
    value: true,
    writable: false,
  });
  return markedError as NonStreamTerminalPersistenceError;
}

function isNonStreamTerminalPersistenceError(
  error: unknown
): error is NonStreamTerminalPersistenceError {
  return (
    error instanceof Error &&
    NON_STREAM_TERMINAL_PERSISTENCE_ERROR in error &&
    (error as NonStreamTerminalPersistenceError)[NON_STREAM_TERMINAL_PERSISTENCE_ERROR] === true
  );
}

async function persistNonStreamTerminalDetails(options: {
  taskId: string;
  messageRequestId: number;
  durationMs: number;
  details: MessageRequestTerminalDetails;
  onCommitted?: () => void | Promise<void>;
}): Promise<boolean> {
  const completeTerminalDetails = {
    ...options.details,
    durationMs: options.durationMs,
  };
  try {
    const committed = await updateMessageRequestDetailsDurably(
      options.messageRequestId,
      completeTerminalDetails,
      options.onCommitted ? { onCommitted: options.onCommitted } : undefined
    );
    if (committed) return true;
  } catch (primaryError) {
    const databaseError = findSafeDatabaseError(primaryError);
    logger.error("ResponseHandler: Durable non-stream terminal persistence failed", {
      taskId: options.taskId,
      messageId: options.messageRequestId,
      statusCode: options.details.statusCode,
      error:
        databaseError?.message ??
        (primaryError instanceof Error ? primaryError.message : String(primaryError)),
      errorCode: databaseError?.code,
      errorPool: databaseError?.pool,
    });
  }

  try {
    return await awaitTerminalPersistenceWithOwnership({
      promise: updateMessageRequestDetailsIfUnfinalized(
        options.messageRequestId,
        completeTerminalDetails,
        options.onCommitted ? { onCommitted: options.onCommitted } : undefined
      ),
      taskId: options.taskId,
      operation: "nonstream-terminal-fallback",
      timeoutMs: STREAM_FAILURE_PERSISTENCE_MAX_MS,
    });
  } catch (fallbackError) {
    const databaseError = findSafeDatabaseError(fallbackError);
    logger.error("ResponseHandler: Conditional non-stream terminal fallback failed", {
      taskId: options.taskId,
      messageId: options.messageRequestId,
      statusCode: options.details.statusCode,
      error:
        databaseError?.message ??
        (fallbackError instanceof Error ? fallbackError.message : String(fallbackError)),
      errorCode: databaseError?.code,
      errorPool: databaseError?.pool,
    });
    throw markNonStreamTerminalPersistenceError(fallbackError);
  }
}

function raceWithTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutId: NodeJS.Timeout | null = null;
  const timeoutPromise = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => reject(new Error(message)), timeoutMs);
    timeoutId.unref?.();
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  });
}

function raceWithDeadline<T>(
  promise: Promise<T>,
  deadlineAtMs: number,
  message: string
): Promise<T> {
  const operation = Promise.resolve(promise);
  const remainingMs = deadlineAtMs - Date.now();
  if (remainingMs <= 0) {
    void operation.catch(() => {
      // The caller has already exhausted its deadline; absorb late rejection.
    });
    return Promise.reject(new Error(message));
  }

  return raceWithTimeout(operation, remainingMs, message);
}

let terminalPersistenceTailSequence = 0;

function awaitTerminalPersistenceWithOwnership<T>(options: {
  promise: Promise<T>;
  taskId: string;
  operation: string;
  timeoutMs: number;
}): Promise<T> {
  const persistence = Promise.resolve(options.promise);
  let started = false;
  const controller = AsyncTaskManager.register(
    `${options.taskId}-${options.operation}-${++terminalPersistenceTailSequence}`,
    async () => {
      started = true;
      try {
        await persistence;
      } catch {
        // The request owner observes and projects the original rejection. This
        // tail task only keeps late persistence joinable during shutdown.
      }
    },
    {
      taskType: "terminal-persistence-tail",
      staleTimeoutMs: Number.POSITIVE_INFINITY,
    }
  );

  if (controller.signal.aborted && !started) {
    return persistence;
  }

  return raceWithTimeout(
    persistence,
    options.timeoutMs,
    `${options.operation}_persistence_timeout`
  );
}

function schedulePostTerminalSideEffects(options: {
  taskId: string;
  providerId: number;
  sessionId: string | null;
  commit: (signal: AbortSignal) => Promise<void>;
}): Promise<void> {
  const effectTaskId = `${options.taskId}-post-terminal-effects`;
  const completion = Promise.withResolvers<void>();
  let started = false;
  const run = async (signal: AbortSignal) => {
    started = true;
    try {
      if (signal.aborted) {
        logger.info("[ResponseHandler] Post-terminal side effects cancelled before start", {
          taskId: options.taskId,
          providerId: options.providerId,
          sessionId: options.sessionId,
        });
        return;
      }

      let commitPromise: Promise<void>;
      try {
        commitPromise = Promise.resolve(options.commit(signal));
      } catch (error) {
        commitPromise = Promise.reject(error);
      }

      let warningTimer: ReturnType<typeof setTimeout> | null = setTimeout(() => {
        logger.warn("[ResponseHandler] Post-terminal side effects are still pending", {
          taskId: options.taskId,
          providerId: options.providerId,
          sessionId: options.sessionId,
          maxWaitMs: STREAM_FINALIZATION_MAX_MS,
        });
      }, STREAM_FINALIZATION_MAX_MS);
      warningTimer.unref?.();
      try {
        await commitPromise;
      } catch (error) {
        logger.warn("[ResponseHandler] Post-terminal side effects failed", {
          taskId: options.taskId,
          providerId: options.providerId,
          sessionId: options.sessionId,
          error: error instanceof Error ? error.message : String(error),
        });
      } finally {
        if (warningTimer) {
          clearTimeout(warningTimer);
          warningTimer = null;
        }
      }
    } finally {
      completion.resolve();
    }
  };
  const controller = AsyncTaskManager.register(effectTaskId, run, {
    taskType: "post-terminal-side-effects",
    staleTimeoutMs: STREAM_FINALIZATION_MAX_MS,
  });

  if (controller.signal.aborted && !started) {
    // shutdownAll may have closed the registry before a late SQL commit is
    // observed. Execute inline so the writer callback remains the owner and
    // shutdown can join it before Redis/DB dependencies are closed.
    void run(new AbortController().signal);
  }

  return completion.promise;
}

async function runPostTerminalSideEffects(
  effects: ReadonlyArray<() => Promise<void>>,
  signal: AbortSignal
): Promise<void> {
  if (signal.aborted) return;
  await Promise.allSettled(
    effects.map((effect) => {
      try {
        return effect();
      } catch (error) {
        return Promise.reject(error);
      }
    })
  );
}

// 流式统计只需要头部元信息和尾部 usage/final event。按字节保存窗口，避免
// string[] 无界增长，也避免 subarray 持有超大原始 ArrayBuffer。
export class BoundedStreamTextAccumulator {
  private readonly headChunks: Uint8Array[] = [];
  private readonly tailChunks: Uint8Array[] = [];
  private readonly tailChunkBytes: number[] = [];
  private headBufferedBytes = 0;
  private tailBufferedBytes = 0;
  private tailHead = 0;
  private tailMode = false;
  private truncated = false;
  private totalBytes = 0;
  private chunksSeen = 0;
  private finishedSnapshot: BoundedStreamTextSnapshot | null = null;

  get chunkCount(): number {
    return this.chunksSeen;
  }

  get totalByteCount(): number {
    return this.totalBytes;
  }

  get bufferedByteCount(): number {
    return this.headBufferedBytes + this.tailBufferedBytes;
  }

  get isTruncated(): boolean {
    return this.truncated;
  }

  pushBytes(value: Uint8Array): void {
    if (!value || value.byteLength === 0) {
      return;
    }

    this.finishedSnapshot = null;
    this.chunksSeen += 1;
    this.totalBytes += value.byteLength;

    if (!this.tailMode && this.headBufferedBytes < STREAM_STATS_HEAD_BYTES) {
      const remainingHeadBytes = STREAM_STATS_HEAD_BYTES - this.headBufferedBytes;
      if (value.byteLength <= remainingHeadBytes) {
        this.headChunks.push(copyUint8Range(value));
        this.headBufferedBytes += value.byteLength;
        return;
      }

      this.headChunks.push(copyUint8Range(value, 0, remainingHeadBytes));
      this.headBufferedBytes += remainingHeadBytes;
      this.tailMode = true;
      this.pushTailBytes(value.subarray(remainingHeadBytes));
      return;
    }

    this.tailMode = true;
    this.pushTailBytes(value);
  }

  finish(): BoundedStreamTextSnapshot {
    if (this.finishedSnapshot) {
      return this.finishedSnapshot;
    }

    const text = this.createSnapshotText();

    this.finishedSnapshot = {
      text,
      truncated: this.truncated,
      totalBytes: this.totalBytes,
      bufferedBytes: this.headBufferedBytes + this.tailBufferedBytes,
      chunkCount: this.chunksSeen,
    };

    return this.finishedSnapshot;
  }

  private createSnapshotText(): string {
    if (!this.tailMode) {
      return this.decodeChunks(this.headChunks, 0, this.headBufferedBytes);
    }

    if (!this.truncated) {
      return this.decodeContiguousBufferedBytes();
    }

    const headText = this.decodeChunks(this.headChunks, 0, this.headBufferedBytes);
    const tailText = this.decodeChunks(this.tailChunks, this.tailHead, this.tailBufferedBytes);
    return `${headText}${STREAM_STATS_TRUNCATED_MARKER}${tailText}`;
  }

  private pushTailBytes(value: Uint8Array): void {
    if (!value || value.byteLength === 0) {
      return;
    }

    if (value.byteLength > STREAM_STATS_TAIL_BYTES) {
      this.tailChunks.length = 0;
      this.tailChunkBytes.length = 0;
      this.tailHead = 0;
      const tail = copyUint8Range(value, value.byteLength - STREAM_STATS_TAIL_BYTES);
      this.tailChunks.push(tail);
      this.tailChunkBytes.push(tail.byteLength);
      this.tailBufferedBytes = tail.byteLength;
      this.truncated = true;
      return;
    }

    const copy = copyUint8Range(value);
    this.tailChunks.push(copy);
    this.tailChunkBytes.push(copy.byteLength);
    this.tailBufferedBytes += copy.byteLength;

    while (
      this.tailBufferedBytes > STREAM_STATS_TAIL_BYTES &&
      this.tailHead < this.tailChunkBytes.length
    ) {
      const overflowBytes = this.tailBufferedBytes - STREAM_STATS_TAIL_BYTES;
      const oldestChunkBytes = this.tailChunkBytes[this.tailHead] ?? 0;

      if (oldestChunkBytes <= 0) {
        this.tailHead += 1;
        continue;
      }

      if (overflowBytes >= oldestChunkBytes) {
        this.tailBufferedBytes -= oldestChunkBytes;
        this.tailChunks[this.tailHead] = new Uint8Array();
        this.tailChunkBytes[this.tailHead] = 0;
        this.tailHead += 1;
        this.truncated = true;
        continue;
      }

      const oldestChunk = this.tailChunks[this.tailHead]!;
      this.tailChunks[this.tailHead] = copyUint8Range(oldestChunk, overflowBytes);
      this.tailChunkBytes[this.tailHead] = oldestChunkBytes - overflowBytes;
      this.tailBufferedBytes -= overflowBytes;
      this.truncated = true;
    }

    if (this.tailHead > 4096) {
      this.tailChunks.splice(0, this.tailHead);
      this.tailChunkBytes.splice(0, this.tailHead);
      this.tailHead = 0;
    }

    const keptCount = this.tailChunks.length - this.tailHead;
    if (keptCount > STREAM_STATS_TAIL_CHUNKS) {
      const joined = this.concatChunks(this.tailChunks, this.tailHead, this.tailBufferedBytes);
      this.tailChunks.length = 0;
      this.tailChunkBytes.length = 0;
      this.tailHead = 0;
      this.tailChunks.push(joined);
      this.tailChunkBytes.push(joined.byteLength);
      this.tailBufferedBytes = joined.byteLength;
    }
  }

  private decodeChunks(chunks: Uint8Array[], startIndex: number, totalBytes: number): string {
    if (totalBytes <= 0) {
      return "";
    }
    return new TextDecoder().decode(this.concatChunks(chunks, startIndex, totalBytes));
  }

  private decodeContiguousBufferedBytes(): string {
    const totalBytes = this.headBufferedBytes + this.tailBufferedBytes;
    if (totalBytes <= 0) {
      return "";
    }

    const headBytes = this.concatChunks(this.headChunks, 0, this.headBufferedBytes);
    const tailBytes = this.concatChunks(this.tailChunks, this.tailHead, this.tailBufferedBytes);
    const out = new Uint8Array(headBytes.byteLength + tailBytes.byteLength);
    out.set(headBytes, 0);
    out.set(tailBytes, headBytes.byteLength);
    return new TextDecoder().decode(out);
  }

  private concatChunks(chunks: Uint8Array[], startIndex: number, totalBytes: number): Uint8Array {
    if (totalBytes <= 0) {
      return new Uint8Array();
    }

    const out = new Uint8Array(totalBytes);
    let offset = 0;
    for (let i = startIndex; i < chunks.length; i++) {
      const chunk = chunks[i];
      if (!chunk || chunk.byteLength === 0) {
        continue;
      }
      out.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return offset === totalBytes ? out : out.slice(0, offset);
  }
}

/**
 * Idempotent helper to release the agent pool reference count attached to a session.
 * Prevents double-release by clearing the callback after first invocation.
 */
function releaseSessionAgent(session: ProxySession): void {
  const s = session as ProxySession & { releaseAgent?: () => void };
  if (s.releaseAgent) {
    try {
      s.releaseAgent();
    } catch {
      // ignore - agent may already be evicted
    }
    s.releaseAgent = undefined;
  }
}

function bindTaskAbortToUpstreamResponse(
  session: ProxySession,
  abortController: AbortController,
  taskId: string
): () => void {
  const abortUpstream = () => {
    const sessionWithController = session as typeof session & {
      responseController?: AbortController;
    };
    const upstreamController = sessionWithController.responseController;
    if (!upstreamController || upstreamController.signal.aborted) {
      return;
    }

    const reason =
      abortController.signal.reason instanceof Error
        ? abortController.signal.reason
        : new Error("async_task_aborted");
    try {
      upstreamController.abort(reason);
    } catch (error) {
      logger.warn("[ResponseHandler] Failed to abort upstream response for async task", {
        taskId,
        error,
      });
    }
  };

  abortController.signal.addEventListener("abort", abortUpstream, { once: true });
  if (abortController.signal.aborted) {
    abortUpstream();
  }

  return () => {
    abortController.signal.removeEventListener("abort", abortUpstream);
  };
}

async function readResponseTextWithTaskActivity(
  response: Response,
  taskId: string
): Promise<string> {
  if (!response.body) {
    AsyncTaskManager.touch(taskId);
    return response.text();
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const chunks: string[] = [];

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (!value || value.byteLength === 0) {
        continue;
      }

      AsyncTaskManager.touch(taskId);
      chunks.push(decoder.decode(value, { stream: true }));
    }

    const finalText = decoder.decode();
    if (finalText) {
      chunks.push(finalText);
    }
    AsyncTaskManager.touch(taskId);
    return chunks.join("");
  } finally {
    reader.releaseLock();
  }
}

function takeBeforeResponseBodySnapshotSource(session: ProxySession): Response | null {
  const snapshotSession = session as ProxySession & {
    detailSnapshotResponseBeforeSource?: Response | null;
  };
  const source = snapshotSession.detailSnapshotResponseBeforeSource;
  snapshotSession.detailSnapshotResponseBeforeSource = null;
  return source ?? null;
}

async function consumeBeforeResponseBodySnapshot(session: ProxySession): Promise<string | null> {
  const source = takeBeforeResponseBodySnapshotSource(session);
  if (!source) return null;

  try {
    return await source.text();
  } catch (error) {
    logger.warn("[ResponseHandler] Failed to read before-response snapshot body", {
      sessionId: session.sessionId ?? null,
      requestSequence: session.requestSequence ?? null,
      error,
    });
    return null;
  }
}

function discardBeforeResponseBodySnapshot(session: ProxySession): boolean {
  const source = takeBeforeResponseBodySnapshotSource(session);
  if (!source?.body) return false;

  void source.body.cancel().catch((error) => {
    logger.warn("[ResponseHandler] Failed to discard before-response snapshot body", {
      sessionId: session.sessionId ?? null,
      requestSequence: session.requestSequence ?? null,
      error,
    });
  });
  return true;
}

export type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
  cache_ttl?: "5m" | "1h" | "mixed";
  cache_read_input_tokens?: number;
  // 图片 modality tokens（从 candidatesTokensDetails/promptTokensDetails 提取）
  input_image_tokens?: number;
  output_image_tokens?: number;
};

function maybeSetCodexContext1m(
  session: ProxySession,
  provider: Provider,
  inputTokens: number | null | undefined
): void {
  if (
    provider.providerType === "codex" &&
    inputTokens != null &&
    inputTokens > CODEX_1M_CONTEXT_TOKEN_THRESHOLD
  ) {
    session.setContext1mApplied(true);
  }
}

/**
 * 清理 Response headers 中的传输相关 header
 *
 * 原因：Bun 的 Response API 在接收 ReadableStream 或修改后的 body 时，
 * 会自动添加 Transfer-Encoding: chunked 和 Content-Length，
 * 如果不清理原始 headers 中的这些字段，会导致重复 header 错误。
 *
 * Node.js 运行时会智能去重，但 Bun 不会，所以需要手动清理。
 *
 * @param headers - 原始响应 headers
 * @returns 清理后的 headers
 */
function cleanResponseHeaders(headers: Headers): Headers {
  const cleaned = new Headers(headers);

  // 删除传输相关 headers，让 Response API 自动管理
  cleaned.delete("transfer-encoding"); // Bun 会根据 body 类型自动添加
  cleaned.delete("content-length"); // body 改变后长度无效，Response API 会重新计算

  return cleaned;
}

function ensurePricingResolutionSpecialSetting(
  session: ProxySession,
  resolvedPricing: Awaited<ReturnType<ProxySession["getResolvedPricingByBillingSource"]>>
): void {
  if (!resolvedPricing) return;

  const existing = session
    .getSpecialSettings()
    ?.find(
      (setting) =>
        setting.type === "pricing_resolution" &&
        setting.resolvedModelName === resolvedPricing.resolvedModelName &&
        setting.resolvedPricingProviderKey === resolvedPricing.resolvedPricingProviderKey &&
        setting.source === resolvedPricing.source
    );

  if (existing) return;

  session.addSpecialSetting({
    type: "pricing_resolution",
    scope: "billing",
    hit: true,
    modelName: session.getCurrentModel() ?? resolvedPricing.resolvedModelName,
    resolvedModelName: resolvedPricing.resolvedModelName,
    resolvedPricingProviderKey: resolvedPricing.resolvedPricingProviderKey,
    source: resolvedPricing.source,
  });
}

function getRequestedCodexServiceTier(
  session: ProxySession,
  provider?: Provider | null
): string | null {
  if ((provider ?? session.provider)?.providerType !== "codex") {
    return null;
  }

  const request = session.request.message as Record<string, unknown>;
  return typeof request.service_tier === "string" ? request.service_tier : null;
}

export function parseServiceTierFromResponseText(responseText: string): string | null {
  let lastSeenServiceTier: string | null = null;

  const applyValue = (value: unknown) => {
    if (typeof value === "string" && value.trim()) {
      lastSeenServiceTier = value.trim();
    }
  };

  try {
    const parsedValue = JSON.parse(responseText);
    if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
      const parsed = parsedValue as Record<string, unknown>;
      applyValue(parsed.service_tier);
      if (parsed.response && typeof parsed.response === "object") {
        applyValue((parsed.response as Record<string, unknown>).service_tier);
      }
    }
  } catch {
    // ignore, fallback to SSE parsing below
  }

  if (lastSeenServiceTier) {
    return lastSeenServiceTier;
  }

  if (isSSEText(responseText)) {
    const events = parseSSEData(responseText);
    for (const event of events) {
      if (!event.data || typeof event.data !== "object") continue;
      const data = event.data as Record<string, unknown>;
      applyValue(data.service_tier);
      if (data.response && typeof data.response === "object") {
        applyValue((data.response as Record<string, unknown>).service_tier);
      }
    }
  }

  return lastSeenServiceTier;
}

type CodexPriorityBillingDecision = {
  requestedServiceTier: string | null;
  actualServiceTier: string | null;
  billingSourcePreference: Awaited<ReturnType<ProxySession["getCodexPriorityBillingSource"]>>;
  resolvedFrom: "requested" | "actual" | null;
  effectivePriority: boolean;
};

async function resolveCodexPriorityBillingDecision(
  session: ProxySession,
  actualServiceTier: string | null,
  options?: {
    provider?: Provider | null;
    requestedServiceTier?: string | null;
  }
): Promise<CodexPriorityBillingDecision | null> {
  const provider = options?.provider ?? session.provider;
  if (provider?.providerType !== "codex") {
    return null;
  }

  const requestedServiceTier =
    options?.requestedServiceTier !== undefined
      ? options.requestedServiceTier
      : getRequestedCodexServiceTier(session, provider);
  let billingSourcePreference: Awaited<ReturnType<ProxySession["getCodexPriorityBillingSource"]>> =
    "requested";

  try {
    billingSourcePreference = await session.getCodexPriorityBillingSource();
  } catch (error) {
    logger.warn(
      "[ResponseHandler] Failed to load codex priority billing source, fallback to requested",
      {
        error: error instanceof Error ? error.message : String(error),
      }
    );
  }

  let resolvedFrom: "requested" | "actual" | null = null;
  let effectiveTier: string | null = null;

  if (billingSourcePreference === "actual") {
    if (actualServiceTier != null) {
      resolvedFrom = "actual";
      effectiveTier = actualServiceTier;
    } else if (requestedServiceTier != null) {
      resolvedFrom = "requested";
      effectiveTier = requestedServiceTier;
    }
  } else if (requestedServiceTier != null) {
    resolvedFrom = "requested";
    effectiveTier = requestedServiceTier;
  }

  return {
    requestedServiceTier,
    actualServiceTier,
    billingSourcePreference,
    resolvedFrom,
    effectivePriority: effectiveTier === "priority",
  };
}

function ensureCodexServiceTierResultSpecialSetting(
  session: ProxySession,
  decision: CodexPriorityBillingDecision | null
): void {
  if (!decision) {
    return;
  }

  const existing = session
    .getSpecialSettings()
    ?.find((setting) => setting.type === "codex_service_tier_result");

  if (existing && existing.type === "codex_service_tier_result") {
    return;
  }

  session.addSpecialSetting({
    type: "codex_service_tier_result",
    scope: "response",
    hit:
      decision.effectivePriority ||
      decision.requestedServiceTier != null ||
      decision.actualServiceTier != null,
    requestedServiceTier: decision.requestedServiceTier,
    actualServiceTier: decision.actualServiceTier,
    billingSourcePreference: decision.billingSourcePreference,
    resolvedFrom: decision.resolvedFrom,
    effectivePriority: decision.effectivePriority,
  });
}

function createLongContextPricingAudit(
  pricing: ResolvedLongContextPricing
): LongContextPricingSpecialSetting {
  return {
    type: "long_context_pricing",
    scope: "billing",
    hit: true,
    pricingScope: pricing.scope,
    thresholdTokens: pricing.thresholdTokens,
  };
}

function ensureLongContextPricingAudit(
  session: ProxySession,
  pricing: ResolvedLongContextPricing | null
): void {
  if (!pricing) {
    return;
  }

  const existing = session
    .getSpecialSettings()
    ?.find(
      (setting) =>
        setting.type === "long_context_pricing" &&
        setting.pricingScope === pricing.scope &&
        setting.thresholdTokens === pricing.thresholdTokens
    );

  if (!existing) {
    session.addSpecialSetting(createLongContextPricingAudit(pricing));
  }
}

function buildCostCalculationOptions(
  costMultiplier: number,
  context1mApplied: boolean,
  priorityServiceTierApplied: boolean,
  longContextPricing: ResolvedLongContextPricing | null,
  groupCostMultiplier: number = 1
): RequestCostCalculationOptions {
  return {
    multiplier: costMultiplier,
    groupMultiplier: groupCostMultiplier,
    context1mApplied,
    priorityServiceTierApplied,
    longContextPricing,
  };
}

function isNonBillingUsageEndpoint(session: ProxySession): boolean {
  return isNonBillingEndpoint(session.getEndpoint());
}

function hasBillableInputCostPerRequest(priceData: { input_cost_per_request?: unknown }): boolean {
  const inputCostPerRequest = priceData.input_cost_per_request;
  return (
    typeof inputCostPerRequest === "number" &&
    Number.isFinite(inputCostPerRequest) &&
    inputCostPerRequest > 0
  );
}

function hasPositiveBillableTokens(usage: UsageMetrics | null): boolean {
  if (!usage) return false;
  const tokens =
    (usage.input_tokens ?? 0) +
    (usage.output_tokens ?? 0) +
    (usage.cache_creation_input_tokens ?? 0) +
    (usage.cache_creation_5m_input_tokens ?? 0) +
    (usage.cache_creation_1h_input_tokens ?? 0) +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.input_image_tokens ?? 0) +
    (usage.output_image_tokens ?? 0);
  return tokens > 0;
}

const FINISH_REASON_MARKER = /"finish_reason"\s*:\s*"[a-z_]+"/;
const GEMINI_FINISH_REASON_MARKER = /"finishReason"\s*:\s*"[A-Z_]+"/;

/**
 * 判断流式响应文本中是否存在“与格式匹配的终止完成标记”，用以区分
 * “上游已完整结束（仅客户端先断开）”与“流被客户端中断而截断”。
 *
 * 仅 usage>0 不足以证明完成：Anthropic 在首个 `message_start` 即带 usage、
 * Gemini 在中间事件即带 usageMetadata，截断流同样会出现正向 token。
 */
function hasStreamCompletionMarker(text: string): boolean {
  if (
    text.includes("response.completed") || // OpenAI Responses / Codex
    text.includes("message_stop") || // Anthropic Messages
    text.includes("[DONE]") // OpenAI Chat Completions
  ) {
    return true;
  }
  // OpenAI chat / Gemini：非空 finish reason 标记最终块。
  return FINISH_REASON_MARKER.test(text) || GEMINI_FINISH_REASON_MARKER.test(text);
}

export async function resolveBillableUsageMetricsForCost(
  session: ProxySession,
  provider: Provider | null,
  usageMetrics: UsageMetrics | null,
  statusCode: number,
  responseText?: string | null
): Promise<UsageMetrics | null> {
  if (isNonBillingUsageEndpoint(session)) {
    return null;
  }

  if (statusCode < 200 || statusCode >= 300) {
    // 默认行为：非 2xx 不计费，避免对失败/中断的请求重复扣费。
    // 当 billNonSuccessfulRequests 开关打开时，只要上游已回报正向 token 用量
    // (典型场景：499 客户端中断但上游已计算 token)，仍按 usage 计费。
    let allowBillingNonSuccess = false;
    try {
      const settings = await getCachedSystemSettings();
      allowBillingNonSuccess = settings.billNonSuccessfulRequests === true;
    } catch (error) {
      logger.warn(
        "[CostCalculation] Failed to read billNonSuccessfulRequests setting, defaulting to skip",
        { error: error instanceof Error ? error.message : String(error) }
      );
    }

    if (!allowBillingNonSuccess) {
      return null;
    }

    if (!hasPositiveBillableTokens(usageMetrics)) {
      return null;
    }

    logger.info("[CostCalculation] Billing non-2xx request per system setting", {
      statusCode,
      providerId: provider?.id,
      providerName: provider?.name,
      originalModel: session.getOriginalModel(),
      redirectedModel: session.getCurrentModel(),
    });

    return usageMetrics;
  }

  if (responseText !== undefined && responseText !== null) {
    const detected = detectUpstreamErrorFromSseOrJsonText(responseText, {
      maxJsonCharsForMessageCheck: 0,
    });
    if (detected.isError) {
      logger.warn("[CostCalculation] Skipping billing for fake-200 error payload", {
        code: detected.code,
        detail: detected.detail,
        originalModel: session.getOriginalModel(),
        redirectedModel: session.getCurrentModel(),
      });
      return null;
    }
  }

  if (usageMetrics) {
    return usageMetrics;
  }

  let resolvedPricing: Awaited<ReturnType<ProxySession["getResolvedPricingByBillingSource"]>>;
  try {
    resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
  } catch (error) {
    logger.error("[CostCalculation] Failed to resolve per-request pricing, skipping billing", {
      error: error instanceof Error ? error.message : String(error),
      originalModel: session.getOriginalModel(),
      redirectedModel: session.getCurrentModel(),
    });
    return null;
  }

  if (!resolvedPricing?.priceData || !hasBillableInputCostPerRequest(resolvedPricing.priceData)) {
    return null;
  }

  // 成功响应可能没有 token usage（例如 OpenAI Images），但本地价格表仍可配置按次价格。
  // 这里用显式零 token sentinel 只承载 input_cost_per_request，不新增按图、按 token 等语义。
  return { input_tokens: 0, output_tokens: 0 };
}

type FinalizeDeferredStreamingResult = {
  /**
   * “内部结算用”的状态码。
   *
   * 注意：这不会改变客户端实际收到的 HTTP 状态码（SSE 已经开始透传后无法回头改）。
   * 这里的目的仅是让内部统计/熔断/会话绑定把“假 200”按失败处理。
   */
  effectiveStatusCode: number;
  /**
   * 内部记录的错误原因（用于写入 DB/监控，帮助定位“假 200”问题）。
   */
  errorMessage: string | null;
  /**
   * 写入 DB 时用于归因的 providerId（优先使用 deferred meta 的 providerId）。
   *
   * 说明：对 SSE 来说，session.provider 可能在后续逻辑里被更新/覆盖；而 deferred meta 代表本次流真正对应的 provider。
   * 该字段用于保证 DB 的 providerId 与 providerChain/熔断归因一致。
   */
  providerIdForPersistence: number | null;
  /** 本次流是否为 hedge 竞速赢家（commitWinner 标记）。 */
  isHedgeWinner: boolean;
  /**
   * 本次请求是否开启了竞速输家计费。开启时赢家费用以“从 0 累加”方式写入，
   * 以便与异步累加的输家费用共存而互不覆盖。
   */
  billHedgeLosers: boolean;
  /**
   * clientAbortCompleteSuccess 门控解析出的 usage（U11：drain 路径避免对同一份
   * allContent 二次解析）。providerType 与调用方不一致时调用方需自行重新解析。
   */
  clientAbortGateUsage?: {
    usageMetrics: UsageMetrics | null;
    providerType: Provider["providerType"] | undefined;
  };
  /** Circuit and Session side effects, committed after durable terminal details. */
  commitSideEffects?: () => Promise<void>;
};

/**
 * 若本次 SSE 被标记为“延迟结算”，则在流结束后补齐成功/失败的最终判定。
 *
 * 触发条件
 * - Forwarder 收到 Response 且识别为 SSE 时，会在 session 上挂载 DeferredStreamingFinalization 元信息。
 * - ResponseHandler 在后台读取完整 SSE 内容后，调用本函数：
 *   - 如果内容看起来是上游错误 JSON（假 200），则：
 *     - 计入熔断器失败；
 *     - 不更新 session 智能绑定（避免把会话粘到坏 provider）；
 *     - 内部状态码改为“推断得到的 4xx/5xx”（未命中则回退 502），
 *       仅影响统计与后续重试选择，不影响本次客户端响应。
 *   - 如果流正常结束且未命中错误判定，则按成功结算并更新绑定/熔断/endpoint 成功率。
 *
 * @param streamEndedNormally - 必须是 reader 读到 done=true 的“自然结束”；超时/中断等异常结束由其它逻辑处理。
 * @param clientAborted - 标记是否为客户端主动中断（用于内部状态码映射，避免把中断记为 200 completed）
 * @param abortReason - 非自然结束时的原因码（用于内部记录/熔断归因；不会影响客户端响应）
 */
function finalizeDeferredStreamingFinalizationIfNeeded(
  session: ProxySession,
  allContent: string,
  upstreamStatusCode: number,
  streamEndedNormally: boolean,
  clientAborted: boolean,
  abortReason?: string
): FinalizeDeferredStreamingResult {
  const meta = consumeDeferredStreamingFinalization(session);
  const provider = session.provider;
  const providerIdForPersistence = meta?.providerId ?? provider?.id ?? null;
  const clearSessionBinding = async () => {
    if (!session.sessionId) return;
    await SessionManager.clearSessionProvider(session.sessionId, providerIdForPersistence);
  };

  const isHedgeWinner = meta?.isHedgeWinner === true;
  const billHedgeLosers = meta?.billHedgeLosers === true;

  // 仅在“上游 HTTP=200 且流自然结束”时做“假 200”检测：
  // - 非 200：HTTP 已经表明失败（无需额外启发式）
  // - 非自然结束：内容可能是部分流/截断，启发式会显著提高误判风险
  //
  // 此处返回 `{isError:false}` 仅表示“跳过检测”，最终仍会在下面按中断/超时视为失败结算。
  const shouldDetectFake200 = streamEndedNormally && upstreamStatusCode === 200;
  const detected = shouldDetectFake200
    ? detectUpstreamErrorFromSseOrJsonText(allContent)
    : ({ isError: false } as const);
  let clientAbortGateUsage: FinalizeDeferredStreamingResult["clientAbortGateUsage"];
  const clientAbortCompleteSuccess = (() => {
    if (!clientAborted || upstreamStatusCode < 200 || upstreamStatusCode >= 300) {
      return false;
    }

    const abortDetected = detectUpstreamErrorFromSseOrJsonText(allContent);
    if (abortDetected.isError) {
      return false;
    }

    // U01: positive usage alone is NOT proof the stream completed — Anthropic
    // emits usage in the FIRST `message_start` event and Gemini in intermediate
    // `usageMetadata`, so a stream truncated by the client abort still shows
    // tokens. Only reclassify as a success when a format-appropriate terminal
    // completion marker is present, proving the upstream finished before the
    // client stopped reading. Otherwise keep the pre-PR safe default (499,
    // unbilled).
    if (!hasStreamCompletionMarker(allContent)) {
      return false;
    }

    const { usageMetrics } = parseUsageFromResponseText(allContent, provider?.providerType);
    clientAbortGateUsage = { usageMetrics, providerType: provider?.providerType };
    return hasPositiveBillableTokens(usageMetrics);
  })();

  // “内部结算用”的状态码（不会改变客户端实际 HTTP 状态码）。
  // - 假 200：优先映射为“推断得到的 4xx/5xx”（未命中则回退 502），确保内部统计/熔断/会话绑定把它当作失败。
  // - 未自然结束：也应映射为失败（避免把中断/部分流误记为 200 completed）。
  let effectiveStatusCode: number;
  let errorMessage: string | null;
  let statusCodeInferred = false;
  let statusCodeInferenceMatcherId: string | undefined;
  if (detected.isError) {
    const inferred = inferUpstreamErrorStatusCodeFromText(allContent);
    if (inferred) {
      effectiveStatusCode = inferred.statusCode;
      statusCodeInferred = true;
      statusCodeInferenceMatcherId = inferred.matcherId;
    } else {
      effectiveStatusCode = 502;
    }
    errorMessage = detected.detail ? `${detected.code}: ${detected.detail}` : detected.code;
  } else if (clientAbortCompleteSuccess) {
    effectiveStatusCode = upstreamStatusCode;
    errorMessage = null;
  } else if (streamEndedNormally && upstreamStatusCode >= 400) {
    effectiveStatusCode = upstreamStatusCode;
    const upstreamError = detectUpstreamErrorFromSseOrJsonText(allContent);
    errorMessage = upstreamError.isError ? upstreamError.code : `HTTP ${upstreamStatusCode}`;
  } else if (clientAborted) {
    effectiveStatusCode = 499;
    errorMessage = "CLIENT_ABORTED";
  } else if (!streamEndedNormally) {
    effectiveStatusCode = 502;
    errorMessage = abortReason ?? "STREAM_ABORTED";
  } else {
    // streamEndedNormally=true
    effectiveStatusCode = upstreamStatusCode;

    if (upstreamStatusCode >= 400) {
      // 非200错误状态码：解析JSON错误响应
      const detected = detectUpstreamErrorFromSseOrJsonText(allContent);
      errorMessage = detected.isError ? detected.code : `HTTP ${upstreamStatusCode}`;
    } else {
      // 2xx 成功状态码
      errorMessage = null;
    }
  }

  const shouldClearSessionBindingOnFailure =
    ((clientAborted || !streamEndedNormally) && !clientAbortCompleteSuccess) ||
    detected.isError ||
    (upstreamStatusCode >= 400 && errorMessage !== null);

  // 未启用延迟结算 / provider 缺失：
  // - 只返回“内部状态码 + 错误原因”，由调用方写入统计；
  // - 不在这里更新熔断/绑定（meta 缺失意味着 Forwarder 没有启用延迟结算；provider 缺失意味着无法归因）。
  if (!meta || !provider) {
    return {
      effectiveStatusCode,
      errorMessage,
      providerIdForPersistence,
      isHedgeWinner,
      billHedgeLosers,
      clientAbortGateUsage,
      commitSideEffects: shouldClearSessionBindingOnFailure ? clearSessionBinding : undefined,
    };
  }

  // meta 由 Forwarder 在“拿到 upstream Response 的那一刻”记录，代表真正产生本次流的 provider。
  // 即使 session.provider 在之后被其它逻辑意外修改（极端情况），我们仍以 meta 为准更新：
  // - provider/endpoint 熔断与统计
  // - session 智能绑定
  // 这样能避免把成功/失败记到错误的 provider 上。
  let providerForChain = provider;
  if (provider.id !== meta.providerId) {
    logger.warn("[ResponseHandler] Deferred streaming meta provider mismatch", {
      sessionId: session.sessionId ?? null,
      metaProviderId: meta.providerId,
      currentProviderId: provider.id,
      canonicalProviderId: meta.providerId,
    });

    // The deferred metadata is the canonical attempt identity. Build the audit
    // entry synchronously so Provider snapshot I/O cannot block durable outcome
    // persistence or retain the response body beyond the finalization deadline.
    providerForChain = {
      ...provider,
      id: meta.providerId,
      name: meta.providerName,
    };
  }

  // 未自然结束：不更新 session 绑定（避免把会话粘到不稳定 provider），但要避免把它误记为 200 completed。
  //
  // 同时，为了让故障转移/熔断能正确工作：
  // - 客户端主动中断：不计入熔断器（这通常不是供应商问题）
  // - 非客户端中断：计入 provider/endpoint 熔断失败（与 timeout 路径保持一致）
  if ((clientAborted || !streamEndedNormally) && !clientAbortCompleteSuccess) {
    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: "system_error",
      attemptNumber: meta.attemptNumber,
      statusCode: effectiveStatusCode,
      errorMessage: errorMessage ?? undefined,
    });

    const commitSideEffects = async () => {
      await clearSessionBinding();

      if (!clientAborted && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
        try {
          const { recordFailure } = await import("@/lib/circuit-breaker");
          await recordFailure(meta.providerId, new Error(errorMessage ?? "STREAM_ABORTED"));
        } catch (cbError) {
          logger.warn("[ResponseHandler] Failed to record streaming failure in circuit breaker", {
            providerId: meta.providerId,
            sessionId: session.sessionId ?? null,
            error: cbError,
          });
        }

        // Stream aborts are key-level errors. The endpoint delivered HTTP 200,
        // so only the Provider circuit is updated here.
      }
    };

    return {
      effectiveStatusCode,
      errorMessage,
      providerIdForPersistence,
      isHedgeWinner,
      billHedgeLosers,
      clientAbortGateUsage,
      commitSideEffects,
    };
  }

  if (detected.isError) {
    logger.warn("[ResponseHandler] SSE completed but body indicates error (fake 200)", {
      providerId: meta.providerId,
      providerName: meta.providerName,
      upstreamStatusCode: meta.upstreamStatusCode,
      effectiveStatusCode,
      statusCodeInferred,
      statusCodeInferenceMatcherId: statusCodeInferenceMatcherId ?? null,
      code: detected.code,
      detail: detected.detail ?? null,
    });

    const chainReason = effectiveStatusCode === 404 ? "resource_not_found" : "retry_failed";

    // NOTE: Do NOT call recordEndpointFailure here. Fake-200 errors are key-level
    // issues (invalid key, auth failure). The endpoint returned HTTP 200 successfully;
    // the error is in the response content, not endpoint connectivity.

    // 记录到决策链（用于日志展示与 DB 持久化）。
    // 注意：这里用 effectiveStatusCode（推断得到的 4xx/5xx，或回退 502）
    // 而不是 upstreamStatusCode（200），以便让内部链路明确显示这是一次失败
    // （否则会被误读为成功）。
    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: chainReason,
      attemptNumber: meta.attemptNumber,
      statusCode: effectiveStatusCode,
      statusCodeInferred,
      errorMessage: detected.detail ? `${detected.code}: ${detected.detail}` : detected.code,
    });

    const commitSideEffects = async () => {
      await clearSessionBinding();

      // 404 is RESOURCE_NOT_FOUND and must not penalize the Provider circuit.
      if (
        effectiveStatusCode !== 404 &&
        session.getEndpointPolicy().allowCircuitBreakerAccounting
      ) {
        try {
          const { recordFailure } = await import("@/lib/circuit-breaker");
          await recordFailure(meta.providerId, new Error(detected.code));
        } catch (cbError) {
          logger.warn("[ResponseHandler] Failed to record fake-200 error in circuit breaker", {
            providerId: meta.providerId,
            sessionId: session.sessionId ?? null,
            error: cbError,
          });
        }
      }
    };

    return {
      effectiveStatusCode,
      errorMessage,
      providerIdForPersistence,
      isHedgeWinner,
      billHedgeLosers,
      clientAbortGateUsage,
      commitSideEffects,
    };
  }

  // ========== 非200状态码处理（流自然结束但HTTP状态码表示错误）==========
  if (upstreamStatusCode >= 400 && errorMessage !== null) {
    logger.warn("[ResponseHandler] SSE completed but HTTP status indicates error", {
      providerId: meta.providerId,
      providerName: meta.providerName,
      upstreamStatusCode,
      effectiveStatusCode,
      errorMessage,
    });

    const chainReason = effectiveStatusCode === 404 ? "resource_not_found" : "retry_failed";

    // NOTE: Do NOT call recordEndpointFailure here. Non-200 HTTP errors (401, 429,
    // etc.) are typically key/auth-level errors. The endpoint was reachable and
    // responded; only forwarder-level failures should penalize the endpoint breaker.

    // 记录到决策链
    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: chainReason,
      attemptNumber: meta.attemptNumber,
      statusCode: effectiveStatusCode,
      errorMessage: errorMessage,
    });

    const commitSideEffects = async () => {
      await clearSessionBinding();

      if (
        effectiveStatusCode !== 404 &&
        session.getEndpointPolicy().allowCircuitBreakerAccounting
      ) {
        try {
          const { recordFailure } = await import("@/lib/circuit-breaker");
          await recordFailure(meta.providerId, new Error(errorMessage));
        } catch (cbError) {
          logger.warn("[ResponseHandler] Failed to record non-200 error in circuit breaker", {
            providerId: meta.providerId,
            sessionId: session.sessionId ?? null,
            error: cbError,
          });
        }
      }
    };

    return {
      effectiveStatusCode,
      errorMessage,
      providerIdForPersistence,
      isHedgeWinner,
      billHedgeLosers,
      clientAbortGateUsage,
      commitSideEffects,
    };
  }

  // ========== 真正成功（SSE 完整结束且未命中错误判定）==========
  // Build the durable audit chain before persistence, but defer external
  // circuit/Session mutations until billing and terminal details are committed.
  // A slow Redis binding must not turn an already completed, billable request
  // into a fallback 500 or prevent lease settlement.
  if (!meta.isHedgeWinner) {
    session.addProviderToChain(providerForChain, {
      endpointId: meta.endpointId,
      endpointUrl: meta.endpointUrl,
      reason: meta.isFirstAttempt ? "request_success" : "retry_success",
      attemptNumber: meta.attemptNumber,
      statusCode: meta.upstreamStatusCode,
    });
  }

  const commitSideEffects = async () => {
    if (meta.endpointId != null) {
      try {
        const { recordEndpointSuccess } = await import("@/lib/endpoint-circuit-breaker");
        await recordEndpointSuccess(meta.endpointId);
      } catch (endpointError) {
        logger.warn("[ResponseHandler] Failed to record endpoint success (stream finalized)", {
          endpointId: meta.endpointId,
          providerId: meta.providerId,
          error: endpointError,
        });
      }
    }

    try {
      const { recordSuccess } = await import("@/lib/circuit-breaker");
      await recordSuccess(meta.providerId);
    } catch (cbError) {
      logger.warn("[ResponseHandler] Failed to record streaming success in circuit breaker", {
        providerId: meta.providerId,
        error: cbError,
      });
    }

    // Hedge winner: commitWinner() already performed session binding and chain logging.
    if (!meta.isHedgeWinner && session.sessionId) {
      const result = await SessionManager.updateSessionBindingSmart(
        session.sessionId,
        meta.providerId,
        meta.providerPriority,
        meta.isFirstAttempt,
        meta.isFailoverSuccess,
        session.authState?.key?.id ?? session.messageContext?.key?.id ?? null
      );

      if (result.updated) {
        logger.info("[ResponseHandler] Session binding updated (stream finalized)", {
          sessionId: session.sessionId,
          providerId: meta.providerId,
          providerName: meta.providerName,
          priority: meta.providerPriority,
          reason: result.reason,
          details: result.details,
          attemptNumber: meta.attemptNumber,
          totalProvidersAttempted: meta.totalProvidersAttempted,
        });
      } else {
        logger.debug("[ResponseHandler] Session binding not updated (stream finalized)", {
          sessionId: session.sessionId,
          providerId: meta.providerId,
          providerName: meta.providerName,
          priority: meta.providerPriority,
          reason: result.reason,
          details: result.details,
        });
      }

      if (session.shouldTrackSessionObservability()) {
        void SessionManager.updateSessionProvider(session.sessionId, {
          providerId: meta.providerId,
          providerName: meta.providerName,
        }).catch((err) => {
          logger.error(
            "[ResponseHandler] Failed to update session provider info (stream finalized)",
            { error: err }
          );
        });
      }
    }

    logger.info("[ResponseHandler] Streaming request finalized as success", {
      providerId: meta.providerId,
      providerName: meta.providerName,
      attemptNumber: meta.attemptNumber,
      totalProvidersAttempted: meta.totalProvidersAttempted,
      statusCode: meta.upstreamStatusCode,
    });
  };

  return {
    effectiveStatusCode,
    errorMessage,
    providerIdForPersistence,
    isHedgeWinner,
    billHedgeLosers,
    clientAbortGateUsage,
    commitSideEffects,
  };
}

export class ProxyResponseHandler {
  static async dispatch(session: ProxySession, response: Response): Promise<Response> {
    const snapshotSession = session as ProxySession & {
      detailSnapshotResponseBeforeSource?: Response | null;
    };
    const isStreamingResponse = response.headers.get("content-type")?.includes("text/event-stream");
    if (!isStreamingResponse && session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
      snapshotSession.detailSnapshotResponseBeforeSource = response.clone();
    }

    let fixedResponse = response;
    if (!session.getEndpointPolicy().bypassResponseRectifier) {
      try {
        // raw passthrough 端点跳过 ResponseFixer，也跳过其中的 Responses 输出归一化。
        fixedResponse = await ResponseFixer.process(session, response);
      } catch (error) {
        logger.error(
          "[ResponseHandler] ResponseFixer failed (getCachedSystemSettings/processNonStream)",
          {
            error: error instanceof Error ? error.message : String(error),
            sessionId: session.sessionId ?? null,
            messageRequestId: session.messageContext?.id ?? null,
            requestSequence: session.requestSequence ?? null,
          }
        );
        fixedResponse = response;
      }
    }

    const contentType = fixedResponse.headers.get("content-type") || "";
    const isSSE = contentType.includes("text/event-stream");

    if (!isSSE) {
      return await ProxyResponseHandler.handleNonStream(session, fixedResponse);
    }

    return await ProxyResponseHandler.handleStream(session, fixedResponse);
  }

  private static async handleNonStream(
    session: ProxySession,
    response: Response
  ): Promise<Response> {
    // F2：stream 请求被上游以非流响应回答时不做 replay，立即让出 owner 租约
    releaseReplayOwnership(session);
    const messageContext = session.messageContext;
    const provider = session.provider;
    if (!provider) {
      discardBeforeResponseBodySnapshot(session);
      releaseSessionAgent(session);
      return response;
    }

    const responseForLog = response.clone();
    const statusCode = response.status;

    let finalResponse = response;
    let finalResponseBodyForSnapshot: string | null = null;
    const persistNonStreamAfterSnapshot = (targetResponse: Response, body: string) => {
      if (!session.sessionId || !session.shouldPersistSessionDebugArtifacts()) {
        return;
      }

      const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
        session.sessionId,
        "after",
        {
          body,
          headers: targetResponse.headers,
          meta: {
            upstreamUrl: null,
            statusCode: targetResponse.status,
          },
        },
        session.requestSequence
      );
      responseAfterSnapshotTask?.catch((err) => {
        logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
      });
    };

    // --- GEMINI HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 判断是否需要透传（客户端和提供商格式都必须是 Gemini）
      const isGeminiPassthrough =
        (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") &&
        (provider.providerType === "gemini" || provider.providerType === "gemini-cli");

      if (isGeminiPassthrough) {
        logger.debug(
          "[ResponseHandler] Gemini non-stream passthrough (clone for stats, return original)",
          {
            originalFormat: session.originalFormat,
            providerType: provider.providerType,
            model: session.request.model,
            statusCode: response.status,
            reason: "Client receives untouched response, stats read from clone",
          }
        );

        const responseForStats = response.clone();
        const statusCode = response.status;

        const taskId = `non-stream-passthrough-${messageContext?.id || `unknown-${Date.now()}`}`;
        const statsAbortController = new AbortController();
        const cleanupTaskAbortBinding = bindTaskAbortToUpstreamResponse(
          session,
          statsAbortController,
          taskId
        );
        const runStatsTask = async () => {
          try {
            const responseText = await readResponseTextWithTaskActivity(responseForStats, taskId);

            const sessionWithCleanup = session as typeof session & {
              clearResponseTimeout?: () => void;
            };
            if (sessionWithCleanup.clearResponseTimeout) {
              sessionWithCleanup.clearResponseTimeout();
            }

            // 存储响应体到 Redis（5分钟过期）
            if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
              const beforeBody = (await consumeBeforeResponseBodySnapshot(session)) ?? responseText;
              void SessionManager.storeSessionResponse(
                session.sessionId,
                responseText,
                session.requestSequence
              ).catch((err) => {
                logger.error("[ResponseHandler] Failed to store response:", err);
              });

              const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "before",
                { body: beforeBody },
                session.requestSequence
              );
              responseBeforeSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
              });

              const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "after",
                { body: responseText },
                session.requestSequence
              );
              responseAfterSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
              });
            }

            // 非200状态码处理：解析错误响应并计入熔断器
            let errorMessageForFinalize: string | undefined;
            let commitProviderFailure: (() => Promise<void>) | undefined;
            if (statusCode >= 400) {
              const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
              errorMessageForFinalize = detected.isError ? detected.code : `HTTP ${statusCode}`;
              const isResourceNotFound = statusCode === 404;

              if (
                !isResourceNotFound &&
                session.getEndpointPolicy().allowCircuitBreakerAccounting
              ) {
                commitProviderFailure = async () => {
                  try {
                    const { recordFailure } = await import("@/lib/circuit-breaker");
                    await recordFailure(provider.id, new Error(errorMessageForFinalize));
                  } catch (cbError) {
                    logger.warn(
                      "ResponseHandler: Failed to record non-200 error in circuit breaker (passthrough)",
                      {
                        providerId: provider.id,
                        error: cbError,
                      }
                    );
                  }
                };
              }

              // 记录到决策链
              session.addProviderToChain(provider, {
                reason: isResourceNotFound ? "resource_not_found" : "retry_failed",
                attemptNumber: 1,
                statusCode: statusCode,
                errorMessage: errorMessageForFinalize,
              });
            }

            // 使用共享的统计处理方法
            const duration = Date.now() - session.startTime;
            let providerFailureScheduled = false;
            const scheduleProviderFailure = () => {
              if (!commitProviderFailure || providerFailureScheduled) return;
              providerFailureScheduled = true;
              return schedulePostTerminalSideEffects({
                taskId,
                providerId: provider.id,
                sessionId: session.sessionId,
                commit: async (signal) => {
                  if (signal.aborted) return;
                  await commitProviderFailure();
                },
              });
            };
            const finalizedUsage = await finalizeRequestStats(
              session,
              responseText,
              statusCode,
              duration,
              errorMessageForFinalize,
              undefined,
              false, // Gemini 非流式透传
              scheduleProviderFailure
            );
            emitProxyLangfuseTrace(session, {
              responseHeaders: response.headers,
              responseText,
              usageMetrics: finalizedUsage,
              costUsd: undefined,
              statusCode,
              durationMs: duration,
              isStreaming: false,
              errorMessage: errorMessageForFinalize,
            });
          } catch (error) {
            if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
              await discardBeforeResponseBodySnapshot(session);
            }
            const clientAborted = isClientAbortError(error as Error);
            if (!clientAborted) {
              logger.error(
                "[ResponseHandler] Gemini non-stream passthrough stats task failed:",
                error
              );
            }

            let finalizedStatusCode = statusCode >= 400 ? statusCode : 502;
            if (clientAborted) {
              finalizedStatusCode = 499;
            }
            const isResourceNotFound = finalizedStatusCode === 404;
            const errorDetails = buildProcessingErrorDetails(error);
            if (!clientAborted) {
              session.addProviderToChain(provider, {
                reason: isResourceNotFound ? "resource_not_found" : "retry_failed",
                attemptNumber: 1,
                statusCode: finalizedStatusCode,
                errorMessage: errorDetails.errorMessage,
              });
            }

            const postTerminalSideEffects: Array<() => Promise<void>> = [];
            if (session.sessionId) {
              const sessionId = session.sessionId;
              postTerminalSideEffects.push(async () => {
                await SessionManager.clearSessionProvider(sessionId, provider.id);
              });
            }
            if (
              !clientAborted &&
              !isResourceNotFound &&
              session.getEndpointPolicy().allowCircuitBreakerAccounting
            ) {
              postTerminalSideEffects.push(async () => {
                try {
                  const { recordFailure } = await import("@/lib/circuit-breaker");
                  await recordFailure(provider.id, error as Error);
                } catch (cbError) {
                  logger.warn(
                    "ResponseHandler: Failed to record Gemini non-stream body failure in circuit breaker",
                    {
                      providerId: provider.id,
                      error: cbError,
                    }
                  );
                }
              });
            }
            let postTerminalSideEffectsScheduled = false;
            const scheduleCommittedSideEffects = () => {
              if (postTerminalSideEffects.length === 0 || postTerminalSideEffectsScheduled) return;
              postTerminalSideEffectsScheduled = true;
              return schedulePostTerminalSideEffects({
                taskId,
                providerId: provider.id,
                sessionId: session.sessionId,
                commit: (signal) => runPostTerminalSideEffects(postTerminalSideEffects, signal),
              });
            };

            if (messageContext) {
              const duration = Date.now() - session.startTime;
              const tracker = ProxyStatusTracker.getInstance();
              try {
                await persistNonStreamTerminalDetails({
                  taskId,
                  messageRequestId: messageContext.id,
                  durationMs: duration,
                  details: {
                    statusCode: finalizedStatusCode,
                    ...errorDetails,
                    ttfbMs: session.ttfbMs ?? duration,
                    providerChain: session.getProviderChain(),
                    model: session.getCurrentModel() ?? undefined,
                    providerId: session.provider?.id,
                    context1mApplied: session.getContext1mApplied(),
                    swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
                    specialSettings: session.getSpecialSettings() ?? undefined,
                  },
                  onCommitted: scheduleCommittedSideEffects,
                });
              } finally {
                tracker.endRequest(messageContext.user.id, messageContext.id);
              }
            }
          } finally {
            cleanupTaskAbortBinding();
            releaseSessionAgent(session);
          }
        };

        AsyncTaskManager.register(
          taskId,
          () => {
            const statsPromise = runStatsTask();
            statsPromise.catch((error) => {
              if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
                void discardBeforeResponseBodySnapshot(session);
              }
              logger.error(
                "[ResponseHandler] Gemini non-stream passthrough stats task uncaught error:",
                error
              );
            });
            return statsPromise;
          },
          {
            taskType: "non-stream-passthrough-stats",
            abortController: statsAbortController,
            staleTimeoutMs: resolveNonStreamTaskStaleTimeoutMs(provider),
          }
        );

        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const responseAfterMetaTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "after",
            {
              headers: response.headers,
              meta: {
                upstreamUrl: null,
                statusCode: response.status,
              },
            },
            session.requestSequence
          );
          responseAfterMetaTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store non-stream response after meta:", err);
          });
        }

        return response;
      } else {
        // ❌ 需要转换：客户端不是 Gemini 格式（如 OpenAI/Claude）
        try {
          const responseForTransform = response.clone();
          const responseText = await responseForTransform.text();
          const responseData = JSON.parse(responseText) as GeminiResponse;

          const transformed = GeminiAdapter.transformResponse(responseData, false);
          const transformedBody = JSON.stringify(transformed);

          logger.debug(
            "[ResponseHandler] Transformed Gemini non-stream response to client format",
            {
              originalFormat: session.originalFormat,
              providerType: provider.providerType,
              model: session.request.model,
            }
          );

          // ⭐ 清理传输 headers（body 已从流转为 JSON 字符串）
          finalResponseBodyForSnapshot = transformedBody;
          finalResponse = new Response(transformedBody, {
            status: response.status,
            statusText: response.statusText,
            headers: cleanResponseHeaders(response.headers),
          });
        } catch (error) {
          logger.error("[ResponseHandler] Failed to transform Gemini non-stream response:", error);
          finalResponse = response;
          finalResponseBodyForSnapshot = null;
        }
      }
    }

    // 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `non-stream-${messageContext?.id || `unknown-${Date.now()}`}`;
    const abortController = new AbortController();
    const cleanupTaskAbortBinding = bindTaskAbortToUpstreamResponse(
      session,
      abortController,
      taskId
    );
    const cleanupClientAbortListener = bindClientAbortListener(session.clientAbortSignal, () => {
      AsyncTaskManager.cancel(taskId);
      abortController.abort();
    });

    const runProcessingTask = async () => {
      const finalizeNonStreamAbort = async (
        options: {
          statusCode?: number;
          error?: unknown;
          postTerminalSideEffects?: Array<() => Promise<void>>;
        } = {}
      ): Promise<void> => {
        const finalizedStatusCode =
          options.statusCode ?? (session.clientAbortSignal?.aborted ? 499 : statusCode);
        const errorDetails =
          options.error === undefined ? undefined : buildProcessingErrorDetails(options.error);
        const postTerminalSideEffects = [...(options.postTerminalSideEffects ?? [])];
        if (session.sessionId) {
          const sessionId = session.sessionId;
          postTerminalSideEffects.push(async () => {
            await SessionManager.clearSessionProvider(sessionId, provider.id);

            const sessionUsagePayload: SessionUsageUpdate = {
              status:
                finalizedStatusCode >= 200 && finalizedStatusCode < 300 ? "completed" : "error",
              statusCode: finalizedStatusCode,
              ...(errorDetails?.errorMessage
                ? { errorMessage: errorDetails.errorMessage }
                : undefined),
            };

            if (session.shouldTrackSessionObservability()) {
              try {
                await SessionManager.updateSessionUsage(sessionId, sessionUsagePayload);
              } catch (error) {
                logger.error("[ResponseHandler] Failed to update session usage:", error);
              }
            }
          });
        }
        let postTerminalSideEffectsScheduled = false;
        const scheduleCommittedSideEffects = () => {
          if (postTerminalSideEffects.length === 0 || postTerminalSideEffectsScheduled) return;
          postTerminalSideEffectsScheduled = true;
          return schedulePostTerminalSideEffects({
            taskId,
            providerId: provider.id,
            sessionId: session.sessionId,
            commit: (signal) => runPostTerminalSideEffects(postTerminalSideEffects, signal),
          });
        };
        if (messageContext) {
          const duration = Date.now() - session.startTime;
          const terminalDetails: MessageRequestTerminalDetails = {
            statusCode: finalizedStatusCode,
            ...errorDetails,
            ttfbMs: session.ttfbMs ?? duration,
            providerChain: session.getProviderChain(),
            model: session.getCurrentModel() ?? undefined, // 更新重定向后的模型
            providerId: session.provider?.id, // 更新最终供应商ID（重试切换后）
            context1mApplied: session.getContext1mApplied(),
            swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
          };
          const tracker = ProxyStatusTracker.getInstance();
          try {
            await persistNonStreamTerminalDetails({
              taskId,
              messageRequestId: messageContext.id,
              durationMs: duration,
              details: terminalDetails,
              onCommitted: scheduleCommittedSideEffects,
            });
          } finally {
            tracker.endRequest(messageContext.user.id, messageContext.id);
          }
        }
      };

      try {
        // 检查客户端是否断开
        if (session.clientAbortSignal?.aborted || abortController.signal.aborted) {
          logger.info("ResponseHandler: Non-stream task cancelled (client disconnected)", {
            taskId,
            providerId: provider.id,
          });
          try {
            await finalizeNonStreamAbort();
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
              taskId,
              providerId: provider.id,
              finalizeError,
            });
            if (isNonStreamTerminalPersistenceError(finalizeError)) {
              throw finalizeError;
            }
          }
          return;
        }

        // ⭐ 非流式：读取完整响应体（会等待所有数据下载完成）
        const responseText = await readResponseTextWithTaskActivity(responseForLog, taskId);

        // ⭐ 响应体读取完成：清除响应超时定时器
        const sessionWithCleanup = session as typeof session & {
          clearResponseTimeout?: () => void;
        };
        if (sessionWithCleanup.clearResponseTimeout) {
          sessionWithCleanup.clearResponseTimeout();
        }
        let usageMetrics: UsageMetrics | null = null;
        const postTerminalSideEffects: Array<() => Promise<void>> = [];

        const usageResult = parseUsageFromResponseText(responseText, provider.providerType);
        usageMetrics = usageResult.usageMetrics;
        const actualServiceTier = parseServiceTierFromResponseText(responseText);
        const codexPriorityBillingDecision = await resolveCodexPriorityBillingDecision(
          session,
          actualServiceTier
        );
        if (!isNonBillingUsageEndpoint(session)) {
          ensureCodexServiceTierResultSpecialSetting(session, codexPriorityBillingDecision);
        }
        const priorityServiceTierApplied = codexPriorityBillingDecision?.effectivePriority ?? false;

        if (usageMetrics) {
          usageMetrics = normalizeUsageWithSwap(
            usageMetrics,
            session,
            provider.swapCacheTtlBilling
          );
        }

        // 关键：必须在 normalizeUsageWithSwap 之后再快照 billable 视图，
        // 否则 updateRequestCostFromUsage / trackCostToRedis 会用未归一化的旧值，
        // 导致缓存 TTL swap、bucket 归一化等场景下的账单与限流统计错位。
        const billableUsageMetrics = await resolveBillableUsageMetricsForCost(
          session,
          provider,
          usageMetrics,
          statusCode,
          responseText
        );

        if (billableUsageMetrics) {
          maybeSetCodexContext1m(session, provider, billableUsageMetrics.input_tokens);
        }

        // Codex: Extract prompt_cache_key and update session binding
        if (
          provider.providerType === "codex" &&
          statusCode >= 200 &&
          statusCode < 300 &&
          session.sessionId &&
          provider.id
        ) {
          try {
            const responseData = JSON.parse(responseText) as Record<string, unknown>;
            const promptCacheKey = SessionManager.extractCodexPromptCacheKey(responseData);
            if (promptCacheKey) {
              const sessionId = session.sessionId;
              const keyId = session.authState?.key?.id ?? session.messageContext?.key?.id ?? null;
              postTerminalSideEffects.push(async () => {
                try {
                  await SessionManager.updateSessionWithCodexCacheKey(
                    sessionId,
                    promptCacheKey,
                    provider.id,
                    keyId
                  );
                } catch (err) {
                  logger.error("[ResponseHandler] Failed to update Codex session:", err);
                }
              });
            }
          } catch (parseError) {
            logger.trace("[ResponseHandler] Failed to parse JSON for Codex session:", parseError);
          }
        }

        // 存储响应体到 Redis（5分钟过期）
        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const beforeBody = (await consumeBeforeResponseBodySnapshot(session)) ?? responseText;
          void SessionManager.storeSessionResponse(
            session.sessionId,
            responseText,
            session.requestSequence
          ).catch((err) => {
            logger.error("[ResponseHandler] Failed to store response:", err);
          });

          const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "before",
            { body: beforeBody },
            session.requestSequence
          );
          responseBeforeSnapshotTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
          });

          // after 快照复用本任务已经读取到的响应文本，避免再启动一个未受
          // AsyncTaskManager 管理的 clone().text() 读取分支。
          persistNonStreamAfterSnapshot(
            finalResponse,
            finalResponseBodyForSnapshot ?? responseText
          );
        }

        if (billableUsageMetrics && messageContext) {
          const billing = sessionBillingInputs(session, provider, priorityServiceTierApplied);
          const costUpdateResult = await updateRequestCostFromUsage(
            messageContext.id,
            session,
            billableUsageMetrics,
            billing
          );
          if (costUpdateResult.longContextPricingApplied) {
            ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
          }

          // 追踪消费到 Redis（用于限流）
          await trackCostToRedis(session, billableUsageMetrics, billing, {
            resolvedPricing: costUpdateResult.resolvedPricing,
            longContextPricing: costUpdateResult.longContextPricing,
          });
        }

        // Calculate cost for session tracking (with multiplier) and Langfuse (raw)
        let costUsdStr: string | undefined;
        let rawCostUsdStr: string | undefined;
        let costBreakdown: CostBreakdown | undefined;
        if (billableUsageMetrics) {
          try {
            if (session.request.model) {
              const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
              if (resolvedPricing) {
                ensurePricingResolutionSpecialSetting(session, resolvedPricing);
                const longContextPricing =
                  matchLongContextPricing(billableUsageMetrics, resolvedPricing.priceData)
                    ?.pricing ?? null;
                const cost = calculateRequestCost(
                  billableUsageMetrics,
                  resolvedPricing.priceData,
                  buildCostCalculationOptions(
                    provider.costMultiplier,
                    session.getContext1mApplied(),
                    priorityServiceTierApplied,
                    longContextPricing,
                    session.getGroupCostMultiplier()
                  )
                );
                if (cost.gt(0)) {
                  costUsdStr = cost.toString();
                }
                // Raw cost without multiplier for Langfuse
                if (provider.costMultiplier !== 1 || session.getGroupCostMultiplier() !== 1) {
                  const rawCost = calculateRequestCost(
                    billableUsageMetrics,
                    resolvedPricing.priceData,
                    buildCostCalculationOptions(
                      1.0,
                      session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing
                    )
                  );
                  if (rawCost.gt(0)) {
                    rawCostUsdStr = rawCost.toString();
                  }
                } else {
                  rawCostUsdStr = costUsdStr;
                }
                // Cost breakdown for Langfuse (raw, no multiplier)
                try {
                  costBreakdown = calculateRequestCostBreakdown(
                    billableUsageMetrics,
                    resolvedPricing.priceData,
                    {
                      context1mApplied: session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing,
                    }
                  );
                } catch {
                  /* non-critical */
                }
              }
            }
          } catch (error) {
            logger.error("[ResponseHandler] Failed to calculate session cost, skipping", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // 更新 session 使用量到 Redis（用于实时监控）
        if (
          session.sessionId &&
          (usageMetrics || costUsdStr !== undefined) &&
          session.shouldTrackSessionObservability()
        ) {
          void SessionManager.updateSessionUsage(session.sessionId, {
            inputTokens: usageMetrics?.input_tokens,
            outputTokens: usageMetrics?.output_tokens,
            cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
            cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
            costUsd: costUsdStr,
            status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
            statusCode: statusCode,
          }).catch((error: unknown) => {
            logger.error("[ResponseHandler] Failed to update session usage:", error);
          });
        }

        // 非200状态码处理：先构造审计链，durable details 后再更新熔断器。
        let terminalErrorMessage: string | undefined;
        if (statusCode >= 400) {
          const detected = detectUpstreamErrorFromSseOrJsonText(responseText);
          const errorMessageForDb = detected.isError ? detected.code : `HTTP ${statusCode}`;
          terminalErrorMessage = errorMessageForDb;
          const isResourceNotFound = statusCode === 404;

          if (!isResourceNotFound && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
            postTerminalSideEffects.push(async () => {
              try {
                const { recordFailure } = await import("@/lib/circuit-breaker");
                await recordFailure(provider.id, new Error(errorMessageForDb));
              } catch (cbError) {
                logger.warn("ResponseHandler: Failed to record non-200 error in circuit breaker", {
                  providerId: provider.id,
                  error: cbError,
                });
              }
            });
          }

          // 记录到决策链
          session.addProviderToChain(provider, {
            reason: isResourceNotFound ? "resource_not_found" : "retry_failed",
            attemptNumber: 1,
            statusCode: statusCode,
            errorMessage: errorMessageForDb,
          });
        }

        let postTerminalSideEffectsScheduled = false;
        const scheduleCommittedSideEffects = () => {
          if (postTerminalSideEffects.length === 0 || postTerminalSideEffectsScheduled) return;
          postTerminalSideEffectsScheduled = true;
          return schedulePostTerminalSideEffects({
            taskId,
            providerId: provider.id,
            sessionId: session.sessionId,
            commit: (signal) => runPostTerminalSideEffects(postTerminalSideEffects, signal),
          });
        };

        if (messageContext) {
          const duration = Date.now() - session.startTime;
          const terminalDetails: MessageRequestTerminalDetails = {
            statusCode: statusCode,
            inputTokens: usageMetrics?.input_tokens,
            outputTokens: usageMetrics?.output_tokens,
            ttfbMs: session.ttfbMs ?? duration,
            cacheCreationInputTokens: usageMetrics?.cache_creation_input_tokens,
            cacheReadInputTokens: usageMetrics?.cache_read_input_tokens,
            cacheCreation5mInputTokens: usageMetrics?.cache_creation_5m_input_tokens,
            cacheCreation1hInputTokens: usageMetrics?.cache_creation_1h_input_tokens,
            cacheTtlApplied: usageMetrics?.cache_ttl ?? null,
            providerChain: session.getProviderChain(),
            ...(terminalErrorMessage ? { errorMessage: terminalErrorMessage } : {}),
            model: session.getCurrentModel() ?? undefined, // 更新重定向后的模型
            actualResponseModel: extractActualResponseModelForProvider(
              provider.providerType,
              false,
              responseText
            ),
            providerId: session.provider?.id, // 更新最终供应商ID（重试切换后）
            context1mApplied: session.getContext1mApplied(),
            swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
            specialSettings: session.getSpecialSettings() ?? undefined,
          };
          const tracker = ProxyStatusTracker.getInstance();
          try {
            await persistNonStreamTerminalDetails({
              taskId,
              messageRequestId: messageContext.id,
              durationMs: duration,
              details: terminalDetails,
              onCommitted: scheduleCommittedSideEffects,
            });
          } finally {
            tracker.endRequest(messageContext.user.id, messageContext.id);
          }
        }

        logger.debug("ResponseHandler: Non-stream response processed", {
          taskId,
          providerId: provider.id,
          providerName: provider.name,
          statusCode,
        });

        emitProxyLangfuseTrace(session, {
          responseHeaders: response.headers,
          responseText,
          usageMetrics,
          costUsd: rawCostUsdStr,
          costBreakdown,
          statusCode,
          durationMs: Date.now() - session.startTime,
          isStreaming: false,
        });
      } catch (error) {
        if (isNonStreamTerminalPersistenceError(error)) {
          throw error;
        }
        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          await discardBeforeResponseBodySnapshot(session);
        }
        // 检测 AbortError 的来源：响应超时 vs 客户端中断
        const err = error as Error;
        if (isClientAbortError(err)) {
          // 获取 responseController 引用（由 forwarder.ts 传递）
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };

          // 区分超时和客户端中断
          const isResponseTimeout =
            sessionWithController.responseController?.signal.aborted &&
            !session.clientAbortSignal?.aborted;

          if (isResponseTimeout) {
            logger.error("ResponseHandler: Response timeout during non-stream body read", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              errorName: err.name,
            });

            const finalizedStatusCode = statusCode >= 400 ? statusCode : 502;
            const isResourceNotFound = finalizedStatusCode === 404;
            const postTerminalSideEffects: Array<() => Promise<void>> = [];
            if (!isResourceNotFound && session.getEndpointPolicy().allowCircuitBreakerAccounting) {
              postTerminalSideEffects.push(async () => {
                try {
                  const { recordFailure } = await import("@/lib/circuit-breaker");
                  await recordFailure(provider.id, err);
                  logger.debug("ResponseHandler: Response timeout recorded in circuit breaker", {
                    providerId: provider.id,
                  });
                } catch (cbError) {
                  logger.warn("ResponseHandler: Failed to record timeout in circuit breaker", {
                    providerId: provider.id,
                    error: cbError,
                  });
                }
              });
            }

            session.addProviderToChain(provider, {
              reason: isResourceNotFound ? "resource_not_found" : "retry_failed",
              attemptNumber: 1,
              statusCode: finalizedStatusCode,
              errorMessage: formatProcessingError(err),
            });

            try {
              await finalizeNonStreamAbort({
                statusCode: finalizedStatusCode,
                error: err,
                postTerminalSideEffects,
              });
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
                taskId,
                providerId: provider.id,
                finalizeError,
              });
              if (isNonStreamTerminalPersistenceError(finalizeError)) {
                throw finalizeError;
              }
            }
          } else {
            // 客户端主动中断：正常日志，不抛出错误
            logger.warn("ResponseHandler: Non-stream processing aborted by client", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              errorName: err.name,
              reason:
                err.name === "ResponseAborted"
                  ? "Response transmission interrupted"
                  : "Client disconnected",
            });
            try {
              await finalizeNonStreamAbort();
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted non-stream response", {
                taskId,
                providerId: provider.id,
                finalizeError,
              });
              if (isNonStreamTerminalPersistenceError(finalizeError)) {
                throw finalizeError;
              }
            }
          }
        } else {
          logger.error("Failed to handle non-stream log:", error);

          // 更新数据库记录（避免 orphan record）
          await persistRequestFailure({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error,
            taskId,
            phase: "non-stream",
          });
        }
      } finally {
        cleanupTaskAbortBinding();
        cleanupClientAbortListener();
        releaseSessionAgent(session);
      }
    };

    // 注册任务并添加全局错误捕获
    AsyncTaskManager.register(
      taskId,
      () => {
        const processingPromise = runProcessingTask();
        return processingPromise.catch(async (error) => {
          logger.error("ResponseHandler: Uncaught error in non-stream processing", {
            taskId,
            error,
          });

          if (isNonStreamTerminalPersistenceError(error)) {
            throw error;
          }

          // 更新数据库记录（避免 orphan record）
          await persistRequestFailure({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error,
            taskId,
            phase: "non-stream",
          });
          throw error;
        });
      },
      {
        taskType: "non-stream-processing",
        abortController,
        staleTimeoutMs: resolveNonStreamTaskStaleTimeoutMs(provider),
      }
    );

    return finalResponse;
  }

  private static async handleStream(session: ProxySession, response: Response): Promise<Response> {
    const messageContext = session.messageContext;
    const provider = session.provider;

    if (!messageContext || !provider || !response.body) {
      releaseReplayOwnership(session);
      discardBeforeResponseBodySnapshot(session);
      releaseSessionAgent(session);
      return response;
    }

    let processedStream: ReadableStream<Uint8Array> = response.body;

    // --- GEMINI STREAM HANDLING ---
    if (provider.providerType === "gemini" || provider.providerType === "gemini-cli") {
      // 判断是否需要透传（客户端和提供商格式都必须是 Gemini）
      const isGeminiPassthrough =
        (session.originalFormat === "gemini" || session.originalFormat === "gemini-cli") &&
        (provider.providerType === "gemini" || provider.providerType === "gemini-cli");

      if (isGeminiPassthrough) {
        logger.debug("[ResponseHandler] Gemini stream passthrough (demand-driven stats)", {
          originalFormat: session.originalFormat,
          providerType: provider.providerType,
          model: session.request.model,
          statusCode: response.status,
          reason: "Client receives untouched chunks observed by the authoritative pump",
        });
        discardBeforeResponseBodySnapshot(session);

        // F2：passthrough 分支不建 replay spool——owner 租约立即释放并清角色
        releaseReplayOwnership(session);

        // F1 shadow 遥测：enforce 已在 forwarder 作用于该流量，shadow 观察同样不留盲区
        const passthroughShadowObserver = (() => {
          if (resolveStreamGateMode() !== "shadow") return null;
          if (session.getEndpointPolicy().kind === "raw_passthrough") return null;
          const family = mapProviderTypeToFamily(provider.providerType);
          if (!family) return null;
          return createShadowGateObserver({
            family,
            providerId: provider.id,
            providerName: provider.name,
          });
        })();

        // 注意：不要在“仅收到响应头”时清除首字节超时。
        // 背景：部分上游可能会快速返回 200 + SSE headers，但随后长时间不发送任何 body 数据。
        // 若在 headers 阶段就 clearResponseTimeout，会导致首字节超时失效，客户端与服务端都会表现为一直“请求中”。
        // 透传场景下，我们在后台 stats 读取到第一块数据时再清除超时（与非透传路径口径一致）。

        let observePassthroughChunk = (_value: Uint8Array) => {};
        let observePassthroughReadStart = () => {};
        let observePassthroughDrainStart = () => {};
        let abortPassthroughTransport = (_reason: Error) => {};
        let passthroughPump: DemandDrivenResponsePump;
        let passthroughDrainTimeoutId: ReturnType<typeof setTimeout> | null = null;
        const clearPassthroughDrainTimeout = () => {
          if (passthroughDrainTimeoutId) {
            clearTimeout(passthroughDrainTimeoutId);
            passthroughDrainTimeoutId = null;
          }
        };
        const startPassthroughDrain = (reason?: unknown) => {
          passthroughPump.startDrain(reason);
          observePassthroughDrainStart();
          if (passthroughDrainTimeoutId) return;
          passthroughDrainTimeoutId = setTimeout(() => {
            passthroughDrainTimeoutId = null;
            const drainTimeoutError = new Error("client_abort_drain_timeout");
            abortPassthroughTransport(drainTimeoutError);
            passthroughPump.cancelSource(drainTimeoutError);
          }, CLIENT_ABORT_DRAIN_MAX_MS);
          passthroughDrainTimeoutId.unref?.();
        };
        passthroughPump = createDemandDrivenResponsePump({
          source: response.body,
          onReadStart: () => observePassthroughReadStart(),
          onChunk: (value) => {
            passthroughShadowObserver?.observe(value);
            observePassthroughChunk(value);
          },
          onClientCancel: (reason) => {
            startPassthroughDrain(reason);
          },
        });
        const cleanupPassthroughClientAbortListener = bindClientAbortListener(
          session.clientAbortSignal,
          () => {
            const reason = session.clientAbortSignal?.reason;
            startPassthroughDrain(reason);
          }
        );
        const statusCode = response.status;

        const taskId = `stream-passthrough-${messageContext.id}`;
        const streamTaskStaleTimeoutMs = resolveStreamTaskStaleTimeoutMs();
        const statsAbortController = new AbortController();
        const cleanupTaskAbortBinding = bindTaskAbortToUpstreamResponse(
          session,
          statsAbortController,
          taskId
        );
        const runStatsTask = async () => {
          const sessionWithCleanup = session as typeof session & {
            clearResponseTimeout?: () => void;
          };
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };

          const streamTextAccumulator = new BoundedStreamTextAccumulator();
          let lastStreamTextSnapshot: BoundedStreamTextSnapshot | null = null;
          const getCollectedChunkCount = () =>
            lastStreamTextSnapshot?.chunkCount ?? streamTextAccumulator.chunkCount;
          let isFirstChunk = true;
          let streamEndedNormally = false;
          let terminalFinalizationStarted = false;
          let responseTimeoutCleared = false;
          let pumpClientAborted = false;
          let abortReason: string | undefined;
          let transportReleased = false;
          let commitSideEffectsScheduled = false;
          let latestCommitSideEffects: (() => Promise<void>) | undefined;
          const scheduleCommitSideEffects = (effect: (() => Promise<void>) | undefined) => {
            if (!effect || commitSideEffectsScheduled) return;
            commitSideEffectsScheduled = true;
            return schedulePostTerminalSideEffects({
              taskId,
              providerId: provider.id,
              sessionId: session.sessionId,
              commit: async (signal) => {
                if (signal.aborted) return;
                await effect();
              },
            });
          };

          // 静默期 Watchdog：透传也需要支持中途卡住（无新数据推送）
          const idleTimeoutMs =
            provider.streamingIdleTimeoutMs > 0
              ? provider.streamingIdleTimeoutMs
              : Number.POSITIVE_INFINITY;
          let idleTimeoutId: NodeJS.Timeout | null = null;
          const clearIdleTimer = () => {
            if (idleTimeoutId) {
              clearTimeout(idleTimeoutId);
              idleTimeoutId = null;
            }
          };
          const startIdleTimer = () => {
            if (idleTimeoutMs === Infinity) return;
            clearIdleTimer();
            idleTimeoutId = setTimeout(() => {
              abortReason = "STREAM_IDLE_TIMEOUT";
              logger.warn("[ResponseHandler] Gemini passthrough streaming idle timeout triggered", {
                taskId,
                providerId: provider.id,
                providerName: provider.name,
                idleTimeoutMs,
                chunksCollected: getCollectedChunkCount(),
                totalBytes: streamTextAccumulator.totalByteCount,
                bufferedBytes: streamTextAccumulator.bufferedByteCount,
                wasTruncated: streamTextAccumulator.isTruncated,
              });
              // 终止上游连接：让透传到客户端的连接也尽快结束，避免永久悬挂占用资源
              try {
                sessionWithController.responseController?.abort(new Error("streaming_idle"));
              } catch {
                // ignore
              }
            }, idleTimeoutMs);
          };

          observePassthroughReadStart = () => {
            if (!isFirstChunk) startIdleTimer();
          };
          observePassthroughDrainStart = startIdleTimer;
          abortPassthroughTransport = (reason) => {
            try {
              sessionWithController.responseController?.abort(reason);
            } catch {
              // ignore
            }
            try {
              statsAbortController.abort(reason);
            } catch {
              // ignore
            }
          };

          const clearResponseTimeoutOnce = (firstChunkSize?: number) => {
            if (responseTimeoutCleared) return;
            if (!sessionWithCleanup.clearResponseTimeout) return;
            sessionWithCleanup.clearResponseTimeout();
            responseTimeoutCleared = true;
            if (firstChunkSize != null) {
              logger.debug(
                "[ResponseHandler] Gemini passthrough: First chunk received, response timeout cleared",
                {
                  taskId,
                  providerId: provider.id,
                  providerName: provider.name,
                  firstChunkSize,
                }
              );
            }
          };

          const flushAndSnapshot = (): BoundedStreamTextSnapshot => {
            const snapshot = streamTextAccumulator.finish();
            lastStreamTextSnapshot = snapshot;
            return snapshot;
          };

          const flushAndJoin = (): string => {
            return flushAndSnapshot().text;
          };

          observePassthroughChunk = (value) => {
            clearIdleTimer();
            if (isFirstChunk) {
              isFirstChunk = false;
              session.recordTtfb();
              clearResponseTimeoutOnce(value.byteLength);
            }
            streamTextAccumulator.pushBytes(value);
            AsyncTaskManager.touch(taskId);
          };

          const releaseTransportResources = () => {
            if (transportReleased) return;
            transportReleased = true;
            clearPassthroughDrainTimeout();
            cleanupPassthroughClientAbortListener();
            cleanupTaskAbortBinding();
            clearIdleTimer();
            try {
              const wasResponseControllerAborted =
                sessionWithController.responseController?.signal.aborted ?? false;
              const clientAborted = session.clientAbortSignal?.aborted ?? false;
              const shouldClearTimeout =
                responseTimeoutCleared ||
                streamEndedNormally ||
                wasResponseControllerAborted ||
                clientAborted;
              if (shouldClearTimeout) {
                clearResponseTimeoutOnce();
              }
            } catch (error) {
              logger.warn(
                "[ResponseHandler] Gemini passthrough: Failed to clear response timeout",
                {
                  taskId,
                  providerId: provider.id,
                  providerName: provider.name,
                  error: error instanceof Error ? error.message : String(error),
                }
              );
            }
            releaseSessionAgent(session);
          };

          try {
            const pumpCompletion = await passthroughPump.completion;
            streamEndedNormally = pumpCompletion.streamEndedNormally;
            pumpClientAborted = pumpCompletion.clientAborted;
            if (pumpCompletion.error) throw pumpCompletion.error;

            clearIdleTimer();
            const streamSnapshot = flushAndSnapshot();
            const allContent = streamSnapshot.text;
            const clientAborted =
              pumpClientAborted || (session.clientAbortSignal?.aborted ?? false);
            releaseTransportResources();

            // 存储响应体到 Redis（5分钟过期）
            if (
              session.sessionId &&
              !streamSnapshot?.truncated &&
              session.shouldPersistSessionDebugArtifacts()
            ) {
              void SessionManager.storeSessionResponse(
                session.sessionId,
                allContent,
                session.requestSequence
              ).catch((err) => {
                logger.error("[ResponseHandler] Failed to store stream passthrough response:", err);
              });

              const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "before",
                { body: allContent },
                session.requestSequence
              );
              responseBeforeSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
              });

              const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
                session.sessionId,
                "after",
                { body: allContent },
                session.requestSequence
              );
              responseAfterSnapshotTask?.catch((err) => {
                logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
              });
            } else if (session.sessionId && streamSnapshot?.truncated) {
              logger.warn("[ResponseHandler] Skip storing passthrough response: body too large", {
                taskId,
                providerId: provider.id,
                providerName: provider.name,
                maxBytes: STREAM_STATS_MAX_BUFFER_BYTES,
                totalBytes: streamSnapshot.totalBytes,
                bufferedBytes: streamSnapshot.bufferedBytes,
              });
            }

            // 使用共享的统计处理方法
            const duration = Date.now() - session.startTime;
            terminalFinalizationStarted = true;
            const finalized = await finalizeDeferredStreamingFinalizationIfNeeded(
              session,
              allContent,
              statusCode,
              streamEndedNormally,
              clientAborted,
              abortReason
            );
            latestCommitSideEffects = finalized.commitSideEffects;
            const finalizedUsage = await finalizeRequestStats(
              session,
              allContent,
              finalized.effectiveStatusCode,
              duration,
              finalized.errorMessage ?? undefined,
              finalized.providerIdForPersistence ?? undefined,
              true, // Gemini 流式透传(NDJSON 无 data:/event: 前缀,必须显式告知)
              () => scheduleCommitSideEffects(latestCommitSideEffects)
            );
            emitProxyLangfuseTrace(session, {
              responseHeaders: response.headers,
              responseText: allContent,
              usageMetrics: finalizedUsage,
              costUsd: undefined,
              statusCode: finalized.effectiveStatusCode,
              durationMs: duration,
              isStreaming: true,
              errorMessage: finalized.errorMessage ?? undefined,
            });
          } catch (error) {
            const err = error instanceof Error ? error : new Error(String(error));
            const clientAborted =
              passthroughPump.wasClientAborted() || (session.clientAbortSignal?.aborted ?? false);
            const isResponseControllerAborted =
              sessionWithController.responseController?.signal.aborted ?? false;
            const isIdleTimeout = !!err.message?.includes("streaming_idle");

            abortReason =
              abortReason ??
              (clientAborted
                ? "CLIENT_ABORTED"
                : isIdleTimeout
                  ? "STREAM_IDLE_TIMEOUT"
                  : isResponseControllerAborted
                    ? "STREAM_RESPONSE_TIMEOUT"
                    : "STREAM_PROCESSING_ERROR");

            // 透传的 stats 任务失败时，必须尽量落库并结束追踪，避免请求长期停留在“requesting”
            logger.error("[ResponseHandler] Gemini passthrough stats task failed", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              clientAborted,
              isResponseControllerAborted,
              isIdleTimeout,
              abortReason,
              errorName: err.name,
              errorMessage: err.message || "(empty message)",
            });

            try {
              if (terminalFinalizationStarted) {
                throw err;
              }
              terminalFinalizationStarted = true;
              clearIdleTimer();
              const allContent = flushAndJoin();
              const duration = Date.now() - session.startTime;

              const finalized = await finalizeDeferredStreamingFinalizationIfNeeded(
                session,
                allContent,
                statusCode,
                false,
                clientAborted,
                abortReason
              );
              latestCommitSideEffects = finalized.commitSideEffects;

              await finalizeRequestStats(
                session,
                allContent,
                finalized.effectiveStatusCode,
                duration,
                finalized.errorMessage ?? undefined,
                finalized.providerIdForPersistence ?? undefined,
                true, // 流式透传错误兜底也是流式上下文
                () => scheduleCommitSideEffects(latestCommitSideEffects)
              );
            } catch (finalizeError) {
              const fallbackStatusCode =
                statusCode >= 400
                  ? statusCode
                  : streamEndedNormally
                    ? 500
                    : clientAborted
                      ? 499
                      : 502;
              await persistRequestFailure({
                session,
                messageContext,
                statusCode: fallbackStatusCode,
                error: finalizeError,
                taskId,
                phase: "stream",
                detailsWriter: updateMessageRequestDetailsIfUnfinalized,
                onCommitted: () => scheduleCommitSideEffects(latestCommitSideEffects),
                awaitPersistence: <T>(promise: Promise<T>) =>
                  awaitTerminalPersistenceWithOwnership({
                    promise,
                    taskId,
                    operation: "gemini-stream-fallback",
                    timeoutMs: STREAM_FAILURE_PERSISTENCE_MAX_MS,
                  }),
              });
            }
          } finally {
            releaseTransportResources();
          }
        };

        AsyncTaskManager.register(
          taskId,
          () => {
            const statsPromise = runStatsTask();
            statsPromise.catch((error) => {
              if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
                void discardBeforeResponseBodySnapshot(session);
              }
              logger.error(
                "[ResponseHandler] Gemini passthrough stats task uncaught error:",
                error
              );
            });
            return statsPromise;
          },
          {
            taskType: "stream-passthrough-stats",
            abortController: statsAbortController,
            staleTimeoutMs: streamTaskStaleTimeoutMs,
          }
        );

        if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
          const responseAfterMetaTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "after",
            {
              headers: response.headers,
              meta: {
                upstreamUrl: null,
                statusCode: response.status,
              },
            },
            session.requestSequence
          );
          responseAfterMetaTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store stream response after meta:", err);
          });
        }

        return new Response(passthroughPump.stream, {
          status: response.status,
          statusText: response.statusText,
          headers: cleanResponseHeaders(response.headers),
        });
      } else {
        // ❌ 需要转换：客户端不是 Gemini 格式（如 OpenAI/Claude）
        logger.debug("[ResponseHandler] Transforming Gemini stream to client format", {
          originalFormat: session.originalFormat,
          providerType: provider.providerType,
          model: session.request.model,
        });

        let buffer = "";
        const transformStream = new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            const decoder = new TextDecoder();
            const text = decoder.decode(chunk, { stream: true });
            buffer += text;

            const lines = buffer.split("\n");
            // Keep the last line in buffer as it might be incomplete
            buffer = lines.pop() || "";

            for (const line of lines) {
              const trimmedLine = line.trim();
              if (trimmedLine.startsWith("data:")) {
                const jsonStr = trimmedLine.slice(5).trim();
                if (!jsonStr) continue;
                try {
                  const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
                  const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
                  const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
                  controller.enqueue(new TextEncoder().encode(output));
                } catch {
                  // Ignore parse errors
                }
              }
            }
          },
          flush(controller) {
            if (buffer.trim().startsWith("data:")) {
              try {
                const jsonStr = buffer.trim().slice(5).trim();
                const geminiResponse = JSON.parse(jsonStr) as GeminiResponse;
                const openAIChunk = GeminiAdapter.transformResponse(geminiResponse, true);
                const output = `data: ${JSON.stringify(openAIChunk)}\n\n`;
                controller.enqueue(new TextEncoder().encode(output));
              } catch {}
            }
          },
        });
        processedStream = response.body.pipeThrough(transformStream);
      }
    }

    const statusCode = response.status;

    // 使用 AsyncTaskManager 管理后台处理任务
    const taskId = `stream-${messageContext?.id || `unknown-${Date.now()}`}`;
    const abortController = new AbortController();
    const cleanupTaskAbortBinding = bindTaskAbortToUpstreamResponse(
      session,
      abortController,
      taskId
    );
    const idleTimeoutMs =
      provider.streamingIdleTimeoutMs > 0
        ? provider.streamingIdleTimeoutMs
        : Number.POSITIVE_INFINITY;
    const streamTaskStaleTimeoutMs = resolveStreamTaskStaleTimeoutMs();
    // F2：owner 请求（活跃 spool）的断线引流窗口延长到 REPLAY_MAX_DETACHED_MS，
    // 让上游响应在客户端断开后继续被缓存直至完成；非 replay 请求维持 60s 现状。
    let clientAbortDrainTimeoutMs = CLIENT_ABORT_DRAIN_MAX_MS;
    let responsePump: DemandDrivenResponsePump | null = null;

    // 提升 idleTimeoutId 到外部作用域，以便客户端断开时能清除
    let idleTimeoutId: NodeJS.Timeout | null = null;
    let clientAbortDrainTimeoutId: NodeJS.Timeout | null = null;
    const streamTextAccumulator = new BoundedStreamTextAccumulator();
    let lastStreamTextSnapshot: BoundedStreamTextSnapshot | null = null;
    const getCollectedChunkCount = () =>
      lastStreamTextSnapshot?.chunkCount ?? streamTextAccumulator.chunkCount;
    const clearClientAbortDrainTimer = () => {
      if (clientAbortDrainTimeoutId) {
        clearTimeout(clientAbortDrainTimeoutId);
        clientAbortDrainTimeoutId = null;
      }
    };
    const clearIdleTimer = () => {
      if (idleTimeoutId) {
        clearTimeout(idleTimeoutId);
        idleTimeoutId = null;
      }
    };
    const startIdleTimer = () => {
      if (idleTimeoutMs === Infinity) return; // 禁用时跳过
      clearIdleTimer(); // 清除旧的
      idleTimeoutId = setTimeout(() => {
        logger.warn("ResponseHandler: Streaming idle timeout triggered", {
          taskId,
          providerId: provider.id,
          idleTimeoutMs,
          chunksCollected: getCollectedChunkCount(),
        });

        // 1. 关闭客户端流（让客户端收到连接关闭通知，避免悬挂）
        try {
          if (responsePump) {
            const idleTimeoutError = new Error("streaming_idle");
            idleTimeoutError.name = "AbortError";
            responsePump.errorClient(idleTimeoutError);
            responsePump.cancelSource(idleTimeoutError);
            logger.debug("ResponseHandler: Client stream closed due to idle timeout", {
              taskId,
              providerId: provider.id,
            });
          }
        } catch (e) {
          logger.warn("ResponseHandler: Failed to close client stream", {
            taskId,
            providerId: provider.id,
            error: e,
          });
        }

        // 2. 终止上游连接（避免资源泄漏）
        try {
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };
          if (sessionWithController.responseController) {
            sessionWithController.responseController.abort(new Error("streaming_idle"));
            logger.debug("ResponseHandler: Upstream connection aborted due to idle timeout", {
              taskId,
              providerId: provider.id,
            });
          }
        } catch (e) {
          logger.warn("ResponseHandler: Failed to abort upstream connection", {
            taskId,
            providerId: provider.id,
            error: e,
          });
        }

        // 3. 终止后台读取任务
        abortController.abort(new Error("streaming_idle"));
      }, idleTimeoutMs);
    };
    let cleanupClientAbortListener = () => {};
    let clientDetachHandled = false;
    const handleClientAbort = (reason?: unknown) => {
      if (responsePump?.getState() === "closed") return;
      responsePump?.startDrain(reason ?? "client_detached");
      if (clientDetachHandled) return;
      clientDetachHandled = true;
      logger.debug("ResponseHandler: Client disconnected, cleaning up", {
        taskId,
        providerId: provider.id,
        messageId: messageContext.id,
      });
      // Do not cancel internal accounting on pure client disconnect. Transfer
      // ownership to the bounded background drain so terminal usage can still
      // be recorded. Idle/response timeout paths still abort upstream.
      clearClientAbortDrainTimer();
      if (!idleTimeoutId) {
        startIdleTimer();
      }
      clientAbortDrainTimeoutId = setTimeout(() => {
        logger.info("ResponseHandler: Client abort drain window exceeded", {
          taskId,
          providerId: provider.id,
          messageId: messageContext.id,
          clientAbortDrainTimeoutMs,
        });

        try {
          const sessionWithController = session as typeof session & {
            responseController?: AbortController;
          };
          sessionWithController.responseController?.abort(new Error("client_abort_drain_timeout"));
        } catch (e) {
          logger.warn("ResponseHandler: Failed to abort upstream after client drain timeout", {
            taskId,
            providerId: provider.id,
            error: e,
          });
        }

        const drainTimeoutError = new Error("client_abort_drain_timeout");
        abortController.abort(drainTimeoutError);
        responsePump?.cancelSource(drainTimeoutError);
      }, clientAbortDrainTimeoutMs);
    };

    // 统计/结算只保留有界的“头 + 尾”文本快照，避免长流式响应把进程堆撑满。
    let usageForCost: UsageMetrics | null = null;
    let isFirstChunk = true; // 标记是否为第一块数据

    // 不在首次读取前启动 idle timer（避免与首字节超时职责重叠）
    // idle timer 仅在首块数据到达后启动，用于检测流中途静默。
    // 客户端断开后例外：后台 drain 也会启动 idle timer，避免 pre-body
    // 静默一直等到 60s drain 总上限。

    const flushAndJoin = (): string => {
      const snapshot = streamTextAccumulator.finish();
      lastStreamTextSnapshot = snapshot;
      return snapshot.text;
    };

    let responseTimeoutCleared = false;
    const clearResponseTimeoutOnce = (): boolean => {
      if (responseTimeoutCleared) return false;
      const sessionWithCleanup = session as typeof session & {
        clearResponseTimeout?: () => void;
      };
      if (!sessionWithCleanup.clearResponseTimeout) return false;
      responseTimeoutCleared = true;
      sessionWithCleanup.clearResponseTimeout();
      return true;
    };

    const getResponseControllerAbortError = (): Error | null => {
      const sessionWithController = session as typeof session & {
        responseController?: AbortController;
      };
      const signal = sessionWithController.responseController?.signal;
      if (!signal?.aborted) return null;
      if (signal.reason instanceof Error && isClientAbortError(signal.reason)) {
        return signal.reason;
      }

      const error = new Error(
        signal.reason instanceof Error ? signal.reason.message : "Response timeout"
      );
      error.name = "AbortError";
      return error;
    };

    let terminalDetailsPersisted = false;
    let streamCommitSideEffectsScheduled = false;
    let latestStreamCommitSideEffects: Array<() => Promise<void>> = [];
    const scheduleStreamCommitSideEffects = () => {
      if (latestStreamCommitSideEffects.length === 0 || streamCommitSideEffectsScheduled) return;
      streamCommitSideEffectsScheduled = true;
      const committedEffects = [...latestStreamCommitSideEffects];
      return schedulePostTerminalSideEffects({
        taskId,
        providerId: provider.id,
        sessionId: session.sessionId,
        commit: (signal) => runPostTerminalSideEffects(committedEffects, signal),
      });
    };
    let streamFailurePersistencePromise: Promise<void> | null = null;
    const persistStreamFailureOnce = (
      options: Parameters<typeof persistRequestFailure>[0]
    ): Promise<void> => {
      if (terminalDetailsPersisted) return Promise.resolve();
      if (!streamFailurePersistencePromise) {
        streamFailurePersistencePromise = persistRequestFailure({
          ...options,
          detailsWriter: updateMessageRequestDetailsIfUnfinalized,
          onCommitted: options.onCommitted ?? scheduleStreamCommitSideEffects,
          awaitPersistence: <T>(promise: Promise<T>) =>
            awaitTerminalPersistenceWithOwnership({
              promise,
              taskId,
              operation: "stream-failure-fallback",
              timeoutMs: STREAM_FAILURE_PERSISTENCE_MAX_MS,
            }),
        })
          .then(() => undefined)
          .catch((error) => {
            logger.error("ResponseHandler: Stream failure fallback threw", {
              taskId,
              messageId: messageContext.id,
              error,
            });
          });
      }
      return streamFailurePersistencePromise ?? Promise.resolve();
    };

    let streamFinalizationPromise: Promise<void> | null = null;
    const finalizeStream = (
      allContent: string,
      streamEndedNormally: boolean,
      clientAborted: boolean,
      abortReason?: string
    ): Promise<void> => {
      if (streamFinalizationPromise) return streamFinalizationPromise;
      streamFinalizationPromise = (async () => {
        const finalizationDeadlineAtMs = Date.now() + STREAM_FINALIZATION_MAX_MS;
        const awaitFinalization = <T>(promise: Promise<T>): Promise<T> =>
          raceWithDeadline(promise, finalizationDeadlineAtMs, "stream_finalization_timeout");
        const finalized = finalizeDeferredStreamingFinalizationIfNeeded(
          session,
          allContent,
          statusCode,
          streamEndedNormally,
          clientAborted,
          abortReason
        );
        latestStreamCommitSideEffects = finalized.commitSideEffects
          ? [finalized.commitSideEffects]
          : [];
        const effectiveStatusCode = finalized.effectiveStatusCode;
        const streamErrorMessage = finalized.errorMessage;
        const providerIdForPersistence = finalized.providerIdForPersistence;

        const streamSnapshot = lastStreamTextSnapshot;

        // 存储响应体到 Redis（5分钟过期）。截断后的统计快照不是完整正文，不能伪装成完整调试正文落盘。
        if (
          session.sessionId &&
          session.shouldPersistSessionDebugArtifacts() &&
          !streamSnapshot?.truncated
        ) {
          const beforeBody = allContent;
          void SessionManager.storeSessionResponse(
            session.sessionId,
            allContent,
            session.requestSequence
          ).catch((err) => {
            logger.error("[ResponseHandler] Failed to store response:", err);
          });

          const responseAfterSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "after",
            { body: allContent },
            session.requestSequence
          );
          responseAfterSnapshotTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store response after snapshot:", err);
          });

          const responseBeforeSnapshotTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
            session.sessionId,
            "before",
            { body: beforeBody },
            session.requestSequence
          );
          responseBeforeSnapshotTask?.catch((err) => {
            logger.error("[ResponseHandler] Failed to store response before snapshot:", err);
          });
        } else if (session.sessionId && streamSnapshot?.truncated) {
          discardBeforeResponseBodySnapshot(session);
          logger.warn("[ResponseHandler] Skip storing stream response: body too large", {
            taskId,
            providerId: provider.id,
            providerName: provider.name,
            maxBytes: STREAM_STATS_MAX_BUFFER_BYTES,
            totalBytes: streamSnapshot.totalBytes,
            bufferedBytes: streamSnapshot.bufferedBytes,
          });
        }

        const duration = Date.now() - session.startTime;

        const tracker = ProxyStatusTracker.getInstance();
        tracker.endRequest(messageContext.user.id, messageContext.id);

        // U11：门控已在 finalize 内解析过同一份 allContent，类型一致时直接复用
        const usageResult =
          finalized.clientAbortGateUsage?.providerType === provider.providerType
            ? { usageMetrics: finalized.clientAbortGateUsage.usageMetrics }
            : parseUsageFromResponseText(allContent, provider.providerType);
        usageForCost = usageResult.usageMetrics;

        const actualServiceTier = parseServiceTierFromResponseText(allContent);
        const codexPriorityBillingDecision = await awaitFinalization(
          resolveCodexPriorityBillingDecision(session, actualServiceTier)
        );
        if (!isNonBillingUsageEndpoint(session)) {
          ensureCodexServiceTierResultSpecialSetting(session, codexPriorityBillingDecision);
        }
        const priorityServiceTierApplied = codexPriorityBillingDecision?.effectivePriority ?? false;

        if (usageForCost) {
          usageForCost = normalizeUsageWithSwap(
            usageForCost,
            session,
            provider.swapCacheTtlBilling
          );
        }

        maybeSetCodexContext1m(session, provider, usageForCost?.input_tokens);

        let codexCacheBinding:
          | {
              sessionId: string;
              promptCacheKey: string;
              providerId: number;
              keyId: number | null;
            }
          | undefined;
        if (
          provider.providerType === "codex" &&
          effectiveStatusCode >= 200 &&
          effectiveStatusCode < 300 &&
          session.sessionId &&
          provider.id
        ) {
          try {
            const sseEvents = parseSSEData(allContent);
            for (const event of sseEvents) {
              if (typeof event.data === "object" && event.data) {
                const promptCacheKey = SessionManager.extractCodexPromptCacheKey(
                  event.data as Record<string, unknown>
                );
                if (promptCacheKey) {
                  codexCacheBinding = {
                    sessionId: session.sessionId,
                    promptCacheKey,
                    providerId: provider.id,
                    keyId: session.authState?.key?.id ?? session.messageContext?.key?.id ?? null,
                  };
                  break; // Only need first prompt_cache_key
                }
              }
            }
          } catch (parseError) {
            logger.trace("[ResponseHandler] Failed to parse SSE for Codex session:", parseError);
          }
        }

        const billableUsageForCost = await awaitFinalization(
          resolveBillableUsageMetricsForCost(
            session,
            provider,
            usageForCost,
            effectiveStatusCode,
            allContent
          )
        );

        const billing = sessionBillingInputs(session, provider, priorityServiceTierApplied);
        const costUpdateResult = await awaitFinalization(
          updateRequestCostFromUsage(
            messageContext.id,
            session,
            billableUsageForCost,
            billing,
            // Any hedge-path winner with loser billing on uses the loser-sum-aware write.
            // Gate on billHedgeLosers (not the racy isHedgeWinner/launchedProviderCount):
            // an alternative can still be mid-launch when the initial provider commits, so
            // isHedgeWinner may read false even though a loser will bill — using it would
            // let the winner's replacement clobber that loser's additive write.
            finalized.billHedgeLosers
          )
        );
        if (costUpdateResult.longContextPricingApplied) {
          ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
        }

        // 追踪消费到 Redis（用于限流）
        await awaitFinalization(
          trackCostToRedis(session, billableUsageForCost, billing, {
            resolvedPricing: costUpdateResult.resolvedPricing,
            longContextPricing: costUpdateResult.longContextPricing,
          })
        );

        // Calculate cost for session tracking (with multiplier) and Langfuse (raw)
        let costUsdStr: string | undefined;
        let rawCostUsdStr: string | undefined;
        let costBreakdown: CostBreakdown | undefined;
        if (billableUsageForCost) {
          try {
            if (session.request.model) {
              const resolvedPricing = await awaitFinalization(
                session.getResolvedPricingByBillingSource(provider)
              );
              if (resolvedPricing) {
                ensurePricingResolutionSpecialSetting(session, resolvedPricing);
                const longContextPricing =
                  matchLongContextPricing(billableUsageForCost, resolvedPricing.priceData)
                    ?.pricing ?? null;
                const cost = calculateRequestCost(
                  billableUsageForCost,
                  resolvedPricing.priceData,
                  buildCostCalculationOptions(
                    provider.costMultiplier,
                    session.getContext1mApplied(),
                    priorityServiceTierApplied,
                    longContextPricing,
                    session.getGroupCostMultiplier()
                  )
                );
                if (cost.gt(0)) {
                  costUsdStr = cost.toString();
                }
                // Raw cost without multiplier for Langfuse
                if (provider.costMultiplier !== 1 || session.getGroupCostMultiplier() !== 1) {
                  const rawCost = calculateRequestCost(
                    billableUsageForCost,
                    resolvedPricing.priceData,
                    buildCostCalculationOptions(
                      1.0,
                      session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing
                    )
                  );
                  if (rawCost.gt(0)) {
                    rawCostUsdStr = rawCost.toString();
                  }
                } else {
                  rawCostUsdStr = costUsdStr;
                }
                // Cost breakdown for Langfuse (raw, no multiplier)
                try {
                  costBreakdown = calculateRequestCostBreakdown(
                    billableUsageForCost,
                    resolvedPricing.priceData,
                    {
                      context1mApplied: session.getContext1mApplied(),
                      priorityServiceTierApplied,
                      longContextPricing,
                    }
                  );
                } catch {
                  /* non-critical */
                }
              }
            }
          } catch (error) {
            logger.error("[ResponseHandler] Failed to calculate session cost (stream), skipping", {
              error: error instanceof Error ? error.message : String(error),
            });
          }
        }

        // 更新 session 使用量到 Redis（用于实时监控）
        if (session.sessionId) {
          const payload: SessionUsageUpdate = {
            status: effectiveStatusCode >= 200 && effectiveStatusCode < 300 ? "completed" : "error",
            statusCode: effectiveStatusCode,
            ...(streamErrorMessage ? { errorMessage: streamErrorMessage } : {}),
          };

          if (usageForCost) {
            payload.inputTokens = usageForCost.input_tokens;
            payload.outputTokens = usageForCost.output_tokens;
            payload.cacheCreationInputTokens = usageForCost.cache_creation_input_tokens;
            payload.cacheReadInputTokens = usageForCost.cache_read_input_tokens;
          }
          if (costUsdStr !== undefined) {
            payload.costUsd = costUsdStr;
          }

          if (session.shouldTrackSessionObservability()) {
            void SessionManager.updateSessionUsage(session.sessionId, payload).catch(
              (error: unknown) => {
                logger.error("[ResponseHandler] Failed to update session usage:", error);
              }
            );
          }
        }

        // Anthropic 流式 thinking signature 模型检测(优先于明文 model 字段)
        const currentRequestedModel = session.getCurrentModel();
        const thinkingActuallyEnabled = isThinkingEnabled(session.request.message);
        const anthropicModelDetection = resolveAnthropicStreamActualResponseModel({
          providerType: provider.providerType,
          requestedModel: currentRequestedModel,
          thinkingEnabled: thinkingActuallyEnabled,
          responseStreamText: allContent,
        });
        if (anthropicModelDetection.source) {
          session.addSpecialSetting({
            type: "thinking_signature_model_detection",
            scope: "response",
            hit: anthropicModelDetection.source === "fallback_no_signature_with_thinking",
            source: anthropicModelDetection.source,
            extractedModel: anthropicModelDetection.actualResponseModel,
            signatureFound: anthropicModelDetection.source === "signature",
            thinkingEnabled: thinkingActuallyEnabled,
            requestedModel: currentRequestedModel,
          });
        }
        const finalActualResponseModel = anthropicModelDetection.source
          ? anthropicModelDetection.actualResponseModel
          : extractActualResponseModelForProvider(provider.providerType, true, allContent);

        const postTerminalSideEffects = [...latestStreamCommitSideEffects];
        if (codexCacheBinding) {
          const { sessionId, promptCacheKey, providerId, keyId } = codexCacheBinding;
          postTerminalSideEffects.push(async () => {
            try {
              await SessionManager.updateSessionWithCodexCacheKey(
                sessionId,
                promptCacheKey,
                providerId,
                keyId
              );
            } catch (err) {
              logger.error("[ResponseHandler] Failed to update Codex session (stream):", err);
            }
          });
        }

        // F2 终态屏障：replay completed 只能出现在计费落库（onCommitted）之后；
        // 任何失败终态（假 200/中断/非 2xx）立即 abort，绝不被已完成重放命中。
        if (replaySpool) {
          const isReplayableSuccess =
            finalized.commitSideEffects !== undefined &&
            effectiveStatusCode >= 200 &&
            effectiveStatusCode < 300;
          if (isReplayableSuccess) {
            postTerminalSideEffects.push(async () => {
              try {
                await replaySpool.completeAfterBilling(messageContext.id);
              } catch (err) {
                logger.warn("[ResponseHandler] Replay spool completion failed:", { error: err });
              }
            });
          } else {
            void replaySpool.abort(streamErrorMessage ?? `status_${effectiveStatusCode}`);
          }
        }

        // F3a 亲和写回：owner 成功终态（计费落库后）才绑定 tip/sys -> 胜出供应商
        if (
          finalized.commitSideEffects !== undefined &&
          effectiveStatusCode >= 200 &&
          effectiveStatusCode < 300 &&
          session.affinity &&
          providerIdForPersistence
        ) {
          const winnerProviderId = providerIdForPersistence;
          postTerminalSideEffects.push(async () => {
            await recordAffinityWinner(session, winnerProviderId);
          });
        } else if (session.affinity && providerIdForPersistence && finalized.errorMessage) {
          // 流终态失败且失败者正是亲和提名的供应商：写墓碑自愈
          void tombstoneAffinityOnFailure(session, providerIdForPersistence);
        }
        latestStreamCommitSideEffects = postTerminalSideEffects;

        // F3b 缓存模拟列：仅开关开启时派生（关闭时保持 undefined，不落值）
        const cacheScoreFields = getEnvConfig().ENABLE_CACHE_EFFECTIVENESS
          ? computeCacheScoreFields({
              affinity: session.affinity,
              succeeded: effectiveStatusCode >= 200 && effectiveStatusCode < 300,
              usageObservable: usageForCost?.input_tokens != null,
              streamTruncated: !streamEndedNormally,
              cacheTtl: usageForCost?.cache_ttl ?? null,
            })
          : undefined;

        // 保存扩展信息（status code, tokens, provider chain）
        terminalDetailsPersisted = await awaitFinalization(
          updateMessageRequestDetailsDurably(
            messageContext.id,
            {
              statusCode: effectiveStatusCode,
              durationMs: duration,
              inputTokens: usageForCost?.input_tokens,
              outputTokens: usageForCost?.output_tokens,
              ttfbMs: session.ttfbMs,
              cacheCreationInputTokens: usageForCost?.cache_creation_input_tokens,
              cacheReadInputTokens: usageForCost?.cache_read_input_tokens,
              cacheCreation5mInputTokens: usageForCost?.cache_creation_5m_input_tokens,
              cacheCreation1hInputTokens: usageForCost?.cache_creation_1h_input_tokens,
              cacheTtlApplied: usageForCost?.cache_ttl ?? null,
              providerChain: session.getProviderChain(),
              ...(streamErrorMessage ? { errorMessage: streamErrorMessage } : {}),
              model: currentRequestedModel ?? undefined, // 更新重定向后的模型
              actualResponseModel: finalActualResponseModel,
              providerId: providerIdForPersistence ?? session.provider?.id, // 更新最终供应商ID（重试切换后）
              context1mApplied: session.getContext1mApplied(),
              swapCacheTtlApplied: provider.swapCacheTtlBilling ?? false,
              specialSettings: session.getSpecialSettings() ?? undefined,
              ...(cacheScoreFields ?? {}),
            },
            {
              onCommitted: scheduleStreamCommitSideEffects,
            }
          )
        );

        emitProxyLangfuseTrace(session, {
          responseHeaders: response.headers,
          responseText: allContent,
          usageMetrics: usageForCost,
          costUsd: rawCostUsdStr,
          costBreakdown,
          statusCode: effectiveStatusCode,
          durationMs: duration,
          isStreaming: true,
          sseEventCount: getCollectedChunkCount(),
          errorMessage: streamErrorMessage ?? undefined,
        });
      })();
      // F2 兜底：finalize 在终态决策点之前抛出时，spool 会永挂 owning、租约悬置、
      // activeSpoolCount 泄漏。旁路 catch 只做 abort，不吞异常——原 promise 仍向
      // 调用方原样 reject（既有传播语义不变）。
      streamFinalizationPromise.catch(() => {
        if (replaySpool && !replaySpool.isTerminal) {
          void replaySpool.abort("finalize_error");
        }
      });
      return streamFinalizationPromise;
    };

    // F1 shadow 模式：旁路逐帧分类，记录「首非空字节 vs 首有效内容」的分歧与延迟差，
    // 不缓冲、不 failover，仅用于 enforce 灰度前评估误判率。
    const shadowGateObserver = (() => {
      if (resolveStreamGateMode() !== "shadow") return null;
      if (session.getEndpointPolicy().kind === "raw_passthrough") return null;
      const family = mapProviderTypeToFamily(provider.providerType);
      if (!family) return null;
      return createShadowGateObserver({
        family,
        providerId: provider.id,
        providerName: provider.name,
      });
    })();

    // F2 owner spool：guard 阶段已抢到 owner 租约的请求，把客户端可见字节
    // write-behind 喂入 Redis 热层，供并发/断线的相同请求 attach 跟尾。
    const replaySpool = createReplaySpoolIfOwner(session, response);
    if (replaySpool) {
      try {
        clientAbortDrainTimeoutMs = getEnvConfig().REPLAY_MAX_DETACHED_MS;
      } catch {
        // env 解析失败保持 60s 现状
      }
    }

    const observeChunk = (value: Uint8Array) => {
      const chunkSize = value.length;
      clearIdleTimer();
      streamTextAccumulator.pushBytes(value);
      AsyncTaskManager.touch(taskId);
      shadowGateObserver?.observe(value);
      replaySpool?.observe(value);

      logger.trace("ResponseHandler: Upstream stream chunk received", {
        taskId,
        providerId: provider.id,
        chunksCollected: getCollectedChunkCount(),
        lastChunkSize: chunkSize,
        idleTimeoutMs: idleTimeoutMs === Infinity ? "disabled" : idleTimeoutMs,
      });

      if (isFirstChunk) {
        session.recordTtfb();
        isFirstChunk = false;
        if (clearResponseTimeoutOnce()) {
          logger.debug("ResponseHandler: First chunk received, response timeout cleared", {
            taskId,
            providerId: provider.id,
            firstChunkSize: chunkSize,
          });
        }
      }
    };

    responsePump = createDemandDrivenResponsePump({
      source: processedStream,
      onReadStart() {
        // A pending chunk is deliberately not considered Provider idle. The
        // pump invokes this only when it actually starts the next source read.
        if (!isFirstChunk) {
          startIdleTimer();
        }
      },
      onChunk: observeChunk,
      onClientCancel: handleClientAbort,
    });
    const activeResponsePump = responsePump;
    const cleanupResponseControllerAbortListener = bindClientAbortListener(
      (
        session as typeof session & {
          responseController?: AbortController;
        }
      ).responseController?.signal,
      () => {
        const responseControllerAbortError = getResponseControllerAbortError();
        if (responseControllerAbortError) {
          activeResponsePump.errorClient(responseControllerAbortError);
          activeResponsePump.cancelSource(responseControllerAbortError);
        }
      }
    );
    cleanupClientAbortListener = bindClientAbortListener(session.clientAbortSignal, () =>
      handleClientAbort(session.clientAbortSignal?.reason)
    );

    const runProcessingTask = async () => {
      try {
        const pumpCompletion = await activeResponsePump.completion;
        cleanupTaskAbortBinding();
        releaseSessionAgent(session);
        cleanupResponseControllerAbortListener();
        cleanupClientAbortListener();
        cleanupClientAbortListener = () => {};
        clearClientAbortDrainTimer();
        clearIdleTimer();
        clearResponseTimeoutOnce();
        const responseControllerAbortError = getResponseControllerAbortError();
        if (responseControllerAbortError) {
          throw responseControllerAbortError;
        }
        if (pumpCompletion.error) {
          throw pumpCompletion.error;
        }
        const streamEndedNormally =
          pumpCompletion.streamEndedNormally && !abortController.signal.aborted;

        // 流式读取完成：清除静默期计时器
        clearIdleTimer();
        const allContent = flushAndJoin();
        const clientAborted = pumpCompletion.clientAborted;
        try {
          await finalizeStream(allContent, streamEndedNormally, clientAborted);
        } catch (finalizeError) {
          logger.error("ResponseHandler: Failed to finalize stream", {
            taskId,
            providerId: provider.id,
            providerName: provider.name,
            messageId: messageContext.id,
            streamEndedNormally,
            clientAborted,
            finalizeError,
          });

          // 回退：避免 finalizeStream 失败导致 request record 未被更新
          await persistStreamFailureOnce({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error: finalizeError,
            taskId,
            phase: "stream",
          });
        }
      } catch (error) {
        // 检测 AbortError 的来源：响应超时 vs 静默期超时 vs 客户端/上游中断
        const err = error as Error;
        const sessionWithController = session as typeof session & {
          responseController?: AbortController;
        };
        const pumpClientAborted = activeResponsePump.wasClientAborted();
        // The pump records which terminal cause won. Reading the raw signal here
        // would let a later client disconnect overwrite an earlier Provider timeout/error.
        const clientAborted = pumpClientAborted;
        const isResponseControllerAborted =
          sessionWithController.responseController?.signal.aborted ?? false;

        if (isClientAbortError(err)) {
          // 区分不同的超时来源
          const isResponseTimeout = isResponseControllerAborted && !clientAborted;
          const isIdleTimeout = err.message?.includes("streaming_idle");

          if (isResponseTimeout && !isIdleTimeout) {
            // ⚠️ 响应超时（首字节超时）：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Response timeout during stream body read", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: getCollectedChunkCount(),
              errorName: err.name,
            });

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，不抛出异常（避免影响后台任务）

            // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, false, "STREAM_RESPONSE_TIMEOUT");
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize response-timeout stream", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });

              // 回退：至少保证 DB 记录能落下，避免 orphan record
              await persistStreamFailureOnce({
                session,
                messageContext,
                statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
                error: err,
                taskId,
                phase: "stream",
              });
            }
          } else if (isIdleTimeout) {
            // ⚠️ 静默期超时：计入熔断器并记录错误日志
            logger.error("ResponseHandler: Streaming idle timeout", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: getCollectedChunkCount(),
            });

            // 注意：无法重试，因为客户端已收到 HTTP 200
            // 错误已记录，不抛出异常（避免影响后台任务）

            // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
            try {
              const allContent = flushAndJoin();
              await finalizeStream(
                allContent,
                false,
                clientAborted,
                clientAborted ? "CLIENT_ABORTED" : "STREAM_IDLE_TIMEOUT"
              );
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize idle-timeout stream", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });

              // 回退：至少保证 DB 记录能落下，避免 orphan record
              await persistStreamFailureOnce({
                session,
                messageContext,
                statusCode: statusCode && statusCode >= 400 ? statusCode : 502,
                error: err,
                taskId,
                phase: "stream",
              });
            }
          } else if (!clientAborted) {
            // 上游在流式过程中意外中断：视为供应商/网络错误
            logger.error("ResponseHandler: Upstream stream aborted unexpectedly", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: getCollectedChunkCount(),
              errorName: err.name,
              errorMessage: err.message || "(empty message)",
            });

            // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, false, "STREAM_UPSTREAM_ABORTED");
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize upstream-aborted stream", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });

              // 回退：至少保证 DB 记录能落下，避免 orphan record
              await persistStreamFailureOnce({
                session,
                messageContext,
                statusCode: 502,
                error: err,
                taskId,
                phase: "stream",
              });
            }
          } else {
            // 客户端主动中断：正常日志，不抛出错误
            logger.warn("ResponseHandler: Stream reading aborted by client", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: getCollectedChunkCount(),
              errorName: err.name,
              reason:
                err.name === "ResponseAborted"
                  ? "Response transmission interrupted"
                  : "Client disconnected",
            });
            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, true);
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize aborted stream response", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });
              await persistStreamFailureOnce({
                session,
                messageContext,
                statusCode: 499,
                error: "CLIENT_ABORTED",
                taskId,
                phase: "stream",
              });
            }
          }
        } else if (isTransportError(err)) {
          if (pumpClientAborted) {
            logger.warn("ResponseHandler: Transport closed after client detached", {
              taskId,
              providerId: provider.id,
              providerName: provider.name,
              messageId: messageContext.id,
              chunksCollected: getCollectedChunkCount(),
              errorName: err.name,
              errorCode: (err as NodeJS.ErrnoException).code,
            });

            try {
              const allContent = flushAndJoin();
              await finalizeStream(allContent, false, true);
            } catch (finalizeError) {
              logger.error("ResponseHandler: Failed to finalize client-detached transport", {
                taskId,
                messageId: messageContext.id,
                finalizeError,
              });
              await persistStreamFailureOnce({
                session,
                messageContext,
                statusCode: 499,
                error: "CLIENT_ABORTED",
                taskId,
                phase: "stream",
              });
            }
            return;
          }

          // 上游流传输错误（SocketError, ECONNRESET 等）：与 upstream abort 相同处理
          // 参见 #916 — controller.error(err) 传播的 transport error
          logger.error("ResponseHandler: Upstream stream transport error", {
            taskId,
            providerId: provider.id,
            providerName: provider.name,
            messageId: messageContext.id,
            chunksCollected: getCollectedChunkCount(),
            errorName: err.name,
            errorMessage: err.message || "(empty message)",
            errorCode: (err as NodeJS.ErrnoException).code,
          });

          try {
            const allContent = flushAndJoin();
            await finalizeStream(allContent, false, false, "STREAM_UPSTREAM_ABORTED");
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize transport-error stream", {
              taskId,
              messageId: messageContext.id,
              finalizeError,
            });

            await persistStreamFailureOnce({
              session,
              messageContext,
              statusCode: 502,
              error: err,
              taskId,
              phase: "stream",
            });
          }
        } else {
          logger.error("Failed to save SSE content:", error);

          // 结算并消费 deferred meta，确保 provider chain/熔断归因完整
          try {
            const allContent = flushAndJoin();
            await finalizeStream(allContent, false, clientAborted, "STREAM_PROCESSING_ERROR");
          } catch (finalizeError) {
            logger.error("ResponseHandler: Failed to finalize stream after processing error", {
              taskId,
              messageId: messageContext.id,
              finalizeError,
            });

            // 回退：至少保证 DB 记录能落下，避免 orphan record
            await persistStreamFailureOnce({
              session,
              messageContext,
              statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
              error,
              taskId,
              phase: "stream",
            });
          }
        }
      } finally {
        // 确保资源释放
        cleanupTaskAbortBinding();
        cleanupResponseControllerAbortListener();
        cleanupClientAbortListener();
        clearClientAbortDrainTimer();
        clearIdleTimer(); // 清除静默期计时器（防止泄漏）
        releaseSessionAgent(session);
      }
    };

    // 注册任务并添加全局错误捕获
    AsyncTaskManager.register(
      taskId,
      () => {
        const processingPromise = runProcessingTask();
        return processingPromise.catch(async (error) => {
          logger.error("ResponseHandler: Uncaught error in stream processing", {
            taskId,
            messageId: messageContext.id,
            error,
          });

          // 更新数据库记录（避免 orphan record）
          await persistStreamFailureOnce({
            session,
            messageContext,
            statusCode: statusCode && statusCode >= 400 ? statusCode : 500,
            error,
            taskId,
            phase: "stream",
          });
          throw error;
        });
      },
      {
        taskType: "stream-processing",
        abortController,
        staleTimeoutMs: streamTaskStaleTimeoutMs,
      }
    );

    // ⭐ 修复 Bun 运行时的 Transfer-Encoding 重复问题
    // 清理上游的传输 headers，让 Response API 自动管理
    const finalStreamHeaders = cleanResponseHeaders(response.headers);
    if (session.sessionId && session.shouldPersistSessionDebugArtifacts()) {
      const responseAfterMetaTask = SessionManager.storeSessionResponsePhaseSnapshot?.(
        session.sessionId,
        "after",
        {
          headers: finalStreamHeaders,
          meta: {
            upstreamUrl: null,
            statusCode: response.status,
          },
        },
        session.requestSequence
      );
      responseAfterMetaTask?.catch((err) => {
        logger.error("[ResponseHandler] Failed to store stream response after meta:", err);
      });
    }

    return new Response(activeResponsePump.stream, {
      status: response.status,
      statusText: response.statusText,
      headers: finalStreamHeaders,
    });
  }
}

function asNonNegativeFiniteNumber(value: unknown): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return undefined;
  }
  return value;
}

function getNestedOpenAICacheWriteTokens(usage: Record<string, unknown>): number | undefined {
  if (typeof usage.cache_creation_input_tokens === "number") {
    return undefined;
  }

  const inputTokensDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
  const promptTokensDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;

  return (
    asNonNegativeFiniteNumber(inputTokensDetails?.cache_write_tokens) ??
    asNonNegativeFiniteNumber(promptTokensDetails?.cache_write_tokens)
  );
}

export function extractUsageMetrics(value: unknown): UsageMetrics | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const usage = value as Record<string, unknown>;
  const inputTokensDetails = usage.input_tokens_details as Record<string, unknown> | undefined;
  const promptTokensDetails = usage.prompt_tokens_details as Record<string, unknown> | undefined;
  const result: UsageMetrics = {};
  let hasAny = false;

  if (typeof usage.input_tokens === "number") {
    result.input_tokens = usage.input_tokens;
    hasAny = true;
  }

  // Gemini support
  // 注意：promptTokenCount 包含 cachedContentTokenCount，需要减去以避免重复计费
  // 计费公式：input = (promptTokenCount - cachedContentTokenCount) × input_price
  //          cache = cachedContentTokenCount × cache_price
  if (typeof usage.promptTokenCount === "number") {
    const cachedTokens =
      typeof usage.cachedContentTokenCount === "number" ? usage.cachedContentTokenCount : 0;
    result.input_tokens = Math.max(usage.promptTokenCount - cachedTokens, 0);
    hasAny = true;
  }
  if (typeof usage.candidatesTokenCount === "number") {
    result.output_tokens = usage.candidatesTokenCount;
    hasAny = true;
  }

  // OpenAI chat completion format: prompt_tokens → input_tokens
  // Priority: Claude (input_tokens) > Gemini (candidatesTokenCount) > OpenAI (prompt_tokens)
  if (result.input_tokens === undefined && typeof usage.prompt_tokens === "number") {
    result.input_tokens = usage.prompt_tokens;
    hasAny = true;
  }
  // Gemini 缓存支持
  if (typeof usage.cachedContentTokenCount === "number") {
    result.cache_read_input_tokens = usage.cachedContentTokenCount;
    hasAny = true;
  }

  // Gemini modality-specific token details (IMAGE/TEXT)
  // candidatesTokensDetails: 输出 token 按 modality 分类
  const candidatesDetails = usage.candidatesTokensDetails as
    | Array<{ modality?: string; tokenCount?: number }>
    | undefined;
  if (Array.isArray(candidatesDetails) && candidatesDetails.length > 0) {
    let imageTokens = 0;
    let textTokens = 0;
    let hasValidToken = false;
    for (const detail of candidatesDetails) {
      if (typeof detail.tokenCount === "number" && detail.tokenCount > 0) {
        hasValidToken = true;
        const modalityUpper = detail.modality?.toUpperCase();
        if (modalityUpper === "IMAGE") {
          imageTokens += detail.tokenCount;
        } else {
          textTokens += detail.tokenCount;
        }
      }
    }
    if (imageTokens > 0) {
      result.output_image_tokens = imageTokens;
      hasAny = true;
    }
    if (hasValidToken) {
      // 计算未分类的 TEXT tokens: candidatesTokenCount - details总和
      // 这些可能是图片生成的内部开销，按 TEXT 价格计费
      const detailsSum = imageTokens + textTokens;
      const candidatesTotal =
        typeof usage.candidatesTokenCount === "number" ? usage.candidatesTokenCount : 0;
      const unaccountedTokens = Math.max(candidatesTotal - detailsSum, 0);
      result.output_tokens = textTokens + unaccountedTokens;
      hasAny = true;
    }
  }

  // promptTokensDetails: 输入 token 按 modality 分类
  const promptDetails = usage.promptTokensDetails as
    | Array<{ modality?: string; tokenCount?: number }>
    | undefined;
  if (Array.isArray(promptDetails) && promptDetails.length > 0) {
    let imageTokens = 0;
    let textTokens = 0;
    let hasValidToken = false;
    for (const detail of promptDetails) {
      if (typeof detail.tokenCount === "number" && detail.tokenCount > 0) {
        hasValidToken = true;
        const modalityUpper = detail.modality?.toUpperCase();
        if (modalityUpper === "IMAGE") {
          imageTokens += detail.tokenCount;
        } else {
          textTokens += detail.tokenCount;
        }
      }
    }
    if (imageTokens > 0) {
      result.input_image_tokens = imageTokens;
      hasAny = true;
    }
    if (hasValidToken) {
      result.input_tokens = textTokens;
      hasAny = true;
    }
  }

  if (typeof usage.output_tokens === "number") {
    result.output_tokens = usage.output_tokens;
    hasAny = true;
  }

  // Gemini 思考/推理 token：直接累加到 output_tokens（思考价格与输出价格相同）
  // 注意：放在 output_tokens 赋值之后，避免被覆盖
  // output_tokens 是转换的时候才存在的，gemini原生接口的没有该值
  // 通常存在 output_tokens的时候，thoughtsTokenCount=0
  if (typeof usage.thoughtsTokenCount === "number" && usage.thoughtsTokenCount > 0) {
    result.output_tokens = (result.output_tokens ?? 0) + usage.thoughtsTokenCount;
    hasAny = true;
  }

  // OpenAI chat completion format: completion_tokens → output_tokens
  // Priority: Claude (output_tokens) > Gemini (candidatesTokenCount/thoughtsTokenCount) > OpenAI (completion_tokens)
  if (result.output_tokens === undefined && typeof usage.completion_tokens === "number") {
    result.output_tokens = usage.completion_tokens;
    hasAny = true;
  }

  if (typeof usage.cache_creation_input_tokens === "number") {
    result.cache_creation_input_tokens = usage.cache_creation_input_tokens;
    hasAny = true;
  }

  if (result.cache_creation_input_tokens === undefined) {
    const cacheWriteTokens = getNestedOpenAICacheWriteTokens(usage);

    if (cacheWriteTokens !== undefined) {
      result.cache_creation_input_tokens = cacheWriteTokens;
      hasAny = true;
      logger.debug("[ResponseHandler] Parsed cache write tokens from OpenAI usage details", {
        cacheWriteTokens,
      });
    }
  }

  const cacheCreationDetails = usage.cache_creation as Record<string, unknown> | undefined;
  let cacheCreationDetailedTotal = 0;

  if (cacheCreationDetails) {
    if (typeof cacheCreationDetails.ephemeral_5m_input_tokens === "number") {
      result.cache_creation_5m_input_tokens = cacheCreationDetails.ephemeral_5m_input_tokens;
      cacheCreationDetailedTotal += cacheCreationDetails.ephemeral_5m_input_tokens;
      hasAny = true;
    }
    if (typeof cacheCreationDetails.ephemeral_1h_input_tokens === "number") {
      result.cache_creation_1h_input_tokens = cacheCreationDetails.ephemeral_1h_input_tokens;
      cacheCreationDetailedTotal += cacheCreationDetails.ephemeral_1h_input_tokens;
      hasAny = true;
    }
  }

  // 兼容顶层扁平格式：cache_creation_5m_input_tokens / cache_creation_1h_input_tokens
  // 部分供应商/relay 直接在顶层返回细分字段，而非嵌套在 cache_creation 对象中
  // 优先级：嵌套格式 > 顶层扁平格式 > 旧 relay 格式
  if (
    result.cache_creation_5m_input_tokens === undefined &&
    typeof usage.cache_creation_5m_input_tokens === "number"
  ) {
    result.cache_creation_5m_input_tokens = usage.cache_creation_5m_input_tokens;
    cacheCreationDetailedTotal += usage.cache_creation_5m_input_tokens;
    hasAny = true;
  }
  if (
    result.cache_creation_1h_input_tokens === undefined &&
    typeof usage.cache_creation_1h_input_tokens === "number"
  ) {
    result.cache_creation_1h_input_tokens = usage.cache_creation_1h_input_tokens;
    cacheCreationDetailedTotal += usage.cache_creation_1h_input_tokens;
    hasAny = true;
  }

  // 兼容部分 relay / 旧字段命名：claude_cache_creation_5_m_tokens / claude_cache_creation_1_h_tokens
  // 仅在标准字段缺失时使用，避免重复统计（优先级最低）
  if (
    result.cache_creation_5m_input_tokens === undefined &&
    typeof usage.claude_cache_creation_5_m_tokens === "number"
  ) {
    result.cache_creation_5m_input_tokens = usage.claude_cache_creation_5_m_tokens;
    cacheCreationDetailedTotal += usage.claude_cache_creation_5_m_tokens;
    hasAny = true;
  }
  if (
    result.cache_creation_1h_input_tokens === undefined &&
    typeof usage.claude_cache_creation_1_h_tokens === "number"
  ) {
    result.cache_creation_1h_input_tokens = usage.claude_cache_creation_1_h_tokens;
    cacheCreationDetailedTotal += usage.claude_cache_creation_1_h_tokens;
    hasAny = true;
  }

  if (result.cache_creation_input_tokens === undefined && cacheCreationDetailedTotal > 0) {
    result.cache_creation_input_tokens = cacheCreationDetailedTotal;
  }

  if (!result.cache_ttl) {
    if (result.cache_creation_1h_input_tokens && result.cache_creation_5m_input_tokens) {
      result.cache_ttl = "mixed";
    } else if (result.cache_creation_1h_input_tokens) {
      result.cache_ttl = "1h";
    } else if (result.cache_creation_5m_input_tokens) {
      result.cache_ttl = "5m";
    }
  }

  // Claude 格式：顶层 cache_read_input_tokens（扁平结构）
  if (typeof usage.cache_read_input_tokens === "number") {
    result.cache_read_input_tokens = usage.cache_read_input_tokens;
    hasAny = true;
  }

  if (result.cache_read_input_tokens === undefined) {
    if (inputTokensDetails && typeof inputTokensDetails.cached_tokens === "number") {
      result.cache_read_input_tokens = inputTokensDetails.cached_tokens;
      hasAny = true;
      logger.debug("[ResponseHandler] Parsed cached tokens from OpenAI Response API format", {
        cachedTokens: inputTokensDetails.cached_tokens,
      });
    }
  }

  if (result.cache_read_input_tokens === undefined) {
    if (promptTokensDetails && typeof promptTokensDetails.cached_tokens === "number") {
      result.cache_read_input_tokens = promptTokensDetails.cached_tokens;
      hasAny = true;
      logger.debug("[ResponseHandler] Parsed cached tokens from OpenAI Chat Completions format", {
        cachedTokens: promptTokensDetails.cached_tokens,
      });
    }
  }

  return hasAny ? result : null;
}

export function parseUsageFromResponseText(
  responseText: string,
  providerType: string | null | undefined
): {
  usageRecord: Record<string, unknown> | null;
  usageMetrics: UsageMetrics | null;
} {
  let usageRecord: Record<string, unknown> | null = null;
  let usageMetrics: UsageMetrics | null = null;

  const applyUsageValue = (value: unknown, source: string) => {
    if (usageMetrics) {
      return;
    }

    if (!value || typeof value !== "object") {
      return;
    }

    const extracted = extractUsageMetrics(value);
    if (!extracted) {
      return;
    }

    usageRecord = value as Record<string, unknown>;
    usageMetrics = adjustUsageForProviderType(extracted, providerType, usageRecord);

    logger.debug("[ResponseHandler] Parsed usage from response", {
      source,
      providerType,
      usage: usageMetrics,
    });
  };

  try {
    const parsedValue = JSON.parse(responseText);

    if (parsedValue && typeof parsedValue === "object" && !Array.isArray(parsedValue)) {
      const parsed = parsedValue as Record<string, unknown>;

      // Standard usage fields
      applyUsageValue(parsed.usage, "json.root.usage");

      // Gemini usageMetadata (direct)
      applyUsageValue(parsed.usageMetadata, "json.root.usageMetadata");

      // Handle response wrapping (some Gemini providers return {response: {...}})
      if (parsed.response && typeof parsed.response === "object") {
        const responseObj = parsed.response as Record<string, unknown>;
        applyUsageValue(responseObj.usage, "json.response.usage");
        applyUsageValue(responseObj.usageMetadata, "json.response.usageMetadata");
      }

      if (Array.isArray(parsed.output)) {
        for (const item of parsed.output as Array<Record<string, unknown>>) {
          if (!item || typeof item !== "object") {
            continue;
          }
          applyUsageValue(item.usage, "json.output");
        }
      }
    }

    if (!usageMetrics && Array.isArray(parsedValue)) {
      for (const item of parsedValue) {
        if (!item || typeof item !== "object") {
          continue;
        }

        const record = item as Record<string, unknown>;
        applyUsageValue(record.usage, "json.array");

        if (record.data && typeof record.data === "object") {
          applyUsageValue((record.data as Record<string, unknown>).usage, "json.array.data");
        }
      }
    }
  } catch {
    // Fallback to SSE parsing when body is not valid JSON
  }

  // SSE 解析：支持两种格式
  // 1. 标准 SSE (event: + data:) - Claude/OpenAI
  // 2. 纯 data: 格式 - Gemini
  if (!usageMetrics && isSSEText(responseText)) {
    const events = parseSSEData(responseText);

    // Claude SSE 特殊处理：
    // - message_delta 通常包含更完整的 usage（应优先使用）
    // - message_start 可能包含 cache_creation 的 TTL 细分字段（作为缺失字段的补充）
    let messageStartUsage: UsageMetrics | null = null;
    let messageDeltaUsage: UsageMetrics | null = null;

    // Gemini SSE: usageMetadata 需要 last-wins（完整 token 计数仅在最后事件中）
    let lastGeminiUsage: UsageMetrics | null = null;
    let lastGeminiUsageRecord: Record<string, unknown> | null = null;

    const mergeUsageMetrics = (base: UsageMetrics | null, patch: UsageMetrics): UsageMetrics => {
      if (!base) {
        return { ...patch };
      }

      return {
        input_tokens: patch.input_tokens ?? base.input_tokens,
        output_tokens: patch.output_tokens ?? base.output_tokens,
        cache_creation_input_tokens:
          patch.cache_creation_input_tokens ?? base.cache_creation_input_tokens,
        cache_creation_5m_input_tokens:
          patch.cache_creation_5m_input_tokens ?? base.cache_creation_5m_input_tokens,
        cache_creation_1h_input_tokens:
          patch.cache_creation_1h_input_tokens ?? base.cache_creation_1h_input_tokens,
        cache_ttl: patch.cache_ttl ?? base.cache_ttl,
        cache_read_input_tokens: patch.cache_read_input_tokens ?? base.cache_read_input_tokens,
      };
    };

    for (const event of events) {
      if (typeof event.data !== "object" || !event.data) {
        continue;
      }

      const data = event.data as Record<string, unknown>;

      if (event.event === "message_start") {
        // Claude message_start format: data.message.usage
        // 部分 relay 可能是 data.usage（无 message 包裹）
        let usageValue: unknown = null;
        if (data.message && typeof data.message === "object") {
          const messageObj = data.message as Record<string, unknown>;
          usageValue = messageObj.usage;
        }
        if (!usageValue) {
          usageValue = data.usage;
        }

        if (usageValue && typeof usageValue === "object") {
          const extracted = extractUsageMetrics(usageValue);
          if (extracted) {
            messageStartUsage = mergeUsageMetrics(messageStartUsage, extracted);
            logger.debug("[ResponseHandler] Extracted usage from message_start", {
              source:
                usageValue === data.usage
                  ? "sse.message_start.usage"
                  : "sse.message_start.message.usage",
              usage: extracted,
            });
          }
        }
      }

      if (event.event === "message_delta") {
        // Claude message_delta format: data.usage
        let usageValue: unknown = data.usage;
        if (!usageValue && data.delta && typeof data.delta === "object") {
          usageValue = (data.delta as Record<string, unknown>).usage;
        }

        if (usageValue && typeof usageValue === "object") {
          const extracted = extractUsageMetrics(usageValue);
          if (extracted) {
            messageDeltaUsage = mergeUsageMetrics(messageDeltaUsage, extracted);
            logger.debug("[ResponseHandler] Extracted usage from message_delta", {
              source: "sse.message_delta.usage",
              usage: extracted,
            });
          }
        }
      }

      // 非 Claude 格式的 SSE 处理（Gemini 等）
      // 注意：Gemini SSE 流中，usageMetadata 在每个事件中都可能存在，
      // 但只有最后一个事件包含完整的 token 计数（candidatesTokenCount、thoughtsTokenCount 等）
      // 因此需要持续更新，使用最后一个有效值
      if (!messageStartUsage && !messageDeltaUsage) {
        // Standard usage fields (data.usage) - 仍使用 first-wins 策略
        applyUsageValue(data.usage, `sse.${event.event}.usage`);

        // Gemini usageMetadata - 改为 last-wins 策略
        // 跳过 applyUsageValue（它是 first-wins），直接更新
        if (data.usageMetadata && typeof data.usageMetadata === "object") {
          const extracted = extractUsageMetrics(data.usageMetadata);
          if (extracted) {
            // 持续更新，最后一个有效值会覆盖之前的
            lastGeminiUsage = extracted;
            lastGeminiUsageRecord = data.usageMetadata as Record<string, unknown>;
          }
        }

        // Handle response wrapping in SSE
        if (!usageMetrics && data.response && typeof data.response === "object") {
          const responseObj = data.response as Record<string, unknown>;
          applyUsageValue(responseObj.usage, `sse.${event.event}.response.usage`);

          // response.usageMetadata 也使用 last-wins 策略
          if (responseObj.usageMetadata && typeof responseObj.usageMetadata === "object") {
            const extracted = extractUsageMetrics(responseObj.usageMetadata);
            if (extracted) {
              lastGeminiUsage = extracted;
              lastGeminiUsageRecord = responseObj.usageMetadata as Record<string, unknown>;
            }
          }
        }
      }
    }

    // Claude SSE 合并规则：优先使用 message_delta，缺失字段再回退到 message_start
    const mergedClaudeUsage = (() => {
      if (messageDeltaUsage && messageStartUsage) {
        return mergeUsageMetrics(messageStartUsage, messageDeltaUsage);
      }
      return messageDeltaUsage ?? messageStartUsage;
    })();

    if (mergedClaudeUsage) {
      usageRecord = mergedClaudeUsage as unknown as Record<string, unknown>;
      usageMetrics = adjustUsageForProviderType(mergedClaudeUsage, providerType, usageRecord);
      logger.debug("[ResponseHandler] Final merged usage from Claude SSE", {
        providerType,
        usage: usageMetrics,
      });
    }

    // Gemini SSE 处理：使用最后一个有效的 usageMetadata
    // 仅当 Claude SSE 没有提供 usage 且 applyUsageValue 也没有找到时才使用
    if (!usageMetrics && lastGeminiUsage) {
      usageRecord = lastGeminiUsageRecord;
      usageMetrics = adjustUsageForProviderType(lastGeminiUsage, providerType, usageRecord);
      logger.debug("[ResponseHandler] Final usage from Gemini SSE (last event)", {
        providerType,
        usage: usageMetrics,
      });
    }
  }

  return { usageRecord, usageMetrics };
}

// Provider types whose upstream APIs report cache tokens as subsets of
// input_tokens (OpenAI semantics) rather than as disjoint buckets (Anthropic
// semantics). For these, subtract both cache buckets from input_tokens before
// persistence so internal cost buckets are not double-counted.
const PROVIDERS_WITH_CACHE_SUBSET_USAGE = new Set<string>(["codex", "openai-compatible"]);

function adjustUsageForProviderType(
  usage: UsageMetrics,
  providerType: string | null | undefined,
  rawUsage: Record<string, unknown> | null
): UsageMetrics {
  if (!providerType || !PROVIDERS_WITH_CACHE_SUBSET_USAGE.has(providerType)) {
    return usage;
  }

  const inputTokens = usage.input_tokens;
  if (typeof inputTokens !== "number") {
    return usage;
  }

  const cachedTokens = asNonNegativeFiniteNumber(usage.cache_read_input_tokens) ?? 0;
  const cacheWriteTokens = rawUsage ? (getNestedOpenAICacheWriteTokens(rawUsage) ?? 0) : 0;
  const adjustedInput = Math.max(inputTokens - cachedTokens - cacheWriteTokens, 0);
  if (adjustedInput === inputTokens) {
    return usage;
  }

  logger.debug("[UsageMetrics] Adjusted input tokens to exclude cache buckets", {
    providerType,
    originalInputTokens: inputTokens,
    cachedTokens,
    cacheWriteTokens,
    adjustedInputTokens: adjustedInput,
  });

  return {
    ...usage,
    input_tokens: adjustedInput,
  };
}

/**
 * Swap 5m/1h cache buckets and cache_ttl when provider.swapCacheTtlBilling is enabled.
 * Mutates in-place.
 */
export function applySwapCacheTtlBilling(usage: UsageMetrics, swap: boolean | undefined): void {
  if (!swap) return;
  [usage.cache_creation_5m_input_tokens, usage.cache_creation_1h_input_tokens] = [
    usage.cache_creation_1h_input_tokens,
    usage.cache_creation_5m_input_tokens,
  ];
  if (usage.cache_ttl === "5m") usage.cache_ttl = "1h";
  else if (usage.cache_ttl === "1h") usage.cache_ttl = "5m";
}

/**
 * Apply swap + resolve session fallback cache_ttl + normalize cache buckets.
 * Returns a new UsageMetrics object with consistent bucket routing.
 * The input object is NOT mutated -- swap is applied to an internal clone.
 */
function normalizeUsageWithSwap(
  usageMetrics: UsageMetrics,
  session: ProxySession,
  swapCacheTtlBilling?: boolean
): UsageMetrics {
  // Clone before mutating to prevent caller side-effects and double-swap risks
  const swapped = { ...usageMetrics };
  applySwapCacheTtlBilling(swapped, swapCacheTtlBilling);

  let resolvedCacheTtl = swapped.cache_ttl ?? session.getCacheTtlResolved?.() ?? null;

  // When the upstream response had no cache_ttl，we fell through to the session-level
  // getCacheTtlResolved() fallback which reflects the *original* (un-swapped) value.
  // We must invert it here to stay consistent with the already-swapped bucket tokens.
  if (swapCacheTtlBilling && !usageMetrics.cache_ttl) {
    if (resolvedCacheTtl === "5m") resolvedCacheTtl = "1h";
    else if (resolvedCacheTtl === "1h") resolvedCacheTtl = "5m";
  }

  const cache5m =
    swapped.cache_creation_5m_input_tokens ??
    (resolvedCacheTtl === "1h" ? undefined : swapped.cache_creation_input_tokens);
  const cache1h =
    swapped.cache_creation_1h_input_tokens ??
    (resolvedCacheTtl === "1h" ? swapped.cache_creation_input_tokens : undefined);
  const cacheTotal =
    swapped.cache_creation_input_tokens ?? ((cache5m ?? 0) + (cache1h ?? 0) || undefined);

  return {
    ...swapped,
    cache_ttl: resolvedCacheTtl ?? swapped.cache_ttl,
    cache_creation_5m_input_tokens: cache5m,
    cache_creation_1h_input_tokens: cache1h,
    cache_creation_input_tokens: cacheTotal,
  };
}

async function updateRequestCostFromUsage(
  messageId: number,
  session: ProxySession,
  usage: UsageMetrics | null,
  billing: BillingComputeInputs,
  // When true the winner cost is written via a direct, idempotent, loser-sum-aware
  // replacement (cost_usd = winnerCost + SUM(hedge_losers[].costUsd)) so it coexists
  // with losers' concurrent additive writes without clobbering or double-counting.
  // Used for hedge-path winners when billHedgeLosers is on.
  winnerLoserAware: boolean = false
): Promise<{
  costUsd: string | null;
  resolvedPricing: Awaited<ReturnType<ProxySession["getResolvedPricingByBillingSource"]>> | null;
  longContextPricing: ResolvedLongContextPricing | null;
  longContextPricingApplied: boolean;
}> {
  const {
    provider,
    costMultiplier,
    context1mApplied,
    priorityServiceTierApplied,
    groupCostMultiplier,
  } = billing;
  if (!usage) {
    logger.warn("[CostCalculation] No usage data, skipping cost update", {
      messageId,
    });
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }

  if (isNonBillingUsageEndpoint(session)) {
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }

  const originalModel = session.getOriginalModel();
  const redirectedModel = session.getCurrentModel();

  if (!originalModel && !redirectedModel) {
    logger.warn("[CostCalculation] No model name available", { messageId });
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }

  try {
    const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);

    if (!resolvedPricing?.priceData || !hasValidPriceData(resolvedPricing.priceData)) {
      logger.warn("[CostCalculation] No price data found, skipping billing", {
        messageId,
        originalModel,
        redirectedModel,
      });

      requestCloudPriceTableSync({ reason: "missing-model" });
      return {
        costUsd: null,
        resolvedPricing: null,
        longContextPricing: null,
        longContextPricingApplied: false,
      };
    }

    const longContextPricing =
      matchLongContextPricing(usage, resolvedPricing.priceData)?.pricing ?? null;
    const cost = calculateRequestCost(
      usage,
      resolvedPricing.priceData,
      buildCostCalculationOptions(
        costMultiplier,
        context1mApplied,
        priorityServiceTierApplied,
        longContextPricing,
        groupCostMultiplier
      )
    );

    // Calculate and store cost breakdown
    let storedBreakdown: StoredCostBreakdown | undefined;
    try {
      const breakdown = calculateRequestCostBreakdown(usage, resolvedPricing.priceData, {
        context1mApplied,
        priorityServiceTierApplied,
        longContextPricing,
      });
      const baseTotal = new Decimal(breakdown.input)
        .plus(breakdown.output)
        .plus(breakdown.cache_creation)
        .plus(breakdown.cache_read);
      // Use the same sanitization rules as calculateRequestCost so that
      // total === base_total * provider_multiplier * group_multiplier
      // holds even when the caller passes NaN / Infinity / negative values.
      storedBreakdown = {
        input: String(breakdown.input),
        output: String(breakdown.output),
        cache_creation: String(breakdown.cache_creation),
        cache_creation_5m: String(breakdown.cache_creation_5m),
        cache_creation_1h: String(breakdown.cache_creation_1h),
        cache_read: String(breakdown.cache_read),
        base_total: baseTotal.toDecimalPlaces(COST_SCALE).toString(),
        provider_multiplier: sanitizeMultiplier(costMultiplier),
        group_multiplier: sanitizeMultiplier(groupCostMultiplier),
        total: cost.toString(),
      };
    } catch {
      /* non-critical */
    }

    logger.info("[CostCalculation] Cost calculated successfully", {
      messageId,
      usedModelForPricing: resolvedPricing.resolvedModelName,
      resolvedPricingProviderKey: resolvedPricing.resolvedPricingProviderKey,
      pricingResolutionSource: resolvedPricing.source,
      costUsd: cost.toString(),
      costMultiplier,
      groupCostMultiplier,
      usage,
    });

    if (cost.gt(0)) {
      if (winnerLoserAware) {
        await updateMessageRequestWinnerCost(messageId, cost, storedBreakdown);
      } else {
        await updateMessageRequestCostWithBreakdown(messageId, cost, storedBreakdown);
      }
      return {
        costUsd: cost.toString(),
        resolvedPricing,
        longContextPricing,
        longContextPricingApplied: longContextPricing != null,
      };
    } else {
      logger.warn("[CostCalculation] Calculated cost is zero or negative", {
        messageId,
        usedModelForPricing: resolvedPricing.resolvedModelName,
        resolvedPricingProviderKey: resolvedPricing.resolvedPricingProviderKey,
        costUsd: cost.toString(),
        priceData: {
          inputCost: resolvedPricing.priceData.input_cost_per_token,
          outputCost: resolvedPricing.priceData.output_cost_per_token,
        },
      });
    }
    return {
      costUsd: null,
      resolvedPricing,
      longContextPricing,
      longContextPricingApplied: longContextPricing != null,
    };
  } catch (error) {
    logger.error("[CostCalculation] Failed to update request cost, skipping billing", {
      messageId,
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      costUsd: null,
      resolvedPricing: null,
      longContextPricing: null,
      longContextPricingApplied: false,
    };
  }
}

/**
 * Bill a hedge (provider racing) loser whose upstream response was drained in the
 * background by the forwarder.
 *
 * Mirrors the winner billing pipeline (parse usage -> normalize -> billable gate ->
 * resolve pricing -> compute cost) but using the LOSER's provider/session for pricing
 * and multipliers, then accumulates the cost onto the ORIGINAL request row via the
 * additive write-back (cost_usd += delta, hedge_losers ||= [entry]).
 *
 * Best-effort: any failure is logged and swallowed so a loser-billing problem never
 * affects the winner's response. Returns the billed cost string, or null if nothing
 * was billed (no usage / non-billable / zero cost).
 */
export async function finalizeHedgeLoserBilling(params: {
  messageRequestId: number;
  /** Original request timestamp for Redis rolling-window alignment. */
  messageRequestCreatedAtMs: number;
  /** Loser's session — used for pricing/multiplier resolution and Redis cost tracking. */
  loserSession: ProxySession;
  provider: Provider;
  /** Hedge attempt sequence number, for the audit entry. */
  attemptNumber: number;
  /** Upstream HTTP status of the loser's response. */
  upstreamStatusCode: number;
  /** The drained loser response body (SSE or JSON). */
  allContent: string;
  /**
   * Whether the loser stream was read to its natural end. When false (drain hit the
   * timeout / size cap / a network abort), we only bill if real token usage was parsed
   * — never the input_cost_per_request {0,0} sentinel, which would over-charge a phantom
   * per-request fee for a truncated stream.
   */
  drainComplete: boolean;
  /**
   * Billing context captured BEFORE the shared session could be polluted by
   * syncWinningAttemptSession (only set for the INITIAL provider's losing attempt, whose
   * session is overwritten with the winner's model). Shadow-session losers leave this
   * undefined and read their own (un-polluted) session.
   */
  billingContext?: {
    originalModel: string | null;
    redirectedModel: string | null;
    requestedServiceTier: string | null;
    context1mApplied: boolean;
    groupCostMultiplier: number;
  };
}): Promise<string | null> {
  const {
    messageRequestId,
    messageRequestCreatedAtMs,
    loserSession,
    provider,
    attemptNumber,
    upstreamStatusCode,
    allContent,
    drainComplete,
    billingContext,
  } = params;

  try {
    if (isNonBillingUsageEndpoint(loserSession)) {
      return null;
    }

    const { usageMetrics } = parseUsageFromResponseText(allContent, provider.providerType);
    let usageForCost = usageMetrics;
    if (usageForCost) {
      usageForCost = normalizeUsageWithSwap(
        usageForCost,
        loserSession,
        provider.swapCacheTtlBilling
      );
    }

    // Truncated drain (timeout / cap / abort) with no parsed usage: do NOT fall through to
    // the per-request-fee sentinel — that would over-bill a phantom fee for an incomplete stream.
    if (!drainComplete && !usageForCost) {
      return null;
    }

    // Same billable gate as the winner: status-code / fake-200 / non-billing checks.
    const billableUsage = await resolveBillableUsageMetricsForCost(
      loserSession,
      provider,
      usageForCost,
      upstreamStatusCode,
      allContent
    );
    if (!billableUsage) {
      return null;
    }

    const resolvedPricing = await loserSession.getResolvedPricingByBillingSource(
      provider,
      billingContext
        ? {
            originalModel: billingContext.originalModel,
            redirectedModel: billingContext.redirectedModel,
          }
        : undefined
    );
    if (!resolvedPricing?.priceData || !hasValidPriceData(resolvedPricing.priceData)) {
      return null;
    }

    const actualServiceTier = parseServiceTierFromResponseText(allContent);
    const priorityServiceTierApplied =
      (
        await resolveCodexPriorityBillingDecision(loserSession, actualServiceTier, {
          provider,
          ...(billingContext ? { requestedServiceTier: billingContext.requestedServiceTier } : {}),
        })
      )?.effectivePriority ?? false;
    // Mirror the winner: a Codex loser with a large prompt must trigger the 1M context tier,
    // else it under-bills. Only mutate for shadow-session losers (no snapshot) — the initial
    // loser uses its pre-pollution snapshot and must not mutate the shared/original session.
    if (!billingContext) {
      maybeSetCodexContext1m(loserSession, provider, billableUsage.input_tokens);
    }
    const context1mApplied = billingContext?.context1mApplied ?? loserSession.getContext1mApplied();
    const costMultiplier = provider.costMultiplier;
    const groupCostMultiplier =
      billingContext?.groupCostMultiplier ?? loserSession.getGroupCostMultiplier();

    const longContextPricing =
      matchLongContextPricing(billableUsage, resolvedPricing.priceData)?.pricing ?? null;
    const cost = calculateRequestCost(
      billableUsage,
      resolvedPricing.priceData,
      buildCostCalculationOptions(
        costMultiplier,
        context1mApplied,
        priorityServiceTierApplied,
        longContextPricing,
        groupCostMultiplier
      )
    );

    if (!cost.gt(0)) {
      return null;
    }

    const loserEntry: HedgeLoserBilling = {
      providerId: provider.id,
      providerName: provider.name,
      attemptNumber,
      costUsd: cost.toString(),
      inputTokens: billableUsage.input_tokens,
      outputTokens: billableUsage.output_tokens,
      cacheCreationInputTokens: billableUsage.cache_creation_input_tokens,
      cacheReadInputTokens: billableUsage.cache_read_input_tokens,
    };

    await addMessageRequestHedgeLoserCost(messageRequestId, cost, loserEntry);

    // Track the loser cost into the same Redis spend counters the winner uses, so the
    // key/user/provider rate limits account for it (DB and limit enforcement stay in sync).
    await trackCostToRedis(
      loserSession,
      billableUsage,
      {
        provider,
        costMultiplier,
        context1mApplied,
        priorityServiceTierApplied,
        groupCostMultiplier,
      },
      { resolvedPricing, longContextPricing },
      {
        eventId: `${messageRequestId}:hedge-loser:${provider.id}:${attemptNumber}`,
        createdAtMs: messageRequestCreatedAtMs,
      }
    );

    logger.info("[HedgeLoserBilling] Billed hedge loser", {
      messageRequestId,
      providerId: provider.id,
      providerName: provider.name,
      attemptNumber,
      costUsd: cost.toString(),
    });

    return cost.toString();
  } catch (error) {
    logger.warn("[HedgeLoserBilling] Failed to bill hedge loser, skipping", {
      messageRequestId,
      providerId: provider.id,
      providerName: provider.name,
      attemptNumber,
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * 统一的请求统计处理方法
 * 用于消除 Gemini 透传、普通非流式、普通流式之间的重复统计逻辑
 *
 * @param statusCode - 内部结算状态码（可能与客户端实际收到的 HTTP 状态不同，例如“假 200”会被推断并映射为更贴近语义的 4xx/5xx；
 *                   未命中推断规则时回退为 502）
 * @param errorMessage - 可选的内部错误原因（用于把假 200/解析失败等信息写入 DB 与监控）
 */
export async function finalizeRequestStats(
  session: ProxySession,
  responseText: string,
  statusCode: number,
  duration: number,
  errorMessage?: string,
  providerIdOverride?: number,
  /**
   * 是否流式上下文。调用方已知时必须显式传入:
   * - Gemini 透传 NDJSON 没有 `data:`/`event:` 头,isSSEText() 会判成非流式,
   *   导致 extractActualResponseModelForProvider 走 non-stream JSON.parse 失败
   * - 如果不传则回退为 isSSEText 嗅探(仅兼容保留)
   */
  isStreaming?: boolean,
  onCommitted?: () => void | Promise<void>
): Promise<UsageMetrics | null> {
  const { messageContext, provider } = session;
  if (!provider || !messageContext) {
    return null;
  }
  const resolvedIsStream = isStreaming ?? isSSEText(responseText);

  const providerIdForPersistence = providerIdOverride ?? session.provider?.id;
  // Hedge-path (e.g. Gemini passthrough) winners reach finalization here instead of via
  // finalizeStream. Peek the deferred meta (without consuming it — commitWinner already did
  // the binding/chain) so the winner cost write uses the loser-sum-aware mode and does not
  // clobber concurrently-billed loser increments.
  const winnerLoserAware = peekDeferredStreamingFinalization(session)?.billHedgeLosers === true;
  const { usageMetrics } = parseUsageFromResponseText(responseText, provider.providerType);
  const actualServiceTier = parseServiceTierFromResponseText(responseText);
  const codexPriorityBillingDecision = await resolveCodexPriorityBillingDecision(
    session,
    actualServiceTier
  );
  if (!isNonBillingUsageEndpoint(session)) {
    ensureCodexServiceTierResultSpecialSetting(session, codexPriorityBillingDecision);
  }
  const priorityServiceTierApplied = codexPriorityBillingDecision?.effectivePriority ?? false;
  if (!usageMetrics) {
    const billablePerRequestUsage = await resolveBillableUsageMetricsForCost(
      session,
      provider,
      null,
      statusCode,
      responseText
    );
    let perRequestCostUsd: string | undefined;

    if (billablePerRequestUsage) {
      const billing = sessionBillingInputs(session, provider, priorityServiceTierApplied);
      const costUpdateResult = await updateRequestCostFromUsage(
        messageContext.id,
        session,
        billablePerRequestUsage,
        billing,
        winnerLoserAware
      );
      if (costUpdateResult.resolvedPricing) {
        ensurePricingResolutionSpecialSetting(session, costUpdateResult.resolvedPricing);
      }
      if (costUpdateResult.longContextPricingApplied) {
        ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
      }

      await trackCostToRedis(session, billablePerRequestUsage, billing, {
        resolvedPricing: costUpdateResult.resolvedPricing,
        longContextPricing: costUpdateResult.longContextPricing,
      });
      perRequestCostUsd = costUpdateResult.costUsd ?? undefined;
    }

    if (
      session.sessionId &&
      perRequestCostUsd !== undefined &&
      session.shouldTrackSessionObservability()
    ) {
      void SessionManager.updateSessionUsage(session.sessionId, {
        costUsd: perRequestCostUsd,
        status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
        statusCode,
        ...(errorMessage ? { errorMessage } : {}),
      }).catch((error: unknown) => {
        logger.error("[ResponseHandler] Failed to update session usage:", error);
      });
    }

    const terminalDetails = {
      statusCode: statusCode,
      durationMs: duration,
      ...(errorMessage ? { errorMessage } : {}),
      ttfbMs: session.ttfbMs ?? duration,
      providerChain: session.getProviderChain(),
      model: session.getCurrentModel() ?? undefined,
      actualResponseModel: extractActualResponseModelForProvider(
        provider.providerType,
        resolvedIsStream,
        responseText
      ),
      providerId: providerIdForPersistence,
      context1mApplied: session.getContext1mApplied(),
      swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
      specialSettings: session.getSpecialSettings() ?? undefined,
    };
    if (onCommitted) {
      await updateMessageRequestDetailsDurably(messageContext.id, terminalDetails, {
        onCommitted,
      });
    } else {
      await updateMessageRequestDetailsDurably(messageContext.id, terminalDetails);
    }
    return null;
  }

  // 4. 更新成本
  // Invert cache TTL at data entry when provider option is enabled
  // All downstream (badge, cost, DB, logs) will see inverted values
  const normalizedUsage = normalizeUsageWithSwap(
    usageMetrics,
    session,
    provider.swapCacheTtlBilling
  );
  const billableNormalizedUsage = !isNonBillingUsageEndpoint(session) ? normalizedUsage : null;

  // 非计费端点（count_tokens / compact）不得触发 Codex 1M 上下文开关，
  // 否则会影响同 session 后续真实请求的账单口径。
  if (billableNormalizedUsage) {
    maybeSetCodexContext1m(session, provider, billableNormalizedUsage.input_tokens);
  }

  const billing = sessionBillingInputs(session, provider, priorityServiceTierApplied);
  const costUpdateResult = await updateRequestCostFromUsage(
    messageContext.id,
    session,
    normalizedUsage,
    billing,
    winnerLoserAware
  );
  if (costUpdateResult.longContextPricingApplied) {
    ensureLongContextPricingAudit(session, costUpdateResult.longContextPricing);
  }

  // 5. 追踪消费到 Redis（用于限流）
  await trackCostToRedis(session, normalizedUsage, billing, {
    resolvedPricing: costUpdateResult.resolvedPricing,
    longContextPricing: costUpdateResult.longContextPricing,
  });

  // 6. 更新 session usage
  if (session.sessionId) {
    let costUsdStr: string | undefined;
    try {
      if (billableNormalizedUsage && session.request.model) {
        const resolvedPricing = await session.getResolvedPricingByBillingSource(provider);
        if (resolvedPricing) {
          ensurePricingResolutionSpecialSetting(session, resolvedPricing);
          const longContextPricing =
            matchLongContextPricing(billableNormalizedUsage, resolvedPricing.priceData)?.pricing ??
            null;
          const cost = calculateRequestCost(
            billableNormalizedUsage,
            resolvedPricing.priceData,
            buildCostCalculationOptions(
              provider.costMultiplier,
              session.getContext1mApplied(),
              priorityServiceTierApplied,
              longContextPricing,
              session.getGroupCostMultiplier()
            )
          );
          if (cost.gt(0)) {
            costUsdStr = cost.toString();
          }
        }
      }
    } catch (error) {
      logger.error("[ResponseHandler] Failed to calculate session cost (finalize), skipping", {
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (session.shouldTrackSessionObservability()) {
      void SessionManager.updateSessionUsage(session.sessionId, {
        inputTokens: normalizedUsage.input_tokens,
        outputTokens: normalizedUsage.output_tokens,
        cacheCreationInputTokens: normalizedUsage.cache_creation_input_tokens,
        cacheReadInputTokens: normalizedUsage.cache_read_input_tokens,
        costUsd: costUsdStr,
        status: statusCode >= 200 && statusCode < 300 ? "completed" : "error",
        statusCode: statusCode,
        ...(errorMessage ? { errorMessage } : {}),
      }).catch((error: unknown) => {
        logger.error("[ResponseHandler] Failed to update session usage:", error);
      });
    }
  }

  // 7. 更新请求详情
  const terminalDetails = {
    statusCode: statusCode,
    durationMs: duration,
    inputTokens: normalizedUsage.input_tokens,
    outputTokens: normalizedUsage.output_tokens,
    ttfbMs: session.ttfbMs ?? duration,
    cacheCreationInputTokens: normalizedUsage.cache_creation_input_tokens,
    cacheReadInputTokens: normalizedUsage.cache_read_input_tokens,
    cacheCreation5mInputTokens: normalizedUsage.cache_creation_5m_input_tokens,
    cacheCreation1hInputTokens: normalizedUsage.cache_creation_1h_input_tokens,
    cacheTtlApplied: normalizedUsage.cache_ttl ?? null,
    providerChain: session.getProviderChain(),
    ...(errorMessage ? { errorMessage } : {}),
    model: session.getCurrentModel() ?? undefined,
    actualResponseModel: extractActualResponseModelForProvider(
      provider.providerType,
      resolvedIsStream,
      responseText
    ),
    providerId: providerIdForPersistence, // 更新最终供应商ID（重试切换后）
    context1mApplied: session.getContext1mApplied(),
    swapCacheTtlApplied: provider.swapCacheTtlBilling ?? false,
    specialSettings: session.getSpecialSettings() ?? undefined,
  };
  if (onCommitted) {
    await updateMessageRequestDetailsDurably(messageContext.id, terminalDetails, { onCommitted });
  } else {
    await updateMessageRequestDetailsDurably(messageContext.id, terminalDetails);
  }

  if (session.sessionId && session.requestSequence != null) {
    if (session.shouldTrackSessionObservability()) {
      void deleteLiveChain(session.sessionId, session.requestSequence);
    }
  }

  return normalizedUsage;
}

/**
 * 追踪消费到 Redis（用于限流）
 */
/**
 * 计费五元组（U19）：一次构造，贯穿 updateRequestCostFromUsage / trackCostToRedis /
 * buildCostCalculationOptions。正常路径用 sessionBillingInputs 从会话即时取值；
 * hedge loser 路径用 commitWinner 之前的快照构造，避免被赢家提交污染。
 */
type BillingComputeInputs = {
  provider: Provider | null;
  costMultiplier: number;
  context1mApplied: boolean;
  priorityServiceTierApplied: boolean;
  groupCostMultiplier: number;
};

type CostTrackingEventContext = {
  eventId: string | number;
  createdAtMs: number;
};

function sessionBillingInputs(
  session: ProxySession,
  provider: Provider,
  priorityServiceTierApplied: boolean
): BillingComputeInputs {
  return {
    provider,
    costMultiplier: provider.costMultiplier,
    context1mApplied: session.getContext1mApplied(),
    priorityServiceTierApplied,
    groupCostMultiplier: session.getGroupCostMultiplier(),
  };
}

async function trackCostToRedis(
  session: ProxySession,
  usage: UsageMetrics | null,
  billing: BillingComputeInputs,
  pricingOverrides?: {
    resolvedPricing?: Awaited<ReturnType<ProxySession["getResolvedPricingByBillingSource"]>> | null;
    longContextPricing?: ResolvedLongContextPricing | null;
  },
  eventContext?: CostTrackingEventContext
): Promise<void> {
  if (!usage) return;
  if (isNonBillingUsageEndpoint(session)) return;

  try {
    const messageContext = session.messageContext;
    const { provider, priorityServiceTierApplied } = billing;
    const key = session.authState?.key;
    const user = session.authState?.user;

    if (!provider || !key || !user) return;

    const eventId = eventContext?.eventId ?? messageContext?.id;
    const createdAtMs = eventContext?.createdAtMs ?? messageContext?.createdAt.getTime();
    if (eventId == null || createdAtMs == null || !Number.isFinite(createdAtMs)) return;

    const modelName = session.request.model;
    if (!modelName) return;

    const resolvedPricing =
      pricingOverrides?.resolvedPricing === undefined
        ? await session.getResolvedPricingByBillingSource(provider)
        : pricingOverrides.resolvedPricing;
    if (!resolvedPricing) return;

    ensurePricingResolutionSpecialSetting(session, resolvedPricing);
    const longContextPricing =
      pricingOverrides?.longContextPricing === undefined
        ? (matchLongContextPricing(usage, resolvedPricing.priceData)?.pricing ?? null)
        : pricingOverrides.longContextPricing;

    const cost = calculateRequestCost(
      usage,
      resolvedPricing.priceData,
      buildCostCalculationOptions(
        billing.costMultiplier,
        billing.context1mApplied,
        priorityServiceTierApplied,
        longContextPricing,
        billing.groupCostMultiplier
      )
    );
    if (cost.lte(0)) return;

    const costFloat = parseFloat(cost.toString());

    // 追踪到 Redis（使用 session.sessionId）
    await RateLimitService.trackCost(key.id, provider.id, session.sessionId ?? "", costFloat, {
      userId: user.id,
      key5hResetMode: key.limit5hResetMode,
      keyResetTime: key.dailyResetTime,
      keyResetMode: key.dailyResetMode,
      provider5hResetMode: provider.limit5hResetMode,
      providerResetTime: provider.dailyResetTime,
      providerResetMode: provider.dailyResetMode,
      user5hResetMode: user.limit5hResetMode,
      userResetTime: user.dailyResetTime,
      userResetMode: user.dailyResetMode,
      requestId: eventId,
      createdAtMs,
    });

    await RateLimitService.settleLeaseBudgets({
      requestId: eventId,
      cost: costFloat,
      entities: {
        key: {
          id: key.id,
          resetModes: { "5h": key.limit5hResetMode, daily: key.dailyResetMode },
        },
        user: {
          id: user.id,
          resetModes: { "5h": user.limit5hResetMode, daily: user.dailyResetMode },
        },
        provider: {
          id: provider.id,
          resetModes: { "5h": provider.limit5hResetMode, daily: provider.dailyResetMode },
        },
      },
    });

    // 刷新 session 时间戳（滑动窗口）
    if (session.sessionId && session.shouldTrackSessionObservability()) {
      void SessionTracker.refreshSession(session.sessionId, key.id, provider.id, user.id).catch(
        (error) => {
          logger.error("[ResponseHandler] Failed to refresh session tracker:", error);
        }
      );
    }
  } catch (error) {
    logger.error("[ResponseHandler] Failed to track cost to Redis, skipping", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function buildProcessingErrorDetails(error: unknown): {
  errorMessage: string;
  errorStack?: string;
  errorCause?: string;
} {
  const databaseError = findSafeDatabaseError(error);
  if (databaseError) {
    return { errorMessage: databaseError.message };
  }

  const maxErrorStackLength = 8192;
  const maxErrorCauseLength = 4096;
  const errorMessage = formatProcessingError(error);

  let errorStack = error instanceof Error ? error.stack : undefined;
  if (errorStack && errorStack.length > maxErrorStackLength) {
    errorStack = `${errorStack.substring(0, maxErrorStackLength)}\n...[truncated]`;
  }

  let errorCause: string | undefined;
  if (error instanceof Error && (error as NodeJS.ErrnoException).cause) {
    try {
      const cause = (error as NodeJS.ErrnoException).cause;
      errorCause = JSON.stringify(cause, Object.getOwnPropertyNames(cause as object));
    } catch {
      errorCause = String((error as NodeJS.ErrnoException).cause);
    }
    if (errorCause && errorCause.length > maxErrorCauseLength) {
      errorCause = `${errorCause.substring(0, maxErrorCauseLength)}...[truncated]`;
    }
  }

  return { errorMessage, errorStack, errorCause };
}

/**
 * 持久化请求失败信息到数据库
 * - 用于后台异步任务中的错误处理，确保 orphan records 被正确更新
 * - 包含完整的错误信息、duration、status code 和 provider chain
 */
async function persistRequestFailure(options: {
  session: ProxySession;
  messageContext: ProxySession["messageContext"] | null;
  statusCode: number;
  error: unknown;
  taskId: string;
  phase: "stream" | "non-stream";
  awaitPersistence?: <T>(promise: Promise<T>) => Promise<T>;
  detailsWriter?: typeof updateMessageRequestDetailsIfUnfinalized;
  onCommitted?: () => void | Promise<void>;
}): Promise<boolean> {
  const { session, messageContext, statusCode, error, taskId, phase } = options;
  const awaitPersistence = options.awaitPersistence ?? (<T>(promise: Promise<T>) => promise);
  const detailsWriter = options.detailsWriter ?? updateMessageRequestDetailsIfUnfinalized;

  if (!messageContext) {
    logger.warn("ResponseHandler: Cannot persist failure without messageContext", {
      taskId,
      phase,
    });
    return false;
  }

  const tracker = ProxyStatusTracker.getInstance();
  const { errorMessage, errorStack, errorCause } = buildProcessingErrorDetails(error);
  const duration = Date.now() - session.startTime;
  let committed = false;

  try {
    // duration 与 terminal status 必须属于同一个 CAS patch，避免 ordinary
    // metadata 在 overflow 或进程退出时丢失而留下永久 active 记录。
    const terminalDetails = {
      statusCode,
      durationMs: duration,
      errorMessage,
      errorStack,
      errorCause,
      ttfbMs: phase === "non-stream" ? (session.ttfbMs ?? duration) : session.ttfbMs,
      providerChain: session.getProviderChain(),
      model: session.getCurrentModel() ?? undefined,
      providerId: session.provider?.id, // 更新最终供应商ID（重试切换后）
      context1mApplied: session.getContext1mApplied(),
      swapCacheTtlApplied: session.provider?.swapCacheTtlBilling ?? false,
      specialSettings: session.getSpecialSettings() ?? undefined,
    };
    const persistence = options.onCommitted
      ? detailsWriter(messageContext.id, terminalDetails, { onCommitted: options.onCommitted })
      : detailsWriter(messageContext.id, terminalDetails);
    committed = Boolean(await awaitPersistence(persistence));

    if (session.sessionId && session.requestSequence != null) {
      if (session.shouldTrackSessionObservability()) {
        void deleteLiveChain(session.sessionId, session.requestSequence);
      }
    }

    const isAsyncWrite = getEnvConfig().MESSAGE_REQUEST_WRITE_MODE !== "sync";
    logger.info(
      isAsyncWrite
        ? "ResponseHandler: Request failure persistence enqueued"
        : "ResponseHandler: Successfully persisted request failure",
      {
        taskId,
        phase,
        messageId: messageContext.id,
        duration,
        statusCode,
        errorMessage,
      }
    );
  } catch (dbError) {
    const databaseError = findSafeDatabaseError(dbError);
    logger.error("ResponseHandler: Failed to persist request failure", {
      taskId,
      phase,
      messageId: messageContext.id,
      error: errorMessage,
      databaseError:
        databaseError?.message ?? (dbError instanceof Error ? dbError.message : String(dbError)),
      databaseErrorCode: databaseError?.code,
      databaseErrorPool: databaseError?.pool,
    });
  } finally {
    // 确保无论数据库操作成功与否，都清理追踪状态
    try {
      tracker.endRequest(messageContext.user.id, messageContext.id);
    } catch (trackerError) {
      logger.warn("ResponseHandler: Failed to end request tracking", {
        taskId,
        messageId: messageContext.id,
        trackerError,
      });
    }
  }

  // Emit Langfuse trace for error/abort paths
  emitProxyLangfuseTrace(session, {
    responseHeaders: new Headers(),
    responseText: "",
    usageMetrics: null,
    costUsd: undefined,
    statusCode,
    durationMs: duration,
    isStreaming: phase === "stream",
    sseEventCount: phase === "stream" ? 0 : undefined,
    errorMessage,
  });
  return committed;
}

/**
 * 格式化处理错误信息
 * - 提取有意义的错误描述用于数据库存储
 */
function formatProcessingError(error: unknown): string {
  if (error instanceof Error) {
    const message = error.message?.trim();
    return message ? `${error.name}: ${message}` : error.name;
  }
  if (typeof error === "string") {
    return error;
  }
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
