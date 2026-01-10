import { describe, expect, test } from "vitest";

import {
  detectThinkingSignatureRectifierTrigger,
  rectifyAnthropicRequestMessage,
} from "./thinking-signature-rectifier";

describe("thinking-signature-rectifier", () => {
  describe("detectThinkingSignatureRectifierTrigger", () => {
    test("应命中：Invalid `signature` in `thinking` block（含反引号）", () => {
      const trigger = detectThinkingSignatureRectifierTrigger(
        "messages.1.content.0: Invalid `signature` in `thinking` block"
      );
      expect(trigger).toBe("invalid_signature_in_thinking_block");
    });

    test("应命中：Invalid signature in thinking block（无反引号/大小写混用）", () => {
      const trigger = detectThinkingSignatureRectifierTrigger(
        "Messages.1.Content.0: invalid signature in thinking block"
      );
      expect(trigger).toBe("invalid_signature_in_thinking_block");
    });

    test("应命中：thinking 启用但 assistant 首块为 tool_use（需关闭 thinking 兜底）", () => {
      const trigger = detectThinkingSignatureRectifierTrigger(
        "messages.69.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block (preceeding the lastmost set of `tool_use` and `tool_result` blocks). To avoid this requirement, disable `thinking`."
      );
      expect(trigger).toBe("assistant_message_must_start_with_thinking");
    });

    test("应命中：非法请求/illegal request/invalid request", () => {
      expect(detectThinkingSignatureRectifierTrigger("非法请求")).toBe("invalid_request");
      expect(detectThinkingSignatureRectifierTrigger("illegal request format")).toBe(
        "invalid_request"
      );
      expect(detectThinkingSignatureRectifierTrigger("invalid request: malformed JSON")).toBe(
        "invalid_request"
      );
    });

    test("不应命中：无关错误", () => {
      expect(detectThinkingSignatureRectifierTrigger("Request timeout")).toBeNull();
    });
  });

  describe("rectifyAnthropicRequestMessage", () => {
    test("应移除 thinking/redacted_thinking block，并移除非 thinking block 的 signature 字段", () => {
      const message: Record<string, unknown> = {
        model: "claude-test",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "t", signature: "sig_thinking" },
              { type: "text", text: "hello", signature: "sig_text_should_remove" },
              {
                type: "tool_use",
                id: "toolu_1",
                name: "WebSearch",
                input: { query: "q" },
                signature: "sig_tool_should_remove",
              },
              { type: "redacted_thinking", data: "r", signature: "sig_redacted" },
            ],
          },
          {
            role: "user",
            content: [{ type: "text", text: "hi" }],
          },
        ],
      };

      const result = rectifyAnthropicRequestMessage(message);
      expect(result.applied).toBe(true);
      expect(result.removedThinkingBlocks).toBe(1);
      expect(result.removedRedactedThinkingBlocks).toBe(1);
      expect(result.removedSignatureFields).toBe(2);

      const messages = message.messages as any[];
      const content = messages[0].content as any[];
      expect(content.map((b) => b.type)).toEqual(["text", "tool_use"]);
      expect(content[0].signature).toBeUndefined();
      expect(content[1].signature).toBeUndefined();
    });

    test("无 messages 或 messages 不为数组时，应不修改", () => {
      const message: Record<string, unknown> = { model: "claude-test" };
      const result = rectifyAnthropicRequestMessage(message);
      expect(result.applied).toBe(false);
      expect(result.removedThinkingBlocks).toBe(0);
      expect(result.removedRedactedThinkingBlocks).toBe(0);
      expect(result.removedSignatureFields).toBe(0);
    });

    test("thinking 启用且 tool_use 续写缺少 thinking 前缀时，应删除顶层 thinking 字段", () => {
      const message: Record<string, unknown> = {
        model: "claude-test",
        thinking: {
          type: "enabled",
          budget_tokens: 1024,
        },
        messages: [
          {
            role: "assistant",
            content: [
              {
                type: "tool_use",
                id: "toolu_1",
                name: "WebSearch",
                input: { query: "q" },
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
          },
        ],
      };

      const result = rectifyAnthropicRequestMessage(message);
      expect(result.applied).toBe(true);
      expect((message as any).thinking).toBeUndefined();
    });
  });
});
