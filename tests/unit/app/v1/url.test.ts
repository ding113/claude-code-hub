import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { buildProxyUrl } from "@/app/v1/_lib/url";

function expectBuiltUrl(baseUrl: string, requestPath: string, expectedUrl: string): void {
  expect(buildProxyUrl(baseUrl, new URL(`https://dummy.com${requestPath}`))).toBe(expectedUrl);
}

describe("buildProxyUrl", () => {
  test("标准拼接：baseUrl 无路径时使用 requestPath + search", () => {
    expectBuiltUrl(
      "https://api.example.com",
      "/v1/messages?x=1",
      "https://api.example.com/v1/messages?x=1"
    );
  });

  test("避免重复拼接：baseUrl 已包含 /responses 时不追加 /v1/responses", () => {
    expectBuiltUrl(
      "https://example.com/openai/responses",
      "/v1/responses?x=1",
      "https://example.com/openai/responses?x=1"
    );
  });

  test("避免重复拼接：baseUrl 已包含 /embeddings 时不追加 /v1/embeddings", () => {
    expectBuiltUrl(
      "https://example.com/openai/embeddings",
      "/v1/embeddings?x=1",
      "https://example.com/openai/embeddings?x=1"
    );
  });

  test("子路径不丢失：baseUrl=/v1/messages + request=/v1/messages/count_tokens", () => {
    expectBuiltUrl(
      "https://api.example.com/v1/messages",
      "/v1/messages/count_tokens",
      "https://api.example.com/v1/messages/count_tokens"
    );
  });

  test("带前缀路径的 baseUrl：/openai/messages + /v1/messages/count_tokens", () => {
    expectBuiltUrl(
      "https://example.com/openai/messages",
      "/v1/messages/count_tokens",
      "https://example.com/openai/messages/count_tokens"
    );
  });

  test("query 以 requestUrl 为准（覆盖 baseUrl 自带 query）", () => {
    expectBuiltUrl(
      "https://api.example.com/v1/messages?from=base",
      "/v1/messages?from=request",
      "https://api.example.com/v1/messages?from=request"
    );
  });

  test("baseUrl 以 /models 结尾时去除请求中的版本前缀", () => {
    expectBuiltUrl(
      "https://api.example.com/gemini/models",
      "/v1beta/models/gemini-1.5-pro:streamGenerateContent",
      "https://api.example.com/gemini/models/gemini-1.5-pro:streamGenerateContent"
    );
  });

  test("支持 v1internal 版本前缀", () => {
    expectBuiltUrl(
      "https://example.com/gemini/models",
      "/v1internal/models/gemini-2.5-flash:generateContent",
      "https://example.com/gemini/models/gemini-2.5-flash:generateContent"
    );
  });

  test("支持未来的版本前缀如 v2", () => {
    expectBuiltUrl(
      "https://example.com/api/models",
      "/v2/models/some-model:action",
      "https://example.com/api/models/some-model:action"
    );
  });

  test("完整 Codex path：baseUrl 已包含 /openai/v1/responses 时保持原路径", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1/responses",
      "/v1/responses?x=1",
      "https://relay.example.com/openai/v1/responses?x=1"
    );
  });

  test("完整 OpenAI Chat path：baseUrl 已包含 /openai/v1/chat/completions 时保持原路径", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1/chat/completions",
      "/v1/chat/completions?x=1",
      "https://relay.example.com/openai/v1/chat/completions?x=1"
    );
  });

  test("版本根路径：baseUrl=/openai/v1 时只追加 endpoint，不重复追加 /v1", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1",
      "/v1/chat/completions?x=1",
      "https://relay.example.com/openai/v1/chat/completions?x=1"
    );
  });

  test("任意版本根路径：baseUrl=/api/coding/paas/v4 时只追加 endpoint", () => {
    expectBuiltUrl(
      "https://open.bigmodel.cn/api/coding/paas/v4",
      "/v1/chat/completions?x=1",
      "https://open.bigmodel.cn/api/coding/paas/v4/chat/completions?x=1"
    );
  });

  test("带 alpha/beta 数字后缀的版本根路径也应被识别", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1beta1",
      "/v1/chat/completions?x=1",
      "https://relay.example.com/openai/v1beta1/chat/completions?x=1"
    );
  });

  test("带 rc 后缀的版本根路径也应被识别", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1rc1",
      "/v1/chat/completions?x=1",
      "https://relay.example.com/openai/v1rc1/chat/completions?x=1"
    );
  });

  test("版本根路径 + Chat 资源后缀：应保留 suffix", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1",
      "/v1/chat/completions/cmpl_123/messages?x=1",
      "https://relay.example.com/openai/v1/chat/completions/cmpl_123/messages?x=1"
    );
  });

  test("版本根路径 + Responses 资源后缀：应保留 suffix", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1",
      "/v1/responses/resp_123/input_items?x=1",
      "https://relay.example.com/openai/v1/responses/resp_123/input_items?x=1"
    );
  });

  test("版本根路径 + Models 资源后缀：应保留 suffix", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/v1",
      "/v1/models/gpt-4o?x=1",
      "https://relay.example.com/openai/v1/models/gpt-4o?x=1"
    );
  });

  test("完整子端点：baseUrl 已包含 /v1/messages/count_tokens 时不应重复拼接", () => {
    expectBuiltUrl(
      "https://proxy.example.com/anthropic/v1/messages/count_tokens",
      "/v1/messages/count_tokens?x=1",
      "https://proxy.example.com/anthropic/v1/messages/count_tokens?x=1"
    );
  });

  test("无版本 endpoint 根路径：baseUrl=/openai/responses + /v1/responses/abc 应只追加 suffix", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/responses",
      "/v1/responses/abc?x=1",
      "https://relay.example.com/openai/responses/abc?x=1"
    );
  });

  test("相似但非标准 endpoint：responses-archive 不应被折叠成标准 /responses", () => {
    expectBuiltUrl(
      "https://relay.example.com/openai/responses-archive",
      "/v1/responses?x=1",
      "https://relay.example.com/openai/responses-archive/v1/responses?x=1"
    );
  });

  test("version root 识别不应误伤普通路径尾巴，如 /v1api", () => {
    expectBuiltUrl(
      "https://relay.example.com/proxy/v1api",
      "/v1/chat/completions?x=1",
      "https://relay.example.com/proxy/v1api/v1/chat/completions?x=1"
    );
  });
});
