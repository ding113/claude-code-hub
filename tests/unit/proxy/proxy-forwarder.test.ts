import { describe, expect, it } from "vitest";
import type { Provider } from "@/types/provider";
import { ProxyForwarder } from "@/app/v1/_lib/proxy/forwarder";
import { ProxySession } from "@/app/v1/_lib/proxy/session";

function createSession({
  userAgent,
  headers,
}: {
  userAgent: string | null;
  headers: Headers;
}): ProxySession {
  // 使用 ProxySession 的内部构造方法创建测试实例
  const session = Object.create(ProxySession.prototype);

  Object.assign(session, {
    startTime: Date.now(),
    method: "POST",
    requestUrl: new URL("https://example.com/v1/messages"),
    headers,
    originalHeaders: new Headers(headers), // 同步更新 originalHeaders
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
      // 简化的 isHeaderModified 实现
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

describe("ProxyForwarder - buildHeaders User-Agent resolution", () => {
  it("应该优先使用过滤器修改的 user-agent（Codex provider）", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", "Filtered-UA/2.0"]]),
    });
    // 设置 originalHeaders 为不同值以模拟过滤器修改
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createCodexProvider();
    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
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
    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
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
    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
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
    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
    const resultHeaders = buildHeaders(session, provider);

    expect(resultHeaders.get("user-agent")).toBe(
      "codex_cli_rs/0.55.0 (Mac OS 26.1.0; arm64) vscode/2.0.64"
    );
  });

  it("应该保留过滤器设置的空字符串 user-agent", () => {
    const session = createSession({
      userAgent: "Original-UA/1.0",
      headers: new Headers([["user-agent", ""]]), // 空字符串
    });
    // originalHeaders 包含原始 UA，但当前是空字符串
    (session as any).originalHeaders = new Headers([["user-agent", "Original-UA/1.0"]]);

    const provider = createCodexProvider();
    const { buildHeaders } = ProxyForwarder as unknown as {
      buildHeaders: (session: ProxySession, provider: Provider) => Headers;
    };
    const resultHeaders = buildHeaders(session, provider);

    // 空字符串应该被保留（使用 ?? 而非 ||）
    expect(resultHeaders.get("user-agent")).toBe("");
  });
});
