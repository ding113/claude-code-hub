import { describe, expect, it } from "vitest";
import {
  classifyFrame,
  isRequestEchoFrame,
  mapProviderTypeToFamily,
} from "@/app/v1/_lib/proxy/stream-gate/frame-classifier";

describe("mapProviderTypeToFamily", () => {
  it("maps provider types to protocol families", () => {
    expect(mapProviderTypeToFamily("claude")).toBe("anthropic");
    expect(mapProviderTypeToFamily("claude-auth")).toBe("anthropic");
    expect(mapProviderTypeToFamily("codex")).toBe("openai-responses");
    expect(mapProviderTypeToFamily("openai-compatible")).toBe("openai-chat");
    expect(mapProviderTypeToFamily("gemini")).toBe("gemini");
    expect(mapProviderTypeToFamily("gemini-cli")).toBe("gemini");
    expect(mapProviderTypeToFamily("unknown-type")).toBeNull();
    expect(mapProviderTypeToFamily(null)).toBeNull();
  });
});

describe("classifyFrame: anthropic", () => {
  it("content: text delta", () => {
    expect(
      classifyFrame(
        "anthropic",
        "content_block_delta",
        '{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}'
      )
    ).toBe("content");
  });

  it("content: embedded type without SSE event name", () => {
    expect(
      classifyFrame("anthropic", null, '{"type":"content_block_delta","delta":{"text":"hi"}}')
    ).toBe("content");
  });

  it("content: thinking / partial_json / signature deltas", () => {
    expect(
      classifyFrame("anthropic", null, '{"type":"content_block_delta","delta":{"thinking":"..."}}')
    ).toBe("content");
    expect(
      classifyFrame(
        "anthropic",
        null,
        '{"type":"content_block_delta","delta":{"partial_json":"{\\"a\\""}}'
      )
    ).toBe("content");
    expect(
      classifyFrame("anthropic", null, '{"type":"content_block_delta","delta":{"signature":"sig"}}')
    ).toBe("content");
  });

  it("neutral: empty text delta", () => {
    expect(
      classifyFrame("anthropic", null, '{"type":"content_block_delta","delta":{"text":""}}')
    ).toBe("neutral");
  });

  it("content: content_block_start carrying entity payload (tool_use)", () => {
    expect(
      classifyFrame(
        "anthropic",
        "content_block_start",
        '{"type":"content_block_start","content_block":{"type":"tool_use","id":"t1","name":"f"}}'
      )
    ).toBe("content");
  });

  it("neutral: content_block_start for empty text block", () => {
    expect(
      classifyFrame(
        "anthropic",
        "content_block_start",
        '{"type":"content_block_start","content_block":{"type":"text","text":""}}'
      )
    ).toBe("neutral");
  });

  it("neutral: message_start / ping / message_delta bookkeeping", () => {
    expect(
      classifyFrame("anthropic", "message_start", '{"type":"message_start","message":{"id":"m"}}')
    ).toBe("neutral");
    expect(classifyFrame("anthropic", "ping", '{"type":"ping"}')).toBe("neutral");
    expect(
      classifyFrame(
        "anthropic",
        "message_delta",
        '{"type":"message_delta","usage":{"output_tokens":5}}'
      )
    ).toBe("neutral");
  });

  it("error: error event and fake-200 error envelope", () => {
    expect(
      classifyFrame(
        "anthropic",
        "error",
        '{"type":"error","error":{"type":"overloaded_error","message":"x"}}'
      )
    ).toBe("error");
    expect(classifyFrame("anthropic", null, '{"error":{"message":"boom"}}')).toBe("error");
  });

  it("error takes precedence over content in the same frame", () => {
    expect(
      classifyFrame(
        "anthropic",
        "content_block_delta",
        '{"type":"content_block_delta","delta":{"text":"hi"},"error":{"message":"x"}}'
      )
    ).toBe("error");
  });

  it("terminal: message_stop", () => {
    expect(classifyFrame("anthropic", "message_stop", '{"type":"message_stop"}')).toBe("terminal");
  });

  it("malformed: broken or non-object JSON", () => {
    expect(classifyFrame("anthropic", null, '{"type":')).toBe("malformed");
    expect(classifyFrame("anthropic", null, "plain text")).toBe("malformed");
    expect(classifyFrame("anthropic", null, '"just a string"')).toBe("malformed");
  });

  it("neutral: unknown future event", () => {
    expect(classifyFrame("anthropic", "future_event", '{"type":"future_event"}')).toBe("neutral");
  });
});

describe("classifyFrame: openai-chat", () => {
  it("content: delta content / tool_calls / refusal / audio", () => {
    expect(classifyFrame("openai-chat", null, '{"choices":[{"delta":{"content":"hi"}}]}')).toBe(
      "content"
    );
    expect(
      classifyFrame(
        "openai-chat",
        null,
        '{"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"name":"f"}}]}}]}'
      )
    ).toBe("content");
    expect(classifyFrame("openai-chat", null, '{"choices":[{"delta":{"refusal":"no"}}]}')).toBe(
      "content"
    );
    expect(
      classifyFrame("openai-chat", null, '{"choices":[{"delta":{"audio":{"data":"b64"}}}]}')
    ).toBe("content");
  });

  it("neutral: role-only first chunk / finish_reason-only / usage-only", () => {
    expect(classifyFrame("openai-chat", null, '{"choices":[{"delta":{"role":"assistant"}}]}')).toBe(
      "neutral"
    );
    expect(
      classifyFrame("openai-chat", null, '{"choices":[{"delta":{},"finish_reason":"stop"}]}')
    ).toBe("neutral");
    expect(classifyFrame("openai-chat", null, '{"choices":[],"usage":{"total_tokens":10}}')).toBe(
      "neutral"
    );
  });

  it("neutral: empty string content delta", () => {
    expect(classifyFrame("openai-chat", null, '{"choices":[{"delta":{"content":""}}]}')).toBe(
      "neutral"
    );
  });

  it("error: in-stream error payload", () => {
    expect(classifyFrame("openai-chat", null, '{"error":{"message":"rate limited"}}')).toBe(
      "error"
    );
  });

  it("terminal: [DONE] sentinel", () => {
    expect(classifyFrame("openai-chat", null, "[DONE]")).toBe("terminal");
    expect(classifyFrame("openai-chat", null, "  [DONE]  ")).toBe("terminal");
  });

  it("malformed: non-JSON that is not the sentinel", () => {
    expect(classifyFrame("openai-chat", null, "DONE")).toBe("malformed");
  });
});

describe("classifyFrame: openai-responses", () => {
  it("content: output_text delta via SSE event name", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.output_text.delta",
        '{"type":"response.output_text.delta","delta":"hi"}'
      )
    ).toBe("content");
  });

  it("content: embedded type without event name", () => {
    expect(
      classifyFrame("openai-responses", null, '{"type":"response.output_text.delta","delta":"hi"}')
    ).toBe("content");
  });

  it("content: reasoning delta / function_call arguments done / partial image", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.reasoning_text.delta",
        '{"type":"response.reasoning_text.delta","delta":"think"}'
      )
    ).toBe("content");
    expect(
      classifyFrame(
        "openai-responses",
        "response.function_call_arguments.done",
        '{"type":"response.function_call_arguments.done","arguments":"{}"}'
      )
    ).toBe("content");
    expect(
      classifyFrame(
        "openai-responses",
        "response.image_generation_call.partial_image",
        '{"type":"response.image_generation_call.partial_image","partial_image_b64":"abc"}'
      )
    ).toBe("content");
  });

  it("content: output_item.added carrying tool name", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.output_item.added",
        '{"type":"response.output_item.added","item":{"type":"function_call","name":"get_x"}}'
      )
    ).toBe("content");
  });

  it("neutral: output_item.added without item.name (message item)", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.output_item.added",
        '{"type":"response.output_item.added","item":{"type":"message"}}'
      )
    ).toBe("neutral");
  });

  it("neutral: response.created with error:null does not hit error rule", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.created",
        '{"type":"response.created","response":{"id":"r","error":null}}'
      )
    ).toBe("neutral");
  });

  it("neutral: sub-tool failures are recoverable", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.mcp_call.failed",
        '{"type":"response.mcp_call.failed"}'
      )
    ).toBe("neutral");
  });

  it("error: top-level error event / response.failed / populated response.error", () => {
    expect(
      classifyFrame("openai-responses", "error", '{"type":"error","code":"x","message":"m"}')
    ).toBe("error");
    expect(
      classifyFrame(
        "openai-responses",
        "response.failed",
        '{"type":"response.failed","response":{"error":{"message":"m"}}}'
      )
    ).toBe("error");
    expect(
      classifyFrame(
        "openai-responses",
        "response.in_progress",
        '{"type":"response.in_progress","response":{"error":{"message":"m"}}}'
      )
    ).toBe("error");
  });

  it("terminal: response.completed / response.incomplete", () => {
    expect(
      classifyFrame(
        "openai-responses",
        "response.completed",
        '{"type":"response.completed","response":{"output":[],"error":null}}'
      )
    ).toBe("terminal");
    expect(
      classifyFrame(
        "openai-responses",
        "response.incomplete",
        '{"type":"response.incomplete","response":{"error":null}}'
      )
    ).toBe("terminal");
  });
});

describe("classifyFrame: gemini", () => {
  it("content: text / functionCall / inlineData parts", () => {
    expect(
      classifyFrame(
        "gemini",
        null,
        '{"candidates":[{"content":{"parts":[{"text":"hi"}],"role":"model"}}]}'
      )
    ).toBe("content");
    expect(
      classifyFrame(
        "gemini",
        null,
        '{"candidates":[{"content":{"parts":[{"functionCall":{"name":"f","args":{}}}]}}]}'
      )
    ).toBe("content");
    expect(
      classifyFrame(
        "gemini",
        null,
        '{"candidates":[{"content":{"parts":[{"inlineData":{"mimeType":"image/png","data":"b64"}}]}}]}'
      )
    ).toBe("content");
  });

  it("neutral: usageMetadata-only chunk", () => {
    expect(
      classifyFrame("gemini", null, '{"usageMetadata":{"totalTokenCount":10},"modelVersion":"g"}')
    ).toBe("neutral");
  });

  it("neutral: empty parts / empty text", () => {
    expect(classifyFrame("gemini", null, '{"candidates":[{"content":{"parts":[]}}]}')).toBe(
      "neutral"
    );
    expect(
      classifyFrame("gemini", null, '{"candidates":[{"content":{"parts":[{"text":""}]}}]}')
    ).toBe("neutral");
  });

  it("error: error chunk / promptFeedback.blockReason / abnormal finishReason", () => {
    expect(
      classifyFrame("gemini", null, '{"error":{"code":500,"message":"x","status":"INTERNAL"}}')
    ).toBe("error");
    expect(classifyFrame("gemini", null, '{"promptFeedback":{"blockReason":"SAFETY"}}')).toBe(
      "error"
    );
    expect(classifyFrame("gemini", null, '{"candidates":[{"finishReason":"SAFETY"}]}')).toBe(
      "error"
    );
    expect(
      classifyFrame("gemini", null, '{"candidates":[{"finishReason":"MALFORMED_FUNCTION_CALL"}]}')
    ).toBe("error");
  });

  it("error precedence: SAFETY finishReason beats content in same chunk", () => {
    expect(
      classifyFrame(
        "gemini",
        null,
        '{"candidates":[{"content":{"parts":[{"text":"partial"}]},"finishReason":"SAFETY"}]}'
      )
    ).toBe("error");
  });

  it("content precedence: normal STOP with text is content, not terminal", () => {
    expect(
      classifyFrame(
        "gemini",
        null,
        '{"candidates":[{"content":{"parts":[{"text":"done"}]},"finishReason":"STOP"}]}'
      )
    ).toBe("content");
  });

  it("terminal: STOP / MAX_TOKENS finishReason without content", () => {
    expect(classifyFrame("gemini", null, '{"candidates":[{"finishReason":"STOP"}]}')).toBe(
      "terminal"
    );
    expect(classifyFrame("gemini", null, '{"candidates":[{"finishReason":"MAX_TOKENS"}]}')).toBe(
      "terminal"
    );
  });
});

describe("classifyFrame: shared edge cases", () => {
  it("neutral: empty / whitespace-only data", () => {
    expect(classifyFrame("anthropic", null, "")).toBe("neutral");
    expect(classifyFrame("openai-chat", null, "   ")).toBe("neutral");
  });

  it("malformed: truncated JSON in every family", () => {
    for (const family of ["anthropic", "openai-chat", "openai-responses", "gemini"] as const) {
      expect(classifyFrame(family, null, '{"cut')).toBe("malformed");
    }
  });

  it("neutral: JSON array payloads with no rule hits", () => {
    expect(classifyFrame("openai-chat", null, "[]")).toBe("neutral");
  });
});

describe("isRequestEchoFrame", () => {
  it("recognizes openai-responses lifecycle echo frames by event name", () => {
    expect(isRequestEchoFrame("openai-responses", "response.created", "{}")).toBe(true);
    expect(isRequestEchoFrame("openai-responses", "response.in_progress", "{}")).toBe(true);
    expect(isRequestEchoFrame("openai-responses", "response.queued", "{}")).toBe(true);
    expect(isRequestEchoFrame("openai-responses", "response.output_text.delta", "{}")).toBe(false);
  });

  it("sniffs the data head when the event line is absent", () => {
    expect(
      isRequestEchoFrame("openai-responses", null, '{"type":"response.created","response":{}}')
    ).toBe(true);
    expect(isRequestEchoFrame("openai-responses", null, '{"type":"other"}')).toBe(false);
    // type 不在头部 64 字节内则不嗅探（上游实践中 type 总在最前）
    expect(
      isRequestEchoFrame(
        "openai-responses",
        null,
        `{"pad":"${"z".repeat(80)}","type":"response.created"}`
      )
    ).toBe(false);
  });

  it("never matches for families without echo frames", () => {
    expect(isRequestEchoFrame("anthropic", "response.created", "{}")).toBe(false);
    expect(isRequestEchoFrame("openai-chat", null, '{"type":"response.created"}')).toBe(false);
    expect(isRequestEchoFrame("gemini", null, '{"type":"response.created"}')).toBe(false);
  });
});
