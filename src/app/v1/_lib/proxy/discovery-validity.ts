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

function classifyJson(value: unknown, protocol: DiscoveryProtocol): DiscoveryValidity {
  if (!value || typeof value !== "object") return { ready: false, terminal: false, error: true };
  const object = value as Record<string, unknown>;
  if (
    object.error ||
    object.failed ||
    object.type === "error" ||
    object.type === "response.failed"
  ) {
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
        (object.type === "response.output_item.added" && hasContent(object.item)),
      terminal: false,
      error: false,
    };
  }
  if (protocol === "gemini") {
    const candidates = Array.isArray(object.candidates) ? object.candidates : [];
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
  const text = typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
  if (!text.trim() || text.trim().startsWith(":"))
    return { ready: false, terminal: false, error: false };
  if (text.includes("[DONE]")) return { ready: false, terminal: true, error: false };

  const lines = text.split(/\r?\n/);
  let sawTerminal = false;
  let sawError = false;
  let sawReady = false;
  for (const line of lines) {
    const candidate = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!candidate || candidate.startsWith(":")) continue;
    try {
      const result = classifyJson(JSON.parse(candidate), protocol);
      sawTerminal ||= result.terminal;
      sawError ||= result.error;
      sawReady ||= result.ready;
    } catch {
      // A raw JSON response may arrive in a single chunk. Plain text is not
      // a protocol-safe winner; keep waiting for a parseable event.
    }
  }
  return { ready: sawReady && !sawError, terminal: sawTerminal, error: sawError };
}

export class DiscoveryValidityParser {
  private buffered = "";
  private readonly decoder = new TextDecoder();
  private _ready = false;
  private _terminal = false;
  private _error = false;
  private _limitExceeded = false;
  private bytesSeen = 0;
  private eventsSeen = 0;

  constructor(readonly protocol: DiscoveryProtocol) {}

  push(chunk: Uint8Array | string): DiscoveryValidity {
    this.bytesSeen +=
      typeof chunk === "string" ? new TextEncoder().encode(chunk).byteLength : chunk.byteLength;
    if (!this._ready && this.bytesSeen > DISCOVERY_PREFIX_MAX_BYTES) {
      this._error = true;
      this._limitExceeded = true;
      this.buffered = "";
      return this.result;
    }
    this.buffered +=
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });

    // SSE streams are line framed. Consume each completed line once instead
    // of reparsing the complete prefix on every chunk (which is quadratic on
    // long streams). Keep only the unfinished line for the next push.
    if (this.buffered.includes("\n")) {
      const lines = this.buffered.split(/\r?\n/);
      this.buffered = lines.pop() ?? "";
      for (const line of lines) this.consumeLine(line);
    }

    // Some providers return one raw JSON object without an SSE newline. Parse
    // it only when the complete object is available; incomplete JSON remains
    // buffered and is not repeatedly scanned as a protocol event.
    const tail = this.buffered.trim();
    if (tail) {
      const candidate = tail.startsWith("data:") ? tail.slice(5).trim() : tail;
      if (candidate === "[DONE]") {
        this._terminal = true;
        this.buffered = "";
      } else if (candidate.startsWith("{") || candidate.startsWith("[")) {
        try {
          const value = JSON.parse(candidate) as unknown;
          this.consumeValue(value);
          this.buffered = "";
        } catch {
          // Keep incomplete raw JSON until the next chunk completes it.
        }
      }
    }

    return this.result;
  }

  private consumeLine(line: string): void {
    const candidate = line.startsWith("data:") ? line.slice(5).trim() : line.trim();
    if (!candidate || candidate.startsWith(":")) return;
    if (candidate === "[DONE]") {
      this._terminal = true;
      return;
    }
    try {
      this.consumeValue(JSON.parse(candidate) as unknown);
    } catch {
      // Ignore comments and incomplete/non-JSON protocol lines.
    }
  }

  private consumeValue(value: unknown): void {
    this.eventsSeen += 1;
    if (!this._ready && this.eventsSeen > DISCOVERY_EVENT_MAX_COUNT) {
      this._error = true;
      this._limitExceeded = true;
      return;
    }
    const result = classifyJson(value, this.protocol);
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
