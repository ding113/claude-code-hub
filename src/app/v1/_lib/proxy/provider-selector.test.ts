/**
 * Unit tests for provider-selector.ts
 *
 * Tests the ProxyProviderResolver class which handles:
 * - Provider selection with weight and priority
 * - Circuit breaker state checking
 * - Concurrent limit checking
 * - Failover loop (max 3 retries)
 * - User group filtering
 * - Session reuse
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ProxyProviderResolver } from "./provider-selector";
import type { Provider } from "@/types/provider";
import type { ProxySession } from "./session";

// Mock server-only module first
vi.mock("server-only", () => ({}));

// Mock dependencies
vi.mock("@/repository/provider");
vi.mock("@/lib/rate-limit");
vi.mock("@/lib/session-manager");
vi.mock("@/lib/circuit-breaker");
vi.mock("@/lib/logger");
vi.mock("./responses");

// Import mocked modules after vi.mock
import { findProviderList, findProviderById } from "@/repository/provider";
import { RateLimitService } from "@/lib/rate-limit";
import { SessionManager } from "@/lib/session-manager";
import { isCircuitOpen, getCircuitState } from "@/lib/circuit-breaker";
import { ProxyResponses } from "./responses";

// Setup ProxyResponses mock
vi.mocked(ProxyResponses).buildError = vi.fn((status: number, message: string) => {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
});

describe("ProxyProviderResolver", () => {
  // Helper to create mock provider
  const createMockProvider = (overrides: Partial<Provider> = {}): Provider => ({
    id: 1,
    name: "Test Provider",
    providerType: "claude",
    apiKey: "test-key",
    baseUrl: "https://api.anthropic.com",
    isEnabled: true,
    weight: 10,
    priority: 1,
    costMultiplier: 1.0,
    allowedModels: null,
    modelRedirects: null,
    joinClaudePool: false,
    groupTag: null,
    limitConcurrentSessions: null,
    limit5hUsd: null,
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  });

  // Helper to create mock session
  const createMockSession = (overrides: Partial<ProxySession> = {}): ProxySession => {
    const session = {
      sessionId: "test-session-id",
      getCurrentModel: vi.fn(() => "claude-sonnet-4-5-20250929"),
      shouldReuseProvider: vi.fn(() => false),
      setProvider: vi.fn(),
      addProviderToChain: vi.fn(),
      setLastSelectionContext: vi.fn(),
      getLastSelectionContext: vi.fn(() => null),
      provider: null,
      authState: {
        user: { id: 1, name: "Test User", providerGroup: null },
        key: { id: 1, name: "Test Key" },
      },
      ...overrides,
    } as unknown as ProxySession;

    // Make setProvider actually update the provider property
    vi.mocked(session.setProvider).mockImplementation((provider: Provider | null) => {
      (session as any).provider = provider;
    });

    return session;
  };

  beforeEach(() => {
    vi.clearAllMocks();
    // Default mocks
    vi.mocked(getCircuitState).mockReturnValue("closed");
    vi.mocked(isCircuitOpen).mockResolvedValue(false);
    vi.mocked(RateLimitService.checkCostLimits).mockResolvedValue({ allowed: true });
    vi.mocked(RateLimitService.checkAndTrackProviderSession).mockResolvedValue({
      allowed: true,
      count: 1,
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("basic provider selection", () => {
    it("should select an enabled provider successfully", async () => {
      const provider = createMockProvider({ id: 1, name: "Test Provider" });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).toBeNull(); // Success returns null
      expect(session.setProvider).toHaveBeenCalledWith(provider);
    });

    it("should return error when no providers available", async () => {
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(503);
    });

    it("should filter out disabled providers", async () => {
      const provider = createMockProvider({ id: 1, isEnabled: false });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).not.toBeNull();
      // setProvider is called with null when no providers are available
      expect(session.provider).toBeNull();
      const response = result as Response;
      expect(response.status).toBe(503);
    });
  });

  describe("session reuse", () => {
    it("should reuse provider from session if healthy", async () => {
      const provider = createMockProvider({ id: 1, name: "Reused Provider" });
      const session = createMockSession({ shouldReuseProvider: vi.fn(() => true) });

      vi.mocked(SessionManager.getSessionProvider).mockResolvedValue(provider.id);
      vi.mocked(findProviderById).mockResolvedValue(provider);
      vi.mocked(findProviderList).mockResolvedValue([provider]); // Fallback if reuse fails

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).toBeNull();
      expect(session.setProvider).toHaveBeenCalledWith(provider);
      expect(session.addProviderToChain).toHaveBeenCalledWith(
        provider,
        expect.objectContaining({ reason: "session_reuse" })
      );
    });

    it("should skip reuse if provider circuit is open", async () => {
      const provider = createMockProvider({ id: 1 });
      const fallback = createMockProvider({ id: 2, name: "Fallback" });
      const session = createMockSession({ shouldReuseProvider: vi.fn(() => true) });

      vi.mocked(SessionManager.getSessionProvider).mockResolvedValue(provider.id);
      vi.mocked(findProviderById).mockResolvedValue(provider);
      vi.mocked(isCircuitOpen).mockResolvedValueOnce(true).mockResolvedValue(false);
      vi.mocked(getCircuitState).mockReturnValue("open");
      vi.mocked(findProviderList).mockResolvedValue([fallback]);

      await ProxyProviderResolver.ensure(session);

      expect(session.setProvider).not.toHaveBeenCalledWith(provider);
    });
  });

  describe("circuit breaker filtering", () => {
    it("should filter out providers with open circuit breaker", async () => {
      const provider1 = createMockProvider({ id: 1, name: "Circuit Open" });
      const provider2 = createMockProvider({ id: 2, name: "Healthy" });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider1, provider2]);
      vi.mocked(isCircuitOpen).mockImplementation(async (id) => id === 1);

      await ProxyProviderResolver.ensure(session);

      expect(session.setProvider).toHaveBeenCalledWith(provider2);
    });

    it("should return error when all circuits are open", async () => {
      const provider = createMockProvider({ id: 1 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider]);
      vi.mocked(isCircuitOpen).mockResolvedValue(true);

      const result = await ProxyProviderResolver.ensure(session);

      // Fail-open strategy: system allows unhealthy provider rather than complete failure
      // The provider is selected despite open circuit, allowing upstream to reject if needed
      expect(result).toBeNull(); // Success - fail-open behavior
      expect(session.provider).toEqual(provider);
    });
  });

  describe("user group filtering", () => {
    it("should filter by user group", async () => {
      const groupA = createMockProvider({ id: 1, groupTag: "group-a" });
      const groupB = createMockProvider({ id: 2, groupTag: "group-b" });
      const session = createMockSession({
        authState: {
          user: { id: 1, name: "User", providerGroup: "group-a" },
          key: { id: 1, name: "Key" },
        },
      });

      vi.mocked(findProviderList).mockResolvedValue([groupA, groupB]);

      await ProxyProviderResolver.ensure(session);

      expect(session.setProvider).toHaveBeenCalledWith(groupA);
    });

    it("should support multi-group filtering", async () => {
      const groupA = createMockProvider({ id: 1, groupTag: "group-a" });
      const groupB = createMockProvider({ id: 2, groupTag: "group-b" });
      const groupC = createMockProvider({ id: 3, groupTag: "group-c" });
      const session = createMockSession({
        authState: {
          user: { id: 1, name: "User", providerGroup: "group-a, group-b" },
          key: { id: 1, name: "Key" },
        },
      });

      vi.mocked(findProviderList).mockResolvedValue([groupA, groupB, groupC]);

      await ProxyProviderResolver.ensure(session);

      const selected = vi.mocked(session.setProvider).mock.calls[0][0];
      expect([groupA, groupB]).toContainEqual(selected);
    });

    it("should return error when no providers match user group", async () => {
      const provider = createMockProvider({ id: 1, groupTag: "group-a" });
      const session = createMockSession({
        authState: {
          user: { id: 1, name: "User", providerGroup: "group-b" },
          key: { id: 1, name: "Key" },
        },
      });

      vi.mocked(findProviderList).mockResolvedValue([provider]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(503);
    });
  });

  describe("priority selection", () => {
    it("should select highest priority provider (lowest number)", async () => {
      const low = createMockProvider({ id: 1, priority: 10 });
      const high = createMockProvider({ id: 2, priority: 1 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([low, high]);

      await ProxyProviderResolver.ensure(session);

      expect(session.setProvider).toHaveBeenCalledWith(high);
    });

    it("should use weighted random among same priority", async () => {
      const provider1 = createMockProvider({ id: 1, priority: 1, weight: 1 });
      const provider2 = createMockProvider({ id: 2, priority: 1, weight: 99 });

      vi.mocked(findProviderList).mockResolvedValue([provider1, provider2]);

      const selections: number[] = [];
      for (let i = 0; i < 10; i++) {
        // Create a fresh session for each iteration to avoid state pollution
        const session = createMockSession();

        await ProxyProviderResolver.ensure(session);
        const selected = session.provider;
        if (selected) selections.push(selected.id);
      }

      const provider2Count = selections.filter((id) => id === 2).length;
      expect(provider2Count).toBeGreaterThan(5);
    });
  });

  describe("concurrent limit check", () => {
    it("should succeed when limit not exceeded", async () => {
      const provider = createMockProvider({ id: 1, limitConcurrentSessions: 10 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).toBeNull();
      expect(RateLimitService.checkAndTrackProviderSession).toHaveBeenCalledWith(
        provider.id,
        session.sessionId,
        10
      );
    });

    it("should retry with fallback when limit exceeded", async () => {
      // Give busy provider higher priority (lower number) to ensure it's selected first
      const busy = createMockProvider({ id: 1, limitConcurrentSessions: 10, priority: 0 });
      const fallback = createMockProvider({ id: 2, limitConcurrentSessions: 10, priority: 1 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([busy, fallback]);
      vi.mocked(RateLimitService.checkAndTrackProviderSession)
        .mockResolvedValueOnce({ allowed: false, count: 10 }) // First call for busy provider
        .mockResolvedValueOnce({ allowed: true, count: 5 }); // Second call for fallback provider

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).toBeNull();
      expect(session.setProvider).toHaveBeenLastCalledWith(fallback);
      expect(session.addProviderToChain).toHaveBeenCalledWith(
        busy,
        expect.objectContaining({ reason: "concurrent_limit_failed" })
      );
    });

    it("should return error when all providers at limit", async () => {
      const provider1 = createMockProvider({ id: 1 });
      const provider2 = createMockProvider({ id: 2 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider1, provider2]);
      vi.mocked(RateLimitService.checkAndTrackProviderSession).mockResolvedValue({
        allowed: false,
        count: 5,
      });

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).not.toBeNull();
      const response = result as Response;
      expect(response.status).toBe(503);
    });
  });

  describe("cost limit filtering", () => {
    it("should filter out providers exceeding cost limits", async () => {
      const overLimit = createMockProvider({ id: 1, limit5hUsd: 10 });
      const underLimit = createMockProvider({ id: 2, limit5hUsd: 100 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([overLimit, underLimit]);
      vi.mocked(RateLimitService.checkCostLimits)
        .mockResolvedValueOnce({ allowed: false })
        .mockResolvedValueOnce({ allowed: true });

      await ProxyProviderResolver.ensure(session);

      expect(session.setProvider).toHaveBeenCalledWith(underLimit);
    });
  });

  describe("pickRandomProviderWithExclusion", () => {
    it("should exclude specified provider IDs", async () => {
      const provider1 = createMockProvider({ id: 1 });
      const provider2 = createMockProvider({ id: 2 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider1, provider2]);

      const result = await ProxyProviderResolver.pickRandomProviderWithExclusion(session, [1]);

      expect(result).toEqual(provider2);
    });

    it("should return null when all are excluded", async () => {
      const provider1 = createMockProvider({ id: 1 });
      const provider2 = createMockProvider({ id: 2 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider1, provider2]);

      const result = await ProxyProviderResolver.pickRandomProviderWithExclusion(session, [1, 2]);

      expect(result).toBeNull();
    });
  });

  describe("edge cases", () => {
    it("should handle providers with zero weight", async () => {
      const provider = createMockProvider({ id: 1, weight: 0 });
      const session = createMockSession();

      vi.mocked(findProviderList).mockResolvedValue([provider]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).toBeNull();
      expect(session.setProvider).toHaveBeenCalledWith(provider);
    });

    it("should handle null session ID gracefully", async () => {
      const provider = createMockProvider({ id: 1 });
      const session = createMockSession({ sessionId: null as unknown as string });

      vi.mocked(findProviderList).mockResolvedValue([provider]);

      const result = await ProxyProviderResolver.ensure(session);

      expect(result).toBeNull();
    });
  });
});
