import { beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    trace: vi.fn(),
    warn: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("@/lib/request-filter-engine", () => ({
  requestFilterEngine: {
    applyFinal: vi.fn(async () => {}),
  },
}));

function createProvider(): Provider {
  return {
    id: 1,
    name: "openai-upstream",
    providerType: "openai-compatible",
    url: "https://openai.example.com/openai",
    key: "upstream-key",
    preserveClientIp: false,
    priority: 0,
    costMultiplier: 1,
    maxRetryAttempts: 1,
    mcpPassthroughType: "minimax",
    mcpPassthroughUrl: "https://mcp.example.com",
  } as unknown as Provider;
}

function createSession(): ProxySession {
  const headers = new Headers({
    "content-type": "application/json",
    authorization: "Bearer proxy-user-key",
  });
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://proxy.example.com/v1/embeddings"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: {
      model: "text-embedding-3-large",
      log: JSON.stringify({
        model: "text-embedding-3-large",
        input: "embedding me",
      }),
      message: {
        model: "text-embedding-3-large",
        input: "embedding me",
      },
    },
    userAgent: "OpenAITest/1.0",
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
    endpointPolicy: resolveEndpointPolicy("/v1/embeddings"),
    setCacheTtlResolved: vi.fn(),
    getCacheTtlResolved: vi.fn(() => null),
    getCurrentModel: vi.fn(() => "text-embedding-3-large"),
    clientRequestsContext1m: vi.fn(() => false),
    setContext1mApplied: vi.fn(),
    getContext1mApplied: vi.fn(() => false),
    getEndpointPolicy: vi.fn(() => resolveEndpointPolicy("/v1/embeddings")),
    isHeaderModified: vi.fn(() => false),
  });

  return session as ProxySession;
}

describe("ProxyForwarder - OpenAI embeddings standard endpoint handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("does not route /v1/embeddings through MCP passthrough URL", async () => {
    const provider = createProvider();
    const session = createSession();
    let capturedUrl: string | null = null;

    const fetchWithoutAutoDecode = vi.spyOn(ProxyForwarder as never, "fetchWithoutAutoDecode");
    fetchWithoutAutoDecode.mockImplementationOnce(async (url: string) => {
      capturedUrl = url;
      return new Response(
        JSON.stringify({
          object: "list",
          data: [{ object: "embedding", embedding: [0.1, 0.2], index: 0 }],
          model: "text-embedding-3-large",
          usage: { prompt_tokens: 3, total_tokens: 3 },
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        }
      );
    });

    const { doForward } = ProxyForwarder as unknown as {
      doForward: (session: ProxySession, provider: Provider, baseUrl: string) => Promise<Response>;
    };

    await doForward(session, provider, provider.url);

    expect(capturedUrl).toBe("https://openai.example.com/openai/v1/embeddings");
    expect(capturedUrl?.startsWith("https://mcp.example.com")).toBe(false);
  });
});
