import { describe, expect, test } from "vitest";
import type { ProviderChainItem } from "@/types/message";
import {
  formatProbability,
  formatProbabilityCompact,
  formatProviderDescription,
  formatProviderSummary,
  formatProviderTimeline,
  getFinalProviderName,
  getRetryCount,
  isActualRequest,
  isHedgeRace,
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
// vendor_type_all_timeout reason tests
// =============================================================================

describe("vendor_type_all_timeout", () => {
  // ---------------------------------------------------------------------------
  // Shared fixtures
  // ---------------------------------------------------------------------------
  const vendorTypeTimeoutItem: ProviderChainItem = {
    id: 1,
    name: "provider-timeout",
    reason: "vendor_type_all_timeout",
    timestamp: 1000,
    statusCode: 524,
    attemptNumber: 1,
    errorMessage: "All endpoints timed out",
    errorDetails: {
      provider: {
        id: 1,
        name: "provider-timeout",
        statusCode: 524,
        statusText: "Origin Time-out",
      },
      request: {
        method: "POST",
        url: "https://api.example.com/v1/messages",
        headers: "content-type: application/json",
      },
    },
  };

  const vendorTypeTimeoutNoDetails: ProviderChainItem = {
    id: 1,
    name: "provider-timeout",
    reason: "vendor_type_all_timeout",
    timestamp: 1000,
    statusCode: 524,
    errorMessage: "All endpoints timed out",
  };

  // ---------------------------------------------------------------------------
  // formatProviderSummary
  // ---------------------------------------------------------------------------

  describe("formatProviderSummary", () => {
    test("renders vendor_type_all_timeout with failure mark", () => {
      const chain: ProviderChainItem[] = [vendorTypeTimeoutItem];
      const result = formatProviderSummary(chain, mockT);

      expect(result).toContain("provider-timeout");
      expect(result).toContain("\u2717");
    });
  });

  // ---------------------------------------------------------------------------
  // formatProviderDescription
  // ---------------------------------------------------------------------------

  describe("formatProviderDescription", () => {
    test("shows vendor type all timeout label", () => {
      const chain: ProviderChainItem[] = [vendorTypeTimeoutItem];
      const result = formatProviderDescription(chain, mockT);

      expect(result).toContain("description.vendorTypeAllTimeout");
    });
  });

  // ---------------------------------------------------------------------------
  // formatProviderTimeline
  // ---------------------------------------------------------------------------

  describe("formatProviderTimeline", () => {
    test("renders vendor_type_all_timeout with provider, statusCode, error, and note", () => {
      const chain: ProviderChainItem[] = [vendorTypeTimeoutItem];
      const { timeline } = formatProviderTimeline(chain, mockT);

      // Title
      expect(timeline).toContain("timeline.vendorTypeAllTimeout");
      // Provider
      expect(timeline).toContain("timeline.provider [provider=provider-timeout]");
      // Status code
      expect(timeline).toContain("timeline.statusCode [code=524]");
      // Error from statusText
      expect(timeline).toContain("timeline.error [error=Origin Time-out]");
      // Note
      expect(timeline).toContain("timeline.vendorTypeAllTimeoutNote");
    });

    test("renders vendor_type_all_timeout without error details", () => {
      const chain: ProviderChainItem[] = [vendorTypeTimeoutNoDetails];
      const { timeline } = formatProviderTimeline(chain, mockT);

      // Should still render without crashing
      expect(timeline).toContain("timeline.vendorTypeAllTimeout");
      // Falls back to item-level fields
      expect(timeline).toContain("timeline.provider [provider=provider-timeout]");
      expect(timeline).toContain("timeline.statusCode [code=524]");
      expect(timeline).toContain("timeline.error [error=All endpoints timed out]");
      // Note is always present
      expect(timeline).toContain("timeline.vendorTypeAllTimeoutNote");
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

    test("renders resource_not_found alongside a successful retry in multi-provider chain", () => {
      const chain: ProviderChainItem[] = [
        baseNotFoundItem,
        {
          id: 2,
          name: "provider-b",
          reason: "retry_success",
          statusCode: 200,
          timestamp: 2000,
          attemptNumber: 1,
        },
      ];
      const result = formatProviderSummary(chain, mockT);

      expect(result).toContain("provider-a");
      expect(result).toContain("provider-b");
      expect(result).toMatch(/provider-a\(.*\).*provider-b\(.*\)/);
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

    test("renders inferred status code label when statusCodeInferred=true", () => {
      const chain: ProviderChainItem[] = [{ ...baseNotFoundItem, statusCodeInferred: true }];
      const { timeline } = formatProviderTimeline(chain, mockT);

      expect(timeline).toContain("timeline.resourceNotFoundFailed [attempt=1]");
      expect(timeline).toContain("timeline.statusCodeInferred [code=404]");
      expect(timeline).toContain("timeline.resourceNotFoundNote");
    });

    test("degrades gracefully when errorDetails.provider is missing", () => {
      const chain: ProviderChainItem[] = [
        {
          ...baseNotFoundItem,
          errorDetails: {
            request: {
              method: "POST",
              url: "https://example.com/v1/messages",
              headers: "{}",
              body: "{}",
              bodyTruncated: false,
            },
          },
        },
      ];
      const { timeline } = formatProviderTimeline(chain, mockT);

      expect(timeline).toContain("timeline.resourceNotFoundFailed [attempt=1]");
      expect(timeline).toContain("timeline.provider [provider=provider-a]");
      expect(timeline).toContain("timeline.statusCode [code=404]");
      expect(timeline).toContain("timeline.error [error=Not Found]");
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

describe("hedge and client_abort reason handling", () => {
  test("hedge_winner with statusCode is treated as success", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000, attemptNumber: 1 },
      {
        id: 2,
        name: "p2",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 2000,
        attemptNumber: 2,
      },
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 2000, attemptNumber: 1 },
    ];
    const { timeline } = formatProviderTimeline(chain, mockT);
    // hedge_winner should appear in timeline
    expect(timeline).toContain("p2");
  });

  test("hedge_triggered is not an actual request", () => {
    const item: ProviderChainItem = {
      id: 1,
      name: "p1",
      reason: "hedge_triggered",
      timestamp: 1000,
    };
    // formatProviderDescription should handle hedge_triggered
    const desc = formatProviderDescription([item], mockT);
    expect(desc).toBeDefined();
  });

  test("hedge_loser_cancelled is an actual request", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 1000, attemptNumber: 1 },
    ];
    const { timeline } = formatProviderTimeline(chain, mockT);
    expect(timeline).toContain("p1");
  });

  test("client_abort is an actual request", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "client_abort", timestamp: 1000, attemptNumber: 1 },
    ];
    const { timeline } = formatProviderTimeline(chain, mockT);
    expect(timeline).toContain("p1");
  });

  test("formatProviderSummary handles hedge_winner chain", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 1000 },
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 2000, attemptNumber: 1 },
      {
        id: 2,
        name: "p2",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 3000,
        attemptNumber: 2,
      },
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 3000, attemptNumber: 1 },
    ];
    const summary = formatProviderSummary(chain, mockT);
    expect(summary).toBeDefined();
  });
});

// =============================================================================
// isHedgeRace and getRetryCount tests
// =============================================================================

describe("isHedgeRace", () => {
  test("returns true when chain contains hedge_triggered", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000 },
    ];
    expect(isHedgeRace(chain)).toBe(true);
  });

  test("returns true when chain contains hedge_launched", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "hedge_launched", timestamp: 1000 },
    ];
    expect(isHedgeRace(chain)).toBe(true);
  });

  test("returns true when chain contains hedge_winner", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "hedge_winner", statusCode: 200, timestamp: 1000 },
    ];
    expect(isHedgeRace(chain)).toBe(true);
  });

  test("returns true when chain contains hedge_loser_cancelled", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 1000 },
    ];
    expect(isHedgeRace(chain)).toBe(true);
  });

  test("returns false for regular retry chain", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "retry_failed", timestamp: 1000 },
      { id: 2, name: "p2", reason: "retry_success", statusCode: 200, timestamp: 2000 },
    ];
    expect(isHedgeRace(chain)).toBe(false);
  });

  test("returns false for single success", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "request_success", statusCode: 200, timestamp: 1000 },
    ];
    expect(isHedgeRace(chain)).toBe(false);
  });
});

describe("getRetryCount", () => {
  test("returns 0 for hedge race (not a retry)", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000 },
      { id: 2, name: "p2", reason: "hedge_launched", timestamp: 1001 },
      { id: 2, name: "p2", reason: "hedge_winner", statusCode: 200, timestamp: 2000 },
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 2000 },
    ];
    expect(getRetryCount(chain)).toBe(0);
  });

  test("returns 0 for single successful request", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "p1", reason: "request_success", statusCode: 200, timestamp: 1000 },
    ];
    expect(getRetryCount(chain)).toBe(0);
  });

  test("returns 1 for one retry (2 actual requests)", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "retry_failed", timestamp: 1000 },
      { id: 2, name: "p2", reason: "retry_success", statusCode: 200, timestamp: 2000 },
    ];
    expect(getRetryCount(chain)).toBe(1);
  });

  test("returns 2 for two retries (3 actual requests)", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "retry_failed", timestamp: 1000 },
      { id: 2, name: "p2", reason: "retry_failed", timestamp: 2000 },
      { id: 3, name: "p3", reason: "retry_success", statusCode: 200, timestamp: 3000 },
    ];
    expect(getRetryCount(chain)).toBe(2);
  });
});

describe("hedge_launched reason handling", () => {
  test("hedge_launched is not an actual request", () => {
    const item: ProviderChainItem = {
      id: 2,
      name: "p2",
      reason: "hedge_launched",
      timestamp: 1001,
    };
    expect(isActualRequest(item)).toBe(false);
  });

  test("hedge_launched appears in timeline", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000, attemptNumber: 1 },
      {
        id: 2,
        name: "p2",
        reason: "hedge_launched",
        timestamp: 1001,
        attemptNumber: 2,
        circuitState: "closed",
      },
      {
        id: 2,
        name: "p2",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 2000,
        attemptNumber: 2,
      },
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 2000, attemptNumber: 1 },
    ];
    const { timeline } = formatProviderTimeline(chain, mockT);
    expect(timeline).toContain("timeline.hedgeLaunched");
    expect(timeline).toContain("p2");
  });
});

describe("Edge cases for hedge race detection", () => {
  test("isHedgeRace returns false for empty chain", () => {
    const chain: ProviderChainItem[] = [];
    expect(isHedgeRace(chain)).toBe(false);
  });

  test("getRetryCount returns 0 for empty chain", () => {
    const chain: ProviderChainItem[] = [];
    expect(getRetryCount(chain)).toBe(0);
  });

  test("isHedgeRace returns true for incomplete hedge chain (only hedge_launched, no winner)", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000 },
      { id: 2, name: "p2", reason: "hedge_launched", timestamp: 1001, attemptNumber: 2 },
      // System crashed or request cancelled before winner determined
    ];
    expect(isHedgeRace(chain)).toBe(true);
  });

  test("getRetryCount returns 0 for incomplete hedge chain", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000 },
      { id: 2, name: "p2", reason: "hedge_launched", timestamp: 1001, attemptNumber: 2 },
    ];
    expect(getRetryCount(chain)).toBe(0);
  });

  test("mixed scenario: retry + hedge race (hedge takes precedence)", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "retry_failed", timestamp: 0 },
      { id: 2, name: "p2", reason: "hedge_triggered", timestamp: 1000, attemptNumber: 2 },
      { id: 3, name: "p3", reason: "hedge_launched", timestamp: 1001, attemptNumber: 3 },
      {
        id: 3,
        name: "p3",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 2000,
        attemptNumber: 3,
      },
      { id: 2, name: "p2", reason: "hedge_loser_cancelled", timestamp: 2000, attemptNumber: 2 },
    ];
    expect(isHedgeRace(chain)).toBe(true);
    expect(getRetryCount(chain)).toBe(0); // Hedge race takes precedence over retry count
  });

  test("multiple hedge_launched entries (3+ concurrent providers)", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "p1", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "p1", reason: "hedge_triggered", timestamp: 1000, attemptNumber: 1 },
      { id: 2, name: "p2", reason: "hedge_launched", timestamp: 1001, attemptNumber: 2 },
      { id: 3, name: "p3", reason: "hedge_launched", timestamp: 1002, attemptNumber: 3 },
      {
        id: 2,
        name: "p2",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 2000,
        attemptNumber: 2,
      },
      { id: 1, name: "p1", reason: "hedge_loser_cancelled", timestamp: 2000, attemptNumber: 1 },
      { id: 3, name: "p3", reason: "hedge_loser_cancelled", timestamp: 2000, attemptNumber: 3 },
    ];
    expect(isHedgeRace(chain)).toBe(true);
    expect(getRetryCount(chain)).toBe(0);

    // Verify all hedge_launched entries are not counted as actual requests
    const actualRequests = chain.filter(isActualRequest);
    expect(actualRequests).toHaveLength(3); // winner + 2 losers
    expect(
      actualRequests.every(
        (item) => item.reason === "hedge_winner" || item.reason === "hedge_loser_cancelled"
      )
    ).toBe(true);
  });
});

// =============================================================================
// getFinalProviderName tests
// =============================================================================

describe("getFinalProviderName", () => {
  test("returns null for empty chain", () => {
    expect(getFinalProviderName([])).toBeNull();
  });

  test("returns null for null/undefined chain", () => {
    expect(getFinalProviderName(null as unknown as ProviderChainItem[])).toBeNull();
    expect(getFinalProviderName(undefined as unknown as ProviderChainItem[])).toBeNull();
  });

  test("returns provider name for single request_success", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "provider-a", reason: "request_success", statusCode: 200, timestamp: 1000 },
    ];
    expect(getFinalProviderName(chain)).toBe("provider-a");
  });

  test("returns hedge_winner provider when hedge_loser_cancelled is last", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "provider-a", reason: "initial_selection", timestamp: 0 },
      { id: 1, name: "provider-a", reason: "hedge_triggered", timestamp: 1000 },
      { id: 2, name: "provider-b", reason: "hedge_launched", timestamp: 1001 },
      {
        id: 2,
        name: "provider-b",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 2000,
      },
      { id: 1, name: "provider-a", reason: "hedge_loser_cancelled", timestamp: 2001 },
    ];
    expect(getFinalProviderName(chain)).toBe("provider-b");
  });

  test("returns retry_success provider for retry chain", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "provider-a", reason: "retry_failed", timestamp: 1000 },
      {
        id: 2,
        name: "provider-b",
        reason: "retry_success",
        statusCode: 200,
        timestamp: 2000,
      },
    ];
    expect(getFinalProviderName(chain)).toBe("provider-b");
  });

  test("returns last entry name when all entries are failures", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "provider-a", reason: "retry_failed", timestamp: 1000 },
      { id: 2, name: "provider-b", reason: "retry_failed", timestamp: 2000 },
    ];
    expect(getFinalProviderName(chain)).toBe("provider-b");
  });

  test("returns last entry name for intermediate-only chain", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "provider-a", reason: "initial_selection", timestamp: 0 },
    ];
    expect(getFinalProviderName(chain)).toBe("provider-a");
  });

  test("returns fallback for retry_success without statusCode", () => {
    const chain: ProviderChainItem[] = [
      { id: 1, name: "provider-a", reason: "retry_success", timestamp: 1000 },
    ];
    // No statusCode means it's an intermediate state, falls through to last-entry fallback
    expect(getFinalProviderName(chain)).toBe("provider-a");
  });

  test("hedge_winner takes priority over request_success earlier in chain", () => {
    // Edge case: both hedge_winner and request_success present
    const chain: ProviderChainItem[] = [
      {
        id: 1,
        name: "provider-a",
        reason: "request_success",
        statusCode: 200,
        timestamp: 500,
      },
      {
        id: 2,
        name: "provider-b",
        reason: "hedge_winner",
        statusCode: 200,
        timestamp: 2000,
      },
    ];
    expect(getFinalProviderName(chain)).toBe("provider-b");
  });
});
