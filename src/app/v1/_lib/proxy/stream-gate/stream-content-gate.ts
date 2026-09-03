import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { getCachedProxyRuntimeSettings } from "@/lib/system-settings/proxy-runtime";
import { inferUpstreamErrorStatusCodeFromText } from "@/lib/utils/upstream-error-detection";
import { BufferedByteChunks } from "../buffered-byte-chunks";
import { ProxyError } from "../errors";
import {
  classifyFrame,
  type FrameVerdict,
  isCleanResponsesCompletion,
  isRequestEchoFrame,
  isResponsesIncompleteCompletion,
  type ProtocolFamily,
} from "./frame-classifier";
import type { StreamGatePrebufferBudget, StreamGatePrebufferLease } from "./prebuffer-budget";
import { SseFrameBufferLimitError, SseFrameParser } from "./sse-frames";

/**
 * 流式内容门控（F1）：在向客户端透传前，按帧分类等待「首个有效内容 chunk」。
 *
 * - content 帧到达 -> 提交：返回已缓冲的前缀字节 + 原 reader，调用方拼接透传
 * - error / malformed 帧 -> precommit 失败：调用方抛错走现有供应商切换循环
 * - terminal 先于 content -> 空流失败；但 openai-responses 的干净完成（status=completed）
 *   视为成功响应直接提交，空回复是合法结果（见 isCleanResponsesCompletion）
 * - 流提前结束（无终止帧的 EOF）-> 空流失败
 * - neutral 帧入缓冲；超过 event/byte 上限 -> prebuffer_overflow 失败
 *   （请求回显帧不计入字节上限，见 isRequestEchoFrame）
 * - 读间隔超过 idleTimeoutMs -> idle_timeout 失败（调用方按静默超时归类）
 * - read 拒绝（首字节超时 abort / 客户端断开）-> 原样返回错误，由调用方按来源归类
 *
 * 客户端在提交前收到的字节数恒为 0：失败时整段前缀被丢弃。
 */

export type StreamGateFailureReason =
  | "gate_error"
  | "decode_error"
  | "empty_stream"
  | "prebuffer_overflow"
  | "idle_timeout";

/**
 * 门控 precommit 错误。流内 error 是 HTTP 200 body 合成的错误：明确的 4xx 状态应保留，
 * 让既有错误规则决定是否重试；无法确认是客户端错误时仍按 502 走供应商故障路径。
 * 熔断计入与否再由 isRequestScopedGateFailure() 区分。
 */
export class StreamPrecommitError extends ProxyError {
  readonly gateReason: StreamGateFailureReason;
  readonly gateFamily: ProtocolFamily;
  /** 干净终止帧先于任何内容到达（区别于上游断流 / 空 body 的 EOF） */
  readonly terminalBeforeContent: boolean;

  constructor(
    reason: StreamGateFailureReason,
    detail: {
      family: ProtocolFamily;
      providerId: number;
      providerName: string;
      frameData?: string;
      framesSeen?: number;
      bufferedBytes?: number;
      echoExcludedBytes?: number;
      terminalBeforeContent?: boolean;
    }
  ) {
    const message = `Stream content gate rejected upstream before first valid content (${reason})`;
    const inferred =
      reason === "gate_error" && detail.frameData
        ? inferUpstreamErrorStatusCodeFromText(detail.frameData)
        : null;
    const inferredClientError =
      inferred && inferred.statusCode >= 400 && inferred.statusCode < 500 ? inferred : null;
    const statusCode = inferredClientError?.statusCode ?? 502;
    super(message, statusCode, {
      body: buildGateErrorBody(reason, detail),
      providerId: detail.providerId,
      providerName: detail.providerName,
      ...(reason === "gate_error"
        ? {
            statusCodeInferred: inferredClientError !== null,
            statusCodeInferenceMatcherId: inferredClientError?.matcherId,
          }
        : {}),
    });
    this.name = "StreamPrecommitError";
    this.gateReason = reason;
    this.gateFamily = detail.family;
    this.terminalBeforeContent = detail.terminalBeforeContent === true;
  }
}

/**
 * 请求作用域的门控失败：不是供应商健康信号，不应计入熔断器。
 *
 * 仅限 `openai-responses` 家族的 `empty_stream`。该家族下上游会返回语法完整、语义为空
 * 的响应：`response.output_text.done` 带 `text: ""`、`response.output_item.done` 带
 * `content[0].text: ""`、`response.completed` 带 `output: []`。所有帧按 isNonEmptyValue
 * 判定均非内容，terminal 先于 content 到达即空流。这种空是请求内容决定的（同一 body 在
 * 任何供应商、任何账号上都复现），记成供应商失败会让一个「毒性请求」在客户端重试放大下
 * 打开健康供应商的熔断器。仍然 failover（客户端确实拿不到可见内容），只是不计健康度。
 *
 * 必须同时满足 `terminalBeforeContent`：`empty_stream` 也覆盖「上游断流 / 空 body」的
 * EOF 分支，那是真实的供应商侧异常，必须继续计入熔断。
 *
 * 其余家族的 `empty_stream` 保持计入：anthropic / openai-chat / gemini 在正常空回复下
 * 仍会发出内容帧（如 `text_delta` 的空串所在的 content_block 系列），只吐终止帧属于畸形
 * 流，是真实的供应商侧异常。
 *
 * 其余 reason 一律计入：`gate_error` / `decode_error` 是真实上游错误帧或损坏载荷，
 * `idle_timeout` 是真实上游静默，`prebuffer_overflow` 是异常中性帧洪泛。
 */
export function isRequestScopedGateFailure(error: unknown): boolean {
  return (
    error instanceof StreamPrecommitError &&
    error.gateReason === "empty_stream" &&
    error.gateFamily === "openai-responses" &&
    error.terminalBeforeContent
  );
}

function buildGateErrorBody(
  reason: StreamGateFailureReason,
  detail: {
    family: ProtocolFamily;
    frameData?: string;
    framesSeen?: number;
    bufferedBytes?: number;
    echoExcludedBytes?: number;
    terminalBeforeContent?: boolean;
  }
): string {
  if (reason === "gate_error" && detail.frameData) {
    // 上游错误帧原文（截断）：让错误规则/覆写与人工排查看到真实上游错误
    return detail.frameData.length > 2000 ? detail.frameData.slice(0, 2000) : detail.frameData;
  }
  return JSON.stringify({
    error: {
      type: "stream_gate_precommit",
      reason,
      family: detail.family,
      frames_seen: detail.framesSeen,
      buffered_bytes: detail.bufferedBytes,
      ...(detail.echoExcludedBytes ? { echo_excluded_bytes: detail.echoExcludedBytes } : {}),
      ...(reason === "empty_stream"
        ? { terminal_before_content: detail.terminalBeforeContent === true }
        : {}),
      ...(detail.frameData ? { frame_preview: detail.frameData.slice(0, 500) } : {}),
    },
  });
}

export type StreamGateMode = "off" | "shadow" | "enforce";

// Shadow 只做旁路诊断，不需要保留完整的大帧；超过该上限时让 parser
// 进入 observation-incomplete 语义，绝不能因为异常上游输入把 Node 堆撑大。
export const STREAM_SHADOW_OBSERVER_MAX_BUFFER_CHARACTERS = 1024 * 1024;

/**
 * 门控模式：系统设置快照优先（每请求的 provider-selector 读取与开机预热保鲜），
 * 无快照时回退 env STREAM_GATE_MODE。
 */
export function resolveStreamGateMode(): StreamGateMode {
  try {
    return getCachedProxyRuntimeSettings()?.streamGateMode ?? getEnvConfig().STREAM_GATE_MODE;
  } catch {
    return "off";
  }
}

/**
 * 是否允许在提交前扣留客户端字节。
 *
 * 只有 enforce 且未开启高并发模式时才扣留；off / shadow / 高并发一律 TTFB 优先，
 * 首个非空上游字节直达客户端。Replay owner 也不例外：坏流由 response-handler 的
 * StreamProtocolObserver 事后 abort（条目不发布），不再用「零字节 failover」换取
 * 首字节延迟——那会让关闭门控的部署仍然按首个内容帧交付。
 */
export function isStreamGatePrecommitActive(highConcurrencyMode: boolean): boolean {
  return resolveStreamGateMode() === "enforce" && !highConcurrencyMode;
}

export interface StreamGateCaps {
  prebufferEventCap: number;
  prebufferByteCap: number;
}

export function resolveStreamGateCaps(): StreamGateCaps {
  try {
    const env = getEnvConfig();
    return {
      prebufferEventCap: env.STREAM_GATE_PREBUFFER_EVENT_CAP,
      prebufferByteCap: env.STREAM_GATE_PREBUFFER_BYTE_CAP,
    };
  } catch {
    return { prebufferEventCap: 64, prebufferByteCap: 10 * 1024 * 1024 };
  }
}

export interface StreamGateOptions extends StreamGateCaps {
  family: ProtocolFamily;
  providerId: number;
  providerName: string;
  /** 首个非空上游 chunk 到达时回调一次（调用方用于清除首字节计时器，恢复其原始语义） */
  onFirstByte?: () => void;
  /** 门控等待期的读间隔静默上限（毫秒；<=0 或未设不启用），对齐提交后 response-handler 的静默超时 */
  idleTimeoutMs?: number;
  /** 记录触发提交的帧信息（高并发模式下关闭以省开销） */
  captureCommitMarker?: boolean;
  /** 进程级共享前缀预算；生产路径必须传入，单元测试可省略。 */
  prebufferBudget?: StreamGatePrebufferBudget;
  /** 等待共享预算时使用与上游请求相同的取消信号。 */
  abortSignal?: AbortSignal;
  /** 开始等待本地预算；竞速路径用它暂停本地 hedge 阈值。 */
  onBudgetWaitStart?: () => void;
  /** 本地预算获得或等待失败；恢复本地 hedge 阈值。 */
  onBudgetWaitEnd?: () => void;
}

/** 触发门控提交的帧/chunk 标记（用于 Message 详情可观测性）。 */
export interface StreamGateCommitMarker {
  /** 触发提交的帧序号（1-based，含中性前缀帧） */
  frameIndex: number;
  /** 触发提交的帧所在网络 chunk 序号（1-based） */
  chunkIndex: number;
  /** 触发提交的 SSE event 名（无事件行时为 null） */
  eventName: string | null;
  /** 提交时已缓冲的前缀字节数 */
  bufferedBytes: number;
  /** 被排除出字节计数的请求回显帧字节数 */
  echoExcludedBytes: number;
}

export type StreamGateResult =
  | {
      committed: true;
      prefixChunks: Uint8Array[];
      framesSeen: number;
      readerDone: boolean;
      commitMarker: StreamGateCommitMarker | null;
      /** 前缀被下游消费或放弃后释放；所有权随 committed 结果转移。 */
      prebufferLease: StreamGatePrebufferLease | null;
    }
  | { committed: false; error: Error };

const PREBUFFER_MEMORY_RESERVATION_MULTIPLIER = 4;

/**
 * 对上游 SSE body reader 执行首个有效内容门控。
 *
 * 提交时返回缓冲前缀（含触发提交的 content 帧所在 chunk）与 framesSeen；
 * reader 所有权归还调用方（committed 且 readerDone=false 时后续字节仍在 reader 上）。
 * 失败时错误对象已按语义构造，reader 由调用方负责 cancel。
 */
export async function runStreamContentGate(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  options: StreamGateOptions
): Promise<StreamGateResult> {
  let prebufferLease: StreamGatePrebufferLease | null = null;
  let leaseTransferred = false;
  const parser = new SseFrameParser({
    maxBufferedCharacters: options.prebufferByteCap,
    bufferLimitExemption: {
      maxBufferedCharacters: options.prebufferByteCap * 2,
      matches: (eventName, dataHead) => isRequestEchoFrame(options.family, eventName, dataHead),
    },
  });
  const buffered = new BufferedByteChunks();
  let bufferedBytes = 0;
  let echoExcludedBytes = 0;
  let framesSeen = 0;
  let chunkIndex = 0;
  let firstByteSeen = false;

  const failure = (
    reason: StreamGateFailureReason,
    frameData?: string,
    terminalBeforeContent = false
  ): StreamGateResult => ({
    committed: false,
    error: new StreamPrecommitError(reason, {
      family: options.family,
      providerId: options.providerId,
      providerName: options.providerName,
      frameData,
      framesSeen,
      bufferedBytes,
      echoExcludedBytes,
      terminalBeforeContent,
    }),
  });
  const exceedsByteCap = () =>
    bufferedBytes - Math.min(echoExcludedBytes, options.prebufferByteCap) >
    options.prebufferByteCap;

  const commit = (eventName: string | null, readerDone: boolean): StreamGateResult => {
    const retainedPrefixBytes = buffered.retainedByteLength;
    const prefixChunks = buffered.take();
    // 读取期间需要覆盖 parser、输入副本和前缀的最坏峰值；提交后 parser
    // 已停止，租约只需覆盖仍挂在下游 pending slot 中的实际 backing bytes。
    prebufferLease?.shrinkTo(retainedPrefixBytes);
    leaseTransferred = true;
    return {
      committed: true,
      prefixChunks,
      framesSeen,
      readerDone,
      commitMarker: options.captureCommitMarker
        ? { frameIndex: framesSeen, chunkIndex, eventName, bufferedBytes, echoExcludedBytes }
        : null,
      prebufferLease,
    };
  };

  try {
    if (options.prebufferBudget) {
      if (options.abortSignal?.aborted) {
        return { committed: false, error: abortSignalError(options.abortSignal) };
      }
      const reservationBytes = options.prebufferByteCap * PREBUFFER_MEMORY_RESERVATION_MULTIPLIER;
      const budgetSnapshot = options.prebufferBudget.snapshot();
      // snapshot 与 acquire 之间没有异步边界；只在本次调用确实会进入 FIFO
      // 队列时暂停供应商计时，避免正常热路径反复清除并重建 timer。
      const waitsForBudget =
        reservationBytes <= budgetSnapshot.limit &&
        (budgetSnapshot.waiting > 0 ||
          budgetSnapshot.reservedBytes + reservationBytes > budgetSnapshot.limit);
      if (waitsForBudget) options.onBudgetWaitStart?.();
      try {
        prebufferLease = await options.prebufferBudget.acquire(
          reservationBytes,
          options.abortSignal
        );
      } catch (error) {
        return {
          committed: false,
          error: error instanceof Error ? error : new Error(String(error)),
        };
      } finally {
        if (waitsForBudget) options.onBudgetWaitEnd?.();
      }
    }

    while (true) {
      let readResult: ReadableStreamReadResult<Uint8Array>;
      try {
        const raced = await readWithIdleTimeout(reader, options.idleTimeoutMs);
        if (raced === IDLE_TIMEOUT) {
          return failure("idle_timeout");
        }
        readResult = raced;
      } catch (readError) {
        // 首字节超时 abort / 客户端断开 / 传输错误：原样上抛，调用方按来源归类
        return {
          committed: false,
          error: readError instanceof Error ? readError : new Error(String(readError)),
        };
      }

      if (readResult.done) {
        // 冲刷尾部未终止帧（无结尾空行的流）
        let sawTerminal = false;
        let trailingResult: StreamGateResult | null = null;
        try {
          parser.finishVisit((eventName, data) => {
            framesSeen++;
            const verdict = classifyFrame(options.family, eventName, data);
            if (verdict === "content") {
              trailingResult = commit(eventName, true);
              return false;
            }
            if (verdict === "error") {
              trailingResult = failure("gate_error", data);
              return false;
            }
            if (verdict === "malformed") {
              trailingResult = failure("decode_error", data);
              return false;
            }
            if (
              verdict === "terminal" &&
              options.family === "openai-responses" &&
              (isCleanResponsesCompletion(eventName, data) ||
                isResponsesIncompleteCompletion(eventName, data))
            ) {
              trailingResult = commit(eventName, true);
              return false;
            }
            if (verdict === "terminal") sawTerminal = true;
            if (verdict === "neutral" && framesSeen > options.prebufferEventCap) {
              trailingResult = failure("prebuffer_overflow");
              return false;
            }
            return true;
          });
        } catch (error) {
          if (error instanceof SseFrameBufferLimitError) {
            return failure("prebuffer_overflow");
          }
          throw error;
        }
        if (trailingResult) return trailingResult;
        // 无终止帧的 EOF 是供应商断流；终止帧先于内容则是请求作用域空结果。
        return failure("empty_stream", undefined, sawTerminal);
      }

      const chunk = readResult.value;
      if (!chunk || chunk.byteLength === 0) {
        continue;
      }
      if (!firstByteSeen) {
        firstByteSeen = true;
        // 上游已开始响应：调用方在此清除首字节计时器（保持「首字节」而非「首内容」语义）
        options.onFirstByte?.();
      }
      chunkIndex++;
      // 回显豁免最多把门禁前缀抬到 2×cap。先检查再持有引用，避免一个
      // 超大网络 chunk 在帧分类和事后检查之前直接越过宣称的内存边界。
      if (chunk.byteLength > options.prebufferByteCap * 2 - bufferedBytes) {
        return failure("prebuffer_overflow");
      }
      buffered.append(chunk);
      bufferedBytes += chunk.byteLength;

      let frameResult: StreamGateResult | null = null;
      try {
        parser.visit(chunk, (eventName, data) => {
          framesSeen++;
          const verdict: FrameVerdict = classifyFrame(options.family, eventName, data);
          if (verdict === "content") {
            frameResult = exceedsByteCap()
              ? failure("prebuffer_overflow")
              : commit(eventName, false);
            return false;
          }
          if (verdict === "error") {
            frameResult = failure("gate_error", data);
            return false;
          }
          if (verdict === "malformed") {
            frameResult = failure("decode_error", data);
            return false;
          }
          if (verdict === "terminal") {
            if (
              options.family === "openai-responses" &&
              (isCleanResponsesCompletion(eventName, data) ||
                isResponsesIncompleteCompletion(eventName, data))
            ) {
              frameResult = exceedsByteCap()
                ? failure("prebuffer_overflow")
                : commit(eventName, false);
            } else {
              frameResult = failure("empty_stream", data, true);
            }
            return false;
          }
          // neutral: 继续缓冲；请求回显帧的载荷不计入字节上限。
          if (isRequestEchoFrame(options.family, eventName, data)) {
            echoExcludedBytes += Buffer.byteLength(data, "utf8");
          }
          if (framesSeen > options.prebufferEventCap) {
            frameResult = failure("prebuffer_overflow");
            return false;
          }
          return true;
        });
      } catch (error) {
        if (error instanceof SseFrameBufferLimitError) {
          return failure("prebuffer_overflow");
        }
        throw error;
      }
      if (frameResult) return frameResult;

      // 豁免额度以 cap 为自身上限：伪装成回显的中性帧最多把缓冲总量抬到 2×cap，不会无界占用内存
      if (exceedsByteCap()) {
        return failure("prebuffer_overflow");
      }
    }
  } finally {
    if (!leaseTransferred) {
      buffered.clear();
      prebufferLease?.release();
    }
  }
}

const IDLE_TIMEOUT = Symbol("stream_gate_idle_timeout");

/**
 * 单次 read 与静默计时器竞速。计时器胜出时挂起的 read 由调用方随后的
 * reader.cancel 收尾；对其附加空 catch 防止孤儿 rejection。
 */
async function readWithIdleTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  idleTimeoutMs: number | undefined
): Promise<ReadableStreamReadResult<Uint8Array> | typeof IDLE_TIMEOUT> {
  if (!idleTimeoutMs || idleTimeoutMs <= 0) {
    return reader.read();
  }
  const readPromise = reader.read();
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      readPromise,
      new Promise<typeof IDLE_TIMEOUT>((resolve) => {
        timer = setTimeout(() => resolve(IDLE_TIMEOUT), idleTimeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
    readPromise.catch(() => undefined);
  }
}

/** 拼接门控前缀字节（供竞速败者计费 drain 恢复 usage 时复用现有单块逻辑）。 */
export function concatChunks(chunks: Uint8Array[]): Uint8Array<ArrayBuffer> | null {
  if (chunks.length === 0) return null;
  if (chunks.length === 1) {
    const only = chunks[0];
    // Web Streams 允许 SharedArrayBuffer-backed view；Response BodyInit 的
    // DOM 类型则要求 ArrayBuffer-backed view。正常路径零拷贝，只有确实
    // 不是 ArrayBuffer 时才复制一次，避免把类型问题扩散到调用方。
    return only.buffer instanceof ArrayBuffer
      ? (only as Uint8Array<ArrayBuffer>)
      : new Uint8Array(only);
  }
  let total = 0;
  for (const chunk of chunks) total += chunk.byteLength;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function abortSignalError(signal: AbortSignal): Error {
  return signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");
}

/**
 * shadow 模式旁路观察者：不缓冲不 failover，只统计
 * 「首非空字节 vs 首有效内容帧」的延迟差与提交前的判定分布，
 * 在首个 content 帧出现时打一条低敏日志（无 body 原文），用于灰度前评估。
 */
export interface ShadowGateObserver {
  observe(chunk: Uint8Array): void;
}

export function createShadowGateObserver(context: {
  family: ProtocolFamily;
  providerId: number;
  providerName: string;
}): ShadowGateObserver {
  const parser = new SseFrameParser({
    maxBufferedCharacters: STREAM_SHADOW_OBSERVER_MAX_BUFFER_CHARACTERS,
  });
  const verdictCounts: Record<FrameVerdict, number> = {
    content: 0,
    error: 0,
    malformed: 0,
    terminal: 0,
    neutral: 0,
  };
  let firstByteAt: number | null = null;
  let reported = false;

  return {
    observe(chunk: Uint8Array): void {
      if (reported) return;
      try {
        if (firstByteAt === null && chunk.byteLength > 0) {
          firstByteAt = Date.now();
        }
        parser.visit(chunk, (eventName, data) => {
          const verdict = classifyFrame(context.family, eventName, data);
          verdictCounts[verdict]++;
          if (verdict === "content" || verdict === "error" || verdict === "malformed") {
            reported = true;
            logger.info("StreamGate[shadow]: first decisive frame observed", {
              providerId: context.providerId,
              providerName: context.providerName,
              family: context.family,
              decisiveVerdict: verdict,
              // 现状「首非空字节即提交」与门控「首有效内容才提交」的判定分歧：
              // divergent=true 表示门控会推迟提交（中性前缀）或触发 failover（error/malformed）
              divergent:
                verdict !== "content" || verdictCounts.neutral + verdictCounts.terminal > 0,
              firstContentLagMs: firstByteAt === null ? null : Date.now() - firstByteAt,
              verdictCounts: { ...verdictCounts },
            });
            return false;
          }
          return true;
        });
      } catch {
        // shadow 观察绝不影响热路径
        reported = true;
      }
    },
  };
}
