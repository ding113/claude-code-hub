import {
  classifyFrame,
  type FrameVerdict,
  type ProtocolFamily,
} from "./stream-gate/frame-classifier";

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

  let verdict = classifyFrame(family, eventName, data);
  if (verdict !== "neutral") return validityFromVerdict(verdict);

  try {
    const value = JSON.parse(data) as unknown;
    if (isDiscoveryProtocolErrorPayload(value)) {
      return { ready: false, terminal: true, error: true };
    }

    // Gemini SDK wrappers may expose the native candidate chunk under response.
    if (
      family === "gemini" &&
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>).response &&
      typeof (value as Record<string, unknown>).response === "object"
    ) {
      verdict = classifyFrame(
        family,
        eventName,
        JSON.stringify((value as Record<string, unknown>).response)
      );
    }
  } catch {
    return validityFromVerdict("malformed");
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
  private buffered = "";
  private dataLines: string[] = [];
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
        this.buffered = "";
        this.dataLines = [];
        this.eventName = null;
        return this.result;
      }
    }
    this.buffered +=
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });

    // SSE streams are line framed and events end on a blank line. Consume
    // completed lines once, while preserving all data: lines for the current
    // event so multi-line payloads are joined according to the SSE spec.
    if (this.buffered.includes("\n")) {
      const lines = this.buffered.split("\n");
      this.buffered = lines.pop() ?? "";
      for (const rawLine of lines) {
        const line = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;
        this.consumeLine(line);
        if (this._error) {
          this.buffered = "";
          this.dataLines = [];
          this.eventName = null;
          return this.result;
        }
      }
    }

    // Some providers return one raw JSON object without an SSE newline. Parse
    // it only when the complete object is available; incomplete JSON remains
    // buffered and is not repeatedly scanned as a protocol event.
    const tail = this.buffered.trim();
    if (this.dataLines.length === 0 && tail && !this.isSseField(tail)) {
      if (tail.startsWith("{") || tail.startsWith("[")) {
        try {
          const value = JSON.parse(tail) as unknown;
          this.consumeEventValue(value);
          this.buffered = "";
        } catch {
          // Keep incomplete raw JSON until the next chunk completes it.
        }
      }
    }

    return this.result;
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
      this.dataLines.push(value);
      return;
    }

    // event/id/retry and unknown SSE fields carry framing metadata only. A
    // bare JSON line is supported for providers returning non-SSE JSON, but
    // never while an SSE data event is pending.
    if (field === "id" || field === "retry" || this.dataLines.length > 0) {
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
    if (this.dataLines.length === 0) return;
    const candidate = this.dataLines.join("\n");
    this.dataLines = [];
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

  private isSseField(line: string): boolean {
    return (
      line.startsWith(":") ||
      line.startsWith("data:") ||
      line.startsWith("event:") ||
      line.startsWith("id:") ||
      line.startsWith("retry:")
    );
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
