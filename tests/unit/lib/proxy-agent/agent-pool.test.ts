/**
 * Agent Pool Tests
 *
 * TDD: Tests written first, implementation follows
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock undici before importing agent-pool
vi.mock("undici", () => ({
  Agent: vi.fn().mockImplementation((options) => ({
    options,
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
  ProxyAgent: vi.fn().mockImplementation((options) => ({
    options,
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock("fetch-socks", () => ({
  socksDispatcher: vi.fn().mockImplementation((proxy, options) => ({
    proxy,
    options,
    close: vi.fn().mockResolvedValue(undefined),
    destroy: vi.fn().mockResolvedValue(undefined),
  })),
}));

import {
  type AgentPool,
  AgentPoolImpl,
  generateAgentCacheKey,
  getGlobalAgentPool,
  resetGlobalAgentPool,
  type AgentPoolConfig,
} from "@/lib/proxy-agent/agent-pool";

describe("generateAgentCacheKey", () => {
  it("should generate correct cache key for direct connection", () => {
    const key = generateAgentCacheKey({
      endpointUrl: "https://api.anthropic.com/v1/messages",
      proxyUrl: null,
      enableHttp2: false,
    });
    expect(key).toBe("https://api.anthropic.com|direct|h1");
  });

  it("should generate correct cache key with proxy", () => {
    const key = generateAgentCacheKey({
      endpointUrl: "https://api.openai.com/v1/chat/completions",
      proxyUrl: "http://proxy.example.com:8080",
      enableHttp2: false,
    });
    expect(key).toBe("https://api.openai.com|http://proxy.example.com:8080|h1");
  });

  it("should generate correct cache key with HTTP/2 enabled", () => {
    const key = generateAgentCacheKey({
      endpointUrl: "https://api.anthropic.com/v1/messages",
      proxyUrl: null,
      enableHttp2: true,
    });
    expect(key).toBe("https://api.anthropic.com|direct|h2");
  });

  it("should generate correct cache key with proxy and HTTP/2", () => {
    const key = generateAgentCacheKey({
      endpointUrl: "https://api.anthropic.com/v1/messages",
      proxyUrl: "https://secure-proxy.example.com:443",
      enableHttp2: true,
    });
    // URL API strips default port 443 for HTTPS
    expect(key).toBe("https://api.anthropic.com|https://secure-proxy.example.com|h2");
  });

  it("should use origin only (strip path and query)", () => {
    const key = generateAgentCacheKey({
      endpointUrl: "https://api.anthropic.com/v1/messages?key=value",
      proxyUrl: null,
      enableHttp2: false,
    });
    expect(key).toBe("https://api.anthropic.com|direct|h1");
  });

  it("should handle different ports", () => {
    const key = generateAgentCacheKey({
      endpointUrl: "https://api.example.com:8443/v1/messages",
      proxyUrl: null,
      enableHttp2: false,
    });
    expect(key).toBe("https://api.example.com:8443|direct|h1");
  });

  it("should differentiate HTTP and HTTPS", () => {
    const httpKey = generateAgentCacheKey({
      endpointUrl: "http://api.example.com/v1/messages",
      proxyUrl: null,
      enableHttp2: false,
    });
    const httpsKey = generateAgentCacheKey({
      endpointUrl: "https://api.example.com/v1/messages",
      proxyUrl: null,
      enableHttp2: false,
    });
    expect(httpKey).not.toBe(httpsKey);
    expect(httpKey).toBe("http://api.example.com|direct|h1");
    expect(httpsKey).toBe("https://api.example.com|direct|h1");
  });
});

describe("AgentPool", () => {
  let pool: AgentPool;
  const defaultConfig: AgentPoolConfig = {
    maxTotalAgents: 10,
    agentTtlMs: 300000, // 5 minutes
    connectionIdleTimeoutMs: 60000, // 1 minute
    cleanupIntervalMs: 30000, // 30 seconds
  };

  beforeEach(() => {
    vi.useFakeTimers();
    pool = new AgentPoolImpl(defaultConfig);
  });

  afterEach(async () => {
    await pool.shutdown();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  describe("caching behavior", () => {
    it("should reuse Agent for same endpoint", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const result1 = await pool.getAgent(params);
      const result2 = await pool.getAgent(params);

      expect(result1.cacheKey).toBe(result2.cacheKey);
      expect(result1.agent).toBe(result2.agent);
      expect(result1.isNew).toBe(true);
      expect(result2.isNew).toBe(false);
    });

    it("should create different Agent for different endpoints", async () => {
      const result1 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      const result2 = await pool.getAgent({
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        proxyUrl: null,
        enableHttp2: false,
      });

      expect(result1.cacheKey).not.toBe(result2.cacheKey);
      expect(result1.agent).not.toBe(result2.agent);
      expect(result1.isNew).toBe(true);
      expect(result2.isNew).toBe(true);
    });

    it("should create different Agent for different proxy configs", async () => {
      const result1 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      const result2 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: "http://proxy.example.com:8080",
        enableHttp2: false,
      });

      expect(result1.cacheKey).not.toBe(result2.cacheKey);
      expect(result1.agent).not.toBe(result2.agent);
    });

    it("should create different Agent for HTTP/2 vs HTTP/1.1", async () => {
      const result1 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      const result2 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: true,
      });

      expect(result1.cacheKey).not.toBe(result2.cacheKey);
      expect(result1.agent).not.toBe(result2.agent);
    });

    it("should track request count", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      await pool.getAgent(params);
      await pool.getAgent(params);
      await pool.getAgent(params);

      const stats = pool.getPoolStats();
      expect(stats.totalRequests).toBe(3);
      expect(stats.cacheHits).toBe(2);
      expect(stats.cacheMisses).toBe(1);
    });
  });

  describe("health management", () => {
    it("should create new Agent after marking unhealthy", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const result1 = await pool.getAgent(params);
      pool.markUnhealthy(result1.cacheKey, "SSL certificate error");

      const result2 = await pool.getAgent(params);

      expect(result2.isNew).toBe(true);
      expect(result2.agent).not.toBe(result1.agent);
    });

    it("should not hang when evicting an unhealthy agent whose close() never resolves", async () => {
      // 说明：beforeEach 使用了 fake timers，但此用例需要依赖真实 setTimeout 做“防卡死”断言
      await pool.shutdown();
      vi.useRealTimers();

      const realPool = new AgentPoolImpl(defaultConfig);

      const withTimeout = async <T>(promise: Promise<T>, ms: number): Promise<T> => {
        let timeoutId: ReturnType<typeof setTimeout> | null = null;
        try {
          return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
              timeoutId = setTimeout(() => reject(new Error("timeout")), ms);
            }),
          ]);
        } finally {
          if (timeoutId) clearTimeout(timeoutId);
        }
      };

      try {
        const params = {
          endpointUrl: "https://api.anthropic.com/v1/messages",
          proxyUrl: null,
          enableHttp2: true,
        };

        const result1 = await realPool.getAgent(params);
        const agent1 = result1.agent as unknown as {
          close?: () => Promise<void>;
          destroy?: unknown;
        };

        // 强制走 close() 分支：模拟某些 dispatcher 不支持 destroy()
        agent1.destroy = undefined;

        // 模拟：close 可能因等待 in-flight 请求结束而长期不返回
        let closeCalled = false;
        agent1.close = () => {
          closeCalled = true;
          return new Promise<void>(() => {});
        };

        realPool.markUnhealthy(result1.cacheKey, "test-hang-close");

        const result2 = await withTimeout(realPool.getAgent(params), 500);
        expect(result2.isNew).toBe(true);
        expect(result2.agent).not.toBe(result1.agent);

        // 断言：即使 close() 处于 pending，也不会阻塞 getAgent()，且会触发 close 调用
        expect(closeCalled).toBe(true);
      } finally {
        await realPool.shutdown();
        vi.useFakeTimers();
      }
    });

    it("should track unhealthy agents in stats", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const result = await pool.getAgent(params);
      pool.markUnhealthy(result.cacheKey, "SSL certificate error");

      const stats = pool.getPoolStats();
      expect(stats.unhealthyAgents).toBe(1);
    });

    it("should evict all Agents for endpoint on evictEndpoint", async () => {
      // Create agents for same endpoint with different configs
      await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });
      await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: true,
      });
      await pool.getAgent({
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        proxyUrl: null,
        enableHttp2: false,
      });

      const statsBefore = pool.getPoolStats();
      expect(statsBefore.cacheSize).toBe(3);

      await pool.evictEndpoint("https://api.anthropic.com");

      const statsAfter = pool.getPoolStats();
      expect(statsAfter.cacheSize).toBe(1);
      expect(statsAfter.evictedAgents).toBe(2);
    });
  });

  describe("expiration cleanup", () => {
    it("should cleanup expired Agents", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000, // 1 second TTL
      });

      await shortTtlPool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      expect(shortTtlPool.getPoolStats().cacheSize).toBe(1);

      // Advance time past TTL
      vi.advanceTimersByTime(2000);

      const cleaned = await shortTtlPool.cleanup();
      expect(cleaned).toBe(1);
      expect(shortTtlPool.getPoolStats().cacheSize).toBe(0);

      await shortTtlPool.shutdown();
    });

    it("should not cleanup recently used Agents", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      await shortTtlPool.getAgent(params);

      // Advance time but not past TTL
      vi.advanceTimersByTime(500);

      // Use the agent again (updates lastUsedAt)
      await shortTtlPool.getAgent(params);

      // Advance time again
      vi.advanceTimersByTime(500);

      const cleaned = await shortTtlPool.cleanup();
      expect(cleaned).toBe(0);
      expect(shortTtlPool.getPoolStats().cacheSize).toBe(1);

      await shortTtlPool.shutdown();
    });

    it("should implement LRU eviction when max size reached", async () => {
      const smallPool = new AgentPoolImpl({
        ...defaultConfig,
        maxTotalAgents: 2,
      });

      // Create 3 agents (exceeds max of 2)
      await smallPool.getAgent({
        endpointUrl: "https://api1.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });

      vi.advanceTimersByTime(100);

      await smallPool.getAgent({
        endpointUrl: "https://api2.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });

      vi.advanceTimersByTime(100);

      await smallPool.getAgent({
        endpointUrl: "https://api3.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });

      // Should have evicted the oldest (LRU)
      const stats = smallPool.getPoolStats();
      expect(stats.cacheSize).toBeLessThanOrEqual(2);

      await smallPool.shutdown();
    });
  });

  describe("proxy support", () => {
    it("should create ProxyAgent for HTTP proxy", async () => {
      const result = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: "http://proxy.example.com:8080",
        enableHttp2: false,
      });

      expect(result.isNew).toBe(true);
      expect(result.cacheKey).toContain("http://proxy.example.com:8080");
    });

    it("should create SOCKS dispatcher for SOCKS proxy", async () => {
      const result = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: "socks5://proxy.example.com:1080",
        enableHttp2: false,
      });

      expect(result.isNew).toBe(true);
      expect(result.cacheKey).toContain("socks5://proxy.example.com:1080");
    });
  });

  describe("pool stats", () => {
    it("should return accurate pool statistics", async () => {
      await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      await pool.getAgent({
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        proxyUrl: null,
        enableHttp2: false,
      });

      const stats = pool.getPoolStats();

      expect(stats.cacheSize).toBe(2);
      expect(stats.totalRequests).toBe(3);
      expect(stats.cacheHits).toBe(1);
      expect(stats.cacheMisses).toBe(2);
      expect(stats.hitRate).toBeCloseTo(1 / 3, 2);
    });
  });

  describe("shutdown", () => {
    it("should close all agents on shutdown", async () => {
      await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      await pool.getAgent({
        endpointUrl: "https://api.openai.com/v1/chat/completions",
        proxyUrl: null,
        enableHttp2: false,
      });

      await pool.shutdown();

      const stats = pool.getPoolStats();
      expect(stats.cacheSize).toBe(0);
    });

    it("should prefer destroy over close to avoid hanging on in-flight streaming requests", async () => {
      const result = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: true,
      });

      const agent = result.agent as unknown as {
        close?: () => Promise<void>;
        destroy?: () => Promise<void>;
      };

      // 模拟：close 可能因等待 in-flight 请求结束而长期不返回
      if (typeof agent.close === "function") {
        vi.mocked(agent.close).mockImplementation(() => new Promise<void>(() => {}));
      }

      await pool.shutdown();

      // destroy 应被优先调用（避免 close 挂死导致 shutdown/evict 卡住）
      if (typeof agent.destroy === "function") {
        expect(agent.destroy).toHaveBeenCalled();
      }
      if (typeof agent.close === "function") {
        expect(agent.close).not.toHaveBeenCalled();
      }
    });
  });
});

describe("getGlobalAgentPool", () => {
  afterEach(async () => {
    await resetGlobalAgentPool();
  });

  it("should return singleton instance", () => {
    const pool1 = getGlobalAgentPool();
    const pool2 = getGlobalAgentPool();

    expect(pool1).toBe(pool2);
  });

  it("should create new instance after reset", async () => {
    const pool1 = getGlobalAgentPool();
    await resetGlobalAgentPool();
    const pool2 = getGlobalAgentPool();

    expect(pool1).not.toBe(pool2);
  });
});
