import type { ClientFormat } from "./format-mapper";
import {
  classifyStructuredFrame,
  classifyTerminalKind,
  type ProtocolFamily,
} from "./stream-gate/frame-classifier";

export const CLIENT_ABORT_METER_MAX_RETAINED_BYTES = 64 * 1024;
export const CLIENT_ABORT_METER_MAX_FRAME_BYTES = 64 * 1024;

type EvidenceSlot =
  | "error"
  | "initial-usage"
  | "latest-usage"
  | "metadata"
  | "signature"
  | "terminal";

export interface ClientAbortMeteringSnapshot {
  text: string;
  sawContent: boolean;
  terminalSeen: boolean;
  incompleteSeen: boolean;
  retainedBytes: number;
  skippedOversizedFrames: number;
  protocolFailure: {
    afterContent: boolean;
    verdict: "error" | "malformed";
    eventName: string | null;
    sawMalformed?: true;
  } | null;
}

export interface ClientAbortMeteringObserver {
  /** 断线瞬间可能仍由当前半帧占用的真实上限，用于加权内存预算。 */
  readonly maxInFlightFrameBytes: number;
  observe(chunk: Uint8Array): {
    drainComplete: boolean;
    errorSeen: boolean;
    protocolFailure: ClientAbortMeteringSnapshot["protocolFailure"];
    replayDrainComplete: boolean;
    terminalSeen: boolean;
  };
  switchToDetachedMode(): void;
  finish(): ClientAbortMeteringSnapshot;
}

export interface ClientAbortMeteringOptions {
  /** 连接仍存续时允许协议观察器验证的最大单帧；断线后始终收紧到 64 KiB。 */
  attachedMaxFrameBytes?: number;
}

interface ParsedFrame {
  eventName: string | null;
  data: string;
}

const USAGE_NUMBER_FIELDS = [
  "cachedContentTokenCount",
  "cache_creation_1h_input_tokens",
  "cache_creation_5m_input_tokens",
  "cache_creation_input_tokens",
  "cache_read_input_tokens",
  "candidatesTokenCount",
  "claude_cache_creation_1_h_tokens",
  "claude_cache_creation_5_m_tokens",
  "completion_tokens",
  "input_tokens",
  "output_tokens",
  "promptTokenCount",
  "prompt_tokens",
  "thoughtsTokenCount",
] as const;

/** Narrows unknown JSON values to non-array records. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Copies finite numeric accounting fields into a compact evidence record. */
function copyFiniteNumberFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  fields: readonly string[]
): void {
  for (const field of fields) {
    const value = source[field];
    if (typeof value === "number" && Number.isFinite(value)) target[field] = value;
  }
}

/** Compacts modality token details while discarding response content. */
function compactTokenDetails(value: unknown): unknown {
  if (!Array.isArray(value)) return undefined;
  const details = value.slice(0, 16).flatMap((entry) => {
    if (!isRecord(entry)) return [];
    const compact: Record<string, unknown> = {};
    if (typeof entry.modality === "string") compact.modality = entry.modality.slice(0, 32);
    if (typeof entry.tokenCount === "number" && Number.isFinite(entry.tokenCount)) {
      compact.tokenCount = entry.tokenCount;
    }
    return Object.keys(compact).length > 0 ? [compact] : [];
  });
  return details.length > 0 ? details : undefined;
}

/** Retains only bounded usage and cache fields needed by billing. */
function compactUsage(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const compact: Record<string, unknown> = {};
  copyFiniteNumberFields(value, compact, USAGE_NUMBER_FIELDS);

  for (const field of ["input_tokens_details", "prompt_tokens_details"] as const) {
    const details = value[field];
    if (!isRecord(details)) continue;
    const compactDetails: Record<string, unknown> = {};
    copyFiniteNumberFields(details, compactDetails, ["cached_tokens", "cache_write_tokens"]);
    if (Object.keys(compactDetails).length > 0) compact[field] = compactDetails;
  }

  if (isRecord(value.cache_creation)) {
    const cacheCreation: Record<string, unknown> = {};
    copyFiniteNumberFields(value.cache_creation, cacheCreation, [
      "ephemeral_1h_input_tokens",
      "ephemeral_5m_input_tokens",
    ]);
    if (Object.keys(cacheCreation).length > 0) compact.cache_creation = cacheCreation;
  }

  for (const field of ["candidatesTokensDetails", "promptTokensDetails"] as const) {
    const details = compactTokenDetails(value[field]);
    if (details) compact[field] = details;
  }

  return Object.keys(compact).length > 0 ? compact : null;
}

/** Retains a bounded protocol-error representation. */
function compactError(value: unknown): unknown {
  if (typeof value === "string") return value.slice(0, 1024);
  if (!isRecord(value)) return value === true ? true : undefined;
  const compact: Record<string, unknown> = {};
  for (const field of ["code", "message", "type"] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") compact[field] = fieldValue.slice(0, 1024);
  }
  return Object.keys(compact).length > 0 ? compact : true;
}

/** Builds a bounded frame payload without retaining generated content. */
function compactPayload(value: Record<string, unknown>, depth = 0): Record<string, unknown> {
  const compact: Record<string, unknown> = {};
  for (const field of [
    "id",
    "model",
    "prompt_cache_key",
    "service_tier",
    "status",
    "type",
  ] as const) {
    const fieldValue = value[field];
    if (typeof fieldValue === "string") compact[field] = fieldValue.slice(0, 256);
  }
  if (value.failed === true) compact.failed = true;
  if (value.error !== undefined) compact.error = compactError(value.error);

  for (const field of ["usage", "usageMetadata"] as const) {
    const usage = compactUsage(value[field]);
    if (usage) compact[field] = usage;
  }

  if (isRecord(value.message)) {
    const message: Record<string, unknown> = {};
    for (const field of ["id", "model"] as const) {
      const fieldValue = value.message[field];
      if (typeof fieldValue === "string") message[field] = fieldValue.slice(0, 256);
    }
    const usage = compactUsage(value.message.usage);
    if (usage) message.usage = usage;
    if (Object.keys(message).length > 0) compact.message = message;
  }

  if (isRecord(value.delta)) {
    const delta: Record<string, unknown> = {};
    if (typeof value.delta.type === "string") delta.type = value.delta.type.slice(0, 128);
    if (typeof value.delta.stop_reason === "string") {
      delta.stop_reason = value.delta.stop_reason.slice(0, 128);
    }
    if (typeof value.delta.signature === "string") {
      delta.signature = value.delta.signature.slice(0, 8192);
    }
    const usage = compactUsage(value.delta.usage);
    if (usage) delta.usage = usage;
    if (Object.keys(delta).length > 0) compact.delta = delta;
  }

  if (depth < 4 && isRecord(value.response)) {
    compact.response = compactPayload(value.response, depth + 1);
  }

  if (Array.isArray(value.choices)) {
    compact.choices = value.choices.slice(0, 16).map((choice) => {
      if (!isRecord(choice) || typeof choice.finish_reason !== "string") return {};
      return { finish_reason: choice.finish_reason.slice(0, 128) };
    });
  }

  if (Array.isArray(value.candidates)) {
    compact.candidates = value.candidates.slice(0, 16).map((candidate) => {
      if (!isRecord(candidate) || typeof candidate.finishReason !== "string") return {};
      return { finishReason: candidate.finishReason.slice(0, 128) };
    });
  }

  return compact;
}

/** 只把协议支持的 usage 字段视为计量证据；零值同样是有效的显式 usage。 */
function hasCompactUsage(value: Record<string, unknown>, depth = 0): boolean {
  if (compactUsage(value.usage) || compactUsage(value.usageMetadata)) return true;
  if (isRecord(value.message) && compactUsage(value.message.usage)) return true;
  if (isRecord(value.delta) && compactUsage(value.delta.usage)) return true;
  return depth < 4 && isRecord(value.response) && hasCompactUsage(value.response, depth + 1);
}

export function mapClientFormatToProtocolFamily(format: ClientFormat): ProtocolFamily {
  switch (format) {
    case "response":
      return "openai-responses";
    case "claude":
      return "anthropic";
    case "openai":
      return "openai-chat";
    case "gemini":
    case "gemini-cli":
      return "gemini";
  }
}

/** Mirrors the shared classifier's non-empty error-payload semantics. */
function hasProtocolErrorPayload(value: unknown): boolean {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === "string") return value.length > 0;
  if (Array.isArray(value)) return value.some(hasProtocolErrorPayload);
  if (isRecord(value)) return Object.keys(value).length > 0;
  return true;
}

/** Detects provider protocol-error markers in a parsed frame. */
function isProtocolError(value: Record<string, unknown>): boolean {
  return (
    hasProtocolErrorPayload(value.error) ||
    value.failed === true ||
    value.type === "error" ||
    value.type === "response.error" ||
    value.type === "response.failed" ||
    (isRecord(value.response) && hasProtocolErrorPayload(value.response.error))
  );
}

/** Detects a terminal OpenAI Chat completion choice. */
function hasOpenAiCompletion(value: Record<string, unknown>): boolean {
  return (
    Array.isArray(value.choices) &&
    value.choices.some(
      (choice) =>
        isRecord(choice) &&
        typeof choice.finish_reason === "string" &&
        choice.finish_reason.trim().length > 0
    )
  );
}

/** Detects a terminal Gemini candidate finish reason. */
function hasGeminiCompletion(value: Record<string, unknown>): boolean {
  const payload = isRecord(value.response) ? value.response : value;
  return (
    Array.isArray(payload.candidates) &&
    payload.candidates.some(
      (candidate) =>
        isRecord(candidate) &&
        typeof candidate.finishReason === "string" &&
        candidate.finishReason.trim().length > 0
    )
  );
}

/** Skips content-only SSE frames that cannot contribute terminal accounting evidence. */
function shouldInspectFrame(format: ClientFormat, frame: ParsedFrame): boolean {
  if (frame.eventName === null || frame.eventName === "message") return true;

  switch (format) {
    case "response":
      return (
        frame.eventName === "error" ||
        frame.eventName === "response.created" ||
        frame.eventName === "response.in_progress" ||
        frame.eventName === "response.completed" ||
        frame.eventName === "response.done" ||
        frame.eventName === "response.incomplete" ||
        frame.eventName === "response.error" ||
        frame.eventName === "response.failed"
      );
    case "claude":
      return (
        frame.eventName === "error" ||
        frame.eventName === "message_start" ||
        frame.eventName === "message_delta" ||
        frame.eventName === "message_stop" ||
        (frame.eventName === "content_block_delta" && frame.data.includes("signature_delta"))
      );
    case "openai":
    case "gemini":
    case "gemini-cli":
      return true;
  }
}

/** Incrementally frames SSE, data-only SSE, and bounded NDJSON input. */
const FRAME_DATA_LINE_OVERHEAD_CHARACTERS = 16;

class BoundedEventFramer {
  private readonly decoder = new TextDecoder("utf-8");
  private line = "";
  private lineOverflow = false;
  private overflowedRawJsonLine = false;
  private pendingCr = false;
  private eventName: string | null = null;
  private dataLines: string[] = [];
  private frameCharacters = 0;
  private droppingFrame = false;
  private pendingMaxFrameCharacters: number | null = null;
  skippedOversizedFrames = 0;

  constructor(
    private maxFrameCharacters: number,
    private readonly onFrame: (frame: ParsedFrame) => void
  ) {}

  get maxRetainedCharacters(): number {
    return this.maxFrameCharacters;
  }

  setMaxFrameCharacters(maxFrameCharacters: number): void {
    if (maxFrameCharacters >= this.maxFrameCharacters) return;
    const hasInFlightFrame =
      this.line.length > 0 ||
      this.lineOverflow ||
      this.frameCharacters > 0 ||
      this.dataLines.length > 0 ||
      this.eventName !== null ||
      this.droppingFrame;
    if (!hasInFlightFrame) {
      this.maxFrameCharacters = maxFrameCharacters;
      return;
    }

    // 断线可能发生在一个合法 Gemini NDJSON 大行中间。立即把额度降到
    // 64 KiB 会丢掉同一行尾部的 finishReason/usage，随后只能等超时。当前
    // 半帧继续使用已预算的 attached 上限；抵达边界后再收紧后续帧。
    this.pendingMaxFrameCharacters =
      this.pendingMaxFrameCharacters === null
        ? maxFrameCharacters
        : Math.min(this.pendingMaxFrameCharacters, maxFrameCharacters);
  }

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.consume(this.decoder.decode(chunk, { stream: true }));
  }

  finish(): void {
    this.consume(this.decoder.decode());
    if (this.line.length > 0 || this.lineOverflow) this.consumeLine();
    if (this.droppingFrame) this.completeOversizedFrame();
    else this.flushFrame();
  }

  private consume(text: string): void {
    let offset = 0;
    if (this.pendingCr) {
      this.pendingCr = false;
      if (text.startsWith("\n")) offset = 1;
    }

    while (offset < text.length) {
      const nextLf = text.indexOf("\n", offset);
      const nextCr = text.indexOf("\r", offset);
      const lineEnd = nextLf === -1 ? nextCr : nextCr === -1 ? nextLf : Math.min(nextLf, nextCr);

      if (lineEnd === -1) {
        this.appendLineSegment(text.slice(offset));
        return;
      }

      this.appendLineSegment(text.slice(offset, lineEnd));
      this.consumeLine();
      const endedWithCr = text[lineEnd] === "\r";
      offset = lineEnd + 1;
      if (endedWithCr) {
        if (offset < text.length && text[offset] === "\n") {
          offset += 1;
        } else if (offset === text.length) {
          this.pendingCr = true;
        }
      }
    }
  }

  private appendLineSegment(segment: string): void {
    if (this.lineOverflow || segment.length === 0) return;
    const available = this.maxFrameCharacters - this.frameCharacters - this.line.length;
    if (segment.length <= available) {
      this.line += segment;
      return;
    }

    const prefix = `${this.line}${segment.slice(0, Math.max(0, available))}`;
    this.overflowedRawJsonLine =
      this.eventName === null && this.dataLines.length === 0 && prefix.trimStart().startsWith("{");
    this.line = "";
    this.lineOverflow = true;
    this.dropCurrentFrame();
  }

  private consumeLine(): void {
    const line = this.line;
    const overflowed = this.lineOverflow;
    const overflowedRawJsonLine = this.overflowedRawJsonLine;
    this.line = "";
    this.lineOverflow = false;
    this.overflowedRawJsonLine = false;

    if (overflowed && overflowedRawJsonLine) {
      this.completeOversizedFrame();
      return;
    }

    if (line.length === 0 && !overflowed) {
      if (this.droppingFrame) {
        this.completeOversizedFrame();
      } else {
        this.flushFrame();
      }
      return;
    }
    if (this.droppingFrame || overflowed) return;
    if (line.startsWith(":")) return;
    if (line.startsWith("event:")) {
      this.eventName = line.slice(6).trim().slice(0, 256);
      this.frameCharacters += line.length;
      this.enforceFrameLimit();
      return;
    }
    if (line.startsWith("data:")) {
      const data = line.slice(5).replace(/^\s/, "");
      this.dataLines.push(data);
      // Empty or tiny data lines otherwise bypass a pure character budget via
      // array-slot/object overhead. Charge a conservative per-line allowance.
      this.frameCharacters += data.length + FRAME_DATA_LINE_OVERHEAD_CHARACTERS;
      this.enforceFrameLimit();
      return;
    }

    const candidate = line.trim();
    if (this.eventName === null && this.dataLines.length === 0 && candidate.startsWith("{")) {
      if (candidate.length <= this.maxFrameCharacters) {
        this.onFrame({ eventName: null, data: candidate });
      } else {
        this.skippedOversizedFrames += 1;
      }
      this.applyPendingFrameLimit();
    }
  }

  private enforceFrameLimit(): void {
    if (this.frameCharacters <= this.maxFrameCharacters) return;
    this.dropCurrentFrame();
  }

  private dropCurrentFrame(): void {
    if (!this.droppingFrame) this.skippedOversizedFrames += 1;
    this.droppingFrame = true;
    this.resetFrame();
  }

  private completeOversizedFrame(): void {
    if (!this.droppingFrame) return;
    this.droppingFrame = false;
    this.resetFrame();
    this.applyPendingFrameLimit();
  }

  private flushFrame(): void {
    if (this.droppingFrame || this.dataLines.length === 0) {
      this.resetFrame();
      this.applyPendingFrameLimit();
      return;
    }
    this.onFrame({ eventName: this.eventName, data: this.dataLines.join("\n") });
    this.resetFrame();
    this.applyPendingFrameLimit();
  }

  private resetFrame(): void {
    this.eventName = null;
    this.dataLines = [];
    this.frameCharacters = 0;
  }

  private applyPendingFrameLimit(): void {
    if (this.pendingMaxFrameCharacters === null) return;
    this.maxFrameCharacters = Math.min(this.maxFrameCharacters, this.pendingMaxFrameCharacters);
    this.pendingMaxFrameCharacters = null;
  }
}

/** Creates the bounded accounting observer used after a client disconnect. */
export function createClientAbortMeteringObserver(
  format: ClientFormat,
  options: ClientAbortMeteringOptions = {}
): ClientAbortMeteringObserver {
  const evidence = new Map<EvidenceSlot, string>();
  const evidenceBytes = new Map<EvidenceSlot, number>();
  const evidenceValueCounts = new Map<string, number>();
  const encoder = new TextEncoder();
  let retainedByteTotal = 0;
  let drainComplete = false;
  let replayDrainComplete = false;
  let openAiCompletionSeen = false;
  let sawContent = false;
  let terminalSeen = false;
  let incompleteSeen = false;
  let protocolFailure: ClientAbortMeteringSnapshot["protocolFailure"] = null;
  let finished = false;

  const setEvidence = (slot: EvidenceSlot, value: string): void => {
    const previous = evidence.get(slot);
    if (previous === value) return;
    const previousBytes = evidenceBytes.get(slot) ?? 0;
    const nextBytes = encoder.encode(value).length;
    const previousCount = previous ? (evidenceValueCounts.get(previous) ?? 0) : 0;
    const nextCount = evidenceValueCounts.get(value) ?? 0;
    const nextTotal =
      retainedByteTotal -
      (previousCount === 1 ? previousBytes : 0) +
      (nextCount === 0 ? nextBytes : 0);
    if (nextTotal > CLIENT_ABORT_METER_MAX_RETAINED_BYTES) return;

    if (previous) {
      if (previousCount <= 1) {
        evidenceValueCounts.delete(previous);
        retainedByteTotal -= previousBytes;
      } else {
        evidenceValueCounts.set(previous, previousCount - 1);
      }
    }
    evidence.set(slot, value);
    evidenceBytes.set(slot, nextBytes);
    evidenceValueCounts.set(value, nextCount + 1);
    if (nextCount === 0) retainedByteTotal += nextBytes;
  };

  const recordProtocolFailure = (
    verdict: "error" | "malformed",
    eventName: string | null
  ): void => {
    if (verdict === "error") {
      drainComplete = true;
      replayDrainComplete = true;
    }
    if (!protocolFailure) {
      protocolFailure = { afterContent: sawContent, verdict, eventName };
      return;
    }
    if (verdict === "error" && protocolFailure.verdict === "malformed") {
      protocolFailure = {
        afterContent: sawContent,
        verdict,
        eventName,
        sawMalformed: true,
      };
    } else if (verdict === "malformed" && protocolFailure.verdict === "error") {
      protocolFailure = { ...protocolFailure, sawMalformed: true };
    }
  };

  const recordFrame = (frame: ParsedFrame): void => {
    const trimmed = frame.data.trim();
    if (trimmed === "[DONE]") {
      if (format === "openai") {
        drainComplete = true;
        replayDrainComplete = true;
        terminalSeen = true;
        setEvidence("terminal", "data: [DONE]\n\n");
      } else {
        recordProtocolFailure("malformed", frame.eventName);
      }
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      recordProtocolFailure("malformed", frame.eventName);
      return;
    }
    if (parsed === null || typeof parsed !== "object") {
      recordProtocolFailure("malformed", frame.eventName);
      return;
    }

    const family = mapClientFormatToProtocolFamily(format);
    const verdict = classifyStructuredFrame(family, frame.eventName, parsed);
    const terminalKind =
      verdict === "terminal" ? classifyTerminalKind(family, frame.eventName, parsed) : null;
    if (verdict === "content") sawContent = true;
    if (verdict === "error" || verdict === "malformed") {
      recordProtocolFailure(verdict, frame.eventName);
    }
    if (!isRecord(parsed) || !shouldInspectFrame(format, frame)) return;

    const protocolError =
      verdict === "error" || isProtocolError(parsed) || frame.eventName === "error";
    const type = typeof parsed.type === "string" ? parsed.type : null;
    const terminal = (() => {
      switch (format) {
        case "response":
          return (
            (type === "response.completed" || type === "response.done") &&
            (frame.eventName === null || frame.eventName === "message" || frame.eventName === type)
          );
        case "claude":
          return (
            type === "message_stop" &&
            (frame.eventName === null ||
              frame.eventName === "message" ||
              frame.eventName === "message_stop")
          );
        case "openai":
          return hasOpenAiCompletion(parsed);
        case "gemini":
        case "gemini-cli":
          return hasGeminiCompletion(parsed);
      }
    })();
    const incompleteTerminal = terminalKind === "incomplete";
    const hasSignature =
      isRecord(parsed.delta) &&
      parsed.delta.type === "signature_delta" &&
      typeof parsed.delta.signature === "string";
    const hasMetadata =
      typeof parsed.model === "string" ||
      typeof parsed.prompt_cache_key === "string" ||
      typeof parsed.service_tier === "string" ||
      (isRecord(parsed.message) && typeof parsed.message.model === "string") ||
      (isRecord(parsed.response) &&
        (typeof parsed.response.model === "string" ||
          typeof parsed.response.service_tier === "string"));
    const hasUsage = hasCompactUsage(parsed);

    if (terminal) {
      terminalSeen = true;
      if (format === "openai") {
        openAiCompletionSeen = true;
        // OpenAI Chat 可能在 finish_reason 之后再发送独立 usage chunk。
        // 只有同帧已有 usage、之后已收到 usage，或看到 [DONE] 时才能安全停止读取。
        if (hasUsage) drainComplete = true;
      } else {
        drainComplete = true;
        replayDrainComplete = true;
      }
    } else if (format === "openai" && openAiCompletionSeen && hasUsage) {
      drainComplete = true;
    }
    if (incompleteTerminal) {
      incompleteSeen = true;
      drainComplete = true;
      // 失败终态无需继续构造 Replay；调用方会将 spool 标记为 aborted。
      replayDrainComplete = true;
    }
    if (
      !(protocolError || terminal || incompleteTerminal || hasUsage || hasSignature || hasMetadata)
    ) {
      return;
    }
    const compact = compactPayload(parsed);
    const compactData = JSON.stringify(compact);
    const normalized = `${frame.eventName ? `event: ${frame.eventName}\n` : ""}data: ${compactData}\n\n`;

    if (protocolError) {
      recordProtocolFailure("error", frame.eventName);
      setEvidence("error", normalized);
    }
    if (terminal || incompleteTerminal) setEvidence("terminal", normalized);
    if (hasUsage) {
      const isInitialClaudeUsage =
        format === "claude" && (type === "message_start" || frame.eventName === "message_start");
      setEvidence(isInitialClaudeUsage ? "initial-usage" : "latest-usage", normalized);
    }
    if (hasSignature) {
      setEvidence("signature", normalized);
    }
    if (hasMetadata) {
      setEvidence("metadata", normalized);
    }
  };
  const attachedMaxFrameBytes =
    Number.isSafeInteger(options.attachedMaxFrameBytes) &&
    (options.attachedMaxFrameBytes ?? 0) > CLIENT_ABORT_METER_MAX_FRAME_BYTES
      ? (options.attachedMaxFrameBytes as number)
      : CLIENT_ABORT_METER_MAX_FRAME_BYTES;
  const framer = new BoundedEventFramer(attachedMaxFrameBytes, recordFrame);

  return {
    // 分帧器保留 JS 字符串；按 UTF-16 最坏 2 bytes/character 计入进程预算。
    get maxInFlightFrameBytes(): number {
      return framer.maxRetainedCharacters * 2;
    },
    observe(chunk): {
      drainComplete: boolean;
      errorSeen: boolean;
      protocolFailure: ClientAbortMeteringSnapshot["protocolFailure"];
      replayDrainComplete: boolean;
      terminalSeen: boolean;
    } {
      if (!finished) framer.push(chunk);
      return {
        drainComplete,
        errorSeen: protocolFailure?.verdict === "error",
        protocolFailure: protocolFailure ? { ...protocolFailure } : null,
        replayDrainComplete,
        terminalSeen,
      };
    },
    switchToDetachedMode(): void {
      if (!finished) framer.setMaxFrameCharacters(CLIENT_ABORT_METER_MAX_FRAME_BYTES);
    },
    finish(): ClientAbortMeteringSnapshot {
      if (!finished) {
        finished = true;
        framer.finish();
      }
      const text = [...new Set(evidence.values())].join("");
      return {
        text,
        sawContent,
        terminalSeen,
        incompleteSeen,
        retainedBytes: retainedByteTotal,
        skippedOversizedFrames: framer.skippedOversizedFrames,
        protocolFailure: protocolFailure ? { ...protocolFailure } : null,
      };
    },
  };
}
