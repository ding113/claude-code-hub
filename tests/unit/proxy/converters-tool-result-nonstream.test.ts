import { describe, expect, it } from "vitest";
import { transformClaudeNonStreamResponseToOpenAI } from "@/app/v1/_lib/converters/openai-to-claude/response";
import { transformClaudeNonStreamResponseToCodex } from "@/app/v1/_lib/converters/claude-to-codex/response";

function createCtx(): any {
  return null;
}

describe("Non-stream converters tolerate tool_result blocks", () => {
  it("Claude->OpenAI: ignores tool_result without crashing", () => {
    const response = {
      type: "message",
      id: "msg_1",
      model: "claude-test",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        { type: "text", text: "hello" },
        { type: "tool_result", tool_use_id: "toolu_1", content: "ok" },
        { type: "text", text: " world" },
      ],
    } as Record<string, unknown>;

    const out = transformClaudeNonStreamResponseToOpenAI(
      createCtx(),
      "claude-test",
      {},
      {},
      response
    );

    expect(out).toMatchObject({
      object: "chat.completion",
      choices: [
        {
          message: {
            role: "assistant",
            content: "hello world",
          },
        },
      ],
    });
  });

  it("Claude->Codex: ignores tool_result without crashing", () => {
    const response = {
      type: "message",
      id: "msg_1",
      model: "claude-test",
      stop_reason: "end_turn",
      usage: { input_tokens: 1, output_tokens: 1 },
      content: [
        { type: "text", text: "hello" },
        { type: "tool_result", tool_use_id: "toolu_1", content: [{ type: "text", text: "ok" }] },
        { type: "tool_use", id: "toolu_2", name: "do", input: { a: 1 } },
      ],
    } as Record<string, unknown>;

    const out = transformClaudeNonStreamResponseToCodex(
      createCtx(),
      "claude-test",
      {},
      {},
      response
    );

    expect(out).toMatchObject({
      type: "response.completed",
      response: {
        type: "response",
        output: [
          {
            type: "message",
            role: "assistant",
            content: [{ type: "output_text", text: "hello" }],
          },
          {
            type: "function_call",
            call_id: "toolu_2",
            name: "do",
          },
        ],
      },
    });
  });
});
