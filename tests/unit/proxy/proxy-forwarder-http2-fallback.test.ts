import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveEndpointPolicy } from "@/app/v1/_lib/proxy/endpoint-policy";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import {
  clearHttp2TransportQuarantine,
  isHttp2TransportQuarantined,
} from "@/lib/proxy-agent/http2-quarantine";
import { resetGlobalAgentPool } from "@/lib/proxy-agent";
import type { Provider } from "@/types/provider";

const mocks = vi.hoisted(() => ({
  isHttp2Enabled: vi.fn(async () => true),
  request: vi.fn(),
}));

vi.mock("@/lib/config", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config")>();
  return { ...actual, isHttp2Enabled: mocks.isHttp2Enabled };
});

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    trace: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

vi.mock("undici", async (importOriginal) => {
  const actual = await importOriginal<typeof import("undici")>();
  return { ...actual, request: mocks.request };
});

vi.mock("@/app/v1/_lib/proxy/provider-selector", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/app/v1/_lib/proxy/provider-selector")>();
  return {
    ...actual,
    ProxyProviderResolver: {
      ...actual.ProxyProviderResolver,
      pickRandomProviderWithExclusion: vi.fn(async () => null),
    },
  };
});

function createProvider(): Provider {
  return {
    id: 1,
    name: "yescode-codex",
    url: "https://co.yes.vg/team/v1/responses",
    key: "upstream-key",
    providerVendorId: null,
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: null,
    providerType: "openai-compatible",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1_800_000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 10_000,
    requestTimeoutNonStreamingMs: 1_000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexImageGenerationPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    geminiGoogleSearchPreference: null,
    tpm: 0,
    rpm: 0,
    rpd: 0,
    cc: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  };
}

function createSession(provider: Provider, content = "hello"): ProxySession {
  const session = Object.create(ProxySession.prototype) as ProxySession;
  const headers = new Headers({ "content-type": "application/json" });
  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://co.yes.vg/team/v1/responses"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: "{}",
    request: {
      message: {
        model: "gpt-5.5",
        input: [{ role: "user", content }],
      },
      log: "{}",
    },
    userAgent: "test-agent",
    context: null,
    clientAbortSignal: null,
    userName: "test-user",
    authState: { success: true, user: null, key: null, apiKey: null },
    provider,
    messageContext: null,
    sessionId: null,
    requestSequence: 1,
    originalFormat: "response",
    providerType: provider.providerType,
    originalModelName: null,
    originalUrlPathname: null,
    providerChain: [],
    cacheTtlResolved: null,
    context1mApplied: false,
    specialSettings: [],
    cachedPriceData: undefined,
    cachedBillingModelSource: undefined,
    endpointPolicy: resolveEndpointPolicy("/team/v1/responses"),
    isHeaderModified: () => false,
  });
  return session;
}

function responseFixture(): {
  statusCode: number;
  headers: Record<string, string>;
  body: Readable;
} {
  return {
    statusCode: 200,
    headers: {
      "content-type": "text/plain",
      "content-length": "11",
    },
    body: Readable.from(['{"ok":true}']),
  };
}

function releaseAgent(session: ProxySession): void {
  (session as ProxySession & { releaseAgent?: () => void }).releaseAgent?.();
}

function bodyDigest(body: unknown): string {
  return createHash("sha256")
    .update(String(body ?? ""))
    .digest("hex");
}

describe("ProxyForwarder HTTP/2 fallback", () => {
  beforeEach(() => {
    clearHttp2TransportQuarantine();
    mocks.isHttp2Enabled.mockResolvedValue(true);
    mocks.request.mockReset();
  });

  afterEach(async () => {
    clearHttp2TransportQuarantine();
    await resetGlobalAgentPool();
  });

  it("retries the same body over H1 and keeps later attempts on H1", async () => {
    const h2Error = new Error("Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM");
    Object.assign(h2Error, { code: "ERR_HTTP2_STREAM_ERROR" });
    mocks.request.mockRejectedValueOnce(h2Error);
    mocks.request.mockResolvedValueOnce(responseFixture());
    mocks.request.mockResolvedValueOnce(responseFixture());

    const provider = createProvider();
    const firstSession = createSession(provider, "x".repeat(5_700_000));
    const firstResponse = await (
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      }
    ).doForward(firstSession, provider, provider.url);

    expect(firstResponse.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    const firstInit = mocks.request.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown };
    const fallbackInit = mocks.request.mock.calls[1]?.[1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(firstInit.dispatcher).toBeDefined();
    expect(fallbackInit.dispatcher).toBeUndefined();
    expect(bodyDigest(fallbackInit.body)).toBe(bodyDigest(firstInit.body));
    expect(
      isHttp2TransportQuarantined({ targetUrl: provider.url, proxyUrl: provider.proxyUrl })
    ).toBe(true);
    releaseAgent(firstSession);

    const secondSession = createSession(provider, "x".repeat(5_700_000));
    const secondResponse = await (
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      }
    ).doForward(secondSession, provider, provider.url);

    expect(secondResponse.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    const quarantinedInit = mocks.request.mock.calls[2]?.[1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(quarantinedInit.dispatcher).toBeUndefined();
    expect(quarantinedInit.body).toBe(firstInit.body);
    releaseAgent(secondSession);
  });

  it("downgrades when Undici wraps the H2 reset in nested causes", async () => {
    const rootCause = new Error("Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM");
    Object.assign(rootCause, { code: "ERR_HTTP2_STREAM_ERROR" });
    const wrapped = new Error("fetch failed", { cause: rootCause });
    const outer = new Error("request failed", { cause: wrapped });
    mocks.request.mockRejectedValueOnce(outer);
    mocks.request.mockResolvedValueOnce(responseFixture());

    const provider = createProvider();
    const session = createSession(provider);
    const response = await (
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      }
    ).doForward(session, provider, provider.url);

    expect(response.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledTimes(2);
    const fallbackInit = mocks.request.mock.calls[1]?.[1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(fallbackInit.dispatcher).toBeUndefined();
    releaseAgent(session);
  });

  it("does not replay a response-body reset after headers are returned", async () => {
    const bodyError = new Error("Stream closed with error code NGHTTP2_INTERNAL_ERROR");
    Object.assign(bodyError, { code: "ERR_HTTP2_STREAM_ERROR" });
    const body = new Readable({
      read() {
        this.push("prefix");
        queueMicrotask(() => this.destroy(bodyError));
      },
    });
    mocks.request.mockResolvedValueOnce({
      statusCode: 200,
      headers: { "content-type": "text/plain" },
      body,
    });

    const provider = createProvider();
    const session = createSession(provider);
    const response = await (
      ProxyForwarder as unknown as {
        doForward: (...args: unknown[]) => Promise<Response>;
      }
    ).doForward(session, provider, provider.url);

    await expect(response.text()).rejects.toThrow("NGHTTP2_INTERNAL_ERROR");
    expect(mocks.request).toHaveBeenCalledTimes(1);
    releaseAgent(session);
  });

  it("lets the normal vendor retry path reuse H1 after a failed downgrade", async () => {
    const provider = createProvider();
    provider.maxRetryAttempts = 2;
    const h2Error = new Error("Stream closed with error code NGHTTP2_ENHANCE_YOUR_CALM");
    Object.assign(h2Error, { code: "ERR_HTTP2_STREAM_ERROR" });
    const h1Error = new Error("upstream remained unavailable");
    Object.assign(h1Error, { code: "ECONNRESET" });
    mocks.request.mockRejectedValueOnce(h2Error).mockRejectedValueOnce(h1Error);
    mocks.request.mockResolvedValueOnce(responseFixture());

    const session = createSession(provider);
    const response = await ProxyForwarder.send(session);

    expect(response.status).toBe(200);
    expect(mocks.request).toHaveBeenCalledTimes(3);
    const firstInit = mocks.request.mock.calls[0]?.[1] as RequestInit & { dispatcher?: unknown };
    const fallbackInit = mocks.request.mock.calls[1]?.[1] as RequestInit & {
      dispatcher?: unknown;
    };
    const retryInit = mocks.request.mock.calls[2]?.[1] as RequestInit & {
      dispatcher?: unknown;
    };
    expect(firstInit.dispatcher).toBeDefined();
    expect(fallbackInit.dispatcher).toBeUndefined();
    expect(retryInit.dispatcher).toBeUndefined();
    expect(bodyDigest(retryInit.body)).toBe(bodyDigest(firstInit.body));
    expect(session.getProviderChain().some((item) => item.reason === "http2_fallback")).toBe(true);
    releaseAgent(session);
  });
});
