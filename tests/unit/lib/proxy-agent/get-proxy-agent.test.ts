/**
 * getProxyAgentForProvider Tests
 *
 * TDD: Tests written first, implementation follows
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";

// Create mock objects outside the mock factory
const mockAgent = {
  close: vi.fn().mockResolvedValue(undefined),
  destroy: vi.fn().mockResolvedValue(undefined),
};

const mockPool = {
  getAgent: vi.fn().mockResolvedValue({
    agent: mockAgent,
    isNew: true,
    cacheKey: "https://api.anthropic.com|direct|h1",
  }),
  markUnhealthy: vi.fn(),
  evictEndpoint: vi.fn().mockResolvedValue(undefined),
  getPoolStats: vi.fn().mockReturnValue({
    cacheSize: 1,
    totalRequests: 1,
    cacheHits: 0,
    cacheMisses: 1,
    hitRate: 0,
    unhealthyAgents: 0,
    evictedAgents: 0,
  }),
  cleanup: vi.fn().mockResolvedValue(0),
  shutdown: vi.fn().mockResolvedValue(undefined),
};

// Mock the agent pool module
vi.mock("@/lib/proxy-agent/agent-pool", () => ({
  getGlobalAgentPool: vi.fn(() => mockPool),
  resetGlobalAgentPool: vi.fn().mockResolvedValue(undefined),
  generateAgentCacheKey: vi.fn().mockImplementation((params) => {
    const url = new URL(params.endpointUrl);
    const proxy = params.proxyUrl || "direct";
    const protocol = params.enableHttp2 ? "h2" : "h1";
    return `${url.origin}|${proxy}|${protocol}`;
  }),
  AgentPoolImpl: vi.fn(),
}));

// Import after mock setup
import { getProxyAgentForProvider, type ProxyConfigWithCacheKey } from "@/lib/proxy-agent";

describe("getProxyAgentForProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset default mock return value
    mockPool.getAgent.mockResolvedValue({
      agent: mockAgent,
      isNew: true,
      cacheKey: "https://api.anthropic.com|direct|h1",
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("direct connection (no proxy)", () => {
    it("should return null when provider has no proxy configured", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: null,
        proxyFallbackToDirect: false,
      };

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).toBeNull();
      expect(mockPool.getAgent).not.toHaveBeenCalled();
    });

    it("should return null when proxyUrl is empty string", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "",
        proxyFallbackToDirect: false,
      };

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).toBeNull();
    });

    it("should return null when proxyUrl is whitespace only", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "   ",
        proxyFallbackToDirect: false,
      };

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).toBeNull();
    });
  });

  describe("with proxy configured", () => {
    it("should return ProxyConfig with cacheKey for HTTP proxy", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "http://proxy.example.com:8080",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|http://proxy.example.com:8080|h1",
      });

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).not.toBeNull();
      expect(result?.cacheKey).toBe("https://api.anthropic.com|http://proxy.example.com:8080|h1");
      expect(result?.fallbackToDirect).toBe(false);
      expect(result?.http2Enabled).toBe(false);
      expect(mockPool.getAgent).toHaveBeenCalledWith({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: "http://proxy.example.com:8080",
        enableHttp2: false,
      });
    });

    it("should return ProxyConfig with HTTP/2 enabled", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "http://proxy.example.com:8080",
        proxyFallbackToDirect: true,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|http://proxy.example.com:8080|h2",
      });

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        true
      );

      expect(result).not.toBeNull();
      expect(result?.http2Enabled).toBe(true);
      expect(result?.fallbackToDirect).toBe(true);
      expect(mockPool.getAgent).toHaveBeenCalledWith({
        endpointUrl: "https://api.anthropic.com/v1/messages",
        proxyUrl: "http://proxy.example.com:8080",
        enableHttp2: true,
      });
    });

    it("should handle SOCKS proxy", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "socks5://proxy.example.com:1080",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|socks5://proxy.example.com:1080|h1",
      });

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).not.toBeNull();
      expect(result?.cacheKey).toContain("socks5://");
    });

    it("should disable HTTP/2 for SOCKS proxy even when requested", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "socks5://proxy.example.com:1080",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|socks5://proxy.example.com:1080|h1",
      });

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        true // Request HTTP/2
      );

      expect(result).not.toBeNull();
      expect(result?.http2Enabled).toBe(false); // Should be false for SOCKS
    });

    it("should mask proxy URL in result", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "http://user:password@proxy.example.com:8080",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|http://user:password@proxy.example.com:8080|h1",
      });

      const result = await getProxyAgentForProvider(
        provider as Provider,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).not.toBeNull();
      // proxyUrl should be masked (password hidden)
      expect(result?.proxyUrl).not.toContain("password");
      expect(result?.proxyUrl).toContain("***");
    });
  });

  describe("ProviderProxyConfig interface", () => {
    it("should work with minimal ProviderProxyConfig", async () => {
      const config = {
        id: 1,
        proxyUrl: "http://proxy.example.com:8080",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|http://proxy.example.com:8080|h1",
      });

      const result = await getProxyAgentForProvider(
        config,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).not.toBeNull();
      expect(result?.cacheKey).toBeDefined();
    });

    it("should work with optional name field", async () => {
      const config = {
        id: 1,
        name: "My Proxy",
        proxyUrl: "http://proxy.example.com:8080",
        proxyFallbackToDirect: true,
      };

      mockPool.getAgent.mockResolvedValueOnce({
        agent: mockAgent,
        isNew: true,
        cacheKey: "https://api.anthropic.com|http://proxy.example.com:8080|h1",
      });

      const result = await getProxyAgentForProvider(
        config,
        "https://api.anthropic.com/v1/messages",
        false
      );

      expect(result).not.toBeNull();
      expect(result?.fallbackToDirect).toBe(true);
    });
  });

  describe("error handling", () => {
    it("should throw on invalid proxy URL", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "not-a-valid-url",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockRejectedValueOnce(new Error("Invalid URL"));

      await expect(
        getProxyAgentForProvider(
          provider as Provider,
          "https://api.anthropic.com/v1/messages",
          false
        )
      ).rejects.toThrow();
    });

    it("should throw on unsupported proxy protocol", async () => {
      const provider: Partial<Provider> = {
        id: 1,
        name: "Test Provider",
        proxyUrl: "ftp://proxy.example.com:21",
        proxyFallbackToDirect: false,
      };

      mockPool.getAgent.mockRejectedValueOnce(new Error("Unsupported proxy protocol"));

      await expect(
        getProxyAgentForProvider(
          provider as Provider,
          "https://api.anthropic.com/v1/messages",
          false
        )
      ).rejects.toThrow();
    });
  });
});
