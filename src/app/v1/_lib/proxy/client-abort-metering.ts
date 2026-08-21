import type { ClientFormat } from "./format-mapper";

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
  billingComplete: boolean;
  retainedBytes: number;
  skippedOversizedFrames: number;
  protocolFailure: {
    afterContent: boolean;
    verdict: "error" | "malformed";
    eventName: string | null;
  } | null;
}

export interface ClientAbortMeteringObserver {
  observe(chunk: Uint8Array): { billingComplete: boolean };
  finish(): ClientAbortMeteringSnapshot;
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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

function compactPayload(value: Record<string, unknown>): Record<string, unknown> {
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

  if (isRecord(value.response)) compact.response = compactPayload(value.response);

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

function positiveUsage(value: unknown): boolean {
  const usage = compactUsage(value);
  if (!usage) return false;
  const stack: unknown[] = [usage];
  while (stack.length > 0) {
    const current = stack.pop();
    if (typeof current === "number" && current > 0) return true;
    if (Array.isArray(current)) stack.push(...current);
    else if (isRecord(current)) stack.push(...Object.values(current));
  }
  return false;
}

function findUsage(value: Record<string, unknown>): boolean {
  if (positiveUsage(value.usage) || positiveUsage(value.usageMetadata)) return true;
  if (isRecord(value.message) && positiveUsage(value.message.usage)) return true;
  if (isRecord(value.delta) && positiveUsage(value.delta.usage)) return true;
  return isRecord(value.response) && findUsage(value.response);
}

function isProtocolError(value: Record<string, unknown>): boolean {
  return (
    value.error !== undefined ||
    value.failed === true ||
    value.type === "error" ||
    value.type === "response.error" ||
    value.type === "response.failed" ||
    (isRecord(value.response) && value.response.error !== undefined)
  );
}

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
  skippedOversizedFrames = 0;

  constructor(
    private readonly maxFrameCharacters: number,
    private readonly onFrame: (frame: ParsedFrame) => void
  ) {}

  push(chunk: Uint8Array): void {
    if (chunk.byteLength === 0) return;
    this.consume(this.decoder.decode(chunk, { stream: true }));
  }

  finish(): void {
    this.consume(this.decoder.decode());
    if (this.line.length > 0 || this.lineOverflow) this.consumeLine();
    this.flushFrame();
  }

  private consume(text: string): void {
    for (const character of text) {
      if (this.pendingCr) {
        this.pendingCr = false;
        if (character === "\n") continue;
      }
      if (character === "\r") {
        this.consumeLine();
        this.pendingCr = true;
        continue;
      }
      if (character === "\n") {
        this.consumeLine();
        continue;
      }
      if (this.lineOverflow) continue;
      if (this.line.length >= this.maxFrameCharacters) {
        this.overflowedRawJsonLine =
          this.eventName === null &&
          this.dataLines.length === 0 &&
          this.line.trimStart().startsWith("{");
        this.line = "";
        this.lineOverflow = true;
        this.dropCurrentFrame();
        continue;
      }
      this.line += character;
    }
  }

  private consumeLine(): void {
    const line = this.line;
    const overflowed = this.lineOverflow;
    const overflowedRawJsonLine = this.overflowedRawJsonLine;
    this.line = "";
    this.lineOverflow = false;
    this.overflowedRawJsonLine = false;

    if (overflowed && overflowedRawJsonLine) {
      this.droppingFrame = false;
      this.resetFrame();
      return;
    }

    if (line.length === 0 && !overflowed) {
      if (this.droppingFrame) {
        this.droppingFrame = false;
        this.resetFrame();
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
      this.frameCharacters += data.length;
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

  private flushFrame(): void {
    if (this.droppingFrame || this.dataLines.length === 0) {
      this.resetFrame();
      return;
    }
    this.onFrame({ eventName: this.eventName, data: this.dataLines.join("\n") });
    this.resetFrame();
  }

  private resetFrame(): void {
    this.eventName = null;
    this.dataLines = [];
    this.frameCharacters = 0;
  }
}

export function createClientAbortMeteringObserver(
  format: ClientFormat
): ClientAbortMeteringObserver {
  const evidence = new Map<EvidenceSlot, string>();
  const encoder = new TextEncoder();
  let terminalSeen = false;
  let terminalUsageSeen = false;
  let protocolFailure: ClientAbortMeteringSnapshot["protocolFailure"] = null;
  let finished = false;

  const retainedBytes = () =>
    [...new Set(evidence.values())].reduce(
      (total, value) => total + encoder.encode(value).length,
      0
    );

  const setEvidence = (slot: EvidenceSlot, value: string): void => {
    const previous = evidence.get(slot);
    evidence.set(slot, value);
    if (retainedBytes() <= CLIENT_ABORT_METER_MAX_RETAINED_BYTES) return;
    evidence.delete(slot);
    if (previous !== undefined) evidence.set(slot, previous);
  };

  const recordFrame = (frame: ParsedFrame): void => {
    const trimmed = frame.data.trim();
    if (trimmed === "[DONE]") {
      if (format === "openai") terminalSeen = true;
      setEvidence("terminal", "data: [DONE]\n\n");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(trimmed) as unknown;
    } catch {
      protocolFailure ??= {
        afterContent: terminalSeen,
        verdict: "malformed",
        eventName: frame.eventName,
      };
      return;
    }
    if (!isRecord(parsed)) return;

    const hasUsage = findUsage(parsed);
    const protocolError = isProtocolError(parsed) || frame.eventName === "error";
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

    if (terminal) terminalSeen = true;
    if (
      hasUsage &&
      (format !== "claude" || type === "message_delta" || frame.eventName === "message_delta")
    ) {
      terminalUsageSeen = true;
    }

    const compact = compactPayload(parsed);
    const compactData = JSON.stringify(compact);
    const normalized = `${frame.eventName ? `event: ${frame.eventName}\n` : ""}data: ${compactData}\n\n`;

    if (protocolError) {
      protocolFailure ??= {
        afterContent: terminalSeen,
        verdict: "error",
        eventName: frame.eventName,
      };
      setEvidence("error", normalized);
    }
    if (terminal) setEvidence("terminal", normalized);
    if (hasUsage) {
      const isInitialClaudeUsage =
        format === "claude" && (type === "message_start" || frame.eventName === "message_start");
      setEvidence(isInitialClaudeUsage ? "initial-usage" : "latest-usage", normalized);
    }
    if (
      isRecord(parsed.delta) &&
      parsed.delta.type === "signature_delta" &&
      typeof parsed.delta.signature === "string"
    ) {
      setEvidence("signature", normalized);
    }
    if (
      typeof parsed.model === "string" ||
      typeof parsed.prompt_cache_key === "string" ||
      typeof parsed.service_tier === "string" ||
      (isRecord(parsed.message) && typeof parsed.message.model === "string") ||
      (isRecord(parsed.response) &&
        (typeof parsed.response.model === "string" ||
          typeof parsed.response.service_tier === "string"))
    ) {
      setEvidence("metadata", normalized);
    }
  };

  const framer = new BoundedEventFramer(CLIENT_ABORT_METER_MAX_FRAME_BYTES, recordFrame);
  const isBillingComplete = () => terminalSeen && terminalUsageSeen;

  return {
    observe(chunk): { billingComplete: boolean } {
      if (!finished) framer.push(chunk);
      return { billingComplete: isBillingComplete() };
    },
    finish(): ClientAbortMeteringSnapshot {
      if (!finished) {
        finished = true;
        framer.finish();
      }
      const text = [...new Set(evidence.values())].join("");
      return {
        text,
        billingComplete: isBillingComplete(),
        retainedBytes: encoder.encode(text).length,
        skippedOversizedFrames: framer.skippedOversizedFrames,
        protocolFailure: protocolFailure ? { ...protocolFailure } : null,
      };
    },
  };
}
