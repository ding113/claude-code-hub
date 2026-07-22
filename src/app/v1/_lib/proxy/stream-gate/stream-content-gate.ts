import { getEnvConfig } from "@/lib/config/env.schema";
import { logger } from "@/lib/logger";
import { ProxyError } from "../errors";
import { classifyFrame, type FrameVerdict, type ProtocolFamily } from "./frame-classifier";
import { SseFrameParser } from "./sse-frames";

/**
 * 流式内容门控（F1）：在向客户端透传前，按帧分类等待「首个有效内容 chunk」。
 *
 * - content 帧到达 -> 提交：返回已缓冲的前缀字节 + 原 reader，调用方拼接透传
 * - error / malformed 帧 -> precommit 失败：调用方抛错走现有供应商切换循环
 * - terminal 先于 content / 流提前结束 -> 空流失败
 * - neutral 帧入缓冲；超过 event/byte 上限 -> prebuffer_overflow 失败
 * - read 拒绝（首字节超时 abort / 客户端断开）-> 原样返回错误，由调用方按来源归类
 *
 * 客户端在提交前收到的字节数恒为 0：失败时整段前缀被丢弃。
 */

export type StreamGateFailureReason =
  | "gate_error"
  | "decode_error"
  | "empty_stream"
  | "prebuffer_overflow";

/**
 * 门控 precommit 错误。继承 ProxyError（statusCode 502）——
 * categorizeErrorAsync 将其归为 PROVIDER_ERROR：计入熔断器并切换供应商，
 * 无需改动现有错误分类逻辑。gate_error 时把上游错误帧原文带入
 * upstreamError.body，供错误规则匹配（如不可重试的客户端输入错误）与审计。
 */
export class StreamPrecommitError extends ProxyError {
  readonly gateReason: StreamGateFailureReason;

  constructor(
    reason: StreamGateFailureReason,
    detail: {
      family: ProtocolFamily;
      providerId: number;
      providerName: string;
      frameData?: string;
      framesSeen?: number;
      bufferedBytes?: number;
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
  }
}

function buildGateErrorBody(
  reason: StreamGateFailureReason,
  detail: {
    family: ProtocolFamily;
    frameData?: string;
    framesSeen?: number;
    bufferedBytes?: number;
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
      ...(detail.frameData ? { frame_preview: detail.frameData.slice(0, 500) } : {}),
    },
  });
}

export type StreamGateMode = "off" | "shadow" | "enforce";

export function resolveStreamGateMode(): StreamGateMode {
  try {
    return getEnvConfig().STREAM_GATE_MODE;
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
    return { prebufferEventCap: 64, prebufferByteCap: 256 * 1024 };
  }
}

export interface StreamGateOptions extends StreamGateCaps {
  family: ProtocolFamily;
  providerId: number;
  providerName: string;
}

export type StreamGateResult =
  | { committed: true; prefixChunks: Uint8Array[]; framesSeen: number; readerDone: boolean }
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
  let framesSeen = 0;

  const failure = (reason: StreamGateFailureReason, frameData?: string): StreamGateResult => ({
    committed: false,
    error: new StreamPrecommitError(reason, {
      family: options.family,
      providerId: options.providerId,
      providerName: options.providerName,
      frameData,
      framesSeen,
      bufferedBytes,
    }),
  });

  while (true) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await reader.read();
    } catch (readError) {
      // 首字节超时 abort / 客户端断开 / 传输错误：原样上抛，调用方按来源归类
      return {
        committed: false,
        error: readError instanceof Error ? readError : new Error(String(readError)),
      };
    }

    if (readResult.done) {
      // 冲刷尾部未终止帧（无结尾空行的流）
      for (const frame of parser.finish()) {
        framesSeen++;
        const verdict = classifyFrame(options.family, frame.eventName, frame.data);
        if (verdict === "content") {
          return { committed: true, prefixChunks: buffered, framesSeen, readerDone: true };
        }
        if (verdict === "error") return failure("gate_error", frame.data);
        if (verdict === "malformed") return failure("decode_error", frame.data);
      }
      return failure("empty_stream");
    }

    const chunk = readResult.value;
    if (!chunk || chunk.byteLength === 0) {
      continue;
    }
    buffered.push(chunk);
    bufferedBytes += chunk.byteLength;

    for (const frame of parser.push(chunk)) {
      framesSeen++;
      const verdict: FrameVerdict = classifyFrame(options.family, frame.eventName, frame.data);
      if (verdict === "content") {
        return { committed: true, prefixChunks: buffered, framesSeen, readerDone: false };
      }
      if (verdict === "error") {
        return failure("gate_error", frame.data);
      }
      if (verdict === "malformed") {
        return failure("decode_error", frame.data);
      }
      if (verdict === "terminal") {
        // 干净终止先于任何内容 = 空流
        return failure("empty_stream", frame.data);
      }
      // neutral: 继续缓冲
    }

    if (framesSeen > options.prebufferEventCap || bufferedBytes > options.prebufferByteCap) {
      return failure("prebuffer_overflow");
    }
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
