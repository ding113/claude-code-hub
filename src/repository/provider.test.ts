import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { providers } from "@/drizzle/schema";
import type { CreateProviderData, UpdateProviderData } from "@/types/provider";
import {
  createProvider,
  findProviderList,
  findProviderById,
  updateProvider,
  deleteProvider,
  getProviderStatistics,
} from "./provider";

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

// Mock db module
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

describe("Provider Repository", () => {
  beforeEach(async () => {
    // Create in-memory PGlite database
    client = new PGlite();
    mockDb = drizzle(client);

    // Run migrations
    await migrate(mockDb, { migrationsFolder: "./drizzle" });
  });

  afterEach(async () => {
    await client.close();
  });

  describe("createProvider", () => {
    it("should create a provider with minimal required fields", async () => {
      const providerData: CreateProviderData = {
        name: "Test Provider",
        url: "https://api.anthropic.com",
        key: "sk-test-key",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const provider = await createProvider(providerData);

      expect(provider).toBeDefined();
      expect(provider.id).toBeGreaterThan(0);
      expect(provider.name).toBe("Test Provider");
      expect(provider.url).toBe("https://api.anthropic.com");
      expect(provider.key).toBe("sk-test-key");
      expect(provider.isEnabled).toBe(true);
      expect(provider.weight).toBe(1);
      expect(provider.priority).toBe(0);
      expect(provider.costMultiplier).toBe(1.0);
      expect(provider.providerType).toBe("claude");
      expect(provider.joinClaudePool).toBe(false);
      expect(provider.codexInstructionsStrategy).toBe("auto");
      expect(provider.circuitBreakerFailureThreshold).toBe(5);
      expect(provider.circuitBreakerOpenDuration).toBe(1800000);
      expect(provider.circuitBreakerHalfOpenSuccessThreshold).toBe(2);
    });

    it("should create a provider with all optional fields", async () => {
      const providerData: CreateProviderData = {
        name: "Full Provider",
        url: "https://api.example.com",
        key: "sk-full-key",
        is_enabled: false,
        weight: 5,
        priority: 10,
        cost_multiplier: 1.5,
        group_tag: "production",
        provider_type: "codex",
        model_redirects: { "claude-opus-4": "gpt-4" },
        allowed_models: ["claude-opus-4", "claude-sonnet-4"],
        join_claude_pool: true,
        codex_instructions_strategy: "force_official",
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
        favicon_url: "https://example.com/favicon.ico",
        tpm: 1000000,
        rpm: 1000,
        rpd: 10000,
        cc: 50,
      };

      const provider = await createProvider(providerData);

      expect(provider).toBeDefined();
      expect(provider.name).toBe("Full Provider");
      expect(provider.isEnabled).toBe(false);
      expect(provider.weight).toBe(5);
      expect(provider.priority).toBe(10);
      expect(provider.costMultiplier).toBe(1.5);
      expect(provider.groupTag).toBe("production");
      expect(provider.providerType).toBe("codex");
      expect(provider.modelRedirects).toEqual({ "claude-opus-4": "gpt-4" });
      expect(provider.allowedModels).toEqual(["claude-opus-4", "claude-sonnet-4"]);
      expect(provider.joinClaudePool).toBe(true);
      expect(provider.codexInstructionsStrategy).toBe("force_official");
      expect(provider.limit5hUsd).toBe(100);
      expect(provider.limitWeeklyUsd).toBe(500);
      expect(provider.limitMonthlyUsd).toBe(2000);
      expect(provider.limitConcurrentSessions).toBe(10);
      expect(provider.circuitBreakerFailureThreshold).toBe(3);
      expect(provider.circuitBreakerOpenDuration).toBe(600000);
      expect(provider.circuitBreakerHalfOpenSuccessThreshold).toBe(1);
      expect(provider.proxyUrl).toBe("http://proxy.example.com:8080");
      expect(provider.proxyFallbackToDirect).toBe(true);
      expect(provider.websiteUrl).toBe("https://example.com");
      expect(provider.faviconUrl).toBe("https://example.com/favicon.ico");
      expect(provider.tpm).toBe(1000000);
      expect(provider.rpm).toBe(1000);
      expect(provider.rpd).toBe(10000);
      expect(provider.cc).toBe(50);
    });

    it("should handle null cost_multiplier correctly", async () => {
      const providerData: CreateProviderData = {
        name: "Null Cost Provider",
        url: "https://api.test.com",
        key: "sk-null-cost",
        cost_multiplier: null as unknown as number,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const provider = await createProvider(providerData);

      expect(provider.costMultiplier).toBe(1.0);
    });

    it("should handle different provider types", async () => {
      const types: Array<"claude" | "claude-auth" | "codex" | "gemini-cli" | "openai-compatible"> =
        ["claude", "claude-auth", "codex", "gemini-cli", "openai-compatible"];

      for (const type of types) {
        const providerData: CreateProviderData = {
          name: `${type} Provider`,
          url: "https://api.test.com",
          key: `sk-${type}`,
          provider_type: type,
          tpm: null,
          rpm: null,
          rpd: null,
          cc: null,
        };

        const provider = await createProvider(providerData);
        expect(provider.providerType).toBe(type);
      }
    });

    it("should handle null limit fields", async () => {
      const providerData: CreateProviderData = {
        name: "No Limits Provider",
        url: "https://api.test.com",
        key: "sk-no-limits",
        limit_5h_usd: null,
        limit_weekly_usd: null,
        limit_monthly_usd: null,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      };

      const provider = await createProvider(providerData);

      expect(provider.limit5hUsd).toBeNull();
      expect(provider.limitWeeklyUsd).toBeNull();
      expect(provider.limitMonthlyUsd).toBeNull();
    });
  });

  describe("findProviderList", () => {
    beforeEach(async () => {
      // Create test providers
      for (let i = 1; i <= 10; i++) {
        await createProvider({
          name: `Provider ${i}`,
          url: `https://api${i}.test.com`,
          key: `sk-test-${i}`,
          weight: i,
          priority: i % 3,
          tpm: null,
          rpm: null,
          rpd: null,
          cc: null,
        });
      }
    });

    it("should return all providers with default limit", async () => {
      const providers = await findProviderList();

      expect(providers).toHaveLength(10);
      expect(providers[0].name).toBe("Provider 10"); // Latest first
    });

    it("should respect limit parameter", async () => {
      const providers = await findProviderList(5);

      expect(providers).toHaveLength(5);
    });

    it("should respect offset parameter", async () => {
      const providers = await findProviderList(5, 5);

      expect(providers).toHaveLength(5);
      expect(providers[0].name).toBe("Provider 5");
    });

    it("should not return deleted providers", async () => {
      // Delete first provider
      const allProviders = await findProviderList();
      await deleteProvider(allProviders[0].id);

      const activeProviders = await findProviderList();

      expect(activeProviders).toHaveLength(9);
    });

    it("should return providers ordered by created_at desc", async () => {
      const providers = await findProviderList();

      for (let i = 0; i < providers.length - 1; i++) {
        expect(providers[i].createdAt.getTime()).toBeGreaterThanOrEqual(
          providers[i + 1].createdAt.getTime()
        );
      }
    });
  });

  describe("findProviderById", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await createProvider({
        name: "Test Provider",
        url: "https://api.test.com",
        key: "sk-test-key",
        weight: 5,
        priority: 10,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });
      testProviderId = provider.id;
    });

    it("should find provider by id", async () => {
      const provider = await findProviderById(testProviderId);

      expect(provider).toBeDefined();
      expect(provider?.id).toBe(testProviderId);
      expect(provider?.name).toBe("Test Provider");
    });

    it("should return null for non-existent provider", async () => {
      const provider = await findProviderById(99999);

      expect(provider).toBeNull();
    });

    it("should return null for deleted provider", async () => {
      await deleteProvider(testProviderId);

      const provider = await findProviderById(testProviderId);

      expect(provider).toBeNull();
    });

    it("should return provider with all fields", async () => {
      const provider = await findProviderById(testProviderId);

      expect(provider).toBeDefined();
      expect(provider?.id).toBeDefined();
      expect(provider?.name).toBeDefined();
      expect(provider?.url).toBeDefined();
      expect(provider?.key).toBeDefined();
      expect(provider?.isEnabled).toBeDefined();
      expect(provider?.weight).toBeDefined();
      expect(provider?.priority).toBeDefined();
      expect(provider?.costMultiplier).toBeDefined();
      expect(provider?.createdAt).toBeInstanceOf(Date);
      expect(provider?.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe("updateProvider", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await createProvider({
        name: "Original Provider",
        url: "https://api.original.com",
        key: "sk-original",
        weight: 1,
        priority: 0,
        cost_multiplier: 1.0,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });
      testProviderId = provider.id;
    });

    it("should update provider name", async () => {
      const updateData: UpdateProviderData = {
        name: "Updated Provider",
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.name).toBe("Updated Provider");
      expect(provider?.url).toBe("https://api.original.com"); // Unchanged
    });

    it("should update multiple fields", async () => {
      const updateData: UpdateProviderData = {
        name: "Multi Update",
        weight: 10,
        priority: 5,
        cost_multiplier: 2.0,
        is_enabled: false,
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.name).toBe("Multi Update");
      expect(provider?.weight).toBe(10);
      expect(provider?.priority).toBe(5);
      expect(provider?.costMultiplier).toBe(2.0);
      expect(provider?.isEnabled).toBe(false);
    });

    it("should update provider type and related fields", async () => {
      const updateData: UpdateProviderData = {
        provider_type: "codex",
        codex_instructions_strategy: "keep_original",
        join_claude_pool: true,
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.providerType).toBe("codex");
      expect(provider?.codexInstructionsStrategy).toBe("keep_original");
      expect(provider?.joinClaudePool).toBe(true);
    });

    it("should update model configuration", async () => {
      const updateData: UpdateProviderData = {
        model_redirects: { "claude-opus-4": "gpt-4-turbo" },
        allowed_models: ["claude-opus-4", "claude-sonnet-4"],
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.modelRedirects).toEqual({ "claude-opus-4": "gpt-4-turbo" });
      expect(provider?.allowedModels).toEqual(["claude-opus-4", "claude-sonnet-4"]);
    });

    it("should update limit fields", async () => {
      const updateData: UpdateProviderData = {
        limit_5h_usd: 200,
        limit_weekly_usd: 1000,
        limit_monthly_usd: 4000,
        limit_concurrent_sessions: 20,
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.limit5hUsd).toBe(200);
      expect(provider?.limitWeeklyUsd).toBe(1000);
      expect(provider?.limitMonthlyUsd).toBe(4000);
      expect(provider?.limitConcurrentSessions).toBe(20);
    });

    it("should update circuit breaker configuration", async () => {
      const updateData: UpdateProviderData = {
        circuit_breaker_failure_threshold: 10,
        circuit_breaker_open_duration: 300000,
        circuit_breaker_half_open_success_threshold: 3,
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.circuitBreakerFailureThreshold).toBe(10);
      expect(provider?.circuitBreakerOpenDuration).toBe(300000);
      expect(provider?.circuitBreakerHalfOpenSuccessThreshold).toBe(3);
    });

    it("should update proxy configuration", async () => {
      const updateData: UpdateProviderData = {
        proxy_url: "socks5://proxy.example.com:1080",
        proxy_fallback_to_direct: true,
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.proxyUrl).toBe("socks5://proxy.example.com:1080");
      expect(provider?.proxyFallbackToDirect).toBe(true);
    });

    it("should set limit fields to null", async () => {
      // First set some limits
      await updateProvider(testProviderId, {
        limit_5h_usd: 100,
        limit_weekly_usd: 500,
      });

      // Then set them to null
      const updateData: UpdateProviderData = {
        limit_5h_usd: null,
        limit_weekly_usd: null,
      };

      const provider = await updateProvider(testProviderId, updateData);

      expect(provider).toBeDefined();
      expect(provider?.limit5hUsd).toBeNull();
      expect(provider?.limitWeeklyUsd).toBeNull();
    });

    it("should return original provider when update data is empty", async () => {
      const provider = await updateProvider(testProviderId, {});

      expect(provider).toBeDefined();
      expect(provider?.name).toBe("Original Provider");
    });

    it("should return null for non-existent provider", async () => {
      const provider = await updateProvider(99999, { name: "Test" });

      expect(provider).toBeNull();
    });

    it("should return null for deleted provider", async () => {
      await deleteProvider(testProviderId);

      const provider = await updateProvider(testProviderId, { name: "Test" });

      expect(provider).toBeNull();
    });

    it("should update updatedAt timestamp", async () => {
      const originalProvider = await findProviderById(testProviderId);

      // Wait a bit to ensure timestamp difference
      await new Promise((resolve) => setTimeout(resolve, 10));

      const updatedProvider = await updateProvider(testProviderId, { name: "Updated" });

      expect(updatedProvider).toBeDefined();
      expect(updatedProvider!.updatedAt.getTime()).toBeGreaterThan(
        originalProvider!.updatedAt.getTime()
      );
    });
  });

  describe("deleteProvider", () => {
    let testProviderId: number;

    beforeEach(async () => {
      const provider = await createProvider({
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

    it("should soft delete provider", async () => {
      const result = await deleteProvider(testProviderId);

      expect(result).toBe(true);

      const provider = await findProviderById(testProviderId);
      expect(provider).toBeNull();
    });

    it("should return false for non-existent provider", async () => {
      const result = await deleteProvider(99999);

      expect(result).toBe(false);
    });

    it("should return false when deleting already deleted provider", async () => {
      await deleteProvider(testProviderId);
      const result = await deleteProvider(testProviderId);

      expect(result).toBe(false);
    });

    it("should not affect other providers", async () => {
      const provider2 = await createProvider({
        name: "Provider 2",
        url: "https://api2.test.com",
        key: "sk-test-2",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      await deleteProvider(testProviderId);

      const stillExists = await findProviderById(provider2.id);
      expect(stillExists).toBeDefined();
    });
  });

  describe("getProviderStatistics", () => {
    it("should return statistics for providers without messages", async () => {
      const provider = await createProvider({
        name: "Stats Provider",
        url: "https://api.stats.com",
        key: "sk-stats",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      const result = await getProviderStatistics();

      // PGlite returns an object with rows property, while postgres client returns array directly
      const stats = Array.isArray(result) ? result : (result as any).rows;

      expect(stats).toBeDefined();
      expect(Array.isArray(stats)).toBe(true);

      const providerStat = stats.find((s: any) => s.id === provider.id);
      expect(providerStat).toBeDefined();
      expect(providerStat?.today_cost).toBe("0");
      expect(providerStat?.today_calls).toBe(0);
      expect(providerStat?.last_call_time).toBeNull();
      expect(providerStat?.last_call_model).toBeNull();
    });

    it("should handle empty provider list", async () => {
      const result = await getProviderStatistics();

      // PGlite returns an object with rows property, while postgres client returns array directly
      const stats = Array.isArray(result) ? result : (result as any).rows;

      expect(stats).toBeDefined();
      expect(Array.isArray(stats)).toBe(true);
      expect(stats).toHaveLength(0);
    });

    it("should return statistics ordered by provider id", async () => {
      // Create multiple providers
      await createProvider({
        name: "Provider 1",
        url: "https://api1.test.com",
        key: "sk-1",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      await createProvider({
        name: "Provider 2",
        url: "https://api2.test.com",
        key: "sk-2",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      const result = await getProviderStatistics();

      // PGlite returns an object with rows property, while postgres client returns array directly
      const stats = Array.isArray(result) ? result : (result as any).rows;

      expect(stats.length).toBeGreaterThanOrEqual(2);

      // Verify ordering
      for (let i = 0; i < stats.length - 1; i++) {
        expect(stats[i].id).toBeLessThan(stats[i + 1].id);
      }
    });

    it("should not include deleted providers", async () => {
      const provider = await createProvider({
        name: "To Delete",
        url: "https://api.delete.com",
        key: "sk-delete",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      await deleteProvider(provider.id);

      const result = await getProviderStatistics();

      // PGlite returns an object with rows property, while postgres client returns array directly
      const stats = Array.isArray(result) ? result : (result as any).rows;

      const deletedProviderStat = stats.find((s: any) => s.id === provider.id);

      expect(deletedProviderStat).toBeUndefined();
    });

    it("should handle database timezone correctly", async () => {
      const provider = await createProvider({
        name: "Timezone Provider",
        url: "https://api.tz.com",
        key: "sk-tz",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      // This should not throw timezone-related errors
      const result = await getProviderStatistics();

      // PGlite returns an object with rows property, while postgres client returns array directly
      const stats = Array.isArray(result) ? result : (result as any).rows;

      expect(stats).toBeDefined();
      const providerStat = stats.find((s: any) => s.id === provider.id);
      expect(providerStat).toBeDefined();
    });
  });

  describe("Edge Cases", () => {
    it("should handle provider with special characters in name", async () => {
      const provider = await createProvider({
        name: "Provider 特殊字符 & Special",
        url: "https://api.test.com",
        key: "sk-special",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.name).toBe("Provider 特殊字符 & Special");

      const found = await findProviderById(provider.id);
      expect(found?.name).toBe("Provider 特殊字符 & Special");
    });

    it("should handle very long URL", async () => {
      const longUrl = "https://" + "a".repeat(500) + ".com";
      const provider = await createProvider({
        name: "Long URL Provider",
        url: longUrl,
        key: "sk-long",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.url).toBe(longUrl);
    });

    it("should handle complex model redirects", async () => {
      const redirects = {
        "claude-opus-4": "gpt-4-turbo",
        "claude-sonnet-4": "gpt-4",
        "claude-3-5-sonnet": "gpt-3.5-turbo",
      };

      const provider = await createProvider({
        name: "Complex Redirects",
        url: "https://api.test.com",
        key: "sk-complex",
        model_redirects: redirects,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.modelRedirects).toEqual(redirects);

      const found = await findProviderById(provider.id);
      expect(found?.modelRedirects).toEqual(redirects);
    });

    it("should handle empty allowed_models array", async () => {
      const provider = await createProvider({
        name: "Empty Models",
        url: "https://api.test.com",
        key: "sk-empty",
        allowed_models: [],
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.allowedModels).toEqual([]);
    });

    it("should handle max concurrent sessions as 0", async () => {
      const provider = await createProvider({
        name: "No Concurrent",
        url: "https://api.test.com",
        key: "sk-no-concurrent",
        limit_concurrent_sessions: 0,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.limitConcurrentSessions).toBe(0);
    });

    it("should handle very small cost multiplier", async () => {
      const provider = await createProvider({
        name: "Small Multiplier",
        url: "https://api.test.com",
        key: "sk-small",
        cost_multiplier: 0.0001,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.costMultiplier).toBe(0.0001);
    });

    it("should handle very large cost multiplier", async () => {
      const provider = await createProvider({
        name: "Large Multiplier",
        url: "https://api.test.com",
        key: "sk-large",
        cost_multiplier: 999999.9999,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      expect(provider.costMultiplier).toBe(999999.9999);
    });
  });

  describe("Query Filtering", () => {
    it("should correctly filter by group_tag", async () => {
      await createProvider({
        name: "Group A Provider",
        url: "https://api.groupa.com",
        key: "sk-groupa",
        group_tag: "group-a",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      await createProvider({
        name: "Group B Provider",
        url: "https://api.groupb.com",
        key: "sk-groupb",
        group_tag: "group-b",
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      const allProviders = await findProviderList();
      const groupAProviders = allProviders.filter((p) => p.groupTag === "group-a");
      const groupBProviders = allProviders.filter((p) => p.groupTag === "group-b");

      expect(groupAProviders).toHaveLength(1);
      expect(groupBProviders).toHaveLength(1);
      expect(groupAProviders[0].name).toBe("Group A Provider");
      expect(groupBProviders[0].name).toBe("Group B Provider");
    });

    it("should correctly filter enabled providers", async () => {
      await createProvider({
        name: "Enabled Provider",
        url: "https://api.enabled.com",
        key: "sk-enabled",
        is_enabled: true,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      await createProvider({
        name: "Disabled Provider",
        url: "https://api.disabled.com",
        key: "sk-disabled",
        is_enabled: false,
        tpm: null,
        rpm: null,
        rpd: null,
        cc: null,
      });

      const allProviders = await findProviderList();
      const enabledProviders = allProviders.filter((p) => p.isEnabled);
      const disabledProviders = allProviders.filter((p) => !p.isEnabled);

      expect(enabledProviders.length).toBeGreaterThan(0);
      expect(disabledProviders.length).toBeGreaterThan(0);
    });
  });
});
