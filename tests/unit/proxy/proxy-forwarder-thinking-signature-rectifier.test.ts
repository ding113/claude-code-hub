import { beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  return {
    getCachedSystemSettings: vi.fn(async () => ({
      enableThinkingSignatureRectifier: true,
    })),
    recordSuccess: vi.fn(),
    recordFailure: vi.fn(async () => {}),
    getCircuitState: vi.fn(() => "closed"),
    getProviderHealthInfo: vi.fn(async () => ({
      health: { failureCount: 0 },
      config: { failureThreshold: 3 },
    })),
    updateMessageRequestDetails: vi.fn(async () => {}),
  };
});

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    isHttp2Enabled: vi.fn(async () => false),
    getCachedSystemSettings: mocks.getCachedSystemSettings,
  };
});

vi.mock("@/lib/circuit-breaker", () => ({
  getCircuitState: mocks.getCircuitState,
  getProviderHealthInfo: mocks.getProviderHealthInfo,
  recordFailure: mocks.recordFailure,
  recordSuccess: mocks.recordSuccess,
}));

vi.mock("@/repository/message", () => ({
  updateMessageRequestDetails: mocks.updateMessageRequestDetails,
}));

import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxyError } from "@/app/v1/_lib/proxy/errors";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createSession(): ProxySession {
  const headers = new Headers();
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-test",
      log: "",
      message: {
        model: "claude-test",
        messages: [
          {
            role: "assistant",
            content: [
              { type: "thinking", thinking: "t", signature: "sig_thinking" },
              { type: "text", text: "hello", signature: "sig_text_should_remove" },
              { type: "redacted_thinking", data: "r", signature: "sig_redacted" },
            ],
          },
        ],
      },
    },
    userAgent: null,
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: { id: 123, createdAt: new Date(), user: { id: 1 }, key: {}, apiKey: "k" },
    sessionId: null,
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    isHeaderModified: () => false,
  });

  return session as any;
}

function createAnthropicProvider(): Provider {
  return {
    id: 1,
    name: "anthropic-1",
    providerType: "claude",
    url: "https://example.com/v1/messages",
    key: "k",
    preserveClientIp: false,
    priority: 0,
  } as unknown as Provider;
}

describe("ProxyForwarder - thinking signature rectifier", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test("首次命中特定 400 错误时应整流并对同供应商重试一次（成功后不抛错）", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("Invalid `signature` in `thinking` block", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    doForward.mockImplementationOnce(async (s: ProxySession) => {
      const msg = s.request.message as any;
      const blocks = msg.messages[0].content as any[];
      expect(blocks.some((b) => b.type === "thinking")).toBe(false);
      expect(blocks.some((b) => b.type === "redacted_thinking")).toBe(false);
      expect(blocks.some((b) => "signature" in b)).toBe(false);

      const body = JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "ok" }],
      });

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      });
    });

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(session.getProviderChain()?.length).toBeGreaterThanOrEqual(2);

    const special = session.getSpecialSettings();
    expect(special).not.toBeNull();
    expect(JSON.stringify(special)).toContain("thinking_signature_rectifier");
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("命中 invalid request 相关 400 错误时也应整流并对同供应商重试一次", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("invalid request: malformed content", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    doForward.mockImplementationOnce(async (s: ProxySession) => {
      const msg = s.request.message as any;
      const blocks = msg.messages[0].content as any[];
      expect(blocks.some((b) => b.type === "thinking")).toBe(false);
      expect(blocks.some((b) => b.type === "redacted_thinking")).toBe(false);
      expect(blocks.some((b) => "signature" in b)).toBe(false);

      const body = JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "ok" }],
      });

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      });
    });

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(session.getProviderChain()?.length).toBeGreaterThanOrEqual(2);

    const special = session.getSpecialSettings();
    expect(special).not.toBeNull();
    expect(JSON.stringify(special)).toContain("thinking_signature_rectifier");
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("thinking 启用但 assistant 首块为 tool_use 的 400 错误时，应关闭 thinking 并对同供应商重试一次", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const msg = session.request.message as any;
    msg.thinking = { type: "enabled", budget_tokens: 1024 };
    msg.messages = [
      { role: "user", content: [{ type: "text", text: "hi" }] },
      {
        role: "assistant",
        content: [{ type: "tool_use", id: "toolu_1", name: "WebSearch", input: { query: "q" } }],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
    ];

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError(
        "messages.69.content.0.type: Expected `thinking` or `redacted_thinking`, but found `tool_use`. When `thinking` is enabled, a final `assistant` message must start with a thinking block (preceeding the lastmost set of `tool_use` and `tool_result` blocks). To avoid this requirement, disable `thinking`.",
        400,
        {
          body: "",
          providerId: 1,
          providerName: "anthropic-1",
        }
      );
    });

    doForward.mockImplementationOnce(async (s: ProxySession) => {
      const bodyMsg = s.request.message as any;
      expect(bodyMsg.thinking).toBeUndefined();

      const body = JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "ok" }],
      });

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      });
    });

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("移除 thinking block 后若 tool_use 置顶且 thinking 仍启用，应同时关闭 thinking 再重试", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const msg = session.request.message as any;
    msg.thinking = { type: "enabled", budget_tokens: 1024 };
    msg.messages = [
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "t", signature: "sig_thinking" },
          { type: "tool_use", id: "toolu_1", name: "WebSearch", input: { query: "q" } },
        ],
      },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "ok" }] },
    ];

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("Invalid `signature` in `thinking` block", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    doForward.mockImplementationOnce(async (s: ProxySession) => {
      const bodyMsg = s.request.message as any;
      const blocks = bodyMsg.messages[0].content as any[];

      expect(blocks.some((b) => b.type === "thinking")).toBe(false);
      expect(blocks.some((b) => b.type === "redacted_thinking")).toBe(false);
      expect(bodyMsg.thinking).toBeUndefined();

      const body = JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "ok" }],
      });

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      });
    });

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);
  });

  test("匹配触发但无可整流内容时不应做无意义重试", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const msg = session.request.message as any;
    msg.messages[0].content = [{ type: "text", text: "hello" }];

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("Invalid `signature` in `thinking` block", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(ProxyError);
    expect(doForward).toHaveBeenCalledTimes(1);

    // 仍应写入一次审计字段，但不应触发第二次 doForward 调用
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);

    const special = (session.getSpecialSettings() ?? []) as any[];
    const rectifier = special.find((s) => s.type === "thinking_signature_rectifier");
    expect(rectifier).toBeTruthy();
    expect(rectifier.hit).toBe(false);
  });

  test("重试后仍失败时应停止继续重试/切换，并按最终错误抛出", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("Invalid `signature` in `thinking` block", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("Invalid `signature` in `thinking` block", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    await expect(ProxyForwarder.send(session)).rejects.toBeInstanceOf(ProxyError);
    expect(doForward).toHaveBeenCalledTimes(2);

    // 第一次失败会写入审计字段，且只需要写一次（同一条 message_request 记录）
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);

    const special = session.getSpecialSettings();
    expect(special).not.toBeNull();
    expect(JSON.stringify(special)).toContain("thinking_signature_rectifier");
  });

  test("命中 signature Extra inputs not permitted 错误时应整流并对同供应商重试一次", async () => {
    const session = createSession();
    session.setProvider(createAnthropicProvider());

    // 模拟包含 signature 字段的 tool_use content block
    const msg = session.request.message as any;
    msg.messages = [
      {
        role: "assistant",
        content: [
          { type: "text", text: "hello" },
          {
            type: "tool_use",
            id: "toolu_1",
            name: "WebSearch",
            input: { query: "q" },
            signature: "sig_tool_should_remove",
          },
        ],
      },
    ];

    const doForward = vi.spyOn(ProxyForwarder as any, "doForward");

    doForward.mockImplementationOnce(async () => {
      throw new ProxyError("content.1.tool_use.signature: Extra inputs are not permitted", 400, {
        body: "",
        providerId: 1,
        providerName: "anthropic-1",
      });
    });

    doForward.mockImplementationOnce(async (s: ProxySession) => {
      const bodyMsg = s.request.message as any;
      const blocks = bodyMsg.messages[0].content as any[];

      // 验证 signature 字段已被移除
      expect(blocks.some((b: any) => "signature" in b)).toBe(false);

      const body = JSON.stringify({
        type: "message",
        content: [{ type: "text", text: "ok" }],
      });

      return new Response(body, {
        status: 200,
        headers: {
          "content-type": "application/json",
          "content-length": String(body.length),
        },
      });
    });

    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(doForward).toHaveBeenCalledTimes(2);
    expect(mocks.updateMessageRequestDetails).toHaveBeenCalledTimes(1);

    const special = session.getSpecialSettings();
    expect(special).not.toBeNull();
    expect(JSON.stringify(special)).toContain("thinking_signature_rectifier");
  });
});
