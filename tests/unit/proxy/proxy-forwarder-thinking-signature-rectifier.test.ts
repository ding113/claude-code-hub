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
});
