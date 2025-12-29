import { afterEach, describe, expect, it, vi } from "vitest";

const undiciMocks = vi.hoisted(() => {
  return {
    Agent: vi.fn(),
    ProxyAgent: vi.fn(),
    setGlobalDispatcher: vi.fn(),
    request: vi.fn(),
    fetch: vi.fn(),
  };
});

vi.mock("undici", () => undiciMocks);

const ORIGINAL_ENV = {
  FETCH_CONNECT_TIMEOUT: process.env.FETCH_CONNECT_TIMEOUT,
  FETCH_HEADERS_TIMEOUT: process.env.FETCH_HEADERS_TIMEOUT,
  FETCH_BODY_TIMEOUT: process.env.FETCH_BODY_TIMEOUT,
};

function restoreEnv() {
  if (ORIGINAL_ENV.FETCH_CONNECT_TIMEOUT === undefined) {
    delete process.env.FETCH_CONNECT_TIMEOUT;
  } else {
    process.env.FETCH_CONNECT_TIMEOUT = ORIGINAL_ENV.FETCH_CONNECT_TIMEOUT;
  }

  if (ORIGINAL_ENV.FETCH_HEADERS_TIMEOUT === undefined) {
    delete process.env.FETCH_HEADERS_TIMEOUT;
  } else {
    process.env.FETCH_HEADERS_TIMEOUT = ORIGINAL_ENV.FETCH_HEADERS_TIMEOUT;
  }

  if (ORIGINAL_ENV.FETCH_BODY_TIMEOUT === undefined) {
    delete process.env.FETCH_BODY_TIMEOUT;
  } else {
    process.env.FETCH_BODY_TIMEOUT = ORIGINAL_ENV.FETCH_BODY_TIMEOUT;
  }
}

afterEach(() => {
  restoreEnv();
});

describe("EnvSchema - Fetch 超时配置", () => {
  it("未配置环境变量时，应使用 600s 的 headers/body 默认值（保持历史行为）", async () => {
    delete process.env.FETCH_CONNECT_TIMEOUT;
    delete process.env.FETCH_HEADERS_TIMEOUT;
    delete process.env.FETCH_BODY_TIMEOUT;

    vi.resetModules();
    const { getEnvConfig } = await import("@/lib/config/env.schema");
    const env = getEnvConfig();

    expect(env.FETCH_CONNECT_TIMEOUT).toBe(30000);
    expect(env.FETCH_HEADERS_TIMEOUT).toBe(600000);
    expect(env.FETCH_BODY_TIMEOUT).toBe(600000);
  });

  it("配置环境变量时，应正确解析三类超时（毫秒）", async () => {
    process.env.FETCH_CONNECT_TIMEOUT = "111";
    process.env.FETCH_HEADERS_TIMEOUT = "222";
    process.env.FETCH_BODY_TIMEOUT = "333";

    vi.resetModules();
    const { getEnvConfig } = await import("@/lib/config/env.schema");
    const env = getEnvConfig();

    expect(env.FETCH_CONNECT_TIMEOUT).toBe(111);
    expect(env.FETCH_HEADERS_TIMEOUT).toBe(222);
    expect(env.FETCH_BODY_TIMEOUT).toBe(333);
  });
});

describe("Undici - 超时参数注入", () => {
  it("proxy-agent.ts 应将 headers/body/connect timeout 从 env 注入到全局 Agent", async () => {
    process.env.FETCH_CONNECT_TIMEOUT = "1000";
    process.env.FETCH_HEADERS_TIMEOUT = "2000";
    process.env.FETCH_BODY_TIMEOUT = "3000";

    vi.resetModules();
    undiciMocks.Agent.mockClear();
    undiciMocks.setGlobalDispatcher.mockClear();

    await import("@/lib/proxy-agent");

    expect(undiciMocks.Agent).toHaveBeenCalledWith(
      expect.objectContaining({
        connectTimeout: 1000,
        headersTimeout: 2000,
        bodyTimeout: 3000,
      })
    );
    expect(undiciMocks.setGlobalDispatcher).toHaveBeenCalledTimes(1);
  });

  it("createProxyAgentForProvider 应将 headers/body/connect timeout 从 env 注入到 ProxyAgent", async () => {
    process.env.FETCH_CONNECT_TIMEOUT = "4000";
    process.env.FETCH_HEADERS_TIMEOUT = "5000";
    process.env.FETCH_BODY_TIMEOUT = "6000";

    vi.resetModules();
    undiciMocks.ProxyAgent.mockClear();

    const { createProxyAgentForProvider } = await import("@/lib/proxy-agent");

    createProxyAgentForProvider(
      {
        id: 1,
        name: "test-provider",
        proxyUrl: "http://user:pass@proxy.local:8080",
        proxyFallbackToDirect: false,
      },
      "https://example.com/v1/messages",
      true
    );

    expect(undiciMocks.ProxyAgent).toHaveBeenCalledWith(
      expect.objectContaining({
        uri: "http://user:pass@proxy.local:8080",
        allowH2: true,
        connectTimeout: 4000,
        headersTimeout: 5000,
        bodyTimeout: 6000,
      })
    );
  });

  it("forwarder.ts 的 undici.request 路径应显式传递 headers/body timeout", async () => {
    process.env.FETCH_CONNECT_TIMEOUT = "7000";
    process.env.FETCH_HEADERS_TIMEOUT = "8000";
    process.env.FETCH_BODY_TIMEOUT = "9000";

    vi.resetModules();
    undiciMocks.request.mockImplementation(() => {
      throw new Error("boom");
    });

    const { ProxyForwarder } = await import("@/app/v1/_lib/proxy/forwarder");
    undiciMocks.request.mockClear();

    await expect(
      (ProxyForwarder as any).fetchWithoutAutoDecode(
        "https://example.com/v1/messages",
        {
          method: "POST",
          headers: new Headers([["content-type", "application/json"]]),
        },
        1,
        "test-provider"
      )
    ).rejects.toThrow("boom");

    expect(undiciMocks.request).toHaveBeenCalledWith(
      "https://example.com/v1/messages",
      expect.objectContaining({
        headersTimeout: 8000,
        bodyTimeout: 9000,
      })
    );
  });
});
