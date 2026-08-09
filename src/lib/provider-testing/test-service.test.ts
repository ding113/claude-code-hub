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
    /** Delay before the first body chunk (ms). Used to verify first-token timing. */
    firstChunkDelayMs?: number;
  }
): Response {
  const ok = options?.ok ?? true;
  const firstChunkDelayMs = options?.firstChunkDelayMs ?? 0;

  const bodyStream = new ReadableStream<Uint8Array>({
    start(controller) {
      const bytes = new TextEncoder().encode(responseBody);
      const push = () => {
        if (bytes.byteLength > 0) {
          controller.enqueue(bytes);
        }
        controller.close();
      };
      if (firstChunkDelayMs > 0) {
        setTimeout(push, firstChunkDelayMs);
      } else {
        push();
      }
    },
  });

  return {
    ok,
    status: options?.status ?? (ok ? 200 : 400),
    statusText: options?.statusText ?? (ok ? "OK" : "Bad Request"),
    headers: new Headers({
      "content-type": options?.contentType ?? "application/json",
    }),
    body: bodyStream,
    text: async () => {
      if (firstChunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, firstChunkDelayMs));
      }
      return responseBody;
    },
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
      model: "gpt-5.5",
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
      model: "gpt-5.5",
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
      model: "gpt-5.5",
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
      model: "gpt-5.5",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/v1/responses");
  });

  test.each([
    "https://api.gptclubapi.xyz/openai",
    "https://api.gptclubapi.xyz/openai/",
  ])("codex bare /openai base preserves absolute versioned request url: %s", async (providerUrl) => {
    mockJsonResponse({
      id: "resp_test",
      model: "gpt-5.5",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
        },
      ],
    });

    const result = await executeProviderTest({
      providerUrl,
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.5",
    });

    expect(result.success).toBe(true);
    expect(result.requestUrl).toBe("https://api.gptclubapi.xyz/openai/v1/responses");
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.gptclubapi.xyz/openai/v1/responses");
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

  test("带 rc 后缀的版本根路径在 provider testing 中也应生效", async () => {
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
      providerUrl: "https://relay.example.com/openai/v1rc1",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/v1rc1/chat/completions");
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
      model: "gpt-5.5",
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
      model: "gpt-5.5",
    });

    expect(result.success).toBe(true);
    expectRequestUrl("https://relay.example.com/openai/responses");
  });

  test("非标准相似路径在 provider testing 中不应被错误折叠", async () => {
    mockJsonResponse({
      id: "resp_test",
      model: "gpt-5.5",
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
      model: "gpt-5.5",
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

  test("openai-compatible 只有流式模板时 400 不再二次请求", async () => {
      const errorBody = JSON.stringify({
        error: {
          message: "bad request",
        },
      });

      fetchMock.mockResolvedValue(
        createMockResponse(errorBody, {
          ok: false,
          status: 400,
          statusText: "Bad Request",
        })
      );

      const result = await executeProviderTest({
        providerUrl: "https://api.example.com",
        apiKey: "sk-test",
        providerType: "openai-compatible",
        model: "gpt-4.1-mini",
      });

      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(result.success).toBe(false);
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body)) as {
        stream?: boolean;
      };
      expect(body.stream).toBe(true);
    });

  test("codex bare /openai base retries versionless responses path after invalid url", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid URL (POST /v1/v1/responses)",
      },
    });
    const okBody = JSON.stringify({
      id: "resp_test",
      model: "gpt-5.5",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
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
      providerUrl: "https://api.gptclubapi.xyz/openai",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.5",
      preset: "cx_codex_basic",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://api.gptclubapi.xyz/openai/v1/responses");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://api.gptclubapi.xyz/openai/responses");
    expect(result.success).toBe(true);
    expect(result.content).toBe("pong");
    expect(result.requestUrl).toBe("https://api.gptclubapi.xyz/openai/responses");
  });

  test("codex provider test only retries versionless path once within a single attempt", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid URL (POST /v1/v1/responses)",
      },
    });
    const okBody = JSON.stringify({
      id: "resp_test",
      model: "gpt-5.5",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
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
      providerUrl: "https://api.gptclubapi.xyz/openai",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.5",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.gptclubapi.xyz/openai/v1/responses",
      "https://api.gptclubapi.xyz/openai/responses",
    ]);
    expect(result.success).toBe(true);
    expect(result.requestUrl).toBe("https://api.gptclubapi.xyz/openai/responses");
  });

  test("codex provider test only has one stream preset so versionless failure does not multi-template retry", async () => {
      const invalidUrlBody = JSON.stringify({
        error: {
          message: "Invalid URL (POST /v1/responses)",
        },
      });
      const stillInvalidBody = JSON.stringify({
        error: {
          message: "Unsupported responses body",
        },
      });

      fetchMock
        .mockResolvedValueOnce(
          createMockResponse(invalidUrlBody, {
            ok: false,
            status: 400,
            statusText: "Bad Request",
          })
        )
        .mockResolvedValueOnce(
          createMockResponse(stillInvalidBody, {
            ok: false,
            status: 400,
            statusText: "Bad Request",
          })
        );

      const result = await executeProviderTest({
        providerUrl: "https://api.gptclubapi.xyz/openai",
        apiKey: "sk-test",
        providerType: "codex",
        model: "gpt-5.5",
      });

      // Single lean codex preset: versioned path → one versionless fallback, then stop.
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
        "https://api.gptclubapi.xyz/openai/v1/responses",
        "https://api.gptclubapi.xyz/openai/responses",
      ]);
      expect(result.success).toBe(false);
    });

  test("openai-compatible bare /openai base retries versionless chat path after invalid url", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid URL (POST /v1/chat/completions)",
      },
    });
    const okBody = JSON.stringify({
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
      providerUrl: "https://api.gptclubapi.xyz/openai",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://api.gptclubapi.xyz/openai/v1/chat/completions",
      "https://api.gptclubapi.xyz/openai/chat/completions",
    ]);
    expect(result.success).toBe(true);
    expect(result.requestUrl).toBe("https://api.gptclubapi.xyz/openai/chat/completions");
    expect(result.content).toBe("pong");
  });

  test("openai-compatible fallback rewrites the request endpoint instead of a matching base-path segment", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid URL (POST /v1/chat/completions)",
      },
    });
    const okBody = JSON.stringify({
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
      providerUrl: "https://relay.example.com/router/v1/responses",
      apiKey: "sk-test-openai-compatible",
      providerType: "openai-compatible",
      model: "gpt-4.1-mini",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "https://relay.example.com/router/v1/responses/v1/chat/completions",
      "https://relay.example.com/router/v1/responses/chat/completions",
    ]);
    expect(result.success).toBe(true);
    expect(result.requestUrl).toBe(
      "https://relay.example.com/router/v1/responses/chat/completions"
    );
    expect(result.content).toBe("pong");
  });

  test("fallback result timing reflects the final request attempt", async () => {
    const nowValues = [0, 0, 0, 0, 5, 100, 160, 220];
    const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => nowValues.shift() ?? 220);
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid URL (POST /v1/v1/responses)",
      },
    });
    const okBody = JSON.stringify({
      id: "resp_test",
      model: "gpt-5.5",
      output: [
        {
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text: "pong" }],
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

    try {
      const result = await executeProviderTest({
        providerUrl: "https://api.gptclubapi.xyz/openai",
        apiKey: "sk-test-codex",
        providerType: "codex",
        model: "gpt-5.5",
        preset: "cx_codex_basic",
      });

      expect(result.success).toBe(true);
      expect(result.requestUrl).toBe("https://api.gptclubapi.xyz/openai/responses");
      expect(result.firstByteMs).toBeGreaterThan(0);
      expect(result.latencyMs).toBeGreaterThan(result.firstByteMs ?? 0);
    } finally {
      nowSpy.mockRestore();
    }
  });

  test("codex invalid request without invalid-url marker does not retry versionless path", async () => {
    const errorBody = JSON.stringify({
      error: {
        message: "Invalid request payload",
      },
    });

    fetchMock.mockResolvedValue(
      createMockResponse(errorBody, {
        ok: false,
        status: 400,
        statusText: "Bad Request",
      })
    );

    const result = await executeProviderTest({
      providerUrl: "https://api.gptclubapi.xyz/openai",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.5",
      preset: "cx_codex_basic",
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(result.success).toBe(false);
    expect(result.status).toBe("red");
    expect(result.requestUrl).toBe("https://api.gptclubapi.xyz/openai/v1/responses");
  });

  test("codex 新版 SSE 事件流应正确提取 output_text delta，避免误判为内容不匹配", async () => {
    const responseBody = `event: response.created
data: {"type":"response.created","response":{"model":"gpt-5.5","usage":null},"sequence_number":0}

event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"pong","item_id":"msg_123","output_index":0,"sequence_number":1}

event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":39,"output_tokens":5,"total_tokens":44}},"sequence_number":2}
`;

    mockSseResponse(responseBody);

    const result = await executeProviderTest({
      providerUrl: "https://sub.fkcodex.com",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.5",
    });

    expect(result.success).toBe(true);
    expect(result.subStatus).toBe("success");
    expect(result.content).toBe("pong");
    expect(result.model).toBe("gpt-5.5");
    expect(result.usage).toEqual({
      inputTokens: 39,
      outputTokens: 5,
    });
  });

  test("codex SSE 若只携带 done 类事件也应提取最终文本", async () => {
    const responseBody = `event: response.output_text.done
data: {"type":"response.output_text.done","text":"pong","item_id":"msg_123","output_index":0,"content_index":0,"sequence_number":1}

event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.5","usage":{"input_tokens":39,"output_tokens":5,"total_tokens":44},"output":[{"type":"message","content":[{"type":"output_text","text":"pong"}]}]},"sequence_number":2}
`;

    mockSseResponse(responseBody);

    const result = await executeProviderTest({
      providerUrl: "https://sub.fkcodex.com",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.5",
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("pong");
    expect(result.model).toBe("gpt-5.5");
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
      apiKey: "test-key",
      providerType: "openai-compatible",
    });

    expect(result.success).toBe(false);
    expect(result.subStatus).toBe("network_error");
    expect(result.validationDetails.httpPassed).toBe(false);
    expect(result.validationDetails.latencyPassed).toBe(false);
  });

  test("SSE first-token timing waits for real text delta, not control frames", async () => {
    // Control frame first (immediate), real text delta after 150ms.
    const control = `event: response.created
data: {"type":"response.created","response":{"id":"resp_1"}}

`;
    const delta = `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"pong"}

`;
    const completed = `event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.6-terra","usage":{"input_tokens":39,"output_tokens":5,"total_tokens":44}}}

`;

    const encoder = new TextEncoder();
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(control));
        setTimeout(() => {
          controller.enqueue(encoder.encode(delta));
          setTimeout(() => {
            controller.enqueue(encoder.encode(completed));
            controller.close();
          }, 30);
        }, 150);
      },
    });
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: bodyStream,
      text: async () => control + delta + completed,
    } as Response);

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    // Must wait for real text delta (~150ms), not control frame (~0ms).
    expect(result.firstByteMs).toBeGreaterThanOrEqual(100);
  });

  test("SSE 读流等到 response.completed 才结束，避免只有文本时丢 usage", async () => {
    const control = `event: response.created
data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.6-terra","usage":null}}

`;
    const delta = `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"pong"}

`;
    const completed = `event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.6-terra","usage":{"input_tokens":312,"output_tokens":5,"total_tokens":317}}}

`;

    const encoder = new TextEncoder();
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        // First only control + text (as if provider flushes early).
        controller.enqueue(encoder.encode(control + delta));
        // usage arrives later on completed — reader must still be open.
        setTimeout(() => {
          controller.enqueue(encoder.encode(completed));
          controller.close();
        }, 80);
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: bodyStream,
      text: async () => control + delta + completed,
    } as Response);

    const result = await executeProviderTest({
      providerUrl: "https://1pkapi.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("pong");
    expect(result.usage).toEqual({
      inputTokens: 312,
      outputTokens: 5,
    });
  });

  test("SSE completed 事件 data 行被 chunk 边界切开时仍能读到 usage", async () => {
    // 模拟 otokapi 类上游：response.completed 的 data 行超长
    // （instructions 在中间，usage 在 data 行尾部），且 chunk 边界
    // 恰好把 data 行切开 —— usage 在第二个 chunk 才到达。
    const longInstructions = "i".repeat(20000);
    const control = `event: response.created
data: {"type":"response.created","response":{"id":"resp_1","model":"gpt-5.6-terra","usage":null}}

`;
    const delta = `event: response.output_text.delta
data: {"type":"response.output_text.delta","delta":"pong"}

`;
    // 完整 completed 事件：data 行内含超长 instructions，usage 在尾部
    const completedFull = `event: response.completed
data: {"type":"response.completed","response":{"model":"gpt-5.6-terra","instructions":"${longInstructions}","usage":{"input_tokens":312,"output_tokens":5,"total_tokens":317}}}

`;
    // 切开点：正好在 "response.completed" 类型之后、usage 之前
    const cutPoint =
      completedFull.indexOf('"usage"') > 0
        ? completedFull.indexOf('"usage"') - 200
        : completedFull.length - 100;
    const chunk1 = completedFull.slice(0, cutPoint);
    const chunk2 = completedFull.slice(cutPoint);

    const encoder = new TextEncoder();
    const bodyStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(control + delta));
        // 第一个 chunk 只到 data 行中部（含 response.completed 类型标记但无 usage）
        controller.enqueue(encoder.encode(chunk1));
        // 第二个 chunk 携带 data 行尾部（usage）与空行终止符
        setTimeout(() => {
          controller.enqueue(encoder.encode(chunk2));
          controller.close();
        }, 30);
      },
    });

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({ "content-type": "text/event-stream" }),
      body: bodyStream,
      text: async () => control + delta + completedFull,
    } as Response);

    const result = await executeProviderTest({
      providerUrl: "https://otokapi.com/v1",
      apiKey: "sk-test",
      providerType: "codex",
      model: "gpt-5.6-terra",
      timeoutMs: 5000,
    });

    expect(result.success).toBe(true);
    expect(result.content).toBe("pong");
    // 关键：即使 completed 行被 chunk 切开，usage 也必须被解析到
    expect(result.usage).toEqual({
      inputTokens: 312,
      outputTokens: 5,
    });
  });
});
