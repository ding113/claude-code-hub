import { describe, expect, it } from "vitest";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";
import type { Provider } from "@/types/provider";

function createSession(
  headers: Headers,
  sessionId: string | null,
  upstreamSessionSeed: string | null = sessionId
): ProxySession {
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    upstreamSessionSeed,
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/chat/completions"),
    headers,
    originalHeaders: new Headers(headers),
    request: { message: {}, log: "" },
    userAgent: "Test/1.0",
    provider: null,
    sessionId,
    requestSequence: 1,
    originalFormat: "openai",
    isHeaderModified: () => false,
  });

  return session as unknown as ProxySession;
}

function buildHeaders(session: ProxySession, provider: Provider, upstreamBaseUrl: string): Headers {
  const forwarder = ProxyForwarder as unknown as {
    buildHeaders: (s: ProxySession, p: Provider, url: string) => Headers;
  };
  return forwarder.buildHeaders(session, provider, upstreamBaseUrl);
}

function createProvider(customHeaders?: Record<string, string>): Provider {
  return {
    providerType: "openai-compatible",
    url: "https://opencode.ai/zen/go/v1",
    key: "test-key",
    preserveClientIp: false,
    customHeaders: customHeaders ?? null,
  } as unknown as Provider;
}

describe("ProxyForwarder - x-opencode-session injection", () => {
  it("injects a session header for opencode upstreams", () => {
    const session = createSession(new Headers(), "sess_abc");

    const headers = buildHeaders(session, createProvider(), "https://opencode.ai/zen/go/v1");

    expect(headers.get("x-opencode-session")).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/
    );
    // 同一会话稳定，才能命中上游 prompt cache
    expect(headers.get("x-opencode-session")).toBe(
      buildHeaders(
        createSession(new Headers(), "sess_abc"),
        createProvider(),
        "https://opencode.ai/zen/go/v1"
      ).get("x-opencode-session")
    );
  });

  it("reuses the parent seed for hedge shadow sessions that cleared sessionId", () => {
    const parent = createSession(new Headers(), "sess_abc");
    // createStreamingShadowSession 会清空 sessionId，但 upstreamSessionSeed 随对象复制保留
    const shadow = createSession(new Headers(), null, "sess_abc");

    expect(
      buildHeaders(shadow, createProvider(), "https://opencode.ai/zen/go/v1").get(
        "x-opencode-session"
      )
    ).toBe(
      buildHeaders(parent, createProvider(), "https://opencode.ai/zen/go/v1").get(
        "x-opencode-session"
      )
    );
  });

  it("still injects when the session has no id yet", () => {
    const session = createSession(new Headers(), null, null);

    const headers = buildHeaders(session, createProvider(), "https://opencode.ai/zen/go/v1");

    expect(headers.get("x-opencode-session")).toBeTruthy();
  });

  it("keeps the client-provided session header", () => {
    const session = createSession(new Headers([["x-opencode-session", "ses_client"]]), "sess_abc");

    const headers = buildHeaders(session, createProvider(), "https://opencode.ai/zen/go/v1");

    expect(headers.get("x-opencode-session")).toBe("ses_client");
  });

  it("keeps a provider custom header regardless of casing", () => {
    const session = createSession(new Headers(), "sess_abc");

    const headers = buildHeaders(
      session,
      createProvider({ "X-OpenCode-Session": "ses_custom" }),
      "https://opencode.ai/zen/go/v1"
    );

    expect(headers.get("x-opencode-session")).toBe("ses_custom");
  });

  it("does not inject for non-opencode upstreams", () => {
    const session = createSession(new Headers(), "sess_abc");

    const headers = buildHeaders(
      session,
      { ...createProvider(), url: "https://api.openai.com/v1" } as Provider,
      "https://api.openai.com/v1"
    );

    expect(headers.has("x-opencode-session")).toBe(false);
  });
});
