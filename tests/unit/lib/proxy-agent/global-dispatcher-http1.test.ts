/**
 * 全局 undici dispatcher 必须禁用 HTTP/2
 *
 * 回归背景（2026-09 生产故障）：
 * undici 8 的 buildConnector 在未传入 allowH2 时默认取 true，ALPN 会同时广告 h2。
 * 生产环境即使后台关闭 HTTP/2，未指定 dispatcher 的请求仍协商到 h2，Cloudflare 随后
 * 返回 NGHTTP2_ENHANCE_YOUR_CALM；又因为“回退 HTTP/1.1”只是删除 dispatcher 回到同一个
 * 全局 Agent，回退同样落到 h2。多个供应商共用同一 origin 时会同时失败，最终放大成 503。
 *
 * 因此这里锁定两个不变式：
 * 1. 全局 Agent 显式声明 allowH2: false；
 * 2. setGlobalDispatcher 确实用该 Agent 注册。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const agentCalls: Array<Record<string, unknown>> = [];
  const setGlobalDispatcher = vi.fn();
  return { agentCalls, setGlobalDispatcher };
});

vi.mock("undici", () => {
  class Agent {
    options: Record<string, unknown>;
    constructor(options: Record<string, unknown>) {
      this.options = options;
      mocks.agentCalls.push(options);
    }
  }
  class ProxyAgent extends Agent {}
  return {
    Agent,
    ProxyAgent,
    setGlobalDispatcher: mocks.setGlobalDispatcher,
    // 类型导入在运行时不需要真实实现
    Dispatcher: class {},
  };
});

vi.mock("fetch-socks", () => ({
  socksDispatcher: vi.fn(() => ({})),
}));

vi.mock("@/lib/proxy-agent/agent-pool", () => ({
  getGlobalAgentPool: vi.fn(() => ({
    getAgent: vi.fn(),
    releaseAgent: vi.fn(),
    markUnhealthy: vi.fn(),
    evictEndpoint: vi.fn(),
    getPoolStats: vi.fn(),
    cleanup: vi.fn(),
    shutdown: vi.fn(),
  })),
  resetGlobalAgentPool: vi.fn(),
}));

vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({
    FETCH_CONNECT_TIMEOUT: 30_000,
    FETCH_HEADERS_TIMEOUT: 600_000,
    FETCH_BODY_TIMEOUT: 600_000,
  }),
}));

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

describe("global undici dispatcher", () => {
  beforeEach(() => {
    mocks.agentCalls.length = 0;
    mocks.setGlobalDispatcher.mockClear();
    vi.resetModules();
  });

  it("registers a global Agent with HTTP/2 explicitly disabled", async () => {
    await import("@/lib/proxy-agent");

    expect(mocks.setGlobalDispatcher).toHaveBeenCalledTimes(1);
    expect(mocks.agentCalls).toHaveLength(1);

    const options = mocks.agentCalls[0];
    // 必须是显式的 false：省略该字段等价于 undici 默认启用 h2，正是本次故障根因
    expect(options.allowH2).toBe(false);
    expect(Object.hasOwn(options, "allowH2")).toBe(true);
  });

  it("keeps the timeout overrides that the global Agent exists for", async () => {
    await import("@/lib/proxy-agent");

    const options = mocks.agentCalls[0];
    expect(options.connectTimeout).toBe(30_000);
    expect(options.headersTimeout).toBe(600_000);
    expect(options.bodyTimeout).toBe(600_000);
  });

  it("does not construct any h2-capable global agent", async () => {
    await import("@/lib/proxy-agent");

    const h2Capable = mocks.agentCalls.filter((options) => options.allowH2 !== false);
    expect(h2Capable).toEqual([]);
  });
});
