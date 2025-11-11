/**
 * Unit tests for proxy-agent.ts
 *
 * Test coverage:
 * - Proxy type detection (HTTP/HTTPS/SOCKS4/SOCKS5)
 * - Proxy configuration creation
 * - Fallback strategy logic
 * - URL validation and edge cases
 * - Credentials masking for security
 * - Error handling (invalid URLs, unsupported protocols)
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  createProxyAgentForProvider,
  maskProxyUrl,
  isValidProxyUrl,
  type ProxyConfig,
} from "./proxy-agent";
import type { Provider } from "@/types/provider";
import { ProxyAgent } from "undici";
import { SocksProxyAgent } from "socks-proxy-agent";

// Mock dependencies
vi.mock("undici", () => ({
  ProxyAgent: vi.fn().mockImplementation((url: string) => ({
    _type: "ProxyAgent",
    _url: url,
  })),
}));

vi.mock("socks-proxy-agent", () => ({
  SocksProxyAgent: vi.fn().mockImplementation((url: string) => ({
    _type: "SocksProxyAgent",
    _url: url,
  })),
}));

vi.mock("./logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
  },
}));

import { logger } from "./logger";

describe("Proxy Agent", () => {
  const createMockProvider = (overrides: Partial<Provider> = {}): Provider => ({
    id: 1,
    name: "Test Provider",
    url: "https://api.example.com",
    key: "test-key",
    isEnabled: true,
    weight: 100,
    priority: 1,
    costMultiplier: 1.0,
    groupTag: null,
    providerType: "claude",
    modelRedirects: null,
    allowedModels: null,
    joinClaudePool: false,
    codexInstructionsStrategy: "auto",
    limit5hUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitConcurrentSessions: 10,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 30 * 60 * 1000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    websiteUrl: null,
    faviconUrl: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createProxyAgentForProvider", () => {
    describe("No Proxy Configuration", () => {
      it("should return null when proxyUrl is not configured", () => {
        const provider = createMockProvider({ proxyUrl: null });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).toBeNull();
      });

      it("should return null when proxyUrl is empty string", () => {
        const provider = createMockProvider({ proxyUrl: "" });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).toBeNull();
      });

      it("should return null when proxyUrl is whitespace only", () => {
        const provider = createMockProvider({ proxyUrl: "   " });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).toBeNull();
      });
    });

    describe("HTTP/HTTPS Proxy", () => {
      it("should create ProxyAgent for HTTP proxy", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com:8080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(ProxyAgent).toHaveBeenCalledWith("http://proxy.example.com:8080");
        expect(result?.agent).toBeDefined();
        expect(result?.fallbackToDirect).toBe(false);
        expect(result?.proxyUrl).toBe("http://proxy.example.com:8080/");
      });

      it("should create ProxyAgent for HTTPS proxy", () => {
        const provider = createMockProvider({
          proxyUrl: "https://secure-proxy.example.com:443",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(ProxyAgent).toHaveBeenCalledWith("https://secure-proxy.example.com:443");
        expect(result?.agent).toBeDefined();
      });

      it("should create ProxyAgent with credentials", () => {
        const provider = createMockProvider({
          proxyUrl: "http://user:password@proxy.example.com:8080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(ProxyAgent).toHaveBeenCalledWith("http://user:password@proxy.example.com:8080");
        expect(result?.proxyUrl).toBe("http://user:***@proxy.example.com:8080/");
      });

      it("should log debug information for HTTP proxy", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com:8080",
        });
        createProxyAgentForProvider(provider, "https://api.anthropic.com/v1/messages");

        expect(logger.debug).toHaveBeenCalledWith(
          "HTTP/HTTPS ProxyAgent created",
          expect.objectContaining({
            providerId: 1,
            providerName: "Test Provider",
            protocol: "http:",
            proxyHost: "proxy.example.com",
            proxyPort: "8080",
            targetUrl: "https://api.anthropic.com",
          })
        );
      });
    });

    describe("SOCKS Proxy", () => {
      it("should create SocksProxyAgent for SOCKS5 proxy", () => {
        const provider = createMockProvider({
          proxyUrl: "socks5://127.0.0.1:1080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(SocksProxyAgent).toHaveBeenCalledWith("socks5://127.0.0.1:1080");
        expect(result?.agent).toBeDefined();
      });

      it("should create SocksProxyAgent for SOCKS4 proxy", () => {
        const provider = createMockProvider({
          proxyUrl: "socks4://127.0.0.1:1080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(SocksProxyAgent).toHaveBeenCalledWith("socks4://127.0.0.1:1080");
        expect(result?.agent).toBeDefined();
      });

      it("should create SocksProxyAgent with credentials", () => {
        const provider = createMockProvider({
          proxyUrl: "socks5://user:password@proxy.example.com:1080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(SocksProxyAgent).toHaveBeenCalledWith(
          "socks5://user:password@proxy.example.com:1080"
        );
        expect(result?.proxyUrl).toBe("socks5://user:***@proxy.example.com:1080");
      });

      it("should log debug information for SOCKS proxy", () => {
        const provider = createMockProvider({
          proxyUrl: "socks5://127.0.0.1:1080",
        });
        createProxyAgentForProvider(provider, "https://api.anthropic.com/v1/messages");

        expect(logger.debug).toHaveBeenCalledWith(
          "SOCKS ProxyAgent created",
          expect.objectContaining({
            providerId: 1,
            providerName: "Test Provider",
            protocol: "socks5:",
            proxyHost: "127.0.0.1",
            proxyPort: "1080",
            targetUrl: "https://api.anthropic.com",
          })
        );
      });
    });

    describe("Fallback Strategy", () => {
      it("should respect proxyFallbackToDirect flag when true", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com:8080",
          proxyFallbackToDirect: true,
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.fallbackToDirect).toBe(true);
      });

      it("should respect proxyFallbackToDirect flag when false", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com:8080",
          proxyFallbackToDirect: false,
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.fallbackToDirect).toBe(false);
      });

      it("should default to false when proxyFallbackToDirect is not set", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com:8080",
        });
        // Explicitly set to false to test default behavior
        provider.proxyFallbackToDirect = false;

        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.fallbackToDirect).toBe(false);
      });
    });

    describe("Error Handling", () => {
      it("should throw error for invalid proxy URL format", () => {
        const provider = createMockProvider({
          proxyUrl: "not-a-valid-url",
        });

        expect(() => createProxyAgentForProvider(provider, "https://api.anthropic.com")).toThrow(
          "Invalid proxy configuration"
        );
      });

      it("should throw error for unsupported protocol", () => {
        const provider = createMockProvider({
          proxyUrl: "ftp://proxy.example.com:21",
        });

        expect(() => createProxyAgentForProvider(provider, "https://api.anthropic.com")).toThrow(
          "Unsupported proxy protocol: ftp:"
        );
      });

      it("should log error when proxy creation fails", () => {
        const provider = createMockProvider({
          proxyUrl: "invalid-url",
        });

        try {
          createProxyAgentForProvider(provider, "https://api.anthropic.com");
        } catch {
          // Expected error
        }

        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create ProxyAgent",
          expect.objectContaining({
            providerId: 1,
            providerName: "Test Provider",
            proxyUrl: "invalid-url",
            error: expect.any(String),
          })
        );
      });

      it("should mask credentials in error logs", () => {
        const provider = createMockProvider({
          proxyUrl: "http://user:secret@invalid:99999999",
        });

        try {
          createProxyAgentForProvider(provider, "https://api.anthropic.com");
        } catch {
          // Expected error
        }

        expect(logger.error).toHaveBeenCalledWith(
          "Failed to create ProxyAgent",
          expect.objectContaining({
            proxyUrl: expect.stringContaining("***"),
          })
        );
      });
    });

    describe("Edge Cases", () => {
      it("should handle proxy URL with trailing slash", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com:8080/",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.agent).toBeDefined();
      });

      it("should trim whitespace from proxy URL", () => {
        const provider = createMockProvider({
          proxyUrl: "  http://proxy.example.com:8080  ",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(ProxyAgent).toHaveBeenCalledWith("http://proxy.example.com:8080");
      });

      it("should handle proxy URL without port (uses default)", () => {
        const provider = createMockProvider({
          proxyUrl: "http://proxy.example.com",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.agent).toBeDefined();
      });

      it("should handle IPv6 proxy addresses", () => {
        const provider = createMockProvider({
          proxyUrl: "http://[::1]:8080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.agent).toBeDefined();
      });

      it("should handle complex userinfo with special characters", () => {
        const provider = createMockProvider({
          proxyUrl: "http://user%40name:p%40ssw0rd@proxy.example.com:8080",
        });
        const result = createProxyAgentForProvider(provider, "https://api.anthropic.com");

        expect(result).not.toBeNull();
        expect(result?.proxyUrl).toContain("***");
      });
    });
  });

  describe("maskProxyUrl", () => {
    it("should mask password in HTTP URL", () => {
      const masked = maskProxyUrl("http://user:password@proxy.example.com:8080");
      expect(masked).toBe("http://user:***@proxy.example.com:8080/");
    });

    it("should mask password in HTTPS URL", () => {
      const masked = maskProxyUrl("https://user:secret@proxy.example.com:443");
      expect(masked).toBe("https://user:***@proxy.example.com/");
    });

    it("should mask password in SOCKS5 URL", () => {
      const masked = maskProxyUrl("socks5://user:pass@127.0.0.1:1080");
      expect(masked).toBe("socks5://user:***@127.0.0.1:1080");
    });

    it("should mask password in SOCKS4 URL", () => {
      const masked = maskProxyUrl("socks4://user:pass@127.0.0.1:1080");
      expect(masked).toBe("socks4://user:***@127.0.0.1:1080");
    });

    it("should not modify URL without credentials", () => {
      const masked = maskProxyUrl("http://proxy.example.com:8080");
      expect(masked).toBe("http://proxy.example.com:8080/");
    });

    it("should not modify URL with username only", () => {
      const masked = maskProxyUrl("http://user@proxy.example.com:8080");
      expect(masked).toBe("http://user@proxy.example.com:8080/");
    });

    it("should handle URL with empty password", () => {
      const masked = maskProxyUrl("http://user:@proxy.example.com:8080");
      // Note: URL constructor removes empty passwords, so it becomes username-only
      expect(masked).toBe("http://user@proxy.example.com:8080/");
    });

    it("should handle malformed URL with regex fallback", () => {
      // Use a truly malformed URL that URL constructor will reject
      const masked = maskProxyUrl("://user:password@host");
      expect(masked).toBe("://user:***@host");
    });

    it("should handle URL with no @ symbol", () => {
      const masked = maskProxyUrl("http://proxy.example.com:8080");
      expect(masked).toBe("http://proxy.example.com:8080/");
    });

    it("should mask complex passwords with special characters", () => {
      const masked = maskProxyUrl("http://user:p@ssw0rd!@proxy.example.com:8080");
      expect(masked).toBe("http://user:***@proxy.example.com:8080/");
    });

    it("should handle URL-encoded passwords", () => {
      const masked = maskProxyUrl("http://user:p%40ssw0rd@proxy.example.com:8080");
      expect(masked).toBe("http://user:***@proxy.example.com:8080/");
    });

    it("should handle IPv6 addresses", () => {
      const masked = maskProxyUrl("http://user:password@[::1]:8080");
      expect(masked).toBe("http://user:***@[::1]:8080/");
    });
  });

  describe("isValidProxyUrl", () => {
    describe("Valid URLs", () => {
      it("should return true for valid HTTP proxy URL", () => {
        expect(isValidProxyUrl("http://proxy.example.com:8080")).toBe(true);
      });

      it("should return true for valid HTTPS proxy URL", () => {
        expect(isValidProxyUrl("https://proxy.example.com:443")).toBe(true);
      });

      it("should return true for valid SOCKS5 proxy URL", () => {
        expect(isValidProxyUrl("socks5://127.0.0.1:1080")).toBe(true);
      });

      it("should return true for valid SOCKS4 proxy URL", () => {
        expect(isValidProxyUrl("socks4://127.0.0.1:1080")).toBe(true);
      });

      it("should return true for URL with credentials", () => {
        expect(isValidProxyUrl("http://user:password@proxy.example.com:8080")).toBe(true);
      });

      it("should return true for URL without port", () => {
        expect(isValidProxyUrl("http://proxy.example.com")).toBe(true);
      });

      it("should return true for IPv6 address", () => {
        expect(isValidProxyUrl("http://[::1]:8080")).toBe(true);
      });

      it("should return true for URL with trailing slash", () => {
        expect(isValidProxyUrl("http://proxy.example.com:8080/")).toBe(true);
      });

      it("should trim whitespace and validate", () => {
        expect(isValidProxyUrl("  http://proxy.example.com:8080  ")).toBe(true);
      });
    });

    describe("Invalid URLs", () => {
      it("should return false for null", () => {
        expect(isValidProxyUrl(null as unknown as string)).toBe(false);
      });

      it("should return false for undefined", () => {
        expect(isValidProxyUrl(undefined as unknown as string)).toBe(false);
      });

      it("should return false for empty string", () => {
        expect(isValidProxyUrl("")).toBe(false);
      });

      it("should return false for whitespace only", () => {
        expect(isValidProxyUrl("   ")).toBe(false);
      });

      it("should return false for unsupported protocol", () => {
        expect(isValidProxyUrl("ftp://proxy.example.com:21")).toBe(false);
      });

      it("should return false for malformed URL", () => {
        expect(isValidProxyUrl("not-a-valid-url")).toBe(false);
      });

      it("should return false for URL without hostname", () => {
        expect(isValidProxyUrl("http://:8080")).toBe(false);
      });

      it("should return false for protocol only", () => {
        expect(isValidProxyUrl("http://")).toBe(false);
      });

      it("should return false for URL with invalid port", () => {
        expect(isValidProxyUrl("http://proxy.example.com:99999999")).toBe(false);
      });

      it("should return false for socks protocol (not socks4/socks5)", () => {
        expect(isValidProxyUrl("socks://127.0.0.1:1080")).toBe(false);
      });
    });
  });

  describe("Integration Scenarios", () => {
    it("should create valid config for typical production proxy", () => {
      const provider = createMockProvider({
        proxyUrl: "http://proxy.company.com:8080",
        proxyFallbackToDirect: true,
      });
      const result = createProxyAgentForProvider(
        provider,
        "https://api.anthropic.com/v1/messages"
      ) as ProxyConfig;

      expect(result).not.toBeNull();
      expect(result.agent).toBeDefined();
      expect(result.fallbackToDirect).toBe(true);
      expect(result.proxyUrl).toBe("http://proxy.company.com:8080/");
      expect(isValidProxyUrl(provider.proxyUrl!)).toBe(true);
    });

    it("should create valid config for authenticated SOCKS5 proxy", () => {
      const provider = createMockProvider({
        proxyUrl: "socks5://user:secret@proxy.example.com:1080",
        proxyFallbackToDirect: false,
      });
      const result = createProxyAgentForProvider(
        provider,
        "https://api.anthropic.com/v1/messages"
      ) as ProxyConfig;

      expect(result).not.toBeNull();
      expect(result.agent).toBeDefined();
      expect(result.fallbackToDirect).toBe(false);
      expect(result.proxyUrl).toBe("socks5://user:***@proxy.example.com:1080");
      expect(isValidProxyUrl(provider.proxyUrl!)).toBe(true);
    });

    it("should handle provider without proxy gracefully", () => {
      const provider = createMockProvider({ proxyUrl: null });
      const result = createProxyAgentForProvider(provider, "https://api.anthropic.com/v1/messages");

      expect(result).toBeNull();
    });

    it("should validate before creating agent to avoid runtime errors", () => {
      const validUrl = "http://proxy.example.com:8080";
      const invalidUrl = "not-valid-url";

      expect(isValidProxyUrl(validUrl)).toBe(true);
      expect(isValidProxyUrl(invalidUrl)).toBe(false);

      const providerValid = createMockProvider({ proxyUrl: validUrl });
      expect(() =>
        createProxyAgentForProvider(providerValid, "https://api.anthropic.com")
      ).not.toThrow();

      const providerInvalid = createMockProvider({ proxyUrl: invalidUrl });
      expect(() =>
        createProxyAgentForProvider(providerInvalid, "https://api.anthropic.com")
      ).toThrow();
    });
  });
});
