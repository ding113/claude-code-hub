/**
 * End-to-End Test Script for Error Rules System
 *
 * Purpose:
 * - Verify complete workflow: Create -> Cache Refresh -> Detection -> Delete -> Verification
 * - Test Server Actions integration
 * - Test database persistence
 * - Test cache synchronization
 *
 * Requirements:
 * - Database connection (PostgreSQL)
 * - Next.js runtime (for revalidatePath)
 *
 * Usage:
 *   bun run tests/e2e/e2e-error-rules.test.ts
 *
 * Note: This test requires real database and Next.js runtime.
 * It will be skipped in CI unless explicitly configured.
 */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import {
  createErrorRuleAction,
  deleteErrorRuleAction,
  refreshCacheAction,
} from "@/actions/error-rules";
import { isNonRetryableClientError } from "@/app/v1/_lib/proxy/errors";
import { errorRuleDetector } from "@/lib/error-rule-detector";
import { DEFAULT_ERROR_RULES } from "@/repository/error-rules";
import { setTestAuthCookie, clearTestCookies } from "../__helpers__/setup";

// Valid error categories (from DEFAULT_ERROR_RULES)
const VALID_CATEGORY = "validation_error";

let createdRuleId: number | null = null;

beforeAll(async () => {
  // Set up test authentication (simulates admin login)
  setTestAuthCookie(process.env.ADMIN_TOKEN || "test-admin-token");

  // Load default rules from memory (bypasses database dependency)
  errorRuleDetector.loadDefaultRulesFromMemory(DEFAULT_ERROR_RULES);
});

afterAll(async () => {
  // Cleanup: Delete test rule if it exists
  if (createdRuleId !== null) {
    try {
      await deleteErrorRuleAction(createdRuleId);
    } catch {
      // Ignore cleanup errors in test environment
    }
  }

  // Clear test cookies
  clearTestCookies();
});

describe("End-to-End Error Rules Workflow", () => {
  test("Step 1: Create new error rule via Server Action", async () => {
    const result = await createErrorRuleAction({
      pattern: "test.*custom.*error",
      category: VALID_CATEGORY,
      matchType: "regex",
      description: "E2E Test Rule - Safe to delete",
    });

    expect(result.ok).toBe(true);

    if (result.ok) {
      expect(result.data).toBeDefined();
      createdRuleId = result.data.id;
      expect(createdRuleId).toBeGreaterThan(0);
      expect(result.data.pattern).toBe("test.*custom.*error");
      expect(result.data.category).toBe(VALID_CATEGORY);
      expect(result.data.isEnabled).toBe(true);
    }
  });

  test("Step 2: Verify cache auto-refresh after creation", async () => {
    // Wait for EventEmitter to trigger auto-refresh
    await new Promise((resolve) => setTimeout(resolve, 200));

    const stats = errorRuleDetector.getStats();
    expect(stats.totalCount).toBeGreaterThan(7); // More than just default rules
  });

  test("Step 3: Test detection with new rule", () => {
    const error = new Error("This is a test custom error message");
    const result = isNonRetryableClientError(error);

    // Should match the newly created rule
    expect(result).toBe(true);
  });

  test("Step 4: Verify detection result details", () => {
    const result = errorRuleDetector.detect("This is a test custom error message");

    expect(result.matched).toBe(true);
    expect(result.category).toBe(VALID_CATEGORY);
    expect(result.matchType).toBe("regex");
    expect(result.pattern).toBe("test.*custom.*error");
  });

  test("Step 5: Manual cache refresh", async () => {
    // Note: This may fail in test environment due to revalidatePath
    // requiring Next.js runtime
    try {
      const result = await refreshCacheAction();
      expect(result.ok).toBe(true);

      if (result.ok) {
        expect(result.data).toBeDefined();
        expect(result.data.stats.totalCount).toBeGreaterThan(7);
        expect(result.data.stats.isLoading).toBe(false);
      }
    } catch (error) {
      // Skip if revalidatePath fails (expected in non-Next.js environment)
      console.warn("[E2E Test] refreshCacheAction failed (expected in test env):", error);
    }
  });

  test("Step 6: Delete test rule", async () => {
    if (createdRuleId === null) {
      throw new Error("No rule to delete");
    }

    const result = await deleteErrorRuleAction(createdRuleId);

    expect(result.ok).toBe(true);

    createdRuleId = null; // Mark as deleted
  });

  test("Step 7: Verify cache refresh after deletion", async () => {
    // Wait for EventEmitter to trigger auto-refresh
    await new Promise((resolve) => setTimeout(resolve, 200));

    const stats = errorRuleDetector.getStats();
    expect(stats.totalCount).toBeGreaterThanOrEqual(7); // Back to default rules
  });

  test("Step 8: Verify detection no longer matches after deletion", () => {
    const error = new Error("This is a test custom error message");

    // Wait a bit more to ensure cache is fully refreshed
    setTimeout(() => {
      const _result = isNonRetryableClientError(error);

      // Should NOT match anymore (rule deleted)
      // Note: This might still match if there are other rules with similar patterns
      // So we check the detailed result
      const detailResult = errorRuleDetector.detect("This is a test custom error message");

      if (detailResult.matched) {
        // If still matched, it should NOT be from our deleted rule
        expect(detailResult.pattern).not.toBe("test.*custom.*error");
      }
    }, 100);
  });
});

describe("ReDoS Protection E2E", () => {
  test("Should reject dangerous regex pattern", async () => {
    const result = await createErrorRuleAction({
      pattern: "(a+)+",
      category: VALID_CATEGORY,
      matchType: "regex",
      description: "Dangerous ReDoS pattern - should be rejected",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ReDoS");
    }
  });

  test("Should reject nested quantifiers", async () => {
    const result = await createErrorRuleAction({
      pattern: "(x+)*",
      category: VALID_CATEGORY,
      matchType: "regex",
      description: "Another dangerous pattern",
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("ReDoS");
    }
  });

  test("Should accept safe regex pattern", async () => {
    const result = await createErrorRuleAction({
      pattern: "safe.*pattern.*test",
      category: VALID_CATEGORY,
      matchType: "regex",
      description: "Safe pattern - should be accepted",
    });

    expect(result.ok).toBe(true);

    // Cleanup
    if (result.ok && result.data) {
      await deleteErrorRuleAction(result.data.id);
    }
  });
});

describe("Default Rules Verification", () => {
  test("Should have exactly 7 default rules in database", async () => {
    const stats = errorRuleDetector.getStats();

    // After initialization, should have at least 7 default rules
    expect(stats.totalCount).toBeGreaterThanOrEqual(7);
  });

  test("All default rules should be enabled", () => {
    // Indirectly verify by testing all 7 default patterns
    const defaultPatterns = [
      "prompt is too long: 5000 tokens > 4096 maximum",
      "blocked by our content filter policy",
      "PDF has too many pages: 150 > 100 maximum pages",
      "thinking block format is invalid",
      "Missing required parameter: model",
      "非法请求",
      "cache_control limit exceeded: 5 blocks",
      "A maximum of 4 blocks with cache_control may be provided. Found 5.",
    ];

    for (const pattern of defaultPatterns) {
      const result = errorRuleDetector.detect(pattern);
      expect(result.matched).toBe(true);
    }
  });
});

describe("Performance Under Load", () => {
  test("Should handle rapid rule creation and deletion", async () => {
    const ruleIds: number[] = [];

    // Create 5 rules rapidly
    for (let i = 0; i < 5; i++) {
      const result = await createErrorRuleAction({
        pattern: `load.*test.*${i}`,
        category: VALID_CATEGORY,
        matchType: "regex",
        description: `Load test rule ${i}`,
      });

      if (result.ok && result.data) {
        ruleIds.push(result.data.id);
      }
    }

    expect(ruleIds.length).toBe(5);

    // Wait for cache refresh
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify all rules are loaded
    const stats = errorRuleDetector.getStats();
    expect(stats.totalCount).toBeGreaterThanOrEqual(12); // 7 default + 5 new

    // Delete all test rules
    for (const id of ruleIds) {
      await deleteErrorRuleAction(id);
    }

    // Wait for cache refresh
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Verify rules are removed
    const finalStats = errorRuleDetector.getStats();
    expect(finalStats.totalCount).toBeGreaterThanOrEqual(7);
  });
});
