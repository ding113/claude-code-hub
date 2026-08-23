import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { getCachedProxyRuntimeSettings } from "@/lib/system-settings/proxy-runtime";
import { ProxyError } from "../errors";
import {
  classifyFrame,
  type FrameVerdict,
  isCleanResponsesCompletion,
  isRequestEchoFrame,
  type ProtocolFamily,
} from "./frame-classifier";
import { SseFrameParser } from "./sse-frames";

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
 * 门控 precommit 错误。继承 ProxyError（statusCode 502）——
 * categorizeErrorAsync 将其归为 PROVIDER_ERROR：切换供应商，
 * 无需改动现有错误分类逻辑。gate_error 时把上游错误帧原文带入
 * upstreamError.body，供错误规则匹配（如不可重试的客户端输入错误）与审计。
 *
 * 熔断计入与否由 isRequestScopedGateFailure() 区分，见其文档。
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
    super(message, 502, {
      body: buildGateErrorBody(reason, detail),
      providerId: detail.providerId,
      providerName: detail.providerName,
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
    }
  | { committed: false; error: Error };

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
  const parser = new SseFrameParser();
  const buffered: Uint8Array[] = [];
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

  const commit = (eventName: string | null, readerDone: boolean): StreamGateResult => ({
    committed: true,
    prefixChunks: buffered,
    framesSeen,
    readerDone,
    commitMarker: options.captureCommitMarker
      ? { frameIndex: framesSeen, chunkIndex, eventName, bufferedBytes, echoExcludedBytes }
      : null,
  });

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
      for (const frame of parser.finish()) {
        framesSeen++;
        const verdict = classifyFrame(options.family, frame.eventName, frame.data);
        if (verdict === "content") {
          return commit(frame.eventName, true);
        }
        if (verdict === "error") return failure("gate_error", frame.data);
        if (verdict === "malformed") return failure("decode_error", frame.data);
        if (verdict === "terminal") {
          // 干净完成即成功响应：连同缓冲前缀一起透传（尾帧已读完，readerDone=true）
          if (
            options.family === "openai-responses" &&
            isCleanResponsesCompletion(frame.eventName, frame.data)
          ) {
            return commit(frame.eventName, true);
          }
          sawTerminal = true;
        }
      }
      // sawTerminal=false 即上游断流 / 空 body：真实供应商侧异常，与「干净终止但无内容」区分
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
    buffered.push(chunk);
    bufferedBytes += chunk.byteLength;

    for (const frame of parser.push(chunk)) {
      framesSeen++;
      const verdict: FrameVerdict = classifyFrame(options.family, frame.eventName, frame.data);
      if (verdict === "content") {
        return commit(frame.eventName, false);
      }
      if (verdict === "error") {
        return failure("gate_error", frame.data);
      }
      if (verdict === "malformed") {
        return failure("decode_error", frame.data);
      }
      if (verdict === "terminal") {
        // openai-responses 的干净完成（status=completed 且无 error）是协议层面的成功响应：
        // 空回复合法（审阅 / watchdog 类 prompt 的契约就是无问题时沉默），直接提交透传，
        // 不能放大成同供应商重试 + 跨供应商 failover
        if (
          options.family === "openai-responses" &&
          isCleanResponsesCompletion(frame.eventName, frame.data)
        ) {
          return commit(frame.eventName, false);
        }
        // 其余干净终止先于任何内容 = 空流
        return failure("empty_stream", frame.data, true);
      }
      // neutral: 继续缓冲；请求回显帧的载荷不计入字节上限（豁免额度另有上限，见下方判定）
      if (isRequestEchoFrame(options.family, frame.eventName, frame.data)) {
        echoExcludedBytes += Buffer.byteLength(frame.data, "utf8");
      }
      // event 上限为逐帧硬上限（单 chunk 大量小帧也会触发）
      if (framesSeen > options.prebufferEventCap) {
        return failure("prebuffer_overflow");
      }
    }

    // 豁免额度以 cap 为自身上限：伪装成回显的中性帧最多把缓冲总量抬到 2×cap，不会无界占用内存
    const cappedEchoExcluded = Math.min(echoExcludedBytes, options.prebufferByteCap);
    if (bufferedBytes - cappedEchoExcluded > options.prebufferByteCap) {
      return failure("prebuffer_overflow");
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
export function concatChunks(chunks: Uint8Array[]): Uint8Array | null {
  if (chunks.length === 0) return null;
  if (chunks.length === 1) return chunks[0];
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
  const parser = new SseFrameParser();
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
        for (const frame of parser.push(chunk)) {
          const verdict = classifyFrame(context.family, frame.eventName, frame.data);
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
            return;
          }
        }
      } catch {
        // shadow 观察绝不影响热路径
        reported = true;
      }
    },
  };
}
