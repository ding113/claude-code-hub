import { describe, expect, it } from "vitest";
import type { Provider } from "@/types/provider";
import { DEFAULT_CODEX_USER_AGENT, ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
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

function createCodexProvider(): Provider {
  return {
    providerType: "codex",
    url: "https://example.com/v1/responses",
    key: "test-outbound-key",
    preserveClientIp: false,
  } as unknown as Provider;
}

function createOpenAIProvider(): Provider {
  return {
    providerType: "openai-compatible",
    url: "https://openai.example.com/v1/chat/completions",
    key: "test-outbound-key",
    preserveClientIp: false,
  } as unknown as Provider;
}

function createClaudeProvider(url = "https://api.anthropic.com/v1/messages"): Provider {
  return {
    providerType: "claude",
    url,
    key: "test-outbound-key",
    preserveClientIp: false,
  } as unknown as Provider;
}

function createClaudeAuthProvider(): Provider {
  return {
    providerType: "claude-auth",
    url: "https://relay.example.com/v1/messages",
    key: "test-outbound-key",
    preserveClientIp: false,
  } as unknown as Provider;
}

function createGeminiProvider(providerType: "gemini" | "gemini-cli"): Provider {
  return {
    providerType,
    url: "https://generativelanguage.googleapis.com/v1beta",
    key: "test-outbound-key",
    preserveClientIp: false,
  } as unknown as Provider;
}

function buildHeaders(session: ProxySession, provider: Provider): Headers {
  const forwarder = ProxyForwarder as unknown as {
    buildHeaders: (session: ProxySession, provider: Provider, upstreamBaseUrl: string) => Headers;
  };
  return forwarder.buildHeaders(
    session,
    provider,
    ((provider as { url?: string }).url ?? "https://example.com").toString()
  );
}

function createAuthLeakSession(): ProxySession {
  return createSession({
    userAgent: "Original-UA/1.0",
    headers: new Headers([
      ["authorization", "Bearer proxy-user-bearer-should-not-leak"],
      ["x-api-key", "proxy-user-key-should-not-leak"],
    ]),
  });
}

describe("ProxyForwarder - buildHeaders User-Agent resolution", () => {
  it("应该优先使用过滤器修改的 user-agent（Codex provider）", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Filtered-UA/2.0"]]),
    });
    // 设置 originalHeaders 为不同值以模拟过滤器修改
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createCodexProvider();
    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("user-agent")).toBe("Filtered-UA/2.0");
  });

  it("应该使用原始 user-agent 当未被过滤器修改时", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    // 原始和当前相同
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createCodexProvider();
    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("user-agent")).toBe("Original-UA/1.0");
  });

  it("应该使用原始 user-agent 当过滤器删除 header 时", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers(), // user-agent 被删除
    });
    // originalHeaders 包含 user-agent，但当前 headers 没有
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createCodexProvider();
    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("user-agent")).toBe("Original-UA/1.0");
  });

  it("应该使用兜底 user-agent 当原始值为空且未修改时", () => {
    const session = createSession({
      userAgent: null,
      headers: new Headers(),
    });
    (session as any).originalHeaders = new Headers();

    const provider = createCodexProvider();
    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("user-agent")).toBe(DEFAULT_CODEX_USER_AGENT);
  });

  it("应该保留过滤器设置的空字符串 user-agent", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", ""]]), // 空字符串
    });
    // originalHeaders 包含原始 UA，但当前是空字符串
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createCodexProvider();
    const resultHeaders = buildHeaders(session, provider);

    // 空字符串应该被保留（使用 ?? 而非 ||）
    expect(resultHeaders.get("user-agent")).toBe("");
  });

  it("应该剥离 transfer-encoding 这类传输层 header，避免向上游继续透传", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([
        ["user-agent", "Original-UA/1.0"],
        ["connection", "keep-alive"],
        ["transfer-encoding", "chunked"],
        ["content-length", "123"],
      ]),
    });

    const provider = createCodexProvider();
    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("connection")).toBeNull();
    expect(resultHeaders.get("transfer-encoding")).toBeNull();
    expect(resultHeaders.get("content-length")).toBeNull();
  });
});

describe("ProxyForwarder - buildHeaders auth minimization", () => {
  it("codex 应只发送 Authorization，不再默认双发 x-api-key", () => {
    const resultHeaders = buildHeaders(createAuthLeakSession(), createCodexProvider());

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBeNull();
  });

  it("openai-compatible 应只发送 Authorization，不再默认双发 x-api-key", () => {
    const resultHeaders = buildHeaders(createAuthLeakSession(), createOpenAIProvider());

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBeNull();
  });

  it("claude-auth 应只发送 Authorization", () => {
    const resultHeaders = buildHeaders(createAuthLeakSession(), createClaudeAuthProvider());

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBeNull();
  });

  it("claude proxy host 应只发送 Authorization", () => {
    const resultHeaders = buildHeaders(
      createAuthLeakSession(),
      createClaudeProvider("https://proxy.openrouter.example.com/v1/messages")
    );

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBeNull();
  });

  it("openrouter 风格 host 应被识别为 proxy 并只发送 Authorization", () => {
    const resultHeaders = buildHeaders(
      createAuthLeakSession(),
      createClaudeProvider("https://openrouter.example.com/v1/messages")
    );

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBeNull();
  });

  it("非代理 claude 直连仍保留双头兼容性", () => {
    const resultHeaders = buildHeaders(createAuthLeakSession(), createClaudeProvider());

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBe("test-outbound-key");
  });

  it("普通自定义域名的 claude endpoint 仍保留双头兼容性", () => {
    const resultHeaders = buildHeaders(
      createAuthLeakSession(),
      createClaudeProvider("https://models.partner.example.com/v1/messages")
    );

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBe("test-outbound-key");
  });
});

describe("ProxyForwarder - buildGeminiHeaders headers passthrough", () => {
  it("应该透传 user-agent，并覆盖上游 x-goog-api-key（API key 模式）", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([
        ["user-agent", "Original-UA/1.0"],
        ["x-api-key", "proxy-user-key-should-not-leak"],
        ["x-goog-api-key", "proxy-user-key-google-should-not-leak"],
        ["authorization", "Bearer proxy-user-bearer-should-not-leak"],
      ]),
    });

    const provider = createGeminiProvider("gemini");
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };
    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("user-agent")).toBe("Original-UA/1.0");
    expect(resultHeaders.get("x-api-key")).toBeNull();
    expect(resultHeaders.get("authorization")).toBeNull();
    expect(resultHeaders.get("x-goog-api-key")).toBe("upstream-api-key");
    expect(resultHeaders.get("accept-encoding")).toBe("identity");
    expect(resultHeaders.get("content-type")).toBe("application/json");
    expect(resultHeaders.get("host")).toBe("generativelanguage.googleapis.com");
  });

  it("应该允许过滤器修改 user-agent（Gemini provider）", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Filtered-UA/2.0"]]),
    });
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createGeminiProvider("gemini");
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };
    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("user-agent")).toBe("Filtered-UA/2.0");
  });

  it("应该在过滤器删除 user-agent 时回退到原始 userAgent（Gemini provider）", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers(), // user-agent 被删除
    });
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createGeminiProvider("gemini");
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };
    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("user-agent")).toBe("Original-UA/1.0");
  });

  it("应该使用 Authorization Bearer（OAuth 模式）并移除 x-goog-api-key", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([
        ["user-agent", "Original-UA/1.0"],
        ["x-goog-api-key", "proxy-user-key-google-should-not-leak"],
      ]),
    });

    const provider = createGeminiProvider("gemini");
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };
    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-oauth-token",
      false
    );

    expect(resultHeaders.get("authorization")).toBe("Bearer upstream-oauth-token");
    expect(resultHeaders.get("x-goog-api-key")).toBeNull();
  });

  it("gemini-cli 应该注入 x-goog-api-client 头", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });

    const provider = createGeminiProvider("gemini-cli");
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };
    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://cloudcode-pa.googleapis.com/v1internal",
      "upstream-oauth-token",
      false
    );

    expect(resultHeaders.get("x-goog-api-client")).toBe("GeminiCLI/1.0");
  });

  it("Gemini 路径也应该剥离 transfer-encoding，避免请求体透传回归污染上游", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([
        ["user-agent", "Original-UA/1.0"],
        ["connection", "keep-alive"],
        ["transfer-encoding", "chunked"],
        ["content-length", "123"],
      ]),
    });

    const provider = createGeminiProvider("gemini");
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };
    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("connection")).toBeNull();
    expect(resultHeaders.get("transfer-encoding")).toBeNull();
    expect(resultHeaders.get("content-length")).toBeNull();
  });
});

describe("ProxyForwarder - buildHeaders custom headers", () => {
  function withCustomHeaders<P extends Provider>(
    provider: P,
    customHeaders: Record<string, string> | null
  ): P {
    return Object.assign(Object.create(Object.getPrototypeOf(provider)), provider, {
      customHeaders,
    });
  }

  it("应该把 provider.customHeaders 注入出站 Headers (codex)", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createCodexProvider(), {
      "cf-aig-authorization": "Bearer provider-token",
      "x-tenant-id": "tenant-42",
    });

    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("cf-aig-authorization")).toBe("Bearer provider-token");
    expect(resultHeaders.get("x-tenant-id")).toBe("tenant-42");
    // 不影响鉴权
    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
  });

  it("应该允许 provider.customHeaders 覆盖默认 content-type", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createOpenAIProvider(), {
      "content-type": "application/x-ndjson",
    });

    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("content-type")).toBe("application/x-ndjson");
  });

  it("即使 DB 中 customHeaders 包含受保护的 authorization，也不应覆盖鉴权头 (codex)", () => {
    const session = createAuthLeakSession();
    const provider = withCustomHeaders(createCodexProvider(), {
      Authorization: "Bearer attacker-attempt",
    });

    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
  });

  it("即使 DB 中 customHeaders 包含受保护的 x-api-key，也不应破坏 claude 直连双头", () => {
    const session = createAuthLeakSession();
    const provider = withCustomHeaders(createClaudeProvider(), {
      "x-api-key": "attacker-attempt",
    });

    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("authorization")).toBe("Bearer test-outbound-key");
    expect(resultHeaders.get("x-api-key")).toBe("test-outbound-key");
  });

  it("provider.customHeaders 为 null 时维持现有行为", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createOpenAIProvider(), null);

    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("cf-aig-authorization")).toBeNull();
    expect(resultHeaders.get("content-type")).toBe("application/json");
  });

  it("即使 DB 中 customHeaders 包含 hop-by-hop 传输头，也不能注入出站请求", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createOpenAIProvider(), {
      "content-length": "9999",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
      "x-tenant-id": "tenant-42",
    });

    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("content-length")).toBeNull();
    expect(resultHeaders.get("connection")).toBeNull();
    expect(resultHeaders.get("transfer-encoding")).toBeNull();
    // 合法的非传输头应正常注入
    expect(resultHeaders.get("x-tenant-id")).toBe("tenant-42");
  });
});

describe("ProxyForwarder - buildGeminiHeaders custom headers", () => {
  function withCustomHeaders<P extends Provider>(
    provider: P,
    customHeaders: Record<string, string> | null
  ): P {
    return Object.assign(Object.create(Object.getPrototypeOf(provider)), provider, {
      customHeaders,
    });
  }

  it("应该把 provider.customHeaders 注入出站 Gemini Headers", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createGeminiProvider("gemini"), {
      "cf-aig-authorization": "Bearer provider-token",
    });
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };

    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("cf-aig-authorization")).toBe("Bearer provider-token");
    expect(resultHeaders.get("x-goog-api-key")).toBe("upstream-api-key");
  });

  it("DB 中 customHeaders 包含 x-goog-api-key 时不能覆盖鉴权", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createGeminiProvider("gemini"), {
      "x-goog-api-key": "attacker-attempt",
    });
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };

    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("x-goog-api-key")).toBe("upstream-api-key");
  });

  it("DB 中 customHeaders 包含 authorization 时不能覆盖 OAuth Bearer", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createGeminiProvider("gemini"), {
      authorization: "Bearer attacker-attempt",
    });
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };

    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-oauth-token",
      false
    );

    expect(resultHeaders.get("authorization")).toBe("Bearer upstream-oauth-token");
  });

  it("Gemini 路径也应剥离 hop-by-hop 传输头，避免脏数据破坏请求帧", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Original-UA/1.0"]]),
    });
    const provider = withCustomHeaders(createGeminiProvider("gemini"), {
      "content-length": "9999",
      Connection: "keep-alive",
      "Transfer-Encoding": "chunked",
      "x-tenant-id": "tenant-42",
    });
    const { buildGeminiHeaders } = ProxyForwarder as unknown as {
      buildGeminiHeaders: (
        session: ProxySession,
        provider: Provider,
        baseUrl: string,
        accessToken: string,
        isApiKey: boolean
      ) => Headers;
    };

    const resultHeaders = buildGeminiHeaders(
      session,
      provider,
      "https://generativelanguage.googleapis.com/v1beta",
      "upstream-api-key",
      true
    );

    expect(resultHeaders.get("content-length")).toBeNull();
    expect(resultHeaders.get("connection")).toBeNull();
    expect(resultHeaders.get("transfer-encoding")).toBeNull();
    expect(resultHeaders.get("x-tenant-id")).toBe("tenant-42");
  });
});
