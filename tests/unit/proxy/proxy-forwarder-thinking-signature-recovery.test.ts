import { describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

const isHttp2EnabledMock = vi.fn(async () => false);
const isThinkingSignatureFixEnabledMock = vi.fn(async () => true);

vi.mock("@/lib/config", () => {
  return {
    isHttp2Enabled: isHttp2EnabledMock,
    isThinkingSignatureFixEnabled: isThinkingSignatureFixEnabledMock,
  };
});

function createSession(options?: { includeThinkingBlocks?: boolean }): ProxySession {
  const includeThinkingBlocks = options?.includeThinkingBlocks ?? true;
  const headers = new Headers([["content-type", "application/json"]]);
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "claude-sonnet",
      message: {
        model: "claude-sonnet",
        messages: [
          {
            role: "assistant",
            content: [
              ...(includeThinkingBlocks
                ? [{ type: "thinking", thinking: "aaa", signature: "sig-a" }]
                : []),
              { type: "text", text: "hello" },
            ],
          },
          { role: "user", content: [{ type: "text", text: "next" }] },
        ],
      },
      log: "",
      note: undefined,
      buffer: undefined,
    },
    userAgent: "claude_cli/1.0",
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: null,
    provider: null,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "claude",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    billingModelSourcePromise: undefined,
    cachedBillingPriceData: undefined,
    isHeaderModified: (key: string) => {
      const original = session.originalHeaders?.get(key);
      const current = session.headers.get(key);
      return original !== current;
    },
  });

  return session as any;
}

function createClaudeProvider(): Provider {
  return {
    id: 1,
    name: "test-claude-provider",
    providerType: "claude",
    url: "https://upstream.example.com",
    key: "test-outbound-key",
    preserveClientIp: false,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    maxRetryAttempts: 1,
    firstByteTimeoutStreamingMs: 0,
    requestTimeoutNonStreamingMs: 0,
    streamingIdleTimeoutMs: 0,
    cacheTtlPreference: null,
    context1mPreference: null,
    priority: 0,
    weight: 1,
    costMultiplier: 1,
    groupTag: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
  } as unknown as Provider;
}

describe("ProxyForwarder - thinking signature recovery", () => {
  it("启用开关且命中 400 thinking signature 错误时，应移除 thinking 块并重试", async () => {
    isThinkingSignatureFixEnabledMock.mockResolvedValue(true);
    vi.resetModules();

    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");

    const bodies: string[] = [];
    const fetchSpy = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");

    fetchSpy
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        bodies.push(String((init as any).body ?? ""));
        return new Response(
          JSON.stringify({
            type: "error",
            error: {
              type: "invalid_request_error",
              message: "messages.1.content.0: Invalid `signature` in `thinking` block",
            },
          }),
          { status: 400, headers: { "content-type": "application/json" } }
        );
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        bodies.push(String((init as any).body ?? ""));
        return new Response(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });

    const session = createSession();
    const provider = createClaudeProvider();

    const doForward = (ProxyForwarder as any).doForward as (
      s: ProxySession,
      p: Provider
    ) => Promise<Response>;

    const response = await doForward(session, provider);
    expect(response.status).toBe(200);
    expect(bodies.length).toBe(2);

    expect(bodies[0]).toContain('"type":"thinking"');
    expect(bodies[1]).not.toContain('"type":"thinking"');
    expect(bodies[1]).toContain('"type":"text"');

    // 审计标记：应在 session 上可读（后续会写入 message_request 日志）
    expect((session as any).getThinkingSignatureFixApplied?.()).toBe(true);

    // forwarder 需要把超时清理钩子附加到 session，供 response-handler 清理
    expect(typeof (session as any).clearResponseTimeout).toBe("function");
    expect((session as any).responseController).toBeTruthy();
  });

  it("错误码/错误消息不稳定时：若请求包含 thinking 块且上游返回 5xx，也应尝试移除 thinking 块并重试一次", async () => {
    isThinkingSignatureFixEnabledMock.mockResolvedValue(true);
    vi.resetModules();

    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");

    const bodies: string[] = [];
    const fetchSpy = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");

    fetchSpy
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        bodies.push(String((init as any).body ?? ""));
        return new Response("Bad Gateway", {
          status: 502,
          headers: { "content-type": "text/plain" },
        });
      })
      .mockImplementationOnce(async (_url: string, init: RequestInit) => {
        bodies.push(String((init as any).body ?? ""));
        return new Response(
          JSON.stringify({
            type: "message",
            role: "assistant",
            content: [{ type: "text", text: "ok" }],
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        );
      });

    const session = createSession();
    const provider = createClaudeProvider();

    const doForward = (ProxyForwarder as any).doForward as (
      s: ProxySession,
      p: Provider
    ) => Promise<Response>;

    const response = await doForward(session, provider);
    expect(response.status).toBe(200);
    expect(bodies.length).toBe(2);

    expect(bodies[0]).toContain('"type":"thinking"');
    expect(bodies[1]).not.toContain('"type":"thinking"');
    expect((session as any).getThinkingSignatureFixApplied?.()).toBe(true);

    expect(typeof (session as any).clearResponseTimeout).toBe("function");
    expect((session as any).responseController).toBeTruthy();
  });

  it("开关关闭时不应触发二次请求", async () => {
    isThinkingSignatureFixEnabledMock.mockResolvedValue(false);
    vi.resetModules();

    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");

    const bodies: string[] = [];
    const fetchSpy = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");

    fetchSpy.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      bodies.push(String((init as any).body ?? ""));
      return new Response(
        JSON.stringify({
          type: "error",
          error: {
            type: "invalid_request_error",
            message: "messages.1.content.0: Invalid `signature` in `thinking` block",
          },
        }),
        { status: 400, headers: { "content-type": "application/json" } }
      );
    });

    const session = createSession();
    const provider = createClaudeProvider();
    const doForward = (ProxyForwarder as any).doForward as (
      s: ProxySession,
      p: Provider
    ) => Promise<Response>;

    await expect(doForward(session, provider)).rejects.toMatchObject({ statusCode: 400 });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain('"type":"thinking"');
    expect((session as any).getThinkingSignatureFixApplied?.()).toBe(false);
  });

  it.each([
    401, 402, 403, 404, 429,
  ])("上游返回 %s 时不应触发二次请求（避免掩盖鉴权/配额/限流/路由类错误）", async (status) => {
    isThinkingSignatureFixEnabledMock.mockResolvedValue(true);
    vi.resetModules();

    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");

    const bodies: string[] = [];
    const fetchSpy = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");

    fetchSpy.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      bodies.push(String((init as any).body ?? ""));
      return new Response("Bad Request", {
        status,
        headers: { "content-type": "text/plain" },
      });
    });

    const session = createSession();
    const provider = createClaudeProvider();
    const doForward = (ProxyForwarder as any).doForward as (
      s: ProxySession,
      p: Provider
    ) => Promise<Response>;

    await expect(doForward(session, provider)).rejects.toMatchObject({ statusCode: status });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).toContain('"type":"thinking"');
    expect((session as any).getThinkingSignatureFixApplied?.()).toBe(false);
  });

  it("请求不包含 thinking/redacted_thinking 块时，即使开关开启也不应触发二次请求", async () => {
    isThinkingSignatureFixEnabledMock.mockResolvedValue(true);
    vi.resetModules();

    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");

    const bodies: string[] = [];
    const fetchSpy = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");

    fetchSpy.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      bodies.push(String((init as any).body ?? ""));
      return new Response("Bad Gateway", {
        status: 502,
        headers: { "content-type": "text/plain" },
      });
    });

    const session = createSession({ includeThinkingBlocks: false });
    const provider = createClaudeProvider();
    const doForward = (ProxyForwarder as any).doForward as (
      s: ProxySession,
      p: Provider
    ) => Promise<Response>;

    await expect(doForward(session, provider)).rejects.toMatchObject({ statusCode: 502 });
    expect(bodies.length).toBe(1);
    expect(bodies[0]).not.toContain('"type":"thinking"');
    expect((session as any).getThinkingSignatureFixApplied?.()).toBe(false);
  });
});
