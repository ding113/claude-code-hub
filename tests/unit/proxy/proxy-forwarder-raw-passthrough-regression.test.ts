import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  isHttp2Enabled: vi.fn(async () => false),
  getCachedSystemSettings: vi.fn(async () => ({
    enableClaudeMetadataUserIdInjection: false,
    enableBillingHeaderRectifier: false,
  })),
  getProxyAgentForProvider: vi.fn(async () => null),
  getGlobalAgentPool: vi.fn(() => ({
    getAgent: vi.fn(),
    markOriginUnhealthy: vi.fn(),
  })),
  evaluateResponsesWsEligibility: vi.fn(async () => ({
    isWebsocketClient: false,
    eligible: false,
  })),
  tryResponsesWebsocketUpstream: vi.fn(),
  applyFinalRequestFilters: vi.fn(async () => undefined),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return {
    ...actual,
    isHttp2Enabled: mocks.isHttp2Enabled,
    getCachedSystemSettings: mocks.getCachedSystemSettings,
  };
});

vi.mock("@/lib/proxy-agent", () => ({
  getProxyAgentForProvider: mocks.getProxyAgentForProvider,
  getGlobalAgentPool: mocks.getGlobalAgentPool,
}));

vi.mock("@/app/v1/_lib/responses-ws/eligibility", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/responses-ws/eligibility")>();
  return {
    ...actual,
    evaluateResponsesWsEligibility: mocks.evaluateResponsesWsEligibility,
    getResponsesWsSessionId: vi.fn(() => "client-ws-session"),
  };
});

vi.mock("@/app/v1/_lib/responses-ws/upstream-adapter", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/app/v1/_lib/responses-ws/upstream-adapter")>();
  return {
    ...actual,
    tryResponsesWebsocketUpstream: mocks.tryResponsesWebsocketUpstream,
  };
});

vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: {
    applyFinal: mocks.applyFinalRequestFilters,
  },
}));

import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { rectifyResponseInput } from "@/app/v1/_lib/proxy/response-input-rectifier";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createProvider(): Provider {
  return {
    id: 1,
    name: "codex-upstream",
    providerType: "codex",
    url: "https://upstream.example.com/v1/responses",
    key: "upstream-key",
    preserveClientIp: false,
    priority: 0,
    maxRetryAttempts: 1,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
  } as unknown as Provider;
}

function createRawPassthroughSession(bodyText: string, extraHeaders?: HeadersInit): ProxySession {
  const headers = new Headers({
    "content-type": "application/json",
    "content-length": String(new TextEncoder().encode(bodyText).byteLength),
    ...Object.fromEntries(new Headers(extraHeaders).entries()),
  });
  const originalHeaders = new Headers(headers);
  const specialSettings: unknown[] = [];
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://proxy.example.com/v1/responses/compact?stream=false"),
    headers,
    originalHeaders,
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "gpt-5.5",
      log: bodyText,
      message: JSON.parse(bodyText) as Record<string, unknown>,
      buffer: new TextEncoder().encode(bodyText).buffer,
    },
    userAgent: "CodexTest/1.0",
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider: null,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "openai",
    providerType: null,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    forwardedRequestBody: null,
    endpointPolicy: resolveEndpointPolicy("/v1/responses/compact"),
    setCacheTtlResolved: vi.fn(),
    getCacheTtlResolved: vi.fn(() => null),
    getCurrentModel: vi.fn(() => "gpt-5.5"),
    clientRequestsContext1m: vi.fn(() => false),
    setContext1mApplied: vi.fn(),
    getContext1mApplied: vi.fn(() => false),
    getGroupCostMultiplier: vi.fn(() => 1),
    getEndpointPolicy: vi.fn(() => resolveEndpointPolicy("/v1/responses/compact")),
    addSpecialSetting: vi.fn((setting: unknown) => {
      specialSettings.push(setting);
    }),
    getSpecialSettings: vi.fn(() => specialSettings),
    isHeaderModified: vi.fn((key: string) => originalHeaders.get(key) !== headers.get(key)),
  });

  return session as ProxySession;
}

function readBodyText(body: BodyInit | undefined): string | null {
  if (body == null) return null;
  if (typeof body === "string") return body;
  if (body instanceof ArrayBuffer) {
    return new TextDecoder().decode(body);
  }
  if (ArrayBuffer.isView(body)) {
    return new TextDecoder().decode(body);
  }
  throw new Error(`Unsupported body type: ${Object.prototype.toString.call(body)}`);
}

describe("ProxyForwarder raw passthrough regression", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.evaluateResponsesWsEligibility.mockResolvedValue({
      isWebsocketClient: false,
      eligible: false,
    });
    mocks.tryResponsesWebsocketUpstream.mockReset();
  });

  it("raw passthrough 应优先保留原始请求体字节，而不是重新 JSON.stringify", async () => {
    const originalBody = '{\n  "model": "gpt-5.5",\n  "input": [1, 2, 3]\n}\n';
    const session = createRawPassthroughSession(originalBody);
    const provider = createProvider();

    let capturedInit: { body?: BodyInit; headers?: HeadersInit } | null = null;
    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      capturedInit = { body: init.body ?? undefined, headers: init.headers ?? undefined };
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      });
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(readBodyText(capturedInit?.body)).toBe(originalBody);
  });

  it("非 raw 请求重新序列化后移除失真的 content-encoding 与 content-length", async () => {
    const originalBody = '{\n  "model": "gpt-5.5",\n  "input": [1, 2, 3]\n}\n';
    const session = createRawPassthroughSession(originalBody, {
      "content-encoding": "snappy",
    });
    const endpointPolicy = resolveEndpointPolicy("/v1/responses");
    Object.assign(session, {
      requestUrl: new URL("https://proxy.example.com/v1/responses"),
      endpointPolicy,
      getEndpointPolicy: vi.fn(() => endpointPolicy),
    });
    const provider = createProvider();

    let capturedBody: BodyInit | undefined;
    let capturedHeaders: Headers | null = null;
    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      capturedBody = init.body ?? undefined;
      capturedHeaders = new Headers(init.headers);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      });
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(readBodyText(capturedBody)).toBe(JSON.stringify(JSON.parse(originalBody)));
    expect(capturedHeaders?.get("content-encoding")).toBeNull();
    expect(capturedHeaders?.get("content-length")).toBeNull();
  });

  it("raw passthrough 保留无法解码的 content-encoding 与原始请求体字节", async () => {
    const originalBody = '{\n  "model": "gpt-5.5",\n  "input": [1, 2, 3]\n}\n';
    const session = createRawPassthroughSession(originalBody, {
      "content-encoding": "snappy",
    });
    const provider = createProvider();

    let capturedBody: BodyInit | undefined;
    let capturedHeaders: Headers | null = null;
    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      capturedBody = init.body ?? undefined;
      capturedHeaders = new Headers(init.headers);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      });
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(readBodyText(capturedBody)).toBe(originalBody);
    expect(capturedHeaders?.get("content-encoding")).toBe("snappy");
  });

  it("remote compaction v2 保留 /v1/responses wire path 与原始请求体", async () => {
    const originalBody =
      '{\n  "model": "gpt-5.5",\n  "stream": true,\n  "input": [{"type":"compaction_trigger"}]\n}\n';
    const upstreamSse =
      'event: response.output_item.done\ndata: {"type":"response.output_item.done","output_index":0,"item":{"type":"compaction","encrypted_content":"opaque-state"}}\n\n' +
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_compact","status":"completed","output":[{"type":"compaction","encrypted_content":"opaque-state"}]}}\n\n';
    const session = createRawPassthroughSession(originalBody, {
      "x-codex-beta-features": "remote_compaction_v2",
    });
    session.requestUrl = new URL("https://proxy.example.com/v1/responses?transport=http");
    const provider = createProvider();

    let capturedUrl: string | null = null;
    let capturedBody: BodyInit | undefined;
    let capturedHeaders: Headers | null = null;
    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body ?? undefined;
      capturedHeaders = new Headers(init.headers);
      return new Response(upstreamSse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      });
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    const response = await doForward(session, provider, provider.url);

    expect(new URL(capturedUrl as string).pathname).toBe("/v1/responses");
    expect(new URL(capturedUrl as string).searchParams.get("transport")).toBe("http");
    expect(readBodyText(capturedBody)).toBe(originalBody);
    expect(capturedHeaders?.get("x-codex-beta-features")).toBe("remote_compaction_v2");
    expect(await response.text()).toBe(upstreamSse);
  });

  it("remote compaction v2 ArrayBuffer 请求体仍通过上游 Responses WebSocket", async () => {
    const requestBody = {
      model: "gpt-5.5",
      stream: true,
      previous_response_id: "resp_previous",
      input: [{ type: "compaction_trigger" }],
    };
    const originalBody = JSON.stringify(requestBody);
    const upstreamSse =
      'event: response.completed\ndata: {"type":"response.completed","response":{"id":"resp_compact","status":"completed"}}\n\n';
    const session = createRawPassthroughSession(originalBody, {
      "x-codex-beta-features": "remote_compaction_v2",
    });
    session.requestUrl = new URL("https://proxy.example.com/v1/responses");
    const provider = createProvider();

    mocks.evaluateResponsesWsEligibility.mockResolvedValue({
      isWebsocketClient: true,
      eligible: true,
      endpointId: null,
    });
    mocks.tryResponsesWebsocketUpstream.mockResolvedValue({
      response: new Response(upstreamSse, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
      connected: true,
      reused: true,
    });

    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(
      async () => new Response("unexpected HTTP fallback", { status: 500 })
    );
    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    const response = await doForward(session, provider, provider.url);

    expect(mocks.tryResponsesWebsocketUpstream).toHaveBeenCalledWith(
      expect.objectContaining({
        body: requestBody,
        sessionId: "client-ws-session",
      })
    );
    expect(fetchWithoutAutoDecode).not.toHaveBeenCalled();
    expect(await response.text()).toBe(upstreamSse);
  });

  it("remote compaction v2 将单对象 input 规范化后再透传", async () => {
    const originalBody = '{"model":"gpt-5.5","stream":true,"input":{"type":"compaction_trigger"}}';
    const session = createRawPassthroughSession(originalBody, {
      "x-codex-beta-features": "remote_compaction_v2",
    });
    session.requestUrl = new URL("https://proxy.example.com/v1/responses?transport=http");
    const provider = createProvider();

    const result = rectifyResponseInput(session.request.message);
    expect(result.applied).toBe(true);
    await session.syncRequestBodyFromMessage();

    let capturedUrl: string | null = null;
    let capturedBody: BodyInit | undefined;
    let capturedHeaders: Headers | null = null;
    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = init.body ?? undefined;
      capturedHeaders = new Headers(init.headers);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      });
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(new URL(capturedUrl as string).pathname).toBe("/v1/responses");
    expect(new URL(capturedUrl as string).searchParams.get("transport")).toBe("http");
    expect(JSON.parse(readBodyText(capturedBody) ?? "{}").input).toEqual([
      { type: "compaction_trigger" },
    ]);
    expect(capturedHeaders?.get("content-length")).toBeNull();
    expect(capturedHeaders?.get("x-codex-beta-features")).toBe("remote_compaction_v2");
  });

  it("raw passthrough 出站请求不得继续携带 transfer-encoding 这类 hop-by-hop 头", async () => {
    const body = '{"model":"gpt-5.5","input":[]}';
    const session = createRawPassthroughSession(body, {
      connection: "keep-alive",
      "transfer-encoding": "chunked",
    });
    const provider = createProvider();

    let capturedHeaders: Headers | null = null;
    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as any, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      capturedHeaders = new Headers(init.headers);
      return new Response("{}", {
        status: 200,
        headers: { "content-type": "application/json", "content-length": "2" },
      });
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedHeaders?.get("connection")).toBeNull();
    expect(capturedHeaders?.get("transfer-encoding")).toBeNull();
  });
});
