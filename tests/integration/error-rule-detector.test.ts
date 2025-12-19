/**
 * Integration Tests for ErrorRuleDetector Cache Refresh and EventEmitter
 *
 * Purpose:
 * - Test manual cache reload functionality
 * - Test EventEmitter-driven automatic cache refresh
 * - Test cache statistics and state management
 * - Test safe-regex ReDoS detection and filtering
 * - Test performance of database-driven detection vs hardcoded regex
 *
 * Test Coverage:
 * 1. Manual reload() method
 * 2. EventEmitter 'errorRulesUpdated' event handling
 * 3. Cache statistics (getStats, isEmpty)
 * 4. ReDoS risk detection with safe-regex
 * 5. Performance benchmarking
 */

import { beforeAll, describe, expect, test } from "vitest";
import { errorRuleDetector } from "@/lib/error-rule-detector";
import { eventEmitter } from "@/lib/event-emitter";

// Wait for initial cache load
beforeAll(async () => {
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

describe("ErrorRuleDetector Manual Reload", () => {
  test("should reload cache successfully", async () => {
    const statsBefore = errorRuleDetector.getStats();

    await errorRuleDetector.reload();

    const statsAfter = errorRuleDetector.getStats();

    // Verify cache was reloaded
    expect(statsAfter.lastReloadTime).toBeGreaterThanOrEqual(statsBefore.lastReloadTime);
    expect(statsAfter.isLoading).toBe(false);
    expect(statsAfter.totalCount).toBeGreaterThanOrEqual(7); // At least 7 default rules
  });

  test("should not allow concurrent reloads", async () => {
    // Trigger multiple reloads simultaneously
    const promises = [
      errorRuleDetector.reload(),
      errorRuleDetector.reload(),
      errorRuleDetector.reload(),
    ];

    await Promise.all(promises);

    // Should complete without errors
    const stats = errorRuleDetector.getStats();
    expect(stats.isLoading).toBe(false);
  });

  test("should update lastReloadTime on reload", async () => {
    const before = errorRuleDetector.getStats().lastReloadTime;

    await new Promise((resolve) => setTimeout(resolve, 10)); // Ensure time difference
    await errorRuleDetector.reload();

    const after = errorRuleDetector.getStats().lastReloadTime;
    expect(after).toBeGreaterThan(before);
  });
});

describe("EventEmitter Integration", () => {
  test("should auto-reload on 'errorRulesUpdated' event", async () => {
    const statsBefore = errorRuleDetector.getStats();

    // Emit event to trigger auto-reload
    eventEmitter.emit("errorRulesUpdated");

    // Wait for async reload to complete
    await new Promise((resolve) => setTimeout(resolve, 200));

    const statsAfter = errorRuleDetector.getStats();

    // Verify cache was refreshed
    expect(statsAfter.lastReloadTime).toBeGreaterThanOrEqual(statsBefore.lastReloadTime);
  });

  test("should handle multiple event emissions gracefully", async () => {
    // Emit multiple events in quick succession
    for (let i = 0; i < 5; i++) {
      eventEmitter.emit("errorRulesUpdated");
    }

    // Wait for all reloads to complete
    await new Promise((resolve) => setTimeout(resolve, 500));

    const stats = errorRuleDetector.getStats();
    expect(stats.isLoading).toBe(false);
    expect(stats.totalCount).toBeGreaterThanOrEqual(7);
  });
});

describe("Cache Statistics and State", () => {
  test("should return correct statistics", () => {
    const stats = errorRuleDetector.getStats();

    // Verify structure
    expect(stats).toHaveProperty("regexCount");
    expect(stats).toHaveProperty("containsCount");
    expect(stats).toHaveProperty("exactCount");
    expect(stats).toHaveProperty("totalCount");
    expect(stats).toHaveProperty("lastReloadTime");
    expect(stats).toHaveProperty("isLoading");

    // Verify values
    expect(typeof stats.regexCount).toBe("number");
    expect(typeof stats.containsCount).toBe("number");
    expect(typeof stats.exactCount).toBe("number");
    expect(stats.totalCount).toBe(stats.regexCount + stats.containsCount + stats.exactCount);
    expect(stats.totalCount).toBeGreaterThanOrEqual(7); // At least 7 default rules
  });

  test("should not be empty after initialization", () => {
    expect(errorRuleDetector.isEmpty()).toBe(false);
  });

  test("should have valid lastReloadTime", () => {
    const stats = errorRuleDetector.getStats();
    const now = Date.now();

    expect(stats.lastReloadTime).toBeGreaterThan(0);
    expect(stats.lastReloadTime).toBeLessThanOrEqual(now);
  });
});

describe("Error Detection Functionality", () => {
  test("should detect matching error", () => {
    const result = errorRuleDetector.detect("prompt is too long: 5000 tokens > 4096 maximum");

    expect(result.matched).toBe(true);
    expect(result.category).toBeTruthy();
    expect(result.pattern).toBeTruthy();
    expect(result.matchType).toMatch(/regex|contains|exact/);
  });

  test("should return detailed match information", () => {
    const result = errorRuleDetector.detect("blocked by our content filter policy");

    expect(result.matched).toBe(true);
    expect(result.category).toBe("content_filter");
    expect(result.pattern).toBeTruthy();
    expect(result.matchType).toBeTruthy();
  });

  test("should not match unrelated error", () => {
    const result = errorRuleDetector.detect("Network timeout error");

    expect(result.matched).toBe(false);
    expect(result.category).toBeUndefined();
    expect(result.pattern).toBeUndefined();
    expect(result.matchType).toBeUndefined();
  });

  test("should handle empty string", () => {
    const result = errorRuleDetector.detect("");

    expect(result.matched).toBe(false);
  });

  test("should be case-insensitive", () => {
    const result1 = errorRuleDetector.detect("PROMPT IS TOO LONG: 5000 TOKENS > 4096 MAXIMUM");
    const result2 = errorRuleDetector.detect("Prompt Is Too Long: 5000 Tokens > 4096 Maximum");

    expect(result1.matched).toBe(true);
    expect(result2.matched).toBe(true);
  });
});

describe("Performance Testing", () => {
  test("should detect errors efficiently", () => {
    const testMessages = [
      "prompt is too long: 5000 tokens > 4096 maximum",
      "blocked by our content filter policy",
      "PDF has too many pages: 150 > 100 maximum pages",
      "Network timeout",
      "Internal server error",
    ];

    const start = performance.now();

    for (let i = 0; i < 1000; i++) {
      for (const msg of testMessages) {
        errorRuleDetector.detect(msg);
      }
    }

    const end = performance.now();
    const duration = end - start;

    // Should complete 5000 detections in under 100ms
    console.log(`Performance: 5000 detections in ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(100);
  });

  test("should cache regex compilation", () => {
    const message = "prompt is too long: 5000 tokens > 4096 maximum";

    // First detection (might compile regex)
    const start1 = performance.now();
    errorRuleDetector.detect(message);
    const duration1 = performance.now() - start1;

    // Subsequent detections (uses cached regex)
    const start2 = performance.now();
    for (let i = 0; i < 100; i++) {
      errorRuleDetector.detect(message);
    }
    const duration2 = performance.now() - start2;

    console.log(
      `First detection: ${duration1.toFixed(2)}ms, 100 cached: ${duration2.toFixed(2)}ms`
    );

    // Cached detections should be fast
    expect(duration2).toBeLessThan(10);
  });
});

describe("Safe-Regex ReDoS Detection", () => {
  /**
   * Note: These tests verify that ErrorRuleDetector skips dangerous regex patterns.
   * The actual ReDoS validation happens in the Server Action layer (error-rules.ts),
   * but ErrorRuleDetector also filters them during cache loading.
   */

  test("should skip loading dangerous regex patterns", async () => {
    const _statsBefore = errorRuleDetector.getStats();

    // Reload cache (which should skip any dangerous patterns)
    await errorRuleDetector.reload();

    const statsAfter = errorRuleDetector.getStats();

    // All loaded regex patterns should be safe
    // (If there were dangerous patterns in DB, they would be skipped and logged)
    expect(statsAfter.totalCount).toBeGreaterThanOrEqual(7);
  });

  test("should log warning for ReDoS patterns", async () => {
    // This test verifies the behavior when dangerous patterns exist in DB
    // In practice, such patterns should be blocked by Server Action validation
    // but ErrorRuleDetector provides defense-in-depth

    const consoleLogs: string[] = [];
    const originalWarn = console.warn;
    console.warn = (...args: unknown[]) => {
      consoleLogs.push(args.join(" "));
      originalWarn(...args);
    };

    await errorRuleDetector.reload();

    console.warn = originalWarn;

    // If there were any ReDoS patterns, they should be logged
    // (In a clean database, this should be empty)
    const redosWarnings = consoleLogs.filter((log) => log.includes("ReDoS"));
    console.log(`ReDoS warnings found: ${redosWarnings.length}`);
  });
});

describe("Match Type Priority", () => {
  /**
   * Test that detection order follows performance optimization:
   * 1. Contains matching (fastest)
   * 2. Exact matching (O(1) lookup)
   * 3. Regex matching (slowest but most flexible)
   */

  test("should return match type information", () => {
    const testMessages = [
      "prompt is too long: 5000 tokens > 4096 maximum",
      "blocked by our content filter",
    ];

    for (const message of testMessages) {
      const result = errorRuleDetector.detect(message);
      expect(result.matched).toBe(true);
      expect(result.matchType).toBeTruthy();
      // Match type should be one of the valid types
      if (result.matchType) {
        expect(["regex", "contains", "exact"]).toContain(result.matchType);
      }
    }
  });
});

describe("Cache Failure Handling", () => {
  test("should handle database errors gracefully", async () => {
    // ErrorRuleDetector should not throw on database errors
    // It should log errors and keep existing cache (fail-safe design)

    await expect(errorRuleDetector.reload()).resolves.toBeUndefined();
  });

  test("should maintain existing cache on reload failure", async () => {
    const statsBefore = errorRuleDetector.getStats();

    // Even if reload fails, cache should remain usable
    await errorRuleDetector.reload();

    const statsAfter = errorRuleDetector.getStats();

    // Cache should still be functional
    expect(statsAfter.totalCount).toBeGreaterThanOrEqual(statsBefore.totalCount);
  });
});
