import { describe, it, expect } from "vitest";

// 由于 extractUsageMetrics 是内部函数，需要通过 parseUsageFromResponseText 间接测试
// 或者将其导出用于测试
// 这里我们通过构造 JSON 响应来测试 parseUsageFromResponseText

import { parseUsageFromResponseText } from "@/app/v1/_lib/proxy/response-handler";

describe("extractUsageMetrics", () => {
  describe("基本 token 提取", () => {
    it("应正确提取 input_tokens 和 output_tokens", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics).not.toBeNull();
      expect(result.usageMetrics?.input_tokens).toBe(1000);
      expect(result.usageMetrics?.output_tokens).toBe(500);
    });

    it("空值或非对象应返回 null", () => {
      expect(parseUsageFromResponseText("", "claude").usageMetrics).toBeNull();
      expect(parseUsageFromResponseText("null", "claude").usageMetrics).toBeNull();
      expect(parseUsageFromResponseText('"string"', "claude").usageMetrics).toBeNull();
    });
  });

  describe("Claude 嵌套格式 (cache_creation.ephemeral_*)", () => {
    it("应从 cache_creation 嵌套对象提取 5m 和 1h token", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 800,
          cache_creation: {
            ephemeral_5m_input_tokens: 300,
            ephemeral_1h_input_tokens: 500,
          },
          cache_read_input_tokens: 200,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics).not.toBeNull();
      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(800);
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_read_input_tokens).toBe(200);
      expect(result.usageMetrics?.cache_ttl).toBe("mixed");
    });

    it("只有 5m 时应推断 cache_ttl 为 5m", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_input_tokens: 300,
          cache_creation: {
            ephemeral_5m_input_tokens: 300,
          },
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBeUndefined();
      expect(result.usageMetrics?.cache_ttl).toBe("5m");
    });

    it("只有 1h 时应推断 cache_ttl 为 1h", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_input_tokens: 500,
          cache_creation: {
            ephemeral_1h_input_tokens: 500,
          },
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBeUndefined();
      expect(result.usageMetrics?.cache_ttl).toBe("1h");
    });
  });

  describe("旧 relay 格式 (claude_cache_creation_*)", () => {
    it("应从旧 relay 字段提取 5m 和 1h token", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 800,
          claude_cache_creation_5_m_tokens: 300,
          claude_cache_creation_1_h_tokens: 500,
          cache_read_input_tokens: 200,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_ttl).toBe("mixed");
    });

    it("嵌套格式应优先于旧 relay 格式", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 100,
            ephemeral_1h_input_tokens: 200,
          },
          claude_cache_creation_5_m_tokens: 999,
          claude_cache_creation_1_h_tokens: 888,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      // 嵌套格式优先
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(100);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(200);
    });
  });

  describe("顶层扁平格式 (cache_creation_5m_input_tokens)", () => {
    it("应从顶层扁平字段提取 5m 和 1h token", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_creation_input_tokens: 800,
          cache_creation_5m_input_tokens: 300,
          cache_creation_1h_input_tokens: 500,
          cache_read_input_tokens: 200,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(800);
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_read_input_tokens).toBe(200);
      expect(result.usageMetrics?.cache_ttl).toBe("mixed");
    });

    it("只有顶层 5m 时应正确提取并推断 TTL", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_input_tokens: 300,
          cache_creation_5m_input_tokens: 300,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_ttl).toBe("5m");
    });

    it("只有顶层 1h 时应正确提取并推断 TTL", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_input_tokens: 500,
          cache_creation_1h_input_tokens: 500,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_ttl).toBe("1h");
    });

    it("嵌套格式应优先于顶层扁平格式", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 100,
            ephemeral_1h_input_tokens: 200,
          },
          cache_creation_5m_input_tokens: 999,
          cache_creation_1h_input_tokens: 888,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      // 嵌套格式优先
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(100);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(200);
    });

    it("顶层扁平格式应优先于旧 relay 格式", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_5m_input_tokens: 300,
          cache_creation_1h_input_tokens: 500,
          claude_cache_creation_5_m_tokens: 999,
          claude_cache_creation_1_h_tokens: 888,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      // 顶层扁平格式优先于旧 relay 格式
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(500);
    });

    it("三种格式同时存在时应按优先级提取", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 100,
            ephemeral_1h_input_tokens: 200,
          },
          cache_creation_5m_input_tokens: 300,
          cache_creation_1h_input_tokens: 400,
          claude_cache_creation_5_m_tokens: 500,
          claude_cache_creation_1_h_tokens: 600,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      // 嵌套格式最优先
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(100);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(200);
      expect(result.usageMetrics?.cache_ttl).toBe("mixed");
    });
  });

  describe("cache_creation_input_tokens 自动计算", () => {
    it("当 cache_creation_input_tokens 缺失时应自动计算总量", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 300,
            ephemeral_1h_input_tokens: 500,
          },
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(800);
    });

    it("顶层扁平格式缺失 cache_creation_input_tokens 时应自动计算总量", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_5m_input_tokens: 400,
          cache_creation_1h_input_tokens: 600,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(1000);
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(400);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(600);
    });

    it("混合回退：嵌套缺失某字段时顶层扁平补齐", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation: {
            ephemeral_5m_input_tokens: 200,
            // 缺失 ephemeral_1h_input_tokens
          },
          cache_creation_1h_input_tokens: 300, // 顶层扁平补齐
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      // 5m 来自嵌套，1h 来自顶层扁平
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(200);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_ttl).toBe("mixed");
    });

    it("当 cache_creation_input_tokens 存在时不应覆盖", () => {
      const response = JSON.stringify({
        usage: {
          cache_creation_input_tokens: 1000,
          cache_creation: {
            ephemeral_5m_input_tokens: 300,
            ephemeral_1h_input_tokens: 500,
          },
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      // 保留原值
      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(1000);
    });
  });

  describe("Gemini 格式支持", () => {
    it("应正确提取 Gemini usage 字段", () => {
      const response = JSON.stringify({
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
          cachedContentTokenCount: 200,
        },
      });

      const result = parseUsageFromResponseText(response, "gemini");

      expect(result.usageMetrics).not.toBeNull();
      // input_tokens = promptTokenCount - cachedContentTokenCount
      expect(result.usageMetrics?.input_tokens).toBe(800);
      expect(result.usageMetrics?.output_tokens).toBe(500);
      expect(result.usageMetrics?.cache_read_input_tokens).toBe(200);
    });

    it("应正确处理 Gemini thoughtsTokenCount", () => {
      const response = JSON.stringify({
        usageMetadata: {
          promptTokenCount: 1000,
          candidatesTokenCount: 500,
          thoughtsTokenCount: 100,
        },
      });

      const result = parseUsageFromResponseText(response, "gemini");

      // output_tokens = candidatesTokenCount + thoughtsTokenCount
      expect(result.usageMetrics?.output_tokens).toBe(600);
    });
  });

  describe("OpenAI Response API 格式", () => {
    it("应从 input_tokens_details.cached_tokens 提取缓存读取", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          input_tokens_details: {
            cached_tokens: 200,
          },
        },
      });

      const result = parseUsageFromResponseText(response, "openai");

      expect(result.usageMetrics?.cache_read_input_tokens).toBe(200);
    });

    it("顶层 cache_read_input_tokens 应优先于嵌套格式", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          cache_read_input_tokens: 300,
          input_tokens_details: {
            cached_tokens: 200,
          },
        },
      });

      const result = parseUsageFromResponseText(response, "openai");

      // 顶层优先
      expect(result.usageMetrics?.cache_read_input_tokens).toBe(300);
    });
  });

  describe("SSE 流式响应解析", () => {
    it("应正确合并 message_start 和 message_delta 的 usage", () => {
      // 模拟 Claude SSE 流式响应
      const sseResponse = [
        "event: message_start",
        'data: {"type":"message_start","message":{"usage":{"input_tokens":1000,"cache_creation_input_tokens":500,"cache_creation":{"ephemeral_5m_input_tokens":200,"ephemeral_1h_input_tokens":300},"cache_read_input_tokens":100}}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","usage":{"output_tokens":800}}',
        "",
      ].join("\n");

      const result = parseUsageFromResponseText(sseResponse, "claude");

      expect(result.usageMetrics).not.toBeNull();
      expect(result.usageMetrics?.input_tokens).toBe(1000);
      expect(result.usageMetrics?.output_tokens).toBe(800);
      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(500);
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(200);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(300);
      expect(result.usageMetrics?.cache_read_input_tokens).toBe(100);
    });

    it("message_delta 的值应优先于 message_start", () => {
      const sseResponse = [
        "event: message_start",
        'data: {"type":"message_start","message":{"usage":{"input_tokens":100,"output_tokens":50}}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","usage":{"input_tokens":1000,"output_tokens":500}}',
        "",
      ].join("\n");

      const result = parseUsageFromResponseText(sseResponse, "claude");

      // message_delta 优先
      expect(result.usageMetrics?.input_tokens).toBe(1000);
      expect(result.usageMetrics?.output_tokens).toBe(500);
    });

    it("message_start 的 cache 细分应补充 message_delta 缺失的字段", () => {
      const sseResponse = [
        "event: message_start",
        'data: {"type":"message_start","message":{"usage":{"cache_creation":{"ephemeral_5m_input_tokens":200,"ephemeral_1h_input_tokens":300}}}}',
        "",
        "event: message_delta",
        'data: {"type":"message_delta","usage":{"input_tokens":1000,"output_tokens":500,"cache_creation_input_tokens":500}}',
        "",
      ].join("\n");

      const result = parseUsageFromResponseText(sseResponse, "claude");

      // message_delta 的值
      expect(result.usageMetrics?.input_tokens).toBe(1000);
      expect(result.usageMetrics?.output_tokens).toBe(500);
      expect(result.usageMetrics?.cache_creation_input_tokens).toBe(500);
      // message_start 补充的细分字段
      expect(result.usageMetrics?.cache_creation_5m_input_tokens).toBe(200);
      expect(result.usageMetrics?.cache_creation_1h_input_tokens).toBe(300);
    });
  });

  describe("Codex provider 特殊处理", () => {
    it("Codex 应从 input_tokens 中减去 cached_tokens", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
          output_tokens: 500,
          cache_read_input_tokens: 300,
        },
      });

      const result = parseUsageFromResponseText(response, "codex");

      // adjustUsageForProviderType 会调整 input_tokens
      expect(result.usageMetrics?.input_tokens).toBe(700); // 1000 - 300
      expect(result.usageMetrics?.cache_read_input_tokens).toBe(300);
    });
  });

  describe("边界情况", () => {
    it("应处理所有值为 0 的情况", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 0,
          output_tokens: 0,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics).not.toBeNull();
      expect(result.usageMetrics?.input_tokens).toBe(0);
      expect(result.usageMetrics?.output_tokens).toBe(0);
    });

    it("应处理部分字段缺失的情况", () => {
      const response = JSON.stringify({
        usage: {
          input_tokens: 1000,
        },
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics?.input_tokens).toBe(1000);
      expect(result.usageMetrics?.output_tokens).toBeUndefined();
      expect(result.usageMetrics?.cache_creation_input_tokens).toBeUndefined();
    });

    it("应处理无效的 JSON", () => {
      const result = parseUsageFromResponseText("invalid json", "claude");

      expect(result.usageMetrics).toBeNull();
    });

    it("应处理空的 usage 对象", () => {
      const response = JSON.stringify({
        usage: {},
      });

      const result = parseUsageFromResponseText(response, "claude");

      expect(result.usageMetrics).toBeNull();
    });
  });
});
