import { describe, expect, test } from "vitest";
import { parseSSEStream } from "./sse-collector";

describe("parseSSEStream anthropic usage", () => {
  test("keeps input_tokens from message_start and output_tokens from message_delta", () => {
    const body = `event: message_start
data: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-opus-4-6","content":[],"usage":{"input_tokens":1,"output_tokens":1}}}

event: content_block_delta
data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"hi"}}

event: message_delta
data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":1,"output_tokens":2}}

event: message_stop
data: {"type":"message_stop"}
`;
    const parsed = parseSSEStream(body);
    expect(parsed.content).toBe("hi");
    expect(parsed.usage).toEqual({
      inputTokens: 1,
      outputTokens: 2,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
  });

  test("does not zero anthropic usage via openai prompt_tokens branch", () => {
    const body = `event: message_delta
data: {"type":"message_delta","usage":{"input_tokens":12,"output_tokens":3}}
`;
    const parsed = parseSSEStream(body);
    expect(parsed.usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cacheCreationInputTokens: undefined,
      cacheReadInputTokens: undefined,
    });
  });

  test("preserves Anthropic cache usage from message_start through message_delta", () => {
    const body = `event: message_start
data: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_creation_input_tokens":7,"cache_read_input_tokens":5}}}

 event: message_delta
data: {"type":"message_delta","usage":{"output_tokens":3}}
`;
    const parsed = parseSSEStream(body);
    expect(parsed.usage).toEqual({
      inputTokens: 12,
      outputTokens: 3,
      cacheCreationInputTokens: 7,
      cacheReadInputTokens: 5,
    });
  });

  test("extracts cached input tokens from OpenAI and Responses usage frames", () => {
    const openAi = parseSSEStream(
      `data: {"choices":[{"delta":{"content":"pong"}}]}

data: {"usage":{"prompt_tokens":20,"completion_tokens":4,"prompt_tokens_details":{"cached_tokens":6}}}
`
    );
    expect(openAi.usage).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      cacheReadInputTokens: 6,
    });

    const responses = parseSSEStream(
      `event: response.completed
data: {"type":"response.completed","response":{"usage":{"input_tokens":20,"output_tokens":4,"input_tokens_details":{"cached_tokens":6}}}}
`
    );
    expect(responses.usage).toEqual({
      inputTokens: 20,
      outputTokens: 4,
      cacheReadInputTokens: 6,
    });
  });
});
