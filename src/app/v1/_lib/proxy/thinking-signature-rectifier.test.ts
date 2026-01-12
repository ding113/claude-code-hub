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

    test("应命中：signature: Field required（signature 字段缺失）", () => {
      // Claude API 在 thinking block 缺少 signature 字段时返回此错误
      const trigger = detectThinkingSignatureRectifierTrigger(
        "***.***.***.***.***.signature: Field required"
      );
      expect(trigger).toBe("invalid_signature_in_thinking_block");
    });

    test("应命中：各种 signature Field required 格式变体", () => {
      // 数组索引格式
      expect(detectThinkingSignatureRectifierTrigger("content[0].signature: Field required")).toBe(
        "invalid_signature_in_thinking_block"
      );

      // 点号分隔格式
      expect(
        detectThinkingSignatureRectifierTrigger("messages.1.content.0.signature: Field required")
      ).toBe("invalid_signature_in_thinking_block");

      // 大小写混合
      expect(detectThinkingSignatureRectifierTrigger("Signature: field required")).toBe(
        "invalid_signature_in_thinking_block"
      );
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

    test("signature: Field required 场景：thinking block（无 signature）+ thinking 启用 + tool_use 时，应移除 thinking blocks 并删除顶层 thinking", () => {
      // 模拟从非 Anthropic 渠道切换到 Anthropic 渠道的场景：
      // thinking block 存在但缺少 signature 字段，导致 Claude API 报错 "signature: Field required"
      const message: Record<string, unknown> = {
        model: "claude-3-5-sonnet-20241022",
        thinking: {
          type: "enabled",
          budget_tokens: 10000,
        },
        messages: [
          {
            role: "assistant",
            content: [
              // thinking block 缺少 signature 字段（从非 Anthropic 渠道返回）
              { type: "thinking", thinking: "Let me analyze this..." },
              {
                type: "tool_use",
                id: "toolu_01",
                name: "WebSearch",
                input: { query: "test" },
              },
            ],
          },
          {
            role: "user",
            content: [{ type: "tool_result", tool_use_id: "toolu_01", content: "search result" }],
          },
        ],
      };

      const result = rectifyAnthropicRequestMessage(message);

      // 验证整流结果
      expect(result.applied).toBe(true);
      expect(result.removedThinkingBlocks).toBe(1);

      // 验证 thinking block 被移除
      const messages = message.messages as any[];
      const content = messages[0].content as any[];
      expect(content.map((b: any) => b.type)).toEqual(["tool_use"]);

      // 验证顶层 thinking 字段被删除（因为最后一条 assistant 消息现在以 tool_use 开头）
      expect((message as any).thinking).toBeUndefined();
    });
  });
});
