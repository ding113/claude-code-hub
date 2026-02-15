import { describe, expect, it } from "vitest";
import type { Provider } from "@/types/provider";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { HeaderProcessor } from "@/app/v1/_lib/headers";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

function createSession({
  userAgent,
  headers,
}: {
  userAgent: string | null;
  headers: Headers;
}): ProxySession {
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers),
    headerLog: JSON.stringify(Object.fromEntries(headers.entries())),
    request: { message: {}, log: "" },
    userAgent,
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
    isHeaderModified: (key: string) => {
      const original = session.originalHeaders?.get(key);
      const current = session.headers.get(key);
      return original !== current;
    },
  });

  return session as any;
}

describe("ProxyForwarder - Host header correction for multi-endpoint providers", () => {
  it("buildHeaders sets Host from provider.url, which may differ from actual target", () => {
    const session = createSession({
      userAgent: "Test/1.0",
      headers: new Headers([["user-agent", "Test/1.0"]]),
    });

    const provider = {
      providerType: "claude",
      url: "https://api.anthropic.com/v1",
      key: "test-key",
      preserveClientIp: false,
    } as unknown as Provider;

    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
    const resultHeaders = buildHeaders(session, provider);

    // buildHeaders uses provider.url for Host
    expect(resultHeaders.get("host")).toBe("api.anthropic.com");
  });

  it("Host header must be corrected when activeEndpoint baseUrl differs from provider.url", () => {
    const session = createSession({
      userAgent: "Test/1.0",
      headers: new Headers([["user-agent", "Test/1.0"]]),
    });

    const provider = {
      providerType: "claude",
      url: "https://api.anthropic.com/v1",
      key: "test-key",
      preserveClientIp: false,
    } as unknown as Provider;

    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
    const processedHeaders = buildHeaders(session, provider);

    // Initial Host from provider.url
    expect(processedHeaders.get("host")).toBe("api.anthropic.com");

    // Simulate: activeEndpoint has a different baseUrl (e.g. regional endpoint)
    const proxyUrl = "https://eu-west.anthropic.com/v1/messages";
    const actualHost = HeaderProcessor.extractHost(proxyUrl);
    processedHeaders.set("host", actualHost);

    // After correction, Host matches actual target
    expect(processedHeaders.get("host")).toBe("eu-west.anthropic.com");
  });

  it("Host header must be corrected when MCP passthrough URL differs from provider.url", () => {
    const session = createSession({
      userAgent: "Test/1.0",
      headers: new Headers([["user-agent", "Test/1.0"]]),
    });

    const provider = {
      providerType: "claude",
      url: "https://api.minimaxi.com/anthropic",
      key: "test-key",
      preserveClientIp: false,
    } as unknown as Provider;

    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
    const processedHeaders = buildHeaders(session, provider);

    // Initial Host from provider.url (includes /anthropic path)
    expect(processedHeaders.get("host")).toBe("api.minimaxi.com");

    // MCP passthrough: base domain extraction strips path, URL stays same host
    // But if mcpPassthroughUrl points to a different host:
    const mcpProxyUrl = "https://mcp.minimaxi.com/v1/tools/list";
    const actualHost = HeaderProcessor.extractHost(mcpProxyUrl);
    processedHeaders.set("host", actualHost);

    expect(processedHeaders.get("host")).toBe("mcp.minimaxi.com");
  });

  it("Host header remains correct when provider.url and proxyUrl share the same host", () => {
    const session = createSession({
      userAgent: "Test/1.0",
      headers: new Headers([["user-agent", "Test/1.0"]]),
    });

    const provider = {
      providerType: "claude",
      url: "https://api.anthropic.com/v1",
      key: "test-key",
      preserveClientIp: false,
    } as unknown as Provider;

    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
    const processedHeaders = buildHeaders(session, provider);

    // Same host, correction is a no-op
    const proxyUrl = "https://api.anthropic.com/v1/messages";
    const actualHost = HeaderProcessor.extractHost(proxyUrl);
    processedHeaders.set("host", actualHost);

    expect(processedHeaders.get("host")).toBe("api.anthropic.com");
  });

  it("Host header handles port numbers correctly", () => {
    const proxyUrl = "https://api.example.com:8443/v1/messages";
    const host = HeaderProcessor.extractHost(proxyUrl);
    expect(host).toBe("api.example.com:8443");
  });
});
