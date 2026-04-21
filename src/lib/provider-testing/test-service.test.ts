import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: vi.fn(() => null),
}));

import { executeProviderTest } from "./test-service";

const fetchMock = vi.fn<typeof fetch>();

function createMockResponse(
  responseBody: string,
  options?: {
    contentType?: string;
    ok?: boolean;
    status?: number;
    statusText?: string;
  }
): Response {
  const ok = options?.ok ?? true;

  return {
    ok,
    status: options?.status ?? (ok ? 200 : 400),
    statusText: options?.statusText ?? (ok ? "OK" : "Bad Request"),
    headers: new Headers({
      "content-type": options?.contentType ?? "application/json",
    }),
    text: async () => responseBody,
  } as Response;
}

function mockJsonResponse(body: unknown): string {
  const responseBody = JSON.stringify(body);
  fetchMock.mockResolvedValue(createMockResponse(responseBody));
  return responseBody;
}

function mockSseResponse(responseBody: string): void {
  fetchMock.mockResolvedValue(
    createMockResponse(responseBody, {
      contentType: "text/event-stream",
    })
  );
}

function expectRequestUrl(url: string): void {
  expect(fetchMock).toHaveBeenCalledWith(url, expect.any(Object));
}

describe("executeProviderTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("openai-compatible 应该把聊天内容解析为纯文本预览，而不是直接回显整段 JSON", async () => {
    mockJsonResponse({
      id: "chatcmpl_test",
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "pong",
          },
        },
      ],
      usage: {
        prompt_tokens: 4,
        completion_tokens: 1,
        total_tokens: 5,
      },
    });

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(result.success).toBe(true);
    expect(result.model).toBe("gpt-4.1-mini");
    expect(result.content).toBe("pong");
  });

  test("rawResponse 应该保留完整响应体，不能在服务层被截断", async () => {
    const assistantText = `pong-${"x".repeat(7000)}`;
    const responseBody = mockJsonResponse({
      id: "resp_test",
      model: "gpt-5-codex",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [
            {
              type: "output_text",
              text: assistantText,
            },
          ],
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5-codex",
    });

    expect(result.success).toBe(true);
    expect(result.rawResponse).toBe(responseBody);
    expect(result.rawResponse?.length).toBe(responseBody.length);
  });

  test("指定 preset 但未显式传 model 时，应使用 preset 的默认模型构造 Gemini URL", async () => {
    mockJsonResponse({
      modelVersion: "gemini-2.5-pro",
      candidates: [
        {
          content: {
            parts: [{ text: "pong" }],
          },
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://gemini.example.com",
      apiKey: "AIza1234567890abcdefghijklmnopqrstuvwxyz",
      providerType: "gemini",
      preset: "gm_pro_basic",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://gemini.example.com/v1beta/models/gemini-2.5-pro:generateContent");
  });

  test("codex full-path baseUrl 不应重复拼接 /v1/responses", async () => {
    mockJsonResponse({
      id: "resp_test",
      model: "gpt-5.3-codex",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://relay.example.com/openai/v1/responses",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/v1/responses");
  });

  test("openai-compatible 版本根路径应只追加 endpoint，不重复拼接 /v1", async () => {
    mockJsonResponse({
      id: "chatcmpl_test",
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "pong",
          },
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://relay.example.com/openai/v1",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/v1/chat/completions");
  });

  test("任意版本根路径在 provider testing 中也应只追加 endpoint", async () => {
    mockJsonResponse({
      id: "chatcmpl_test",
      model: "glm-4.6",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "pong",
          },
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://open.bigmodel.cn/api/coding/paas/v4",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "glm-4.6",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://open.bigmodel.cn/api/coding/paas/v4/chat/completions");
  });

  test("带 alpha/beta 数字后缀的版本根路径在 provider testing 中也应生效", async () => {
    mockJsonResponse({
      id: "chatcmpl_test",
      model: "gpt-4.1-mini",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: {
            role: "assistant",
            content: "pong",
          },
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://relay.example.com/openai/v1beta1",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/v1beta1/chat/completions");
  });

  test("带 query 的 preset URL 应保留 preset 自带查询参数", async () => {
    mockJsonResponse({
      id: "msg_123",
      type: "message",
      role: "assistant",
      model: "claude-haiku-4-5-20251001",
      content: [{ type: "text", text: "pong" }],
    });

    const result = await executeProviderTest({
      providerUrl: "https://relay.example.com/anthropic/v1?from=base",
      apiKey: "sk-ant-test",
      providerType: "claude",
      preset: "cc_beta_cli",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/anthropic/v1/messages?beta=true");
  });

  test("无版本 endpoint 根路径在 provider testing 中应与 runtime URL 语义一致", async () => {
    mockJsonResponse({
      id: "resp_test",
      model: "gpt-5.3-codex",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://relay.example.com/openai/responses",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/responses");
  });

  test("非标准相似路径在 provider testing 中不应被错误折叠", async () => {
    mockJsonResponse({
      id: "resp_test",
      model: "gpt-5.3-codex",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://relay.example.com/openai/responses-archive",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/responses-archive/v1/responses");
  });

  test("传入未知 preset 时，应直接报错而不是悄悄回退到默认模板", async () => {
    await expect(
      executeProviderTest({
        providerUrl: "https://api.example.com",
        apiKey: "sk-test-openai-compatible",
        providerType: "openai-compatible",
        preset: "cx_base",
      })
    ).rejects.toThrow("Preset not found: cx_base");
  });

  test("openai-compatible 在首个模板返回 400 时，应自动回退到下一个模板", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "bad request",
      },
    });
    const okBody = JSON.stringify({
      model: "gpt-4.1-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: "pong",
          },
        },
      ],
    });

    fetchMock
      .mockResolvedValueOnce(
        createMockResponse(errorBody, {
          ok: false,
          status: 400,
          statusText: "Bad Request",
        })
      )
      .mockResolvedValueOnce(createMockResponse(okBody));

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.success).toBe(true);
    expect(result.content).toBe("pong");

    const secondBody = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as {
      stream?: boolean;
    };
    expect(secondBody.stream).toBe(true);
  });

  test("codex 新版 SSE 事件流应正确提取 output_text delta，避免误判为内容不匹配", async () => {
    const responseBody = `event: response.created
data: {"type":"response.created","response":{"model":"gpt-5.3-codex","usage":null},"sequence_number":0}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"pong","item_id":"msg_123","output_index":0,"sequence_number":1}

event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.3-codex","usage":{"input_tokens":39,"output_tokens":5,"total_tokens":44}},"sequence_number":2}
`;

    mockSseResponse(responseBody);

    const result = await executeProviderTest({
      providerUrl: "https://sub.fkcodex.com",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.success).toBe(true);
    expect(result.subStatus).toBe("success");
    expect(result.content).toBe("pong");
    expect(result.model).toBe("gpt-5.3-codex");
    expect(result.usage).toEqual({
      inputTokens: 39,
      outputTokens: 5,
    });
  });

  test("codex SSE 若只携带 done 类事件也应提取最终文本", async () => {
    const responseBody = `event: response.output_text.done
data: {"type":"response.output_text.done","text":"pong","item_id":"msg_123","output_index":0,"content_index":0,"sequence_number":1}

event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.3-codex","usage":{"input_tokens":39,"output_tokens":5,"total_tokens":44},"output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]},"sequence_number":2}
`;

    mockSseResponse(responseBody);

    const result = await executeProviderTest({
      providerUrl: "https://sub.fkcodex.com",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.3-codex",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("pong");
    expect(result.model).toBe("gpt-5.3-codex");
  });

  test("内容校验应优先使用解析后的文本，不能被原始 JSON 字段名误判为成功", async () => {
    mockJsonResponse({
      model: "gpt-4.1-mini",
      choices: [
        {
          message: {
            role: "assistant",
            content: "no match here",
          },
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
      successContains: "content",
    });

    expect(result.success).toBe(false);
    expect(result.subStatus).toBe("content_mismatch");
    expect(result.validationDetails.contentPassed).toBe(false);
  });

  test("网络错误时 latency 层不能被标记为通过", async () => {
    fetchMock.mockRejectedValue(new Error("ECONNREFUSED"));

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
    });

    expect(result.success).toBe(false);
    expect(result.subStatus).toBe("network_error");
    expect(result.validationDetails.httpPassed).toBe(false);
    expect(result.validationDetails.latencyPassed).toBe(false);
  });
});
