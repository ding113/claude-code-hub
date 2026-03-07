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

import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
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
      model: "gpt-5",
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
    getCurrentModel: vi.fn(() => "gpt-5"),
    clientRequestsContext1m: vi.fn(() => false),
    setContext1mApplied: vi.fn(),
    getContext1mApplied: vi.fn(() => false),
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
  });

  it("raw passthrough 应优先保留原始请求体字节，而不是重新 JSON.stringify", async () => {
    const originalBody = '{\n  "model": "gpt-5",\n  "input": [1, 2, 3]\n}\n';
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

  it("raw passthrough 出站请求不得继续携带 transfer-encoding 这类 hop-by-hop 头", async () => {
    const body = '{"model":"gpt-5","input":[]}';
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
