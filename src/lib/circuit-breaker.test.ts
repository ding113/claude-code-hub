/**
 * Unit tests for circuit-breaker.ts
 *
 * Test coverage:
 * - State machine transitions (Closed → Open → Half-Open → Closed)
 * - Failure counting and threshold triggering
 * - Dynamic configuration loading with caching
 * - Edge cases (threshold boundaries, time windows)
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  isCircuitOpen,
  recordFailure,
  recordSuccess,
  getCircuitState,
  getAllHealthStatus,
  resetCircuit,
  clearConfigCache,
  getProviderHealthInfo,
} from "./circuit-breaker";
import type { CircuitBreakerConfig } from "@/lib/redis/circuit-breaker-config";

// Mock dependencies
vi.mock("@/lib/logger", () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock("@/lib/redis/circuit-breaker-config", () => ({
  loadProviderCircuitConfig: vi.fn(),
  DEFAULT_CIRCUIT_BREAKER_CONFIG: {
    failureThreshold: 5,
    openDuration: 30 * 60 * 1000, // 30 minutes
    halfOpenSuccessThreshold: 2,
  },
}));

vi.mock("@/lib/notification/notifier", () => ({
  sendCircuitBreakerAlert: vi.fn(),
}));

vi.mock("@/drizzle/db", () => ({
  db: {
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({
          limit: vi.fn(() => Promise.resolve([{ name: "Test Provider" }])),
        })),
      })),
    })),
  },
}));

vi.mock("@/drizzle/schema", () => ({
  providers: {
    name: "name",
  },
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
}));

import { loadProviderCircuitConfig } from "@/lib/redis/circuit-breaker-config";

describe("Circuit Breaker", () => {
  const testProviderId = 1;
  const defaultConfig: CircuitBreakerConfig = {
    failureThreshold: 5,
    openDuration: 30 * 60 * 1000, // 30 minutes
    halfOpenSuccessThreshold: 2,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // Reset circuit state
    resetCircuit(testProviderId);
    clearConfigCache(testProviderId);
    // Setup default mock behavior
    vi.mocked(loadProviderCircuitConfig).mockResolvedValue(defaultConfig);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("Initial State", () => {
    it("should start in closed state", async () => {
      const state = getCircuitState(testProviderId);
      expect(state).toBe("closed");
    });

    it("should allow requests when circuit is closed", async () => {
      const isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(false);
    });

    it("should have zero failure count initially", async () => {
      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.failureCount).toBe(0);
      expect(health.lastFailureTime).toBeNull();
    });
  });

  describe("Failure Recording and Threshold", () => {
    it("should increment failure count on recordFailure", async () => {
      const error = new Error("Test error");
      await recordFailure(testProviderId, error);

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.failureCount).toBe(1);
      expect(health.lastFailureTime).toBeTruthy();
    });

    it("should open circuit when failure threshold is reached", async () => {
      const error = new Error("Test error");

      // Record failures up to threshold
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      const state = getCircuitState(testProviderId);
      expect(state).toBe("open");
    });

    it("should reject requests when circuit is open", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      const isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(true);
    });

    it("should set circuitOpenUntil timestamp when circuit opens", async () => {
      const error = new Error("Test error");
      const startTime = Date.now();

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.circuitOpenUntil).toBeTruthy();
      expect(health.circuitOpenUntil).toBeGreaterThanOrEqual(
        startTime + defaultConfig.openDuration
      );
    });
  });

  describe("State Transition: Open → Half-Open", () => {
    it("should transition to half-open after open duration expires", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("open");

      // Advance time past open duration
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);

      // Check if circuit transitions to half-open
      const isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(false);
      expect(getCircuitState(testProviderId)).toBe("half-open");
    });

    it("should reset half-open success count on transition", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      // Advance time to trigger half-open transition
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);
      await isCircuitOpen(testProviderId);

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.halfOpenSuccessCount).toBe(0);
    });

    it("should remain open before open duration expires", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      // Advance time but not enough
      vi.advanceTimersByTime(defaultConfig.openDuration - 1000);

      const isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(true);
      expect(getCircuitState(testProviderId)).toBe("open");
    });
  });

  describe("State Transition: Half-Open → Closed", () => {
    beforeEach(async () => {
      // Setup: Open circuit then transition to half-open
      const error = new Error("Test error");
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);
      await isCircuitOpen(testProviderId);
    });

    it("should increment half-open success count on recordSuccess", async () => {
      await recordSuccess(testProviderId);

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.halfOpenSuccessCount).toBe(1);
      expect(getCircuitState(testProviderId)).toBe("half-open");
    });

    it("should close circuit after reaching success threshold", async () => {
      // Record successes up to threshold
      for (let i = 0; i < defaultConfig.halfOpenSuccessThreshold; i++) {
        await recordSuccess(testProviderId);
      }

      const state = getCircuitState(testProviderId);
      expect(state).toBe("closed");
    });

    it("should reset failure count when closing circuit", async () => {
      // Close the circuit
      for (let i = 0; i < defaultConfig.halfOpenSuccessThreshold; i++) {
        await recordSuccess(testProviderId);
      }

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.failureCount).toBe(0);
      expect(health.lastFailureTime).toBeNull();
      expect(health.circuitOpenUntil).toBeNull();
      expect(health.halfOpenSuccessCount).toBe(0);
    });

    it("should allow requests after circuit closes", async () => {
      // Close the circuit
      for (let i = 0; i < defaultConfig.halfOpenSuccessThreshold; i++) {
        await recordSuccess(testProviderId);
      }

      const isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(false);
    });
  });

  describe("Success in Closed State", () => {
    it("should reset failure count on success in closed state", async () => {
      const error = new Error("Test error");

      // Record some failures (but not enough to open circuit)
      await recordFailure(testProviderId, error);
      await recordFailure(testProviderId, error);

      let health = (await getProviderHealthInfo(testProviderId)).health;
      expect(health.failureCount).toBe(2);

      // Record success
      await recordSuccess(testProviderId);

      health = (await getProviderHealthInfo(testProviderId)).health;
      expect(health.failureCount).toBe(0);
      expect(health.lastFailureTime).toBeNull();
    });

    it("should remain closed on success with zero failures", async () => {
      await recordSuccess(testProviderId);

      const state = getCircuitState(testProviderId);
      expect(state).toBe("closed");

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.failureCount).toBe(0);
    });
  });

  describe("Configuration Loading and Caching", () => {
    it("should load configuration from config service", async () => {
      await getProviderHealthInfo(testProviderId);

      expect(loadProviderCircuitConfig).toHaveBeenCalledWith(testProviderId);
    });

    it("should cache configuration for 5 minutes", async () => {
      // First call
      await getProviderHealthInfo(testProviderId);
      expect(loadProviderCircuitConfig).toHaveBeenCalledTimes(1);

      // Second call within cache TTL
      vi.advanceTimersByTime(4 * 60 * 1000); // 4 minutes
      await getProviderHealthInfo(testProviderId);
      expect(loadProviderCircuitConfig).toHaveBeenCalledTimes(1); // Still cached

      // Third call after cache expires
      vi.advanceTimersByTime(2 * 60 * 1000); // +2 minutes = 6 minutes total
      await getProviderHealthInfo(testProviderId);
      expect(loadProviderCircuitConfig).toHaveBeenCalledTimes(2); // Reloaded
    });

    it("should use custom configuration thresholds", async () => {
      const customConfig: CircuitBreakerConfig = {
        failureThreshold: 3,
        openDuration: 10 * 60 * 1000, // 10 minutes
        halfOpenSuccessThreshold: 1,
      };

      vi.mocked(loadProviderCircuitConfig).mockResolvedValue(customConfig);
      clearConfigCache(testProviderId);

      const error = new Error("Test error");

      // Should open after 3 failures (custom threshold)
      for (let i = 0; i < customConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("open");
    });

    it("should use default config when config loading fails", async () => {
      vi.mocked(loadProviderCircuitConfig).mockRejectedValue(new Error("Config load failed"));
      clearConfigCache(testProviderId);

      const error = new Error("Test error");

      // Should still work with default config
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("open");
    });

    it("should clear configuration cache on clearConfigCache", async () => {
      // Load config
      await getProviderHealthInfo(testProviderId);
      expect(loadProviderCircuitConfig).toHaveBeenCalledTimes(1);

      // Clear cache
      clearConfigCache(testProviderId);

      // Next call should reload
      await getProviderHealthInfo(testProviderId);
      expect(loadProviderCircuitConfig).toHaveBeenCalledTimes(2);
    });
  });

  describe("Manual Circuit Reset", () => {
    it("should reset circuit to closed state from open", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("open");

      // Manual reset
      resetCircuit(testProviderId);

      expect(getCircuitState(testProviderId)).toBe("closed");
    });

    it("should reset all health metrics on manual reset", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      resetCircuit(testProviderId);

      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.failureCount).toBe(0);
      expect(health.lastFailureTime).toBeNull();
      expect(health.circuitOpenUntil).toBeNull();
      expect(health.halfOpenSuccessCount).toBe(0);
      expect(health.circuitState).toBe("closed");
    });

    it("should allow requests immediately after manual reset", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      resetCircuit(testProviderId);

      const isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(false);
    });
  });

  describe("Multiple Providers", () => {
    const provider1 = 1;
    const provider2 = 2;

    beforeEach(() => {
      resetCircuit(provider1);
      resetCircuit(provider2);
    });

    it("should maintain independent state for each provider", async () => {
      const error = new Error("Test error");

      // Fail provider 1
      await recordFailure(provider1, error);
      await recordFailure(provider1, error);

      // Fail provider 2 more times
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(provider2, error);
      }

      expect(getCircuitState(provider1)).toBe("closed");
      expect(getCircuitState(provider2)).toBe("open");
    });

    it("should return all health statuses", () => {
      const allStatus = getAllHealthStatus();

      expect(allStatus[provider1]).toBeDefined();
      expect(allStatus[provider2]).toBeDefined();
      expect(allStatus[provider1].circuitState).toBe("closed");
    });
  });

  describe("getAllHealthStatus - State Auto-Update", () => {
    it("should auto-transition open to half-open when checking all statuses", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("open");

      // Advance time past open duration
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);

      // Get all statuses should trigger auto-transition
      const allStatus = getAllHealthStatus();

      expect(allStatus[testProviderId].circuitState).toBe("half-open");
    });

    it("should not auto-transition if open duration not expired", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      // Advance time but not enough
      vi.advanceTimersByTime(defaultConfig.openDuration - 1000);

      const allStatus = getAllHealthStatus();

      expect(allStatus[testProviderId].circuitState).toBe("open");
    });
  });

  describe("Edge Cases", () => {
    it("should handle exactly threshold failures", async () => {
      const error = new Error("Test error");

      // Record exactly threshold failures
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("open");
    });

    it("should handle threshold - 1 failures", async () => {
      const error = new Error("Test error");

      // Record one less than threshold
      for (let i = 0; i < defaultConfig.failureThreshold - 1; i++) {
        await recordFailure(testProviderId, error);
      }

      expect(getCircuitState(testProviderId)).toBe("closed");
    });

    it("should handle exactly half-open success threshold", async () => {
      const error = new Error("Test error");

      // Open and transition to half-open
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);
      await isCircuitOpen(testProviderId);

      // Record exactly threshold successes
      for (let i = 0; i < defaultConfig.halfOpenSuccessThreshold; i++) {
        await recordSuccess(testProviderId);
      }

      expect(getCircuitState(testProviderId)).toBe("closed");
    });

    it("should handle half-open success threshold - 1", async () => {
      const error = new Error("Test error");

      // Open and transition to half-open
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);
      await isCircuitOpen(testProviderId);

      // Record one less than threshold
      for (let i = 0; i < defaultConfig.halfOpenSuccessThreshold - 1; i++) {
        await recordSuccess(testProviderId);
      }

      expect(getCircuitState(testProviderId)).toBe("half-open");
    });

    it("should handle time exactly at open duration boundary", async () => {
      const error = new Error("Test error");

      // Open the circuit
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }

      // Advance time to exactly the boundary
      vi.advanceTimersByTime(defaultConfig.openDuration);

      // Should still be open (boundary not crossed)
      let isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(true);

      // Advance by 1ms to cross boundary
      vi.advanceTimersByTime(1);
      isOpen = await isCircuitOpen(testProviderId);
      expect(isOpen).toBe(false);
      expect(getCircuitState(testProviderId)).toBe("half-open");
    });

    it("should handle rapid successive failures", async () => {
      const error = new Error("Test error");

      // Record many failures rapidly
      for (let i = 0; i < defaultConfig.failureThreshold * 2; i++) {
        await recordFailure(testProviderId, error);
      }

      // Circuit should be open
      expect(getCircuitState(testProviderId)).toBe("open");

      // Failure count should continue incrementing
      const { health } = await getProviderHealthInfo(testProviderId);
      expect(health.failureCount).toBe(defaultConfig.failureThreshold * 2);
    });

    it("should handle failure in half-open state", async () => {
      const error = new Error("Test error");

      // Open and transition to half-open
      for (let i = 0; i < defaultConfig.failureThreshold; i++) {
        await recordFailure(testProviderId, error);
      }
      vi.advanceTimersByTime(defaultConfig.openDuration + 1000);
      await isCircuitOpen(testProviderId);

      // Record failure in half-open state
      await recordFailure(testProviderId, error);

      // Should remain half-open (or transition back to open based on logic)
      const state = getCircuitState(testProviderId);
      expect(["half-open", "open"]).toContain(state);
    });
  });

  describe("getProviderHealthInfo", () => {
    it("should return health and config together", async () => {
      const result = await getProviderHealthInfo(testProviderId);

      expect(result).toHaveProperty("health");
      expect(result).toHaveProperty("config");
      expect(result.health.circuitState).toBe("closed");
      expect(result.config).toEqual(defaultConfig);
    });

    it("should reflect current health state", async () => {
      const error = new Error("Test error");

      // Record some failures
      await recordFailure(testProviderId, error);
      await recordFailure(testProviderId, error);

      const result = await getProviderHealthInfo(testProviderId);

      expect(result.health.failureCount).toBe(2);
      expect(result.health.lastFailureTime).toBeTruthy();
    });
  });
});
