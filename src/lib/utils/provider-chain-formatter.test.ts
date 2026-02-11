import { describe, expect, test } from "vitest";
import type { ProviderChainItem } from "@/types/message";
import {
  formatProbability,
  formatProbabilityCompact,
  formatProviderDescription,
  formatProviderSummary,
  formatProviderTimeline,
} from "./provider-chain-formatter";

/**
 * Simple mock t() function: returns the key followed by interpolated values.
 * Format: "key" or "key [k1=v1, k2=v2]" when values are provided.
 * This is enough to verify the formatter calls t() with the right keys and values.
 */
function mockT(key: string, values?: Record<string, string | number>): string {
  if (!values || Object.keys(values).length === 0) {
    return key;
  }
  const pairs = Object.entries(values)
    .map(([k, v]) => `${k}=${v}`)
    .join(", ");
  return `${key} [${pairs}]`;
}

describe("formatProbability", () => {
  test("formats 0.5 as 50.0%", () => {
    expect(formatProbability(0.5)).toBe("50.0%");
  });

  test("formats 0 as 0.0%", () => {
    expect(formatProbability(0)).toBe("0.0%");
  });

  test("formats 1 as 100.0%", () => {
    expect(formatProbability(1)).toBe("100.0%");
  });

  test("formats 0.333 as 33.3%", () => {
    expect(formatProbability(0.333)).toBe("33.3%");
  });

  test("normalizes out-of-range value 100 to 100.0% (prevents 10000.0%)", () => {
    expect(formatProbability(100)).toBe("100.0%");
  });

  test("normalizes out-of-range value 50 to 50.0%", () => {
    expect(formatProbability(50)).toBe("50.0%");
  });

  test("caps values greater than 100 at 100.0%", () => {
    expect(formatProbability(150)).toBe("100.0%");
  });

  test("returns null for undefined", () => {
    expect(formatProbability(undefined)).toBeNull();
  });

  test("returns null for null", () => {
    expect(formatProbability(null)).toBeNull();
  });

  test("returns null for NaN", () => {
    expect(formatProbability(Number.NaN)).toBeNull();
  });

  test("returns null for negative values", () => {
    expect(formatProbability(-0.5)).toBeNull();
  });

  test("respects custom decimal places", () => {
    expect(formatProbability(0.5, 0)).toBe("50%");
    expect(formatProbability(0.5, 2)).toBe("50.00%");
  });
});

describe("formatProbabilityCompact", () => {
  test("formats with 0 decimal places", () => {
    expect(formatProbabilityCompact(0.5)).toBe("50%");
  });

  test("returns null for invalid values", () => {
    expect(formatProbabilityCompact(undefined)).toBeNull();
    expect(formatProbabilityCompact(Number.NaN)).toBeNull();
  });
});

// =============================================================================
// endpoint_pool_exhausted reason tests
// =============================================================================

describe("endpoint_pool_exhausted", () => {
  // ---------------------------------------------------------------------------
  // Shared fixtures
  // ---------------------------------------------------------------------------
  const baseExhaustedItem: ProviderChainItem = {
    id: 1,
    name: "provider-a",
    reason: "endpoint_pool_exhausted",
    timestamp: 1000,
    endpointFilterStats: {
      total: 5,
      enabled: 4,
      circuitOpen: 3,
      available: 0,
    },
    strictBlockCause: "no_endpoint_candidates",
  };

  const exhaustedWithSelectorError: ProviderChainItem = {
    id: 1,
    name: "provider-a",
    reason: "endpoint_pool_exhausted",
    timestamp: 1000,
    endpointFilterStats: {
      total: 3,
      enabled: 2,
      circuitOpen: 1,
      available: 0,
    },
    strictBlockCause: "selector_error",
    errorMessage: "endpoint selector threw an unexpected error",
  };

  const exhaustedNoStats: ProviderChainItem = {
    id: 1,
    name: "provider-a",
    reason: "endpoint_pool_exhausted",
    timestamp: 1000,
  };

  // ---------------------------------------------------------------------------
  // getProviderStatus / isActualRequest (tested implicitly through formatters)
  // ---------------------------------------------------------------------------

  describe("formatProviderSummary", () => {
    test("renders exhausted item in chain path with failure mark", () => {
      const chain: ProviderChainItem[] = [baseExhaustedItem];
      const result = formatProviderSummary(chain, mockT);

      // Should show a failure status marker for this provider
      expect(result).toContain("provider-a");
      expect(result).toContain("✗");
    });

    test("renders exhausted alongside successful retry in multi-provider chain", () => {
      const chain: ProviderChainItem[] = [
        baseExhaustedItem,
        {
          id: 2,
          name: "provider-b",
          reason: "request_success",
          statusCode: 200,
          timestamp: 2000,
        },
      ];
      const result = formatProviderSummary(chain, mockT);

      expect(result).toContain("provider-a");
      expect(result).toContain("provider-b");
      // provider-a should be failure, provider-b should be success
      expect(result).toMatch(/provider-a\(.*\).*provider-b\(.*\)/);
    });
  });

  describe("formatProviderDescription", () => {
    test("shows endpoint pool exhausted label in request chain", () => {
      const chain: ProviderChainItem[] = [baseExhaustedItem];
      const result = formatProviderDescription(chain, mockT);

      expect(result).toContain("provider-a");
      expect(result).toContain("description.endpointPoolExhausted");
    });

    test("handles exhausted item when it is the only item (no initial_selection)", () => {
      const chain: ProviderChainItem[] = [baseExhaustedItem];
      const result = formatProviderDescription(chain, mockT);

      // Should not crash, should produce something reasonable
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe("formatProviderTimeline", () => {
    test("renders endpoint pool exhausted with filter stats", () => {
      const chain: ProviderChainItem[] = [
        {
          id: 1,
          name: "provider-a",
          reason: "initial_selection",
          timestamp: 0,
          decisionContext: {
            totalProviders: 3,
            enabledProviders: 3,
            targetType: "claude",
            groupFilterApplied: false,
            beforeHealthCheck: 3,
            afterHealthCheck: 3,
            priorityLevels: [1],
            selectedPriority: 1,
            candidatesAtPriority: [],
          },
        },
        baseExhaustedItem,
      ];

      const { timeline } = formatProviderTimeline(chain, mockT);

      // Should contain the title for endpoint pool exhausted
      expect(timeline).toContain("timeline.endpointPoolExhausted");

      // Should contain filter stats breakdown with values
      expect(timeline).toContain("timeline.endpointStatsTotal [count=5]");
      expect(timeline).toContain("timeline.endpointStatsEnabled [count=4]");
      expect(timeline).toContain("timeline.endpointStatsCircuitOpen [count=3]");
      expect(timeline).toContain("timeline.endpointStatsAvailable [count=0]");
    });

    test("renders strictBlockCause = no_endpoint_candidates", () => {
      const chain: ProviderChainItem[] = [baseExhaustedItem];
      const { timeline } = formatProviderTimeline(chain, mockT);

      expect(timeline).toContain("timeline.strictBlockNoEndpoints");
    });

    test("renders strictBlockCause = selector_error with error message", () => {
      const chain: ProviderChainItem[] = [exhaustedWithSelectorError];
      const { timeline } = formatProviderTimeline(chain, mockT);

      expect(timeline).toContain("timeline.strictBlockSelectorError");
      // The error message is passed through t("timeline.error", { error: ... })
      expect(timeline).toContain("error=endpoint selector threw an unexpected error");
    });

    test("degrades gracefully when endpointFilterStats is missing", () => {
      const chain: ProviderChainItem[] = [exhaustedNoStats];
      const { timeline } = formatProviderTimeline(chain, mockT);

      // Should still render without crashing
      expect(timeline).toContain("timeline.endpointPoolExhausted");
      // Provider name is embedded in the mockT output as a value
      expect(timeline).toContain("provider=provider-a");
      // Should NOT contain stats section
      expect(timeline).not.toContain("timeline.endpointStatsTotal");
    });

    test("computes totalDuration correctly with exhausted items", () => {
      const chain: ProviderChainItem[] = [
        {
          id: 1,
          name: "provider-a",
          reason: "initial_selection",
          timestamp: 0,
          decisionContext: {
            totalProviders: 1,
            enabledProviders: 1,
            targetType: "claude",
            groupFilterApplied: false,
            beforeHealthCheck: 1,
            afterHealthCheck: 1,
            priorityLevels: [1],
            selectedPriority: 1,
            candidatesAtPriority: [],
          },
        },
        { ...baseExhaustedItem, timestamp: 500 },
      ];
      const { totalDuration } = formatProviderTimeline(chain, mockT);
      expect(totalDuration).toBe(500);
    });
  });
});

// =============================================================================
// resource_not_found reason tests
// =============================================================================

describe("resource_not_found", () => {
  const baseNotFoundItem: ProviderChainItem = {
    id: 1,
    name: "provider-a",
    reason: "resource_not_found",
    attemptNumber: 1,
    statusCode: 404,
    errorMessage: "Not Found",
    timestamp: 1000,
    errorDetails: {
      provider: {
        id: 1,
        name: "provider-a",
        statusCode: 404,
        statusText: "Not Found",
      },
    },
  };

  describe("formatProviderSummary", () => {
    test("renders resource_not_found item as failure in summary", () => {
      const chain: ProviderChainItem[] = [baseNotFoundItem];
      const result = formatProviderSummary(chain, mockT);

      expect(result).toContain("provider-a");
      expect(result).toContain("✗");
    });
  });

  describe("formatProviderDescription", () => {
    test("shows resource not found label in request chain", () => {
      const chain: ProviderChainItem[] = [baseNotFoundItem];
      const result = formatProviderDescription(chain, mockT);

      expect(result).toContain("provider-a");
      expect(result).toContain("description.resourceNotFound");
    });
  });

  describe("formatProviderTimeline", () => {
    test("renders resource_not_found with status code and note", () => {
      const chain: ProviderChainItem[] = [baseNotFoundItem];
      const { timeline } = formatProviderTimeline(chain, mockT);

      expect(timeline).toContain("timeline.resourceNotFoundFailed [attempt=1]");
      expect(timeline).toContain("timeline.statusCode [code=404]");
      expect(timeline).toContain("timeline.resourceNotFoundNote");
    });
  });
});

// =============================================================================
// Unknown reason graceful degradation
// =============================================================================

describe("unknown reason graceful degradation", () => {
  const unknownItem: ProviderChainItem = {
    id: 99,
    name: "provider-x",
    // @ts-expect-error -- intentionally testing an unknown reason string
    reason: "some_future_reason_not_yet_defined",
    timestamp: 1000,
  };

  test("formatProviderSummary does not throw for unknown reason", () => {
    expect(() => formatProviderSummary([unknownItem], mockT)).not.toThrow();
  });

  test("formatProviderDescription does not throw for unknown reason", () => {
    expect(() => formatProviderDescription([unknownItem], mockT)).not.toThrow();
  });

  test("formatProviderTimeline does not throw for unknown reason", () => {
    expect(() => formatProviderTimeline([unknownItem], mockT)).not.toThrow();
    const { timeline } = formatProviderTimeline([unknownItem], mockT);
    // Should include the provider name and the raw reason as fallback
    expect(timeline).toContain("provider-x");
    expect(timeline).toContain("some_future_reason_not_yet_defined");
  });

  test("formatProviderTimeline renders unknown reason with no reason field", () => {
    const noReasonItem: ProviderChainItem = {
      id: 99,
      name: "provider-y",
      timestamp: 1000,
    };
    const { timeline } = formatProviderTimeline([noReasonItem], mockT);
    expect(timeline).toContain("provider-y");
    expect(timeline).toContain("timeline.unknown");
  });
});
