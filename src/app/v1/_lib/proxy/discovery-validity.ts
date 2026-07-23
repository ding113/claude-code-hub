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

function hasContent(value: unknown): boolean {
  if (typeof value === "string") return value.trim().length > 0;
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(hasContent);
  const object = value as Record<string, unknown>;
  return [
    "text",
    "content",
    "delta",
    "output_text",
    "thinking",
    "tool_use",
    "tool_calls",
    "functionCall",
    "function_call",
    "function",
    "arguments",
    "partial_json",
    "id",
    "name",
    "input",
    "parts",
  ].some((key) => hasContent(object[key]));
}

function hasAnthropicContentBlock(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const block = value as Record<string, unknown>;
  if (typeof block.type !== "string" || block.type.length === 0) return false;
  // Text blocks need non-empty text; tool_use/thinking/image blocks are
  // deliverable as soon as their typed block starts, even with empty input.
  return block.type === "text" ? hasContent(block.text) : true;
}

function hasOpenAIResponsesOutputItem(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  if (typeof item.type !== "string") return false;

  switch (item.type) {
    case "message":
      return hasContent(item.content);
    case "reasoning":
      return hasContent(item.summary) || hasContent(item.content);
    case "function_call":
    case "mcp_call":
      return hasContent(item.name) || hasContent(item.arguments);
    case "custom_tool_call":
      return hasContent(item.name) || hasContent(item.input);
    case "computer_call":
    case "web_search_call":
    case "file_search_call":
    case "code_interpreter_call":
    case "local_shell_call":
    case "shell_call":
    case "apply_patch_call":
      return [
        item.action,
        item.arguments,
        item.input,
        item.queries,
        item.query,
        item.code,
        item.command,
        item.operation,
      ].some(hasContent);
    default:
      return false;
  }
}

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

function classifyJson(value: unknown, protocol: DiscoveryProtocol): DiscoveryValidity {
  if (!value || typeof value !== "object") return { ready: false, terminal: false, error: true };
  const object = value as Record<string, unknown>;
  if (isDiscoveryProtocolErrorPayload(value)) {
    return { ready: false, terminal: true, error: true };
  }
  if (protocol === "openai-chat") {
    const choices = Array.isArray(object.choices) ? object.choices : [];
    const ready = choices.some((choice) => {
      if (!choice || typeof choice !== "object") return false;
      const choiceObject = choice as Record<string, unknown>;
      const delta = choiceObject.delta;
      return hasContent(delta) || hasContent(choiceObject.message);
    });
    return { ready, terminal: false, error: false };
  }
  if (protocol === "openai-responses") {
    if (object.type === "response.completed" || object.type === "response.done") {
      return { ready: false, terminal: true, error: false };
    }
    return {
      ready:
        (object.type === "response.output_text.delta" && hasContent(object.delta)) ||
        (object.type === "response.function_call_arguments.delta" && hasContent(object.delta)) ||
        (object.type === "response.reasoning_summary_text.delta" && hasContent(object.delta)) ||
        (object.type === "response.output_item.added" && hasOpenAIResponsesOutputItem(object.item)),
      terminal: false,
      error: false,
    };
  }
  if (protocol === "gemini") {
    const response =
      object.response && typeof object.response === "object" && !Array.isArray(object.response)
        ? (object.response as Record<string, unknown>)
        : null;
    const candidatesValue = response?.candidates ?? object.candidates;
    const candidates = Array.isArray(candidatesValue) ? candidatesValue : [];
    return {
      ready: candidates.some((candidate) => hasContent(candidate)),
      terminal: false,
      error: false,
    };
  }
  // Anthropic SSE data events: message_start/message_delta are metadata; a
  // content_block_delta or tool use is the first deliverable event.
  if (
    object.type === "message_start" ||
    object.type === "message_delta" ||
    object.type === "ping"
  ) {
    return { ready: false, terminal: false, error: false };
  }
  if (object.type === "message_stop") {
    return { ready: false, terminal: true, error: false };
  }
  return {
    ready:
      (object.type === "content_block_delta" && hasContent(object.delta)) ||
      (object.type === "content_block_start" && hasAnthropicContentBlock(object.content_block)) ||
      hasContent(object.content),
    terminal: false,
    error: false,
  };
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
    if (field === "data") {
      let value = colonIndex === -1 ? "" : line.slice(colonIndex + 1);
      if (value.startsWith(" ")) value = value.slice(1);
      this.dataLines.push(value);
      return;
    }

    // event/id/retry and unknown SSE fields carry framing metadata only. A
    // bare JSON line is supported for providers returning non-SSE JSON, but
    // never while an SSE data event is pending.
    if (field === "event" || field === "id" || field === "retry" || this.dataLines.length > 0) {
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
    if (this.dataLines.length === 0) return;
    const candidate = this.dataLines.join("\n");
    this.dataLines = [];
    if (!this.beginEvent()) return;
    if (candidate.trim() === "[DONE]") {
      this._terminal = true;
      return;
    }
    try {
      this.consumeValue(JSON.parse(candidate) as unknown);
    } catch {
      // A complete but non-JSON SSE event cannot establish protocol validity.
    }
  }

  private consumeEventValue(value: unknown): void {
    if (!this.beginEvent()) return;
    this.consumeValue(value);
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

  private consumeValue(value: unknown): void {
    const result = classifyJson(value, this.protocol);
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
