import { describe, expect, it } from "vitest";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";

import {
  isThinkingSignatureRelatedError,
  sanitizeClaudeMessagesRequestThinkingBlocks,
} from "@/app/v1/_lib/proxy/thinking-signature-recovery";

describe("thinking-signature-recovery - isThinkingSignatureRelatedError", () => {
  it("应识别 Invalid `signature` in `thinking` block 错误", () => {
    const err = new ProxyError(
      "messages.1.content.0: Invalid `signature` in `thinking` block",
      400
    );
    expect(isThinkingSignatureRelatedError(err)).toBe(true);
  });

  it("应识别不带 messages 前缀的 Invalid signature 错误（错误格式不稳定）", () => {
    const err = new ProxyError(
      "<nil>: foo.bar.content.0: Invalid `signature` in `thinking` block (request id: 2026010423580118927529aGHMHUO9)",
      400
    );
    expect(isThinkingSignatureRelatedError(err)).toBe(true);
  });

  it("应识别 5xx 包装的 Invalid signature 错误（错误码不稳定）", () => {
    const err = new ProxyError(
      "messages.1.content.0: Invalid `signature` in `thinking` block",
      500
    );
    expect(isThinkingSignatureRelatedError(err)).toBe(true);
  });

  it("应识别 thinking/redacted_thinking cannot be modified 错误", () => {
    const err = new ProxyError(
      "messages.71.content.8: `thinking` or `redacted_thinking` blocks in the latest assistant message cannot be modified. These blocks must remain as they were in the original response.",
      400
    );
    expect(isThinkingSignatureRelatedError(err)).toBe(true);
  });

  it("不应误判非相关错误", () => {
    const err400Other = new ProxyError("messages.1.content.0: something else", 400);
    expect(isThinkingSignatureRelatedError(err400Other)).toBe(false);

    expect(
      isThinkingSignatureRelatedError(new Error("Invalid `signature` in `thinking` block"))
    ).toBe(false);
  });
});

describe("thinking-signature-recovery - sanitizeClaudeMessagesRequestThinkingBlocks", () => {
  it("应仅移除 thinking / redacted_thinking 块，保留其他 content blocks", () => {
    const input = {
      model: "claude-sonnet",
      messages: [
        {
          role: "assistant",
          content: [
            { type: "thinking", thinking: "aaa", signature: "sig-a" },
            { type: "text", text: "hello" },
            { type: "redacted_thinking", data: "xxx" },
            { type: "tool_use", id: "toolu_1", name: "WebSearch", input: { query: "q" } },
          ],
        },
        {
          role: "user",
          content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }],
        },
      ],
    } as Record<string, unknown>;

    const result = sanitizeClaudeMessagesRequestThinkingBlocks(input);

    expect(result.changed).toBe(true);
    expect(result.removedBlocks).toBe(2);

    const sanitized = result.sanitized;
    expect(sanitized).toHaveProperty("messages");
    const messages = (sanitized.messages as Array<Record<string, unknown>>)!;
    const assistantContent = messages[0]?.content as Array<Record<string, unknown>>;

    expect(assistantContent.map((b) => b.type)).toEqual(["text", "tool_use"]);
    expect((assistantContent[0] as any).text).toBe("hello");
    expect((assistantContent[1] as any).name).toBe("WebSearch");
  });

  it("当请求体不是 Claude messages 结构时应安全返回不修改", () => {
    const input = { model: "claude-sonnet", foo: "bar" } as Record<string, unknown>;
    const result = sanitizeClaudeMessagesRequestThinkingBlocks(input);
    expect(result.changed).toBe(false);
    expect(result.removedBlocks).toBe(0);
    expect(result.sanitized).toBe(input);
  });

  it("当 messages.content 为字符串时不应修改", () => {
    const input = {
      model: "claude-sonnet",
      messages: [{ role: "user", content: "hello" }],
    } as Record<string, unknown>;
    const result = sanitizeClaudeMessagesRequestThinkingBlocks(input);
    expect(result.changed).toBe(false);
    expect(result.removedBlocks).toBe(0);
    expect(result.sanitized).toBe(input);
  });
});
