import { describe, expect, it } from "vitest";
import {
  CCH_INTERCEPT_HEADER,
  CCH_INTERCEPT_WARMUP_VALUE,
  buildClaudeWarmupInterceptResponse,
  buildClaudeWarmupMessageResponse,
  buildClaudeWarmupSse,
  getClaudeStreamFlag,
  isClaudeWarmupRequestBody,
} from "@/app/v1/_lib/proxy/warmup-intercept";

describe("warmup-intercept", () => {
  describe("isClaudeWarmupRequestBody", () => {
    it("应识别标准 Warmup 请求（user.content[].text=Warmup + cache_control.ephemeral）", () => {
      const requestBody = {
        model: "claude-sonnet-4-5-20250929",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "text",
                text: "Warmup",
                cache_control: { type: "ephemeral" },
              },
            ],
          },
        ],
        system: [{ type: "text", text: "You are Claude Code" }],
      };

      expect(isClaudeWarmupRequestBody(requestBody)).toBe(true);
    });

    it("messages 非单条消息时不应识别为 Warmup", () => {
      const requestBody = {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Warmup", cache_control: { type: "ephemeral" } }],
          },
          { role: "assistant", content: [{ type: "text", text: "..." }] },
        ],
      };
      expect(isClaudeWarmupRequestBody(requestBody)).toBe(false);
    });

    it("role 非 user 时不应识别为 Warmup", () => {
      const requestBody = {
        messages: [
          {
            role: "assistant",
            content: [{ type: "text", text: "Warmup", cache_control: { type: "ephemeral" } }],
          },
        ],
      };
      expect(isClaudeWarmupRequestBody(requestBody)).toBe(false);
    });

    it("缺少 cache_control 或 cache_control.type 非 ephemeral 时不应识别为 Warmup", () => {
      const missingCache = {
        messages: [{ role: "user", content: [{ type: "text", text: "Warmup" }] }],
      };
      const wrongCache = {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Warmup", cache_control: { type: "persistent" } }],
          },
        ],
      };
      expect(isClaudeWarmupRequestBody(missingCache)).toBe(false);
      expect(isClaudeWarmupRequestBody(wrongCache)).toBe(false);
    });

    it("text 非 Warmup 时不应识别为 Warmup", () => {
      const requestBody = {
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "hello", cache_control: { type: "ephemeral" } }],
          },
        ],
      };
      expect(isClaudeWarmupRequestBody(requestBody)).toBe(false);
    });
  });

  describe("getClaudeStreamFlag", () => {
    it("body.stream=true 时应视为 stream", () => {
      expect(getClaudeStreamFlag({ stream: true }, null)).toBe(true);
    });

    it("Accept 包含 text/event-stream 时应视为 stream", () => {
      expect(getClaudeStreamFlag({}, "text/event-stream")).toBe(true);
      expect(getClaudeStreamFlag({}, "text/event-stream; charset=utf-8")).toBe(true);
    });

    it("默认应为非 stream", () => {
      expect(getClaudeStreamFlag({}, "application/json")).toBe(false);
    });
  });

  describe("buildClaudeWarmupMessageResponse", () => {
    it("应生成最小可用的 Claude message 响应结构", () => {
      const res = buildClaudeWarmupMessageResponse("claude-test");
      expect(res.type).toBe("message");
      expect(res.role).toBe("assistant");
      expect(res.model).toBe("claude-test");
      expect(res.content[0]?.type).toBe("text");
      expect(res.content[0]?.text).toContain("I'm ready to help you.");
      expect(res.stop_reason).toBe("end_turn");
      expect(res.usage.input_tokens).toBe(0);
    });
  });

  describe("buildClaudeWarmupSse", () => {
    it("应生成包含 message_start 与 content_block_delta 的 SSE 文本", () => {
      const payload = buildClaudeWarmupMessageResponse("claude-test");
      const sse = buildClaudeWarmupSse(payload);
      expect(sse).toContain("event: message_start");
      expect(sse).toContain("event: content_block_delta");
      expect(sse).toContain("I'm ready to help you.");
      expect(sse).toContain("event: message_stop");
    });
  });

  describe("buildClaudeWarmupInterceptResponse", () => {
    it("非 stream：应返回 JSON + 标记头", async () => {
      const { response } = buildClaudeWarmupInterceptResponse({
        model: "claude-test",
        stream: false,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      expect(response.headers.get(CCH_INTERCEPT_HEADER)).toBe(CCH_INTERCEPT_WARMUP_VALUE);
      const body = await response.text();
      expect(body).toContain("I'm ready to help you.");
    });

    it("stream：应返回 SSE + 标记头", async () => {
      const { response } = buildClaudeWarmupInterceptResponse({
        model: "claude-test",
        stream: true,
      });
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("text/event-stream");
      expect(response.headers.get(CCH_INTERCEPT_HEADER)).toBe(CCH_INTERCEPT_WARMUP_VALUE);
      const body = await response.text();
      expect(body).toContain("event: message_start");
      expect(body).toContain("I'm ready to help you.");
    });
  });
});
