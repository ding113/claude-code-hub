import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/proxy-agent", () => ({
  createProxyAgentForProvider: vi.fn(() => null),
}));

import { executeProviderTest } from "./test-service";

const fetchMock = vi.fn<typeof fetch>();

describe("executeProviderTest", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = fetchMock as typeof fetch;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  test("openai-compatible 应该把聊天内容解析为纯文本预览，而不是直接回显整段 JSON", async () => {
    const responseBody = JSON.stringify({
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

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/json",
      }),
      text: async () => responseBody,
    } as Response);

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
    const responseBody = JSON.stringify({
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

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/json",
      }),
      text: async () => responseBody,
    } as Response);

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

  test("codex SSE 事件流应识别 response.output_text.delta/done 并通过内容校验", async () => {
    const responseBody = [
      'event: response.created',
      'data: {"type":"response.created","response":{"id":"resp_test","model":"gpt-5.4","status":"in_progress"}}',
      "",
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"pong"}',
      "",
      'event: response.output_text.done',
      'data: {"type":"response.output_text.done","text":"pong"}',
      "",
      'event: response.completed',
      'data: {"type":"response.completed","response":{"id":"resp_test","model":"gpt-5.4","status":"completed"}}',
    ].join("\n");

    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "text/event-stream",
      }),
      text: async () => responseBody,
    } as Response);

    const result = await executeProviderTest({
      providerUrl: "https://api.example.com",
      apiKey: "sk-test-codex",
      providerType: "codex",
      model: "gpt-5.4",
    });

    expect(result.success).toBe(true);
    expect(result.status).toBe("green");
    expect(result.subStatus).toBe("success");
    expect(result.model).toBe("gpt-5.4");
    expect(result.content).toBe("pong");
    expect(result.validationDetails.contentPassed).toBe(true);
  });

  test("指定 preset 但未显式传 model 时，应使用 preset 的默认模型构造 Gemini URL", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/json",
      }),
      text: async () =>
        JSON.stringify({
          modelVersion: "gemini-2.5-pro",
          candidates: [
            {
              content: {
                parts: [{ text: "pong" }],
              },
            },
          ],
        }),
    } as Response);

    const result = await executeProviderTest({
      providerUrl: "https://gemini.example.com",
      apiKey: "AIza1234567890abcdefghijklmnopqrstuvwxyz",
      providerType: "gemini",
      preset: "gm_pro_basic",
    });

    expect(result.success).toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      "https://gemini.example.com/v1beta/models/gemini-2.5-pro:generateContent",
      expect.any(Object)
    );
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
      .mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: "Bad Request",
        headers: new Headers({
          "content-type": "application/json",
        }),
        text: async () => errorBody,
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        statusText: "OK",
        headers: new Headers({
          "content-type": "application/json",
        }),
        text: async () => okBody,
      } as Response);

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

  test("内容校验应优先使用解析后的文本，不能被原始 JSON 字段名误判为成功", async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: "OK",
      headers: new Headers({
        "content-type": "application/json",
      }),
      text: async () =>
        JSON.stringify({
          model: "gpt-4.1-mini",
          choices: [
            {
              message: {
                role: "assistant",
                content: "no match here",
              },
            },
          ],
        }),
    } as Response);

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
