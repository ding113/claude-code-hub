export type ProtocolFamily = "anthropic" | "openai-chat" | "openai-responses" | "gemini";

export type ValidationFailureCode =
  | "non_2xx_status"
  | "empty_body"
  | "invalid_json"
  | "stream_no_events"
  | "stream_done_only"
  | "stream_error_event"
  | "stream_no_deliverable"
  | "missing_required_field"
  | "no_deliverable_content";

export interface ValidationResult {
  ok: boolean;
  code?: ValidationFailureCode;
  reason?: string;
}

export interface ValidateInput {
  family: ProtocolFamily;
  status: number;
  body: string;
  isStream: boolean;
}

const SUCCESS: ValidationResult = { ok: true };

export function validateUpstreamResponse(input: ValidateInput): ValidationResult {
  if (input.status < 200 || input.status >= 300) {
    return fail("non_2xx_status", `upstream status=${input.status}`);
  }

  const trimmed = input.body.trim();
  if (trimmed.length === 0) {
    return fail("empty_body", "body is empty / whitespace only");
  }

  if (input.isStream) {
    return validateStream(input.family, input.body);
  }

  return validateNonStream(input.family, input.body);
}

function validateNonStream(family: ProtocolFamily, body: string): ValidationResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return fail("invalid_json", "non-stream body is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    return fail("invalid_json", "non-stream body did not parse to an object");
  }

  switch (family) {
    case "anthropic":
      return validateAnthropicMessage(parsed);
    case "openai-chat":
      return validateOpenAIChatCompletion(parsed);
    case "openai-responses":
      return validateOpenAIResponses(parsed);
    case "gemini":
      return validateGeminiNonStream(parsed);
  }
}

function validateAnthropicMessage(parsed: unknown): ValidationResult {
  const obj = parsed as { content?: unknown };
  if (!Array.isArray(obj.content)) {
    return fail("missing_required_field", "anthropic response missing content array");
  }
  if (obj.content.length === 0) {
    return fail("no_deliverable_content", "anthropic content array is empty");
  }
  for (const block of obj.content) {
    if (!block || typeof block !== "object") continue;
    const typedBlock = block as { type?: unknown; text?: unknown; input?: unknown };
    if (typedBlock.type === "text" && isNonEmptyString(typedBlock.text)) return SUCCESS;
    if (typedBlock.type === "tool_use") return SUCCESS;
    if (typedBlock.type === "thinking") {
      // thinking by itself is not deliverable; keep scanning
      continue;
    }
    if (typeof typedBlock.type === "string" && typedBlock.type.length > 0) {
      // Unknown but typed block: accept as deliverable.
      return SUCCESS;
    }
  }
  return fail("no_deliverable_content", "anthropic content has no deliverable block");
}

function validateOpenAIChatCompletion(parsed: unknown): ValidationResult {
  const obj = parsed as { choices?: unknown };
  if (!Array.isArray(obj.choices)) {
    return fail("missing_required_field", "openai-chat response missing choices");
  }
  if (obj.choices.length === 0) {
    return fail("no_deliverable_content", "openai-chat choices array is empty");
  }
  for (const choice of obj.choices) {
    if (!choice || typeof choice !== "object") continue;
    const message = (choice as { message?: unknown }).message;
    if (!message || typeof message !== "object") continue;
    if (chatMessageHasDeliverable(message)) return SUCCESS;
  }
  return fail("no_deliverable_content", "openai-chat choices have no deliverable message");
}

function chatMessageHasDeliverable(message: unknown): boolean {
  if (!message || typeof message !== "object") return false;
  const typed = message as {
    content?: unknown;
    tool_calls?: unknown;
    function_call?: unknown;
    refusal?: unknown;
  };
  if (isNonEmptyString(typed.content)) return true;
  if (Array.isArray(typed.content) && typed.content.length > 0) return true;
  if (Array.isArray(typed.tool_calls) && typed.tool_calls.length > 0) return true;
  if (typed.function_call && typeof typed.function_call === "object") return true;
  return false;
}

function validateOpenAIResponses(parsed: unknown): ValidationResult {
  const obj = parsed as { output?: unknown };
  if (!Array.isArray(obj.output)) {
    return fail("missing_required_field", "openai-responses missing output array");
  }
  if (obj.output.length === 0) {
    return fail("no_deliverable_content", "openai-responses output array is empty");
  }
  for (const item of obj.output) {
    if (!item || typeof item !== "object") continue;
    const typedItem = item as { type?: unknown; content?: unknown };
    if (typedItem.type === "message" && Array.isArray(typedItem.content)) {
      for (const part of typedItem.content) {
        if (!part || typeof part !== "object") continue;
        const partTyped = part as { type?: unknown; text?: unknown };
        if (partTyped.type === "output_text" && isNonEmptyString(partTyped.text)) return SUCCESS;
        if (typeof partTyped.type === "string" && partTyped.type.length > 0) return SUCCESS;
      }
    }
    if (typeof typedItem.type === "string" && typedItem.type !== "message") {
      // function_call, custom_tool_call_output, reasoning, etc. — all deliverable.
      return SUCCESS;
    }
  }
  return fail("no_deliverable_content", "openai-responses output has no deliverable item");
}

function validateGeminiNonStream(parsed: unknown): ValidationResult {
  const obj = parsed as { candidates?: unknown };
  if (!Array.isArray(obj.candidates)) {
    return fail("missing_required_field", "gemini response missing candidates array");
  }
  if (obj.candidates.length === 0) {
    return fail("no_deliverable_content", "gemini candidates array is empty");
  }
  for (const candidate of obj.candidates) {
    if (!candidate || typeof candidate !== "object") continue;
    const content = (candidate as { content?: unknown }).content;
    if (!content || typeof content !== "object") continue;
    const parts = (content as { parts?: unknown }).parts;
    if (!Array.isArray(parts) || parts.length === 0) continue;
    for (const part of parts) {
      if (!part || typeof part !== "object") continue;
      const typed = part as Record<string, unknown>;
      if (isNonEmptyString(typed.text)) return SUCCESS;
      if (typed.inlineData && typeof typed.inlineData === "object") return SUCCESS;
      if (typed.fileData && typeof typed.fileData === "object") return SUCCESS;
      if (typed.functionCall && typeof typed.functionCall === "object") return SUCCESS;
      if (typed.functionResponse && typeof typed.functionResponse === "object") return SUCCESS;
      if (typed.executableCode && typeof typed.executableCode === "object") return SUCCESS;
      if (typed.codeExecutionResult && typeof typed.codeExecutionResult === "object")
        return SUCCESS;
    }
  }
  return fail("no_deliverable_content", "gemini candidates have no deliverable part");
}

function validateStream(family: ProtocolFamily, body: string): ValidationResult {
  const events = collectSseEvents(body);
  if (events.length === 0) {
    return fail("stream_no_events", "stream contained no events (comments / blanks only)");
  }

  let sawDone = false;
  let sawError = false;
  let sawDeliverable = false;

  for (const event of events) {
    if (event.kind === "done") {
      sawDone = true;
      continue;
    }
    if (event.kind === "error") {
      sawError = true;
      continue;
    }
    if (event.eventName === "error") {
      sawError = true;
      continue;
    }
    const json = parseJsonSafe(event.data);
    if (!json || typeof json !== "object") continue;
    if (eventCarriesDeliverable(family, event.eventName, json)) {
      sawDeliverable = true;
    }
  }

  if (sawDeliverable) return SUCCESS;
  if (sawError) return fail("stream_error_event", "stream contained an error event");
  if (sawDone) return fail("stream_done_only", "stream contained only [DONE]");
  return fail("stream_no_deliverable", "stream had no deliverable events");
}

function eventCarriesDeliverable(
  family: ProtocolFamily,
  _eventName: string | null,
  json: object
): boolean {
  if (family === "anthropic") {
    const typed = json as { type?: unknown; delta?: unknown; content_block?: unknown };
    if (typed.type === "error") return false;
    if (typed.type === "content_block_delta") {
      const delta = typed.delta as { type?: unknown; text?: unknown } | undefined;
      if (
        delta &&
        (isNonEmptyString(delta.text) ||
          isNonEmptyString((delta as { partial_json?: unknown }).partial_json))
      ) {
        return true;
      }
    }
    if (typed.type === "content_block_start") {
      const block = typed.content_block as { type?: unknown; text?: unknown } | undefined;
      if (block && typeof block.type === "string" && block.type.length > 0) {
        if (block.type !== "text" || isNonEmptyString(block.text)) {
          // Non-text blocks (tool_use etc.) count immediately; text blocks need delta to confirm content.
          if (block.type !== "text") return true;
        }
      }
    }
    return false;
  }

  if (family === "openai-chat") {
    const choices = (json as { choices?: unknown }).choices;
    if (!Array.isArray(choices)) return false;
    for (const choice of choices) {
      if (!choice || typeof choice !== "object") continue;
      const delta = (choice as { delta?: unknown }).delta;
      if (!delta || typeof delta !== "object") continue;
      const typed = delta as { content?: unknown; tool_calls?: unknown; function_call?: unknown };
      if (isNonEmptyString(typed.content)) return true;
      if (Array.isArray(typed.content) && typed.content.length > 0) return true;
      if (Array.isArray(typed.tool_calls) && typed.tool_calls.length > 0) return true;
      if (typed.function_call && typeof typed.function_call === "object") return true;
    }
    return false;
  }

  if (family === "openai-responses") {
    const typed = json as { type?: unknown };
    if (typeof typed.type !== "string") return false;
    if (typed.type === "response.error") return false;
    if (typed.type === "response.output_text.delta") {
      const delta = (json as { delta?: unknown }).delta;
      if (isNonEmptyString(delta)) return true;
    }
    if (typed.type === "response.output_item.added" || typed.type === "response.output_item.done") {
      return true;
    }
    if (typed.type === "response.completed") {
      const response = (json as { response?: unknown }).response;
      if (response && typeof response === "object") {
        const output = (response as { output?: unknown }).output;
        if (Array.isArray(output) && output.length > 0) return true;
      }
    }
    // response.created is purely a metadata envelope; do not treat it as
    // deliverable, otherwise streams that contain only metadata events with
    // no output would falsely pass validation.
    return false;
  }

  if (family === "gemini") {
    const candidates = (json as { candidates?: unknown }).candidates;
    if (!Array.isArray(candidates) || candidates.length === 0) return false;
    for (const candidate of candidates) {
      if (!candidate || typeof candidate !== "object") continue;
      const content = (candidate as { content?: unknown }).content;
      if (!content || typeof content !== "object") continue;
      const parts = (content as { parts?: unknown }).parts;
      if (Array.isArray(parts) && parts.length > 0) return true;
    }
    return false;
  }

  return false;
}

interface SseEvent {
  kind: "data" | "done" | "error";
  eventName: string | null;
  data: string;
}

function collectSseEvents(body: string): SseEvent[] {
  const events: SseEvent[] = [];
  const dataLines: string[] = [];
  let currentEvent: string | null = null;

  const flush = () => {
    if (dataLines.length === 0) {
      currentEvent = null;
      return;
    }
    const payload = dataLines.join("\n").trim();
    dataLines.length = 0;
    const event = currentEvent;
    currentEvent = null;
    if (!payload) return;
    if (payload === "[DONE]") {
      events.push({ kind: "done", eventName: event, data: payload });
      return;
    }
    if (event === "error") {
      events.push({ kind: "error", eventName: event, data: payload });
      return;
    }
    events.push({ kind: "data", eventName: event, data: payload });
  };

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine;
    if (line.length === 0) {
      flush();
      continue;
    }
    if (line.startsWith(":")) continue; // SSE comment
    if (line.startsWith("event:")) {
      currentEvent = line.slice(6).trim();
      continue;
    }
    if (line.startsWith("data:")) {
      dataLines.push(line.slice(5).replace(/^\s/, ""));
    }
    // `id:` / `retry:` are valid SSE fields that don't carry deliverable data,
    // so we intentionally skip them without bumping any state.
  }
  flush();
  return events;
}

function parseJsonSafe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function fail(code: ValidationFailureCode, reason: string): ValidationResult {
  return { ok: false, code, reason };
}
