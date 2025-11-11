import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import type { ActionResult } from "./types";
import {
  getProviders,
  addProvider,
  editProvider,
  removeProvider,
  getProvidersHealthStatus,
  resetProviderCircuit,
  getProviderLimitUsage,
  testProviderProxy,
  getUnmaskedProviderKey,
} from "./providers";
import * as providerRepository from "@/repository/provider";

// Mock logger to avoid console noise
vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    fatal: vi.fn(),
  },
}));

// Mock database
let mockDb: ReturnType<typeof drizzle>;
let client: PGlite;

vi.mock("@/drizzle/db", () => ({
  get db() {
    return mockDb;
  },
}));

// Mock env config
vi.mock("@/lib/config", () => ({
  getEnvConfig: () => ({
    TZ: "Asia/Shanghai",
  }),
}));

// Mock Next.js cache
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

// Mock auth
const mockSession = {
  user: { id: 1, role: "admin" as const },
};

vi.mock("@/lib/auth", () => ({
  getSession: vi.fn(),
}));

// Mock circuit breaker
vi.mock("@/lib/circuit-breaker", () => ({
  getAllHealthStatus: vi.fn(() => ({})),
  resetCircuit: vi.fn(),
  clearConfigCache: vi.fn(),
}));

// Mock Redis circuit breaker config
vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  saveProviderCircuitConfig: vi.fn(),
  deleteProviderCircuitConfig: vi.fn(),
}));

// Mock proxy agent
vi.mock("@/lib/proxy-agent", () => ({
  isValidProxyUrl: (url: string) => {
    if (!url) return false;
    return /^(http|https|socks4|socks5):\/\//i.test(url);
  },
  createProxyAgentForProvider: vi.fn(),
}));

// Mock Codex Instructions Cache
vi.mock("@/lib/codex-instructions-cache", () => ({
  CodexInstructionsCache: {
    clearByProvider: vi.fn(),
  },
}));

// Mock validation
vi.mock("@/lib/utils/validation", () => ({
  maskKey: (key: string) => {
    if (!key || key.length <= 8) return key;
    return key.slice(0, 4) + "****" + key.slice(-4);
  },
}));

// Mock proxy errors
vi.mock("@/app/v1/_lib/proxy/errors", () => ({
  isClientAbortError: (error: Error) => error.name === "AbortError",
}));

describe("Provider Server Actions", () => {
  beforeEach(async () => {
    // Reset all mocks
    vi.clearAllMocks();

    // Create in-memory PGlite database
    client = new PGlite();
    mockDb = drizzle(client);

    // Run migrations
    await migrate(mockDb, { migrationsFolder: "./drizzle" });

    // Setup default auth mock (admin user)
    const { getSession } = await import("@/lib/auth");
    vi.mocked(getSession).mockResolvedValue(mockSession);
  });

  afterEach(async () => {
    await client.close();
  });

  describe("getProviders", () => {
    it("should return empty array when not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getProviders();

      expect(result).toEqual([]);
    });

    it("should return empty array when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await getProviders();

      expect(result).toEqual([]);
    });

    it("should return providers with statistics for admin user", async () => {
      // Restore spies if any were set
      vi.restoreAllMocks();

      // Ensure session is admin
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(mockSession);

      // Create test provider
      await providerRepository.createProvider({
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key-12345678",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      const result = await getProviders();

      expect(result).toHaveLength(1);
      expect(result[0].name).toBe("Test Provider");
      expect(result[0].maskedKey).toBe("sk-t****5678");
      expect(result[0].todayTotalCostUsd).toBe("0");
      expect(result[0].todayCallCount).toBe(0);
      expect(result[0].lastCallTime).toBeNull();
    });

    it("should handle statistics fetch failure gracefully", async () => {
      // Create test provider
      await providerRepository.createProvider({
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      // Mock statistics to throw error
      vi.spyOn(providerRepository, "getProviderStatistics").mockRejectedValueOnce(
        new Error("Database error")
      );

      const result = await getProviders();

      // Should still return providers without statistics
      expect(result).toHaveLength(1);
      expect(result[0].todayTotalCostUsd).toBe("0");
      expect(result[0].todayCallCount).toBe(0);
    });

    it("should handle date conversion errors gracefully", async () => {
      const provider = await providerRepository.createProvider({
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      // Mock statistics with invalid date (non-string type that fails conversion)
      vi.spyOn(providerRepository, "getProviderStatistics").mockResolvedValueOnce([
        {
          id: provider.id,
          today_cost: "10.5",
          today_calls: 5,
          last_call_time: { invalid: "object" } as any, // Invalid object type
          last_call_model: "claude-opus-4",
        },
      ] as any);

      const result = await getProviders();

      // Should handle invalid date gracefully and return null
      expect(result).toHaveLength(1);
      expect(result[0].lastCallTime).toBeNull();
    });

    it("should return empty array on unexpected error", async () => {
      // Close the database to simulate an error
      await client.close();

      const result = await getProviders();

      expect(result).toEqual([]);

      // Recreate database for next tests
      client = new PGlite();
      mockDb = drizzle(client);
      await migrate(mockDb, { migrationsFolder: "./drizzle" });
    });
  });

  describe("addProvider", () => {
    it("should create provider with minimal required fields", async () => {
      const data = {
        name: "New Provider",
        url: "https://api.anthropic.com",
        key: "sk-new-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers).toHaveLength(1);
      expect(providers[0].name).toBe("New Provider");
    });

    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const data = {
        name: "New Provider",
        url: "https://api.anthropic.com",
        key: "sk-new-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const data = {
        name: "New Provider",
        url: "https://api.anthropic.com",
        key: "sk-new-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject invalid proxy URL format", async () => {
      const data = {
        name: "New Provider",
        url: "https://api.anthropic.com",
        key: "sk-new-key",
        proxy_url: "invalid-proxy-url",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("代理地址格式无效");
    });

    it("should create provider with all optional fields", async () => {
      const data = {
        name: "Full Provider",
        url: "https://api.example.com",
        key: "sk-full-key",
        is_enabled: false,
        weight: 5,
        priority: 10,
        cost_multiplier: 1.5,
        group_tag: "production",
        provider_type: "codex" as const,
        model_redirects: { "claude-opus-4": "gpt-4" },
        allowed_models: ["claude-opus-4"],
        join_claude_pool: true,
        codex_instructions_strategy: "force_official" as const,
        limit_5h_usd: 100,
        limit_weekly_usd: 500,
        limit_monthly_usd: 2000,
        limit_concurrent_sessions: 10,
        circuit_breaker_failure_threshold: 3,
        circuit_breaker_open_duration: 600000,
        circuit_breaker_half_open_success_threshold: 1,
        proxy_url: "http://proxy.example.com:8080",
        proxy_fallback_to_direct: true,
        website_url: "https://example.com",
        tpm: 1000000,
        rpm: 1000,
        rpd: 10000,
        cc: 50,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      const provider = providers[0];

      expect(provider.name).toBe("Full Provider");
      expect(provider.isEnabled).toBe(false);
      expect(provider.weight).toBe(5);
      expect(provider.priority).toBe(10);
      expect(provider.providerType).toBe("codex");
      expect(provider.limitConcurrentSessions).toBe(10);
    });

    it("should generate favicon URL from website URL", async () => {
      const data = {
        name: "Provider with Website",
        url: "https://api.example.com",
        key: "sk-test-key",
        website_url: "https://example.com",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].faviconUrl).toContain("google.com/s2/favicons");
      expect(providers[0].faviconUrl).toContain("example.com");
    });

    it("should sync circuit breaker config to Redis", async () => {
      const { saveProviderCircuitConfig } = await import(
        "@/lib/redis/circuit-breaker-config"
      );

      const data = {
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        circuit_breaker_failure_threshold: 10,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);
      expect(saveProviderCircuitConfig).toHaveBeenCalledWith(
        expect.any(Number),
        expect.objectContaining({
          failureThreshold: 10,
        })
      );
    });

    it("should handle Redis sync failure gracefully", async () => {
      const { saveProviderCircuitConfig } = await import(
        "@/lib/redis/circuit-breaker-config"
      );
      vi.mocked(saveProviderCircuitConfig).mockRejectedValueOnce(new Error("Redis error"));

      const data = {
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      // Should still succeed even if Redis sync fails
      expect(result.ok).toBe(true);
    });

    it("should handle validation errors", async () => {
      const data = {
        name: "", // Invalid: empty name
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should handle database errors", async () => {
      vi.spyOn(providerRepository, "createProvider").mockRejectedValueOnce(
        new Error("Database constraint violation")
      );

      const data = {
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Database constraint violation");
    });
  });

  describe("editProvider", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await providerRepository.createProvider({
        name: "Original Provider",
        url: "https://api.original.com",
        key: "sk-original",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });
      testProviderId = provider.id;
    });

    it("should update provider successfully", async () => {
      const result = await editProvider(testProviderId, {
        name: "Updated Provider",
      });

      expect(result.ok).toBe(true);

      const provider = await providerRepository.findProviderById(testProviderId);
      expect(provider?.name).toBe("Updated Provider");
    });

    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await editProvider(testProviderId, {
        name: "Updated",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await editProvider(testProviderId, {
        name: "Updated",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject invalid proxy URL format", async () => {
      const result = await editProvider(testProviderId, {
        proxy_url: "invalid-proxy",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("代理地址格式无效");
    });

    it("should update multiple fields", async () => {
      const result = await editProvider(testProviderId, {
        name: "Multi Update",
        weight: 10,
        priority: 5,
        is_enabled: false,
      });

      expect(result.ok).toBe(true);

      const provider = await providerRepository.findProviderById(testProviderId);
      expect(provider?.name).toBe("Multi Update");
      expect(provider?.weight).toBe(10);
      expect(provider?.priority).toBe(5);
      expect(provider?.isEnabled).toBe(false);
    });

    it("should regenerate favicon when website URL is updated", async () => {
      const result = await editProvider(testProviderId, {
        website_url: "https://newsite.com",
      });

      expect(result.ok).toBe(true);

      const provider = await providerRepository.findProviderById(testProviderId);
      expect(provider?.faviconUrl).toContain("newsite.com");
    });

    it("should clear favicon when website URL is removed", async () => {
      // First set a website URL
      await editProvider(testProviderId, {
        website_url: "https://example.com",
      });

      // Then clear it
      const result = await editProvider(testProviderId, {
        website_url: null,
      });

      expect(result.ok).toBe(true);

      const provider = await providerRepository.findProviderById(testProviderId);
      expect(provider?.faviconUrl).toBeNull();
    });

    it("should sync circuit breaker config to Redis when config changes", async () => {
      const { saveProviderCircuitConfig } = await import(
        "@/lib/redis/circuit-breaker-config"
      );
      const { clearConfigCache } = await import("@/lib/circuit-breaker");

      const result = await editProvider(testProviderId, {
        circuit_breaker_failure_threshold: 10,
      });

      expect(result.ok).toBe(true);
      expect(saveProviderCircuitConfig).toHaveBeenCalledWith(
        testProviderId,
        expect.objectContaining({
          failureThreshold: 10,
        })
      );
      expect(clearConfigCache).toHaveBeenCalledWith(testProviderId);
    });

    it("should clear Codex cache when strategy changes", async () => {
      const { CodexInstructionsCache } = await import("@/lib/codex-instructions-cache");

      const result = await editProvider(testProviderId, {
        codex_instructions_strategy: "force_official",
      });

      expect(result.ok).toBe(true);
      expect(CodexInstructionsCache.clearByProvider).toHaveBeenCalledWith(testProviderId);
    });

    it("should return error when provider not found", async () => {
      const result = await editProvider(99999, {
        name: "Updated",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("供应商不存在");
    });

    it("should handle validation errors", async () => {
      const result = await editProvider(testProviderId, {
        name: "", // Invalid: empty name
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });

    it("should handle database errors", async () => {
      vi.spyOn(providerRepository, "updateProvider").mockRejectedValueOnce(
        new Error("Database error")
      );

      const result = await editProvider(testProviderId, {
        name: "Updated",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Database error");
    });

    it("should handle Redis sync failure gracefully", async () => {
      const { saveProviderCircuitConfig } = await import(
        "@/lib/redis/circuit-breaker-config"
      );
      vi.mocked(saveProviderCircuitConfig).mockRejectedValueOnce(new Error("Redis error"));

      const result = await editProvider(testProviderId, {
        circuit_breaker_failure_threshold: 10,
      });

      // Should still succeed even if Redis sync fails
      expect(result.ok).toBe(true);
    });
  });

  describe("removeProvider", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await providerRepository.createProvider({
        name: "Test Provider",
        url: "https://api.test.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });
      testProviderId = provider.id;
    });

    it("should delete provider successfully", async () => {
      const result = await removeProvider(testProviderId);

      expect(result.ok).toBe(true);

      const provider = await providerRepository.findProviderById(testProviderId);
      expect(provider).toBeNull();
    });

    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await removeProvider(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await removeProvider(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should delete Redis cache after deletion", async () => {
      const { deleteProviderCircuitConfig } = await import(
        "@/lib/redis/circuit-breaker-config"
      );
      const { clearConfigCache } = await import("@/lib/circuit-breaker");

      const result = await removeProvider(testProviderId);

      expect(result.ok).toBe(true);
      expect(deleteProviderCircuitConfig).toHaveBeenCalledWith(testProviderId);
      expect(clearConfigCache).toHaveBeenCalledWith(testProviderId);
    });

    it("should handle Redis cache clear failure gracefully", async () => {
      const { deleteProviderCircuitConfig } = await import(
        "@/lib/redis/circuit-breaker-config"
      );
      vi.mocked(deleteProviderCircuitConfig).mockRejectedValueOnce(new Error("Redis error"));

      const result = await removeProvider(testProviderId);

      // Should still succeed even if cache clear fails
      expect(result.ok).toBe(true);
    });

    it("should handle database errors", async () => {
      vi.spyOn(providerRepository, "deleteProvider").mockRejectedValueOnce(
        new Error("Database error")
      );

      const result = await removeProvider(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Database error");
    });
  });

  describe("getProvidersHealthStatus", () => {
    it("should return empty object when not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getProvidersHealthStatus();

      expect(result).toEqual({});
    });

    it("should return empty object when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await getProvidersHealthStatus();

      expect(result).toEqual({});
    });

    it("should return health status for admin user", async () => {
      const { getAllHealthStatus } = await import("@/lib/circuit-breaker");
      vi.mocked(getAllHealthStatus).mockReturnValue({
        1: {
          circuitState: "closed",
          failureCount: 0,
          lastFailureTime: null,
          circuitOpenUntil: null,
        },
      });

      const result = await getProvidersHealthStatus();

      expect(result).toHaveProperty("1");
      expect(result[1].circuitState).toBe("closed");
      expect(result[1].failureCount).toBe(0);
      expect(result[1].recoveryMinutes).toBeNull();
    });

    it("should calculate recovery minutes for open circuits", async () => {
      const { getAllHealthStatus } = await import("@/lib/circuit-breaker");
      const futureTime = Date.now() + 300000; // 5 minutes from now

      vi.mocked(getAllHealthStatus).mockReturnValue({
        1: {
          circuitState: "open",
          failureCount: 5,
          lastFailureTime: Date.now(),
          circuitOpenUntil: futureTime,
        },
      });

      const result = await getProvidersHealthStatus();

      expect(result[1].circuitState).toBe("open");
      expect(result[1].recoveryMinutes).toBeGreaterThan(0);
      expect(result[1].recoveryMinutes).toBeLessThanOrEqual(5);
    });

    it("should handle errors gracefully", async () => {
      const { getAllHealthStatus } = await import("@/lib/circuit-breaker");
      vi.mocked(getAllHealthStatus).mockImplementation(() => {
        throw new Error("Circuit breaker error");
      });

      const result = await getProvidersHealthStatus();

      expect(result).toEqual({});
    });
  });

  describe("resetProviderCircuit", () => {
    it("should reset circuit successfully", async () => {
      const { resetCircuit } = await import("@/lib/circuit-breaker");

      const result = await resetProviderCircuit(1);

      expect(result.ok).toBe(true);
      expect(resetCircuit).toHaveBeenCalledWith(1);
    });

    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await resetProviderCircuit(1);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await resetProviderCircuit(1);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should handle errors", async () => {
      const { resetCircuit } = await import("@/lib/circuit-breaker");
      vi.mocked(resetCircuit).mockImplementation(() => {
        throw new Error("Reset error");
      });

      const result = await resetProviderCircuit(1);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("Reset error");
    });
  });

  describe("getProviderLimitUsage", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await providerRepository.createProvider({
        name: "Test Provider",
        url: "https://api.test.com",
        key: "sk-test-key",
        limit_5h_usd: 100,
        limit_weekly_usd: 500,
        limit_monthly_usd: 2000,
        limit_concurrent_sessions: 10,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });
      testProviderId = provider.id;
    });

    it("should return limit usage for admin user", async () => {
      // Mock dynamic imports
      const mockRateLimitService = {
        getCurrentCost: vi.fn().mockResolvedValue(0),
      };
      const mockSessionTracker = {
        getProviderSessionCount: vi.fn().mockResolvedValue(0),
      };
      const mockTimeUtils = {
        getResetInfo: vi.fn((period: string) => ({
          type: period === "5h" ? "rolling" : "calendar",
          period: period === "5h" ? "5小时" : undefined,
          resetAt: period !== "5h" ? new Date() : undefined,
        })),
      };

      vi.doMock("@/lib/rate-limit", () => ({
        RateLimitService: mockRateLimitService,
      }));
      vi.doMock("@/lib/session-tracker", () => ({
        SessionTracker: mockSessionTracker,
      }));
      vi.doMock("@/lib/rate-limit/time-utils", () => mockTimeUtils);

      const result = await getProviderLimitUsage(testProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.cost5h.current).toBe(0);
        expect(result.data.cost5h.limit).toBe(100);
        expect(result.data.costWeekly.limit).toBe(500);
        expect(result.data.costMonthly.limit).toBe(2000);
        expect(result.data.concurrentSessions.limit).toBe(10);
      }
    });

    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getProviderLimitUsage(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await getProviderLimitUsage(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should return error when provider not found", async () => {
      const result = await getProviderLimitUsage(99999);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("供应商不存在");
    });

    it("should handle errors", async () => {
      vi.spyOn(providerRepository, "findProviderById").mockRejectedValueOnce(
        new Error("Database error")
      );

      const result = await getProviderLimitUsage(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("testProviderProxy", () => {
    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      expect(result.ok).toBe(false);
      expect(result.error).toBe("无权限执行此操作");
    });

    it("should return error for invalid proxy URL format", async () => {
      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "invalid-proxy",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(false);
        expect(result.data.details?.errorType).toBe("InvalidProxyUrl");
      }
    });

    it("should handle successful connection test", async () => {
      // Mock successful fetch
      global.fetch = vi.fn().mockResolvedValue({
        status: 200,
      });

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(true);
        expect(result.data.details?.statusCode).toBe(200);
        expect(result.data.details?.usedProxy).toBe(false); // Mock doesn't create proxy agent
      }
    });

    it("should handle connection timeout", async () => {
      // Mock timeout error
      global.fetch = vi.fn().mockRejectedValue(
        Object.assign(new Error("Request timeout"), { name: "AbortError" })
      );

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(false);
        expect(result.data.details?.errorType).toBe("Timeout");
      }
    });

    it("should handle proxy connection error", async () => {
      // Mock proxy connection error
      global.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(false);
        expect(result.data.details?.errorType).toBe("ProxyError");
      }
    });

    it("should handle network error", async () => {
      // Mock network error
      global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(false);
        expect(result.data.details?.errorType).toBe("NetworkError");
      }
    });

    it("should handle unexpected errors", async () => {
      // Mock fetch to reject after proxy creation
      global.fetch = vi.fn().mockImplementation(() => {
        throw new Error("Unexpected fatal error");
      });

      const result = await testProviderProxy({
        providerUrl: "https://api.anthropic.com",
        proxyUrl: "http://proxy.example.com:8080",
      });

      // Since error is caught in inner try-catch, it returns success=false
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.success).toBe(false);
        expect(result.data.message).toContain("Unexpected fatal error");
      }
    });
  });

  describe("getUnmaskedProviderKey", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await providerRepository.createProvider({
        name: "Test Provider",
        url: "https://api.test.com",
        key: "sk-test-key-secret",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });
      testProviderId = provider.id;
    });

    it("should return unmasked key for admin user", async () => {
      const result = await getUnmaskedProviderKey(testProviderId);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data.key).toBe("sk-test-key-secret");
      }
    });

    it("should reject when user is not authenticated", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue(null);

      const result = await getUnmaskedProviderKey(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("权限不足");
    });

    it("should reject when user is not admin", async () => {
      const { getSession } = await import("@/lib/auth");
      vi.mocked(getSession).mockResolvedValue({
        user: { id: 1, role: "user" as const },
      });

      const result = await getUnmaskedProviderKey(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toContain("权限不足");
    });

    it("should return error when provider not found", async () => {
      const result = await getUnmaskedProviderKey(99999);

      expect(result.ok).toBe(false);
      expect(result.error).toBe("供应商不存在");
    });

    it("should handle database errors", async () => {
      vi.spyOn(providerRepository, "findProviderById").mockRejectedValueOnce(
        new Error("Database error")
      );

      const result = await getUnmaskedProviderKey(testProviderId);

      expect(result.ok).toBe(false);
      expect(result.error).toBeTruthy();
    });
  });

  describe("Edge Cases", () => {
    it("should handle provider with null optional fields", async () => {
      const data = {
        name: "Minimal Provider",
        url: "https://api.test.com",
        key: "sk-test",
        group_tag: null,
        limit_5h_usd: null,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
        limit_concurrent_sessions: null,
        proxy_url: null,
        website_url: null,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].groupTag).toBeNull();
      expect(providers[0].limit5hUsd).toBeNull();
    });

    it("should handle provider with empty model redirects", async () => {
      const data = {
        name: "No Redirects Provider",
        url: "https://api.test.com",
        key: "sk-test",
        model_redirects: {},
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].modelRedirects).toEqual({});
    });

    it("should handle provider with empty allowed models", async () => {
      const data = {
        name: "No Models Provider",
        url: "https://api.test.com",
        key: "sk-test",
        allowed_models: [],
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].allowedModels).toEqual([]);
    });

    it("should handle very long provider name", async () => {
      const longName = "A".repeat(64);
      const data = {
        name: longName,
        url: "https://api.test.com",
        key: "sk-test",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].name).toBe(longName);
    });

    it("should handle special characters in provider name", async () => {
      const data = {
        name: "Provider 特殊字符 & Special",
        url: "https://api.test.com",
        key: "sk-test",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].name).toBe("Provider 特殊字符 & Special");
    });

    it("should handle different proxy URL protocols", async () => {
      const protocols = [
        "http://proxy.example.com:8080",
        "https://proxy.example.com:8080",
        "socks5://proxy.example.com:1080",
        "socks4://127.0.0.1:1080",
      ];

      for (const proxyUrl of protocols) {
        const data = {
          name: `Provider ${proxyUrl.split(":")[0]}`,
          url: "https://api.test.com",
          key: `sk-${proxyUrl.split(":")[0]}`,
          proxy_url: proxyUrl,
          tpm: null,
          rpm: null,
          rpd: null,
          cc: null,
        };

        const result = await addProvider(data);
        expect(result.ok).toBe(true);
      }
    });

    it("should handle zero values for numeric fields", async () => {
      const data = {
        name: "Zero Values Provider",
        url: "https://api.test.com",
        key: "sk-test",
        weight: 1, // Weight min is 1
        priority: 0,
        cost_multiplier: 0,
        limit_concurrent_sessions: 0,
        tpm: 0,
        rpm: 0,
        rpd: 0,
        cc: 0,
      };

      const result = await addProvider(data);

      expect(result.ok).toBe(true);

      const providers = await providerRepository.findProviderList();
      expect(providers[0].weight).toBe(1);
      expect(providers[0].priority).toBe(0);
      expect(providers[0].costMultiplier).toBe(0);
    });
  });
});
