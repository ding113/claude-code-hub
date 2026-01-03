import crypto from "node:crypto";

const WARMUP_TEXT = "Warmup";
const WARMUP_RESPONSE_TEXT = "I'm ready to help you.";

export const CCH_INTERCEPT_HEADER = "x-cch-intercepted";
export const CCH_INTERCEPT_WARMUP_VALUE = "warmup";
export const WARMUP_BLOCKED_BY = "warmup";

type ClaudeTextContentBlock = {
  type: "text";
  text: string;
};

type ClaudeMessageUsage = {
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
};

type ClaudeMessageResponse = {
  model: string;
  id: string;
  type: "message";
  role: "assistant";
  content: ClaudeTextContentBlock[];
  stop_reason: "end_turn";
  stop_sequence: null;
  usage: ClaudeMessageUsage;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function isClaudeWarmupRequestBody(requestBody: unknown): boolean {
  if (!isRecord(requestBody)) return false;

  const messages = requestBody.messages;
  if (!Array.isArray(messages) || messages.length !== 1) return false;

  const message = messages[0];
  if (!isRecord(message)) return false;

  if (message.role !== "user") return false;

  const content = message.content;
  if (!Array.isArray(content) || content.length === 0) return false;

  for (const item of content) {
    if (!isRecord(item)) continue;
    if (item.type !== "text") continue;
    if (item.text !== WARMUP_TEXT) continue;

    const cacheControl = item.cache_control;
    if (!isRecord(cacheControl)) continue;
    if (cacheControl.type !== "ephemeral") continue;

    return true;
  }

  return false;
}

export function getClaudeStreamFlag(requestBody: unknown, acceptHeader: string | null): boolean {
  if (isRecord(requestBody) && requestBody.stream === true) {
    return true;
  }

  const accept = acceptHeader?.toLowerCase() ?? "";
  return accept.includes("text/event-stream");
}

function buildWarmupMessageId(): string {
  const rand = crypto.randomBytes(12).toString("hex");
  return `msg_${rand}`;
}

export function buildClaudeWarmupMessageResponse(model: string): ClaudeMessageResponse {
  return {
    model,
    id: buildWarmupMessageId(),
    type: "message",
    role: "assistant",
    content: [
      {
        type: "text",
        text: WARMUP_RESPONSE_TEXT,
      },
    ],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: {
      input_tokens: 0,
      output_tokens: 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
}

export function buildClaudeWarmupSse(response: ClaudeMessageResponse): string {
  const startEvent = {
    type: "message_start",
    message: {
      id: response.id,
      type: response.type,
      role: response.role,
      model: response.model,
      content: [],
      stop_reason: null,
      stop_sequence: null,
      usage: response.usage,
    },
  };

  const contentBlockStart = {
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "" },
  };

  const contentBlockDelta = {
    type: "content_block_delta",
    index: 0,
    delta: { type: "text_delta", text: response.content[0]?.text ?? "" },
  };

  const contentBlockStop = { type: "content_block_stop", index: 0 };
  const messageDelta = {
    type: "message_delta",
    delta: { stop_reason: response.stop_reason, stop_sequence: response.stop_sequence },
    usage: response.usage,
  };
  const messageStop = { type: "message_stop" };

  const lines: string[] = [];
  const pushEvent = (event: string, data: unknown) => {
    lines.push(`event: ${event}`);
    lines.push(`data: ${JSON.stringify(data)}`);
    lines.push("");
  };

  pushEvent("message_start", startEvent);
  pushEvent("content_block_start", contentBlockStart);
  pushEvent("content_block_delta", contentBlockDelta);
  pushEvent("content_block_stop", contentBlockStop);
  pushEvent("message_delta", messageDelta);
  pushEvent("message_stop", messageStop);

  // SSE 以空行作为事件分隔符
  return `${lines.join("\n")}\n`;
}

export function buildClaudeWarmupInterceptResponse(params: { model: string; stream: boolean }): {
  response: Response;
  responseBodyForStore: string;
  responseHeaders: Headers;
} {
  const payload = buildClaudeWarmupMessageResponse(params.model);

  if (params.stream) {
    const sseText = buildClaudeWarmupSse(payload);
    const headers = new Headers({
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      [CCH_INTERCEPT_HEADER]: CCH_INTERCEPT_WARMUP_VALUE,
    });
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(sseText));
        controller.close();
      },
    });

    return {
      response: new Response(body, { status: 200, headers }),
      responseBodyForStore: sseText,
      responseHeaders: headers,
    };
  }

  const bodyText = JSON.stringify(payload);
  const headers = new Headers({
    "Content-Type": "application/json",
    [CCH_INTERCEPT_HEADER]: CCH_INTERCEPT_WARMUP_VALUE,
  });

  return {
    response: new Response(bodyText, { status: 200, headers }),
    responseBodyForStore: bodyText,
    responseHeaders: headers,
  };
}
