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
};

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
    "arguments",
    "input",
    "parts",
  ].some((key) => hasContent(object[key]));
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
      (object.type === "content_block_start" && hasContent(object.content_block)) ||
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

  constructor(readonly protocol: DiscoveryProtocol) {}

  push(chunk: Uint8Array | string): DiscoveryValidity {
    this.buffered +=
      typeof chunk === "string" ? chunk : this.decoder.decode(chunk, { stream: true });
    const result = classifyDiscoveryChunk(this.buffered, this.protocol);
    this._ready ||= result.ready;
    this._terminal ||= result.terminal;
    this._error ||= result.error;
    return { ready: this._ready && !this._error, terminal: this._terminal, error: this._error };
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
}
