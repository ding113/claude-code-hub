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
  type AgentPoolConfig,
  generateAgentCacheKey,
  getGlobalAgentPool,
  resetGlobalAgentPool,
} from "@/lib/proxy-agent/agent-pool";
import { logger } from "@/lib/logger";

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
      pool.markUnhealthy(result1.cacheKey, "SSL certificate error", result1.dispatcherId);

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

        realPool.releaseAgent(result1.cacheKey, result1.dispatcherId);
        realPool.markUnhealthy(result1.cacheKey, "test-hang-close", result1.dispatcherId);

        const result2 = await withTimeout(realPool.getAgent(params), 500);
        expect(result2.isNew).toBe(true);
        expect(result2.agent).not.toBe(result1.agent);

        // 断言：空闲 unhealthy dispatcher 即使 close() 处于 pending，也不会阻塞 getAgent()
        expect(closeCalled).toBe(true);
      } finally {
        await realPool.shutdown();
        vi.useFakeTimers();
      }
    });

    it("should retire unhealthy active dispatcher without destroying in-flight requests", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const result1 = await pool.getAgent(params);
      const result2 = await pool.getAgent(params);
      const agent1 = result1.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      const destroy1 = vi.fn().mockResolvedValue(undefined);
      agent1.destroy = destroy1;

      pool.markUnhealthy(result1.cacheKey, "SSL certificate error", result1.dispatcherId);

      expect(pool.getPoolStats().cacheSize).toBe(0);
      expect(pool.getPoolStats().activeRequests).toBe(2);
      expect(destroy1).not.toHaveBeenCalled();

      const result3 = await pool.getAgent(params);
      expect(result3.isNew).toBe(true);
      expect(result3.agent).not.toBe(result1.agent);
      expect(result3.dispatcherId).not.toBe(result1.dispatcherId);
      expect(pool.getPoolStats().activeRequests).toBe(3);

      pool.releaseAgent(result1.cacheKey, result1.dispatcherId);
      expect(destroy1).not.toHaveBeenCalled();

      pool.releaseAgent(result2.cacheKey, result2.dispatcherId);
      expect(destroy1).toHaveBeenCalledTimes(1);

      pool.releaseAgent(result3.cacheKey, result3.dispatcherId);
      expect(pool.getPoolStats().activeRequests).toBe(0);
    });

    it("满载时同 cacheKey unhealthy 退役后仍应允许替换 dispatcher", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const smallPool = new AgentPoolImpl({
        ...defaultConfig,
        maxTotalAgents: 2,
        cleanupIntervalMs: 60 * 60 * 1000,
      });

      try {
        const unhealthy = await smallPool.getAgent({
          endpointUrl: "https://replace-unhealthy.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });
        const unhealthyAgent = unhealthy.agent as unknown as {
          destroy?: () => Promise<void>;
        };
        const unhealthyDestroy = vi.fn().mockResolvedValue(undefined);
        unhealthyAgent.destroy = unhealthyDestroy;

        const occupied = await smallPool.getAgent({
          endpointUrl: "https://occupied-unhealthy.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });

        smallPool.markUnhealthy(
          unhealthy.cacheKey,
          "SSL certificate error",
          unhealthy.dispatcherId
        );

        const replacement = await smallPool.getAgent({
          endpointUrl: "https://replace-unhealthy.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });

        expect(replacement.isNew).toBe(true);
        expect(replacement.dispatcherId).not.toBe(unhealthy.dispatcherId);
        expect(unhealthyDestroy).not.toHaveBeenCalled();
        expect(smallPool.getPoolStats()).toEqual(
          expect.objectContaining({
            activeRequests: 3,
            cacheSize: 2,
            liveAgents: 3,
            retiredAgents: 1,
          })
        );

        await expect(
          smallPool.getAgent({
            endpointUrl: "https://new-while-unhealthy-replacement-active.example.com/v1",
            proxyUrl: null,
            enableHttp2: false,
          })
        ).rejects.toThrow("AgentPool live dispatcher capacity exhausted");

        smallPool.releaseAgent(unhealthy.cacheKey, unhealthy.dispatcherId);
        expect(unhealthyDestroy).toHaveBeenCalledTimes(1);
        expect(smallPool.getPoolStats().liveAgents).toBe(2);

        smallPool.releaseAgent(occupied.cacheKey, occupied.dispatcherId);
        smallPool.releaseAgent(replacement.cacheKey, replacement.dispatcherId);
        expect(smallPool.getPoolStats().activeRequests).toBe(0);
      } finally {
        warnSpy.mockRestore();
        await smallPool.shutdown();
      }
    });

    it("should ignore stale unhealthy marks for an older dispatcher generation", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const oldGeneration = await pool.getAgent(params);
      pool.markUnhealthy(oldGeneration.cacheKey, "initial SSL failure", oldGeneration.dispatcherId);

      const newGeneration = await pool.getAgent(params);
      expect(newGeneration.dispatcherId).not.toBe(oldGeneration.dispatcherId);

      pool.markUnhealthy(
        oldGeneration.cacheKey,
        "late SSL failure from old stream",
        oldGeneration.dispatcherId
      );

      const reusedNewGeneration = await pool.getAgent(params);
      expect(reusedNewGeneration.agent).toBe(newGeneration.agent);
      expect(reusedNewGeneration.dispatcherId).toBe(newGeneration.dispatcherId);

      pool.releaseAgent(oldGeneration.cacheKey, oldGeneration.dispatcherId);
      pool.releaseAgent(newGeneration.cacheKey, newGeneration.dispatcherId);
      pool.releaseAgent(reusedNewGeneration.cacheKey, reusedNewGeneration.dispatcherId);
      expect(pool.getPoolStats().activeRequests).toBe(0);
    });

    it("should track unhealthy agents in stats", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const result = await pool.getAgent(params);
      pool.markUnhealthy(result.cacheKey, "SSL certificate error", result.dispatcherId);

      const stats = pool.getPoolStats();
      expect(stats.unhealthyAgents).toBe(1);
    });

    it("should evict all Agents for endpoint on evictEndpoint", async () => {
      // Create agents for same endpoint with different configs
      const h1 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });
      const h2 = await pool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: true,
      });
      const h1Agent = h1.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      const h2Agent = h2.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      const h1Destroy = vi.fn().mockResolvedValue(undefined);
      const h2Destroy = vi.fn().mockResolvedValue(undefined);
      h1Agent.destroy = h1Destroy;
      h2Agent.destroy = h2Destroy;
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
      expect(statsAfter.activeRequests).toBe(3);
      expect(h1Destroy).not.toHaveBeenCalled();
      expect(h2Destroy).not.toHaveBeenCalled();

      pool.releaseAgent(h1.cacheKey, h1.dispatcherId);
      pool.releaseAgent(h2.cacheKey, h2.dispatcherId);
      expect(h1Destroy).toHaveBeenCalledTimes(1);
      expect(h2Destroy).toHaveBeenCalledTimes(1);
    });
  });

  describe("expiration cleanup", () => {
    it("should cleanup expired Agents", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000, // 1 second TTL
      });

      const { cacheKey, dispatcherId } = await shortTtlPool.getAgent({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      });

      expect(shortTtlPool.getPoolStats().cacheSize).toBe(1);

      // Release the agent (simulates request completion)
      shortTtlPool.releaseAgent(cacheKey, dispatcherId);

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

      // Create 3 agents after releasing earlier requests so LRU can reclaim idle capacity.
      const r1 = await smallPool.getAgent({
        endpointUrl: "https://api1.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });
      smallPool.releaseAgent(r1.cacheKey, r1.dispatcherId);

      vi.advanceTimersByTime(100);

      const r2 = await smallPool.getAgent({
        endpointUrl: "https://api2.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });
      smallPool.releaseAgent(r2.cacheKey, r2.dispatcherId);

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

    it("容量紧张时应优先淘汰已过期的空闲 dispatcher", async () => {
      const smallPool = new AgentPoolImpl({
        ...defaultConfig,
        maxTotalAgents: 2,
        agentTtlMs: 60 * 60 * 1000,
        cleanupIntervalMs: 60 * 60 * 1000,
      });

      const expiring = await smallPool.getAgent({
        endpointUrl: "https://expired.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });
      const expiringAgent = expiring.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      const expiringDestroy = vi.fn().mockResolvedValue(undefined);
      expiringAgent.destroy = expiringDestroy;
      smallPool.releaseAgent(expiring.cacheKey, expiring.dispatcherId);

      vi.advanceTimersByTime(20 * 60 * 1000);

      const validLru = await smallPool.getAgent({
        endpointUrl: "https://valid-lru.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });
      const validLruAgent = validLru.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      const validLruDestroy = vi.fn().mockResolvedValue(undefined);
      validLruAgent.destroy = validLruDestroy;
      smallPool.releaseAgent(validLru.cacheKey, validLru.dispatcherId);

      vi.advanceTimersByTime(9 * 60 * 1000 + 50 * 1000);

      const reusedExpiring = await smallPool.getAgent({
        endpointUrl: "https://expired.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });
      expect(reusedExpiring.dispatcherId).toBe(expiring.dispatcherId);
      smallPool.releaseAgent(reusedExpiring.cacheKey, reusedExpiring.dispatcherId);

      vi.advanceTimersByTime(11 * 1000);

      const newEntry = await smallPool.getAgent({
        endpointUrl: "https://new.example.com/v1",
        proxyUrl: null,
        enableHttp2: false,
      });

      expect(expiringDestroy).toHaveBeenCalledTimes(1);
      expect(validLruDestroy).not.toHaveBeenCalled();
      expect(smallPool.getPoolStats().cacheSize).toBe(2);

      smallPool.releaseAgent(newEntry.cacheKey, newEntry.dispatcherId);
      await smallPool.shutdown();
    });

    it("满载时同 cacheKey 硬过期退役后仍应允许替换 dispatcher", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const smallPool = new AgentPoolImpl({
        ...defaultConfig,
        maxTotalAgents: 2,
        cleanupIntervalMs: 60 * 60 * 1000,
      });

      try {
        const expiring = await smallPool.getAgent({
          endpointUrl: "https://replace-expired.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });
        const expiringAgent = expiring.agent as unknown as {
          destroy?: () => Promise<void>;
        };
        const expiringDestroy = vi.fn().mockResolvedValue(undefined);
        expiringAgent.destroy = expiringDestroy;

        const occupied = await smallPool.getAgent({
          endpointUrl: "https://occupied.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });

        vi.advanceTimersByTime(31 * 60 * 1000);

        const replacement = await smallPool.getAgent({
          endpointUrl: "https://replace-expired.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });

        expect(replacement.isNew).toBe(true);
        expect(replacement.dispatcherId).not.toBe(expiring.dispatcherId);
        expect(expiringDestroy).not.toHaveBeenCalled();
        expect(smallPool.getPoolStats()).toEqual(
          expect.objectContaining({
            activeRequests: 3,
            cacheSize: 2,
            liveAgents: 3,
            retiredAgents: 1,
          })
        );

        await expect(
          smallPool.getAgent({
            endpointUrl: "https://new-while-replacement-active.example.com/v1",
            proxyUrl: null,
            enableHttp2: false,
          })
        ).rejects.toThrow("AgentPool live dispatcher capacity exhausted");

        expect(warnSpy).toHaveBeenCalledWith(
          "AgentPool: Live dispatcher capacity exhausted",
          expect.objectContaining({
            effectiveReservedDispatchers: 3,
            replacementCapacityCredit: 0,
            reservedDispatchers: 3,
          })
        );

        smallPool.releaseAgent(expiring.cacheKey, expiring.dispatcherId);
        expect(expiringDestroy).toHaveBeenCalledTimes(1);
        expect(smallPool.getPoolStats().liveAgents).toBe(2);

        smallPool.releaseAgent(occupied.cacheKey, occupied.dispatcherId);
        smallPool.releaseAgent(replacement.cacheKey, replacement.dispatcherId);
        expect(smallPool.getPoolStats().activeRequests).toBe(0);
      } finally {
        warnSpy.mockRestore();
        await smallPool.shutdown();
      }
    });

    it("should reject new dispatcher creation when all live capacity is active", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const smallPool = new AgentPoolImpl({
        ...defaultConfig,
        maxTotalAgents: 2,
      });

      try {
        const r1 = await smallPool.getAgent({
          endpointUrl: "https://api1.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });
        const agent1 = r1.agent as unknown as {
          destroy?: () => Promise<void>;
        };
        const destroy1 = vi.fn().mockResolvedValue(undefined);
        agent1.destroy = destroy1;

        vi.advanceTimersByTime(100);
        const r2 = await smallPool.getAgent({
          endpointUrl: "https://api2.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });

        vi.advanceTimersByTime(100);
        await expect(
          smallPool.getAgent({
            endpointUrl: "https://api3.example.com/v1",
            proxyUrl: null,
            enableHttp2: false,
          })
        ).rejects.toThrow("AgentPool live dispatcher capacity exhausted");

        expect(smallPool.getPoolStats()).toEqual(
          expect.objectContaining({
            cacheMisses: 2,
            hitRate: 0,
            totalRequests: 2,
          })
        );
        expect(warnSpy).toHaveBeenCalledWith(
          "AgentPool: Live dispatcher capacity exhausted",
          expect.objectContaining({
            activeRequests: 2,
            cacheSize: 2,
            maxTotalAgents: 2,
            pendingCreations: 0,
            retiredAgents: 0,
          })
        );
        expect(smallPool.getPoolStats().cacheSize).toBe(2);
        expect(smallPool.getPoolStats().liveAgents).toBe(2);
        expect(smallPool.getPoolStats().activeRequests).toBe(2);
        expect(destroy1).not.toHaveBeenCalled();

        smallPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
        expect(smallPool.getPoolStats().activeRequests).toBe(1);
        expect(destroy1).not.toHaveBeenCalled();

        const r3 = await smallPool.getAgent({
          endpointUrl: "https://api3.example.com/v1",
          proxyUrl: null,
          enableHttp2: false,
        });
        expect(smallPool.getPoolStats().cacheSize).toBe(2);
        expect(smallPool.getPoolStats().liveAgents).toBe(2);
        expect(smallPool.getPoolStats().activeRequests).toBe(2);
        expect(destroy1).toHaveBeenCalledTimes(1);

        smallPool.releaseAgent(r2.cacheKey, r2.dispatcherId);
        smallPool.releaseAgent(r3.cacheKey, r3.dispatcherId);
        expect(smallPool.getPoolStats().activeRequests).toBe(0);
      } finally {
        warnSpy.mockRestore();
        await smallPool.shutdown();
      }
    });
  });

  describe("reference counting", () => {
    it("should prevent expiration of agents with active requests", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      // getAgent increments activeRequests
      await shortTtlPool.getAgent(params);
      expect(shortTtlPool.getPoolStats().activeRequests).toBe(1);

      // Advance past TTL
      vi.advanceTimersByTime(2000);

      // Should NOT be evicted because activeRequests > 0
      const cleaned = await shortTtlPool.cleanup();
      expect(cleaned).toBe(0);
      expect(shortTtlPool.getPoolStats().cacheSize).toBe(1);

      await shortTtlPool.shutdown();
    });

    it("should allow expiration after all requests are released", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const { cacheKey, dispatcherId } = await shortTtlPool.getAgent(params);
      shortTtlPool.releaseAgent(cacheKey, dispatcherId);
      expect(shortTtlPool.getPoolStats().activeRequests).toBe(0);

      // Advance past TTL
      vi.advanceTimersByTime(2000);

      const cleaned = await shortTtlPool.cleanup();
      expect(cleaned).toBe(1);
      expect(shortTtlPool.getPoolStats().cacheSize).toBe(0);

      await shortTtlPool.shutdown();
    });

    it("should track multiple sequential requests correctly", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      // 3 sequential requests to same agent (exercises the cache-hit path)
      const r1 = await shortTtlPool.getAgent(params);
      await shortTtlPool.getAgent(params);
      await shortTtlPool.getAgent(params);
      expect(shortTtlPool.getPoolStats().activeRequests).toBe(3);

      // Release 2
      shortTtlPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
      shortTtlPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
      expect(shortTtlPool.getPoolStats().activeRequests).toBe(1);

      // Advance past TTL - should NOT be evicted
      vi.advanceTimersByTime(2000);
      const cleaned1 = await shortTtlPool.cleanup();
      expect(cleaned1).toBe(0);

      // Release last request
      shortTtlPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
      expect(shortTtlPool.getPoolStats().activeRequests).toBe(0);

      // Now advance past TTL - should be evicted
      vi.advanceTimersByTime(2000);
      const cleaned2 = await shortTtlPool.cleanup();
      expect(cleaned2).toBe(1);

      await shortTtlPool.shutdown();
    });

    it("should count pending-creation waiters in activeRequests", async () => {
      // 回归用例：真正模拟"首次创建阶段的并发请求"
      // 使用 vi.useRealTimers() 并通过 spy 阻塞 createAgent 以强制等待者走 pendingCreations 路径。
      // 如果 waiter 未正确递增 activeRequests，下面 expect(3) 会退化为 1 或 2。
      vi.useRealTimers();
      const concurrentPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 60_000,
      });
      try {
        const params = {
          endpointUrl: "https://api.anthropic.com/v1/messages",
          proxyUrl: null,
          enableHttp2: false,
        };

        // 用 deferred 控制 createAgent 的完成时机，保证后续 getAgent 都落入 pendingCreations
        let releaseCreate: (() => void) | null = null;
        const createBlocker = new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });

        const createSpy = vi.spyOn(concurrentPool as any, "createAgent");
        createSpy.mockImplementationOnce(async () => {
          await createBlocker;
          return {
            close: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn().mockResolvedValue(undefined),
            options: {},
          };
        });

        try {
          // 同时发起 3 个请求：首个进入 createAgentWithCache；后两个必须走 pendingCreations
          const p1 = concurrentPool.getAgent(params);
          const p2 = concurrentPool.getAgent(params);
          const p3 = concurrentPool.getAgent(params);

          // 稍微等一个 microtask，确保 p2/p3 已经进入 await pending 分支
          await Promise.resolve();
          await Promise.resolve();

          // 放行创建
          releaseCreate?.();

          const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

          // 三个调用应拿到相同的 cacheKey 与 dispatcherId
          expect(r2.cacheKey).toBe(r1.cacheKey);
          expect(r3.cacheKey).toBe(r1.cacheKey);
          expect(r2.dispatcherId).toBe(r1.dispatcherId);
          expect(r3.dispatcherId).toBe(r1.dispatcherId);

          // 关键断言：所有 3 个并发 waiter 都应计入 activeRequests
          expect(concurrentPool.getPoolStats().activeRequests).toBe(3);

          // 释放 3 次后归零，且仍能再多释一次（no-op）
          concurrentPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
          concurrentPool.releaseAgent(r2.cacheKey, r2.dispatcherId);
          concurrentPool.releaseAgent(r3.cacheKey, r3.dispatcherId);
          expect(concurrentPool.getPoolStats().activeRequests).toBe(0);
        } finally {
          releaseCreate?.();
          createSpy.mockRestore();
        }
      } finally {
        await concurrentPool.shutdown();
        vi.useFakeTimers();
      }
    });

    it("should count pending creations against live dispatcher capacity", async () => {
      vi.useRealTimers();
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const concurrentPool = new AgentPoolImpl({
        ...defaultConfig,
        maxTotalAgents: 1,
      });
      try {
        let releaseCreate: (() => void) | null = null;
        const createBlocker = new Promise<void>((resolve) => {
          releaseCreate = resolve;
        });

        const createSpy = vi.spyOn(concurrentPool as any, "createAgent");
        createSpy.mockImplementationOnce(async () => {
          await createBlocker;
          return {
            close: vi.fn().mockResolvedValue(undefined),
            destroy: vi.fn().mockResolvedValue(undefined),
            options: {},
          };
        });

        try {
          const p1 = concurrentPool.getAgent({
            endpointUrl: "https://api1.example.com/v1",
            proxyUrl: null,
            enableHttp2: false,
          });

          await Promise.resolve();
          await Promise.resolve();

          await expect(
            concurrentPool.getAgent({
              endpointUrl: "https://api2.example.com/v1",
              proxyUrl: null,
              enableHttp2: false,
            })
          ).rejects.toThrow("AgentPool live dispatcher capacity exhausted");

          expect(warnSpy).toHaveBeenCalledWith(
            "AgentPool: Live dispatcher capacity exhausted",
            expect.objectContaining({
              activeRequests: 0,
              cacheSize: 0,
              maxTotalAgents: 1,
              pendingCreations: 1,
              retiredAgents: 0,
            })
          );

          releaseCreate?.();
          const r1 = await p1;
          expect(concurrentPool.getPoolStats().liveAgents).toBe(1);
          expect(concurrentPool.getPoolStats().pendingCreations).toBe(0);

          concurrentPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
        } finally {
          releaseCreate?.();
          createSpy.mockRestore();
        }
      } finally {
        warnSpy.mockRestore();
        await concurrentPool.shutdown();
        vi.useFakeTimers();
      }
    });

    it("should release stale dispatcher generation without decrementing the current dispatcher", async () => {
      // 回归用例：cacheKey 相同但 dispatcher 已被重建时，旧 release 只应释放旧代 dispatcher
      const regenPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      // 第一代 dispatcher
      const r1 = await regenPool.getAgent(params);
      expect(regenPool.getPoolStats().activeRequests).toBe(1);

      // 模拟外部强制驱逐（例如 markUnhealthy 后下次 getAgent 触发 evictByKey）
      regenPool.markUnhealthy(r1.cacheKey, "simulated SSL failure", r1.dispatcherId);

      // 第二代 dispatcher（同 cacheKey，但 dispatcherId 必须不同）
      const r2 = await regenPool.getAgent(params);
      expect(r2.cacheKey).toBe(r1.cacheKey);
      expect(r2.dispatcherId).not.toBe(r1.dispatcherId);
      expect(regenPool.getPoolStats().activeRequests).toBe(2);

      // 用第一代 dispatcherId 释放 —— 只关闭退役旧代，不应误减第二代
      regenPool.releaseAgent(r1.cacheKey, r1.dispatcherId);
      expect(regenPool.getPoolStats().activeRequests).toBe(1);
      const r3 = await regenPool.getAgent(params);
      expect(r3.dispatcherId).toBe(r2.dispatcherId);
      expect(regenPool.getPoolStats().activeRequests).toBe(2);

      // 第二代被两个请求持有，释放两次后归零
      regenPool.releaseAgent(r2.cacheKey, r2.dispatcherId);
      regenPool.releaseAgent(r3.cacheKey, r3.dispatcherId);
      expect(regenPool.getPoolStats().activeRequests).toBe(0);

      await regenPool.shutdown();
    });

    it("should refresh lastUsedAt on release", async () => {
      const shortTtlPool = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const { cacheKey, dispatcherId } = await shortTtlPool.getAgent(params);

      // Advance 800ms (close to TTL but not past)
      vi.advanceTimersByTime(800);

      // Release refreshes lastUsedAt
      shortTtlPool.releaseAgent(cacheKey, dispatcherId);

      // Advance another 500ms (total 1300ms from start, but only 500ms from release)
      vi.advanceTimersByTime(500);

      // Should NOT be evicted (TTL reset by release)
      const cleaned = await shortTtlPool.cleanup();
      expect(cleaned).toBe(0);

      await shortTtlPool.shutdown();
    });

    it("should retire after hard upper bound without destroying active requests", async () => {
      const pool2 = new AgentPoolImpl({
        ...defaultConfig,
        agentTtlMs: 1000,
        cleanupIntervalMs: 60 * 60 * 1000,
      });

      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      // getAgent increments activeRequests (never released)
      const r1 = await pool2.getAgent(params);
      const agent1 = r1.agent as unknown as {
        destroy?: () => Promise<void>;
      };
      const destroy1 = vi.fn().mockResolvedValue(undefined);
      agent1.destroy = destroy1;
      expect(pool2.getPoolStats().activeRequests).toBe(1);

      // Advance past 30-minute hard upper bound
      vi.advanceTimersByTime(31 * 60 * 1000);

      const cleaned = await pool2.cleanup();
      expect(cleaned).toBe(1);
      expect(pool2.getPoolStats().cacheSize).toBe(0);
      expect(pool2.getPoolStats().activeRequests).toBe(1);
      expect(destroy1).not.toHaveBeenCalled();

      pool2.releaseAgent(r1.cacheKey, r1.dispatcherId);
      expect(destroy1).toHaveBeenCalledTimes(1);
      expect(pool2.getPoolStats().activeRequests).toBe(0);

      await pool2.shutdown();
    });

    it("should force-close retired agents stuck active for more than 6 hours", async () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      const pool2 = new AgentPoolImpl({
        ...defaultConfig,
        cleanupIntervalMs: 60 * 60 * 1000,
      });

      try {
        const params = {
          endpointUrl: "https://api.anthropic.com/v1/messages",
          proxyUrl: null,
          enableHttp2: false,
        };

        const r1 = await pool2.getAgent(params);
        const agent1 = r1.agent as unknown as {
          destroy?: () => Promise<void>;
        };
        const destroy1 = vi.fn().mockResolvedValue(undefined);
        agent1.destroy = destroy1;

        pool2.markUnhealthy(r1.cacheKey, "stuck retired stream", r1.dispatcherId);
        expect(pool2.getPoolStats().cacheSize).toBe(0);
        expect(pool2.getPoolStats().activeRequests).toBe(1);
        expect(destroy1).not.toHaveBeenCalled();

        vi.advanceTimersByTime(6 * 60 * 60 * 1000 + 1);

        const cleaned = await pool2.cleanup();
        expect(cleaned).toBe(1);
        expect(pool2.getPoolStats().activeRequests).toBe(0);
        expect(destroy1).toHaveBeenCalledTimes(1);
        expect(warnSpy).toHaveBeenCalledWith(
          "AgentPool: Force closing long-retired active agent",
          expect.objectContaining({
            activeRequests: 1,
            cacheKey: r1.cacheKey,
            dispatcherId: r1.dispatcherId,
            retiredBy: "unhealthy",
            retiredForMs: 6 * 60 * 60 * 1000 + 1,
          })
        );
      } finally {
        warnSpy.mockRestore();
        await pool2.shutdown();
      }
    });

    it("should be a no-op when releasing non-existent key", () => {
      // Should not throw
      pool.releaseAgent("nonexistent-key", "disp-1");
      expect(pool.getPoolStats().activeRequests).toBe(0);
    });

    it("should not go below zero on over-release", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      const { cacheKey, dispatcherId } = await pool.getAgent(params);
      pool.releaseAgent(cacheKey, dispatcherId);
      // Release again when already at 0
      pool.releaseAgent(cacheKey, dispatcherId);

      expect(pool.getPoolStats().activeRequests).toBe(0);
    });

    it("should include activeRequests in pool stats", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };

      expect(pool.getPoolStats().activeRequests).toBe(0);

      await pool.getAgent(params);
      expect(pool.getPoolStats().activeRequests).toBe(1);

      await pool.getAgent(params);
      expect(pool.getPoolStats().activeRequests).toBe(2);

      const { cacheKey, dispatcherId } = await pool.getAgent(params);
      expect(pool.getPoolStats().activeRequests).toBe(3);

      pool.releaseAgent(cacheKey, dispatcherId);
      expect(pool.getPoolStats().activeRequests).toBe(2);
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

      // 说明：本文件顶部已 mock undici Agent/ProxyAgent，因此 destroy/close 应为 vi.fn，断言才有意义
      if (typeof agent.destroy === "function") {
        expect(vi.isMockFunction(agent.destroy)).toBe(true);
      }
      if (typeof agent.close === "function") {
        expect(vi.isMockFunction(agent.close)).toBe(true);
      }

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

    it("should close a dispatcher created after shutdown starts instead of caching it", async () => {
      const params = {
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: null,
        enableHttp2: false,
      };
      const lateAgent = {
        close: vi.fn().mockResolvedValue(undefined),
        destroy: vi.fn().mockResolvedValue(undefined),
      };
      let resolveCreate!: (agent: unknown) => void;
      const createPromise = new Promise<unknown>((resolve) => {
        resolveCreate = resolve;
      });
      const createSpy = vi.spyOn(pool as any, "createAgent");
      createSpy.mockImplementationOnce(() => createPromise);
      let getPromise: Promise<unknown> | null = null;

      try {
        getPromise = pool.getAgent(params);
        await Promise.resolve();
        expect(createSpy).toHaveBeenCalled();

        await pool.shutdown();
        expect(pool.getPoolStats().pendingCreations).toBe(0);

        resolveCreate(lateAgent);

        await expect(getPromise).rejects.toThrow("AgentPool is shutting down");
        expect(lateAgent.destroy).toHaveBeenCalledTimes(1);
        expect(lateAgent.close).not.toHaveBeenCalled();
        expect(pool.getPoolStats().cacheSize).toBe(0);
        expect(pool.getPoolStats().activeRequests).toBe(0);
      } finally {
        resolveCreate(lateAgent);
        await getPromise?.catch(() => undefined);
        createSpy.mockRestore();
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
