import {
  classifyFrame,
  type FrameVerdict,
  isCleanResponsesCompletion,
  isResponsesIncompleteCompletion,
  type ProtocolFamily,
} from "@/app/v1/_lib/proxy/stream-gate/frame-classifier";
import { SegmentedTextBuffer } from "@/app/v1/_lib/proxy/stream-gate/sse-frames";

export type DiscoveryProtocol =
  | "anthropic"
  | "openai-chat"
  | "openai-responses"
  | "gemini"
  | "unknown";

export type DiscoveryValidity = {
  ready: boolean;
  terminal: boolean;
  error: boolean;
  limitExceeded?: boolean;
};

export const DISCOVERY_PREFIX_MAX_BYTES = 1024 * 1024;
export const DISCOVERY_EVENT_MAX_COUNT = 1024;
const DISCOVERY_TEXT_ENCODER = new TextEncoder();

const DISCOVERY_PROTOCOL_FAMILIES: Partial<Record<DiscoveryProtocol, ProtocolFamily>> = {
  anthropic: "anthropic",
  "openai-chat": "openai-chat",
  "openai-responses": "openai-responses",
  gemini: "gemini",
};

/**
 * Protocol-level error signals that must remain terminal even if a provider
 * emits a later completion marker. Keep this shared by the racing parser and
 * stream finalizer so a failed winner cannot become Sticky during settlement.
 */
export function isDiscoveryProtocolErrorPayload(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const object = value as Record<string, unknown>;
  if (
    object.error ||
    object.failed ||
    object.type === "error" ||
    object.type === "response.error" ||
    object.type === "response.failed"
  ) {
    return true;
  }

  const response = object.response;
  return (
    !!response &&
    typeof response === "object" &&
    !Array.isArray(response) &&
    !!(response as Record<string, unknown>).error
  );
}

function validityFromVerdict(verdict: FrameVerdict): DiscoveryValidity {
  return {
    ready: verdict === "content",
    terminal: verdict === "terminal" || verdict === "error" || verdict === "malformed",
    error: verdict === "error" || verdict === "malformed",
  };
}

function classifyProtocolFrame(
  data: string,
  protocol: DiscoveryProtocol,
  eventName: string | null
): DiscoveryValidity {
  const family = DISCOVERY_PROTOCOL_FAMILIES[protocol];
  if (!family) return { ready: false, terminal: false, error: false };

  let parsed: unknown;
  try {
    parsed = JSON.parse(data) as unknown;
    // 同帧的通用失败标志优先于 content；fake-200 失败响应不能赢得 Discovery。
    if (isDiscoveryProtocolErrorPayload(parsed)) {
      return { ready: false, terminal: true, error: true };
    }
  } catch {
    parsed = undefined;
  }

  if (family === "openai-responses" && isCleanResponsesCompletion(eventName, data)) {
    return { ready: true, terminal: true, error: false };
  }
  if (family === "openai-responses" && isResponsesIncompleteCompletion(eventName, data)) {
    // incomplete 是上游明确返回的协议结果。Discovery 不应把它伪装成 502 后切商。
    return { ready: true, terminal: true, error: false };
  }

  let verdict = classifyFrame(family, eventName, data);
  if (verdict !== "neutral") return validityFromVerdict(verdict);

  // Gemini SDK wrappers may expose the native candidate chunk under response.
  if (
    family === "gemini" &&
    parsed &&
    typeof parsed === "object" &&
    !Array.isArray(parsed) &&
    (parsed as Record<string, unknown>).response &&
    typeof (parsed as Record<string, unknown>).response === "object"
  ) {
    try {
      verdict = classifyFrame(
        family,
        eventName,
        JSON.stringify((parsed as Record<string, unknown>).response)
      );
    } catch {
      return validityFromVerdict("malformed");
    }
  }

  return validityFromVerdict(verdict);
}

export function classifyDiscoveryChunk(
  chunk: Uint8Array | string,
  protocol: DiscoveryProtocol
): DiscoveryValidity {
  return new DiscoveryValidityParser(protocol).push(chunk);
}

export class DiscoveryValidityParser {
  private readonly lineBuffer = new SegmentedTextBuffer();
  private lineHead = "";
  private rawJsonState: "leading" | "structured" | "complete" | "not-json" = "leading";
  private rawJsonDepth = 0;
  private rawJsonInString = false;
  private rawJsonEscaped = false;
  private readonly dataBuffer = new SegmentedTextBuffer();
  private dataLineCount = 0;
  private eventName: string | null = null;
  private readonly decoder = new TextDecoder();
  private _ready = false;
  private _terminal = false;
  private _error = false;
  private _limitExceeded = false;
  private bytesSeen = 0;
  private eventsSeen = 0;

  constructor(readonly protocol: DiscoveryProtocol) {}

  push(chunk: Uint8Array | string): DiscoveryValidity {
    if (this._error) return this.result;
    if (!this._ready) {
      this.bytesSeen +=
        typeof chunk === "string"
          ? DISCOVERY_TEXT_ENCODER.encode(chunk).byteLength
          : chunk.byteLength;
      if (this.bytesSeen > DISCOVERY_PREFIX_MAX_BYTES) {
        this._error = true;
        this._limitExceeded = true;
        this.lineBuffer.clear();
        this.lineHead = "";
        this.resetRawJsonScan();
        this.dataBuffer.clear();
        this.dataLineCount = 0;
        this.eventName = null;
        return this.result;
      }
    }
    const decoded =
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });

    // SSE streams are line framed and events end on a blank line. Consume
    // only the newly decoded text. The unfinished line lives in a segmented
    // buffer so one-byte network chunks do not repeatedly copy a growing string.
    let lineStart = 0;
    let lineEnd = decoded.indexOf("\n");
    while (lineEnd !== -1) {
      this.appendLinePart(decoded.slice(lineStart, lineEnd));
      const rawLine = this.takeLine();
      const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
      this.consumeLine(line);
      if (this._error) {
        this.lineBuffer.clear();
        this.lineHead = "";
        this.resetRawJsonScan();
        this.dataBuffer.clear();
        this.dataLineCount = 0;
        this.eventName = null;
        return this.result;
      }
      lineStart = lineEnd + 1;
      lineEnd = decoded.indexOf("\n", lineStart);
    }
    this.appendLinePart(decoded.slice(lineStart));

    // Some providers return one raw JSON object without an SSE newline. The
    // incremental structural scan visits each code unit once, so braces inside
    // fragmented strings cannot trigger repeated full-buffer JSON.parse calls.
    if (
      this.rawJsonState === "complete" &&
      this.dataLineCount === 0 &&
      this.lineBuffer.length > 0 &&
      (this.lineHead.startsWith("{") || this.lineHead.startsWith("["))
    ) {
      const rawTail = this.takeLine();
      const tail = rawTail.trim();
      try {
        const value = JSON.parse(tail) as unknown;
        this.consumeEventValue(value);
      } catch {
        // A structurally closed root cannot become valid by appending more data.
        // Keep the line ignored until its delimiter instead of parsing it again.
        this.lineBuffer.append(rawTail);
        this.rawJsonState = "not-json";
      }
    }

    return this.result;
  }

  private appendLinePart(part: string): void {
    if (part.length === 0) return;
    this.lineBuffer.append(part);
    if (this.lineHead.length < 16) {
      // JSON 允许任意长度的前导空白。只保留第一个非空白前缀，既不反复
      // 扫描整个累计缓冲，也不会因前 16 个字符恰好都是空白而漏掉原始 JSON。
      const headPart = this.lineHead.length === 0 ? part.trimStart() : part;
      this.lineHead += headPart.slice(0, 16 - this.lineHead.length);
    }
    this.scanRawJsonPart(part);
  }

  private takeLine(): string {
    const line = this.lineBuffer.take();
    this.lineHead = "";
    this.resetRawJsonScan();
    return line;
  }

  private scanRawJsonPart(part: string): void {
    if (this.rawJsonState === "complete" || this.rawJsonState === "not-json") return;

    for (let index = 0; index < part.length; index += 1) {
      const character = part[index];
      if (this.rawJsonState === "leading") {
        if (character === " " || character === "\t" || character === "\r") continue;
        if (character !== "{" && character !== "[") {
          this.rawJsonState = "not-json";
          return;
        }
        this.rawJsonState = "structured";
        this.rawJsonDepth = 1;
        continue;
      }

      if (this.rawJsonInString) {
        if (this.rawJsonEscaped) {
          this.rawJsonEscaped = false;
        } else if (character === "\\") {
          this.rawJsonEscaped = true;
        } else if (character === '"') {
          this.rawJsonInString = false;
        }
        continue;
      }

      if (character === '"') {
        this.rawJsonInString = true;
      } else if (character === "{" || character === "[") {
        this.rawJsonDepth += 1;
      } else if (character === "}" || character === "]") {
        this.rawJsonDepth -= 1;
        if (this.rawJsonDepth === 0) {
          this.rawJsonState = "complete";
          return;
        }
      }
    }
  }

  private resetRawJsonScan(): void {
    this.rawJsonState = "leading";
    this.rawJsonDepth = 0;
    this.rawJsonInString = false;
    this.rawJsonEscaped = false;
  }

  private consumeLine(line: string): void {
    if (line === "") {
      this.flushSseEvent();
      return;
    }

    if (line.startsWith(":")) return;

    const colonIndex = line.indexOf(":");
    const field = colonIndex === -1 ? line : line.slice(0, colonIndex);
    if (field === "event") {
      this.eventName = (colonIndex === -1 ? "" : line.slice(colonIndex + 1)).trim();
      return;
    }
    if (field === "data") {
      let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      if (this.dataLineCount > 0) this.dataBuffer.append("\n");
      this.dataBuffer.append(value);
      this.dataLineCount += 1;
      return;
    }

    // event/id/retry and unknown SSE fields carry framing metadata only. A
    // bare JSON line is supported for providers returning non-SSE JSON, but
    // never while an SSE data event is pending.
    if (field === "id" || field === "retry" || this.dataLineCount > 0) {
      return;
    }
    const candidate = line.trim();
    if (candidate.startsWith("{") || candidate.startsWith("[")) {
      try {
        this.consumeEventValue(JSON.parse(candidate) as unknown);
      } catch {
        // Plain text and incomplete/non-JSON lines cannot establish validity.
      }
    }
  }

  private flushSseEvent(): void {
    const eventName = this.eventName;
    this.eventName = null;
    if (this.dataLineCount === 0) return;
    const candidate = this.dataBuffer.take();
    this.dataLineCount = 0;
    if (!this.beginEvent()) return;
    this.consumeFrame(candidate, eventName);
  }

  private consumeEventValue(value: unknown): void {
    if (!this.beginEvent()) return;
    this.consumeFrame(JSON.stringify(value), null);
  }

  private beginEvent(): boolean {
    this.eventsSeen += 1;
    if (!this._ready && this.eventsSeen > DISCOVERY_EVENT_MAX_COUNT) {
      this._error = true;
      this._limitExceeded = true;
      return false;
    }
    return true;
  }

  private consumeFrame(data: string, eventName: string | null): void {
    const result = classifyProtocolFrame(data, this.protocol, eventName);
    this._ready ||= result.ready;
    this._terminal ||= result.terminal;
    this._error ||= result.error;
  }

  get ready(): boolean {
    return this._ready && !this._error;
  }
  get terminal(): boolean {
    return this._terminal;
  }
  get error(): boolean {
    return this._error;
  }

  get limitExceeded(): boolean {
    return this._limitExceeded;
  }

  private get result(): DiscoveryValidity {
    return {
      ready: this._ready && !this._error,
      terminal: this._terminal,
      error: this._error,
      ...(this._limitExceeded ? { limitExceeded: true } : {}),
    };
  }
}
