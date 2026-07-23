import { describe, expect, it } from "vitest";
import {
  DISCOVERY_EVENT_MAX_COUNT,
  DISCOVERY_PREFIX_MAX_BYTES,
  DiscoveryValidityParser,
  classifyDiscoveryChunk,
} from "@/app/v1/_lib/proxy/discovery-validity";

describe("discovery validity", () => {
  it("does not treat Anthropic metadata as a winner", () => {
    expect(classifyDiscoveryChunk('data: {"type":"message_start"}\n\n', "anthropic").ready).toBe(
      false
    );
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_delta","delta":{"text":"hi"}}\n\n',
        "anthropic"
      ).ready
    ).toBe(true);
  });

  it("accepts OpenAI Chat delta and rejects DONE", () => {
    expect(
      classifyDiscoveryChunk('data: {"choices":[{"delta":{"content":"hi"}}]}\n\n', "openai-chat")
        .ready
    ).toBe(true);
    expect(classifyDiscoveryChunk("data: [DONE]\n\n", "openai-chat").terminal).toBe(true);
  });

  it("keeps stateless readiness when content and DONE share a chunk", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n',
        "openai-chat"
      )
    ).toEqual({ ready: true, terminal: true, error: false });
  });

  it("keeps stateless readiness when a comment precedes content in one chunk", () => {
    expect(
      classifyDiscoveryChunk(
        ': keepalive\ndata: {"choices":[{"delta":{"content":"ready"}}]}\n\n',
        "openai-chat"
      )
    ).toEqual({ ready: true, terminal: false, error: false });
  });

  it("rejects errors even when a later chunk contains content", () => {
    const parser = new DiscoveryValidityParser("openai-responses");
    expect(parser.push('{"type":"response.failed","error":{"message":"no"}}').error).toBe(true);
    expect(parser.push('{"type":"response.output_text.delta","delta":"late"}').ready).toBe(false);
  });

  it("does not promote empty tool or content events", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n\n',
        "anthropic"
      ).ready
    ).toBe(false);
    expect(
      classifyDiscoveryChunk(
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{}}]}}]}\n\n',
        "openai-chat"
      ).ready
    ).toBe(false);
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"response.output_text.delta","delta":"  "}\n\n',
        "openai-responses"
      ).ready
    ).toBe(false);
  });

  it("accepts a non-empty function call delta as deliverable content", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"response.function_call_arguments.delta","delta":"{\\"x\\":1}"}\n\n',
        "openai-responses"
      ).ready
    ).toBe(true);
  });

  it("holds Responses output-item metadata until a text delta is deliverable", () => {
    const parser = new DiscoveryValidityParser("openai-responses");

    expect(
      parser.push(
        'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress","content":[]}}\n\n'
      )
    ).toEqual({ ready: false, terminal: false, error: false });
    expect(parser.push('data: {"type":"response.output_text.delta","delta":"hello"}\n\n')).toEqual({
      ready: true,
      terminal: false,
      error: false,
    });
  });

  it("does not let Responses output-item metadata mask a later error", () => {
    const parser = new DiscoveryValidityParser("openai-responses");

    expect(
      parser.push(
        'data: {"type":"response.output_item.added","item":{"id":"msg_1","type":"message","status":"in_progress"}}\n\n'
      )
    ).toMatchObject({ ready: false, error: false });
    expect(
      parser.push('data: {"type":"response.failed","error":{"message":"upstream failed"}}\n\n')
    ).toEqual({ ready: false, terminal: true, error: true });
  });

  it("accepts only an explicit non-empty Responses tool payload", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","status":"in_progress"}}\n\n',
        "openai-responses"
      ).ready
    ).toBe(false);
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"response.output_item.added","item":{"id":"fc_1","type":"function_call","name":"lookup","arguments":"{}"}}\n\n',
        "openai-responses"
      ).ready
    ).toBe(true);
  });

  it("consumes split SSE lines incrementally without waiting for the full stream", () => {
    const parser = new DiscoveryValidityParser("openai-chat");
    expect(parser.push('data: {"choices":[{"delta":{"content":"hel')).toEqual({
      ready: false,
      terminal: false,
      error: false,
    });
    expect(parser.push('lo"}}]}\n\n')).toEqual({
      ready: true,
      terminal: false,
      error: false,
    });
  });

  it("joins all data lines in one SSE event before parsing", () => {
    const parser = new DiscoveryValidityParser("openai-chat");

    expect(parser.push('event: message\nid: 42\ndata: {"choices":[{"delta":\n')).toEqual({
      ready: false,
      terminal: false,
      error: false,
    });
    expect(parser.push('data: {"content":"hello"}}]}\n\n')).toEqual({
      ready: true,
      terminal: false,
      error: false,
    });
  });

  it("ignores comments and SSE metadata instead of parsing them as payloads", () => {
    const parser = new DiscoveryValidityParser("anthropic");

    expect(parser.push(": keepalive\nevent: message\nid: 7\nretry: 1000\n\n")).toEqual({
      ready: false,
      terminal: false,
      error: false,
    });
    expect(
      parser.push('data: {"type":"content_block_delta",\ndata: "delta":{"text":"hi"}}\n\n')
    ).toMatchObject({ ready: true, error: false });
  });

  it("does not parse raw JSON while an SSE data event is pending", () => {
    const parser = new DiscoveryValidityParser("openai-chat");

    expect(parser.push('data: {"choices":[{"delta":\n')).toEqual({
      ready: false,
      terminal: false,
      error: false,
    });
    expect(parser.push('{"content":"wrongly standalone"}}]}')).toEqual({
      ready: false,
      terminal: false,
      error: false,
    });
    expect(parser.push('\ndata: {"content":"ready"}}]}\n\n')).toMatchObject({
      ready: true,
      error: false,
    });
  });

  it("keeps ready when content and the terminal marker arrive in one read", () => {
    const parser = new DiscoveryValidityParser("openai-chat");

    expect(
      parser.push('data: {"choices":[{"delta":{"content":"done"}}]}\n\ndata: [DONE]\n\n')
    ).toEqual({
      ready: true,
      terminal: true,
      error: false,
    });
  });

  it("accepts Anthropic tool-use partial JSON as deliverable content", () => {
    const parser = new DiscoveryValidityParser("anthropic");

    expect(
      parser.push('data: {"type":"content_block_delta","delta":{"partial_json":"{\\"x\\":1}"}}\n\n')
    ).toMatchObject({ ready: true, error: false });
    expect(parser.push('data: {"type":"message_stop"}\n\n')).toMatchObject({
      ready: true,
      terminal: true,
      error: false,
    });
  });

  it("accepts nested OpenAI Chat tool-call arguments", () => {
    expect(
      parserForOpenAIChatToolCall().push(
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{"arguments":"{\\"x\\":1}"}}]}}]}\n\n'
      )
    ).toMatchObject({ ready: true, error: false });
  });

  it("accepts Anthropic tool-use starts and partial JSON deltas", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tu_1","name":"search","input":{}}}\n\n',
        "anthropic"
      ).ready
    ).toBe(true);
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"q\\":1}"}}\n\n',
        "anthropic"
      ).ready
    ).toBe(true);
  });

  it("fails a metadata-only prefix after the byte limit", () => {
    const parser = new DiscoveryValidityParser("openai-chat");
    const result = parser.push(`:${"x".repeat(DISCOVERY_PREFIX_MAX_BYTES + 1)}`);
    expect(result).toMatchObject({ ready: false, error: true, limitExceeded: true });
  });

  it("fails metadata-only protocol events after the event limit", () => {
    const parser = new DiscoveryValidityParser("anthropic");
    let result = parser.push("");
    for (let index = 0; index <= DISCOVERY_EVENT_MAX_COUNT; index += 1) {
      result = parser.push('data: {"type":"ping"}\n\n');
    }
    expect(result).toMatchObject({ ready: false, error: true, limitExceeded: true });
  });

  it("counts a multi-line data payload as one complete SSE event", () => {
    const parser = new DiscoveryValidityParser("anthropic");
    const metadataEvents = Array.from(
      { length: DISCOVERY_EVENT_MAX_COUNT - 1 },
      () => 'data: {"type":"ping"}\n\n'
    ).join("");

    expect(parser.push(`${metadataEvents}data: {\ndata: "type":"ping"}\n\n`)).toEqual({
      ready: false,
      terminal: false,
      error: false,
    });
    expect(parser.push('data: {"type":"ping"}\n\n')).toMatchObject({
      ready: false,
      error: true,
      limitExceeded: true,
    });
  });

  it("stops parsing current and future events after the event limit", () => {
    const parser = new DiscoveryValidityParser("anthropic");
    const metadataEvents = Array.from(
      { length: DISCOVERY_EVENT_MAX_COUNT + 1 },
      () => 'data: {"type":"ping"}\n\n'
    ).join("");

    const limited = parser.push(`${metadataEvents}data: {"type":"message_stop"}\n\n`);
    expect(limited).toMatchObject({
      ready: false,
      terminal: false,
      error: true,
      limitExceeded: true,
    });

    expect(parser.push('data: {"type":"message_stop"}\n\n')).toEqual(limited);
  });
});

function parserForOpenAIChatToolCall(): DiscoveryValidityParser {
  return new DiscoveryValidityParser("openai-chat");
}
