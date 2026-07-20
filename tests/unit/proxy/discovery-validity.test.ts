import { describe, expect, it } from "vitest";
import {
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
      classifyDiscoveryChunk('data: {"choices":[{"delta":{"content":"hi"}}]}\n', "openai-chat")
        .ready
    ).toBe(true);
    expect(classifyDiscoveryChunk("data: [DONE]\n", "openai-chat").terminal).toBe(true);
  });

  it("rejects errors even when a later chunk contains content", () => {
    const parser = new DiscoveryValidityParser("openai-responses");
    expect(parser.push('{"type":"response.failed","error":{"message":"no"}}').error).toBe(true);
    expect(parser.push('{"type":"response.output_text.delta","delta":"late"}').ready).toBe(false);
  });

  it("does not promote empty tool or content events", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_start","content_block":{"type":"text","text":""}}\n',
        "anthropic"
      ).ready
    ).toBe(false);
    expect(
      classifyDiscoveryChunk(
        'data: {"choices":[{"delta":{"tool_calls":[{"function":{}}]}}]}\n',
        "openai-chat"
      ).ready
    ).toBe(false);
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"response.output_text.delta","delta":"  "}\n',
        "openai-responses"
      ).ready
    ).toBe(false);
  });

  it("accepts a non-empty function call delta as deliverable content", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"response.function_call_arguments.delta","delta":"{\\"x\\":1}"}\n',
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

  it("accepts Anthropic tool-use starts and partial JSON deltas", () => {
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_start","content_block":{"type":"tool_use","id":"tu_1","name":"search","input":{}}}\n',
        "anthropic"
      ).ready
    ).toBe(true);
    expect(
      classifyDiscoveryChunk(
        'data: {"type":"content_block_delta","delta":{"type":"input_json_delta","partial_json":"{\\"q\\":1}"}}\n',
        "anthropic"
      ).ready
    ).toBe(true);
  });
});
