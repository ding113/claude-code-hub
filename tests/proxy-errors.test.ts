/**
 * Unit Tests for isNonRetryableClientError Backward Compatibility
 *
 * Purpose:
 * - Verify that isNonRetryableClientError function maintains backward compatibility
 * - Test integration with database-driven ErrorRuleDetector
 * - Validate error message extraction from ProxyError
 * - Ensure all 7 default rules work correctly
 *
 * Test Coverage:
 * 1. 7 default error rules (each with match/no-match cases)
 * 2. ProxyError message extraction (Claude/OpenAI/FastAPI formats)
 * 3. Edge cases (null, undefined, empty strings)
 * 4. Backward compatibility with hardcoded regex patterns
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { ProxyError, isNonRetryableClientError } from "@/app/v1/_lib/proxy/errors";
import { errorRuleDetector } from "@/lib/error-rule-detector";

// Wait for initial cache load
beforeAll(async () => {
  // Give ErrorRuleDetector time to initialize cache from database
  await new Promise((resolve) => setTimeout(resolve, 1000));
});

describe("isNonRetryableClientError - 7 Default Rules", () => {
  /**
   * Rule 1: Prompt Token Limit
   * Pattern: "prompt is too long.*maximum.*tokens"
   */
  describe("Rule 1: Prompt Token Limit", () => {
    test("should match: prompt too long error", () => {
      const error = new Error("prompt is too long: 5000 tokens > 4096 maximum");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: different format", () => {
      const error = new Error("The prompt is too long. Maximum allowed is 4096 tokens.");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Network timeout");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });

  /**
   * Rule 2: Content Filter
   * Pattern: "blocked by.*content filter"
   */
  describe("Rule 2: Content Filter", () => {
    test("should match: content filter block", () => {
      const error = new Error("blocked by our content filter policy");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: safety filter", () => {
      const error = new Error("Your request was blocked by the content filter");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Request blocked by firewall");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });

  /**
   * Rule 3: PDF Page Limit
   * Pattern: "PDF has too many pages.*maximum.*pages"
   */
  describe("Rule 3: PDF Page Limit", () => {
    test("should match: PDF page limit exceeded", () => {
      const error = new Error("PDF has too many pages: 150 > 100 maximum pages");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: different format", () => {
      const error = new Error("The PDF has too many pages. Maximum is 100 pages.");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Failed to parse PDF");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });

  /**
   * Rule 4: Thinking Block Format
   * Pattern: "thinking.*format.*invalid|Expected.*thinking.*but found"
   */
  describe("Rule 4: Thinking Block Format", () => {
    test("should match: invalid thinking format", () => {
      const error = new Error("thinking block format is invalid");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: expected thinking block", () => {
      const error = new Error("Expected thinking block but found text");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Internal server error");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });

  /**
   * Rule 5: Parameter Validation
   * Pattern: "Missing required parameter|Extra inputs.*not permitted"
   */
  describe("Rule 5: Parameter Validation", () => {
    test("should match: missing required parameter", () => {
      const error = new Error("Missing required parameter: model");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: extra inputs not permitted", () => {
      const error = new Error("Extra inputs are not permitted: tools");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Database connection failed");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });

  /**
   * Rule 6: Invalid Request
   * Pattern: "非法请求|illegal request|invalid request"
   */
  describe("Rule 6: Invalid Request", () => {
    test("should match: Chinese illegal request", () => {
      const error = new Error("非法请求");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: illegal request", () => {
      const error = new Error("illegal request format");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: invalid request", () => {
      const error = new Error("invalid request: malformed JSON");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Request timeout");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });

  /**
   * Rule 7: Cache Control Limit
   * Pattern: "(cache_control.*(limit|maximum).*blocks|(maximum|limit).*blocks.*cache_control)"
   */
  describe("Rule 7: Cache Control Limit", () => {
    test("should match: cache_control limit exceeded", () => {
      const error = new Error("cache_control limit exceeded: 5 blocks > 4 maximum");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: different format", () => {
      const error = new Error("The cache_control has too many limit blocks");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should match: Anthropic API format", () => {
      const error = new Error("A maximum of 4 blocks with cache_control may be provided. Found 5.");
      expect(isNonRetryableClientError(error)).toBe(true);
    });

    test("should NOT match: unrelated error", () => {
      const error = new Error("Cache miss");
      expect(isNonRetryableClientError(error)).toBe(false);
    });
  });
});

describe("ProxyError Message Extraction", () => {
  /**
   * Test error message extraction from ProxyError.upstreamError.parsed
   */
  test("should extract from Claude API format", () => {
    const mockResponse = new Response(
      JSON.stringify({
        error: {
          type: "invalid_request_error",
          message: "prompt is too long: 5000 tokens > 4096 maximum",
        },
      }),
      {
        status: 400,
        headers: { "content-type": "application/json" },
      }
    );

    ProxyError.fromUpstreamResponse(mockResponse, { id: 1, name: "test-provider" }).then(
      (error) => {
        expect(isNonRetryableClientError(error)).toBe(true);
      }
    );
  });

  test("should extract from OpenAI API format", () => {
    const error = new ProxyError("Test error", 400, {
      body: '{"error":{"message":"Missing required parameter: model"}}',
      parsed: {
        error: {
          message: "Missing required parameter: model",
        },
      },
    });

    expect(isNonRetryableClientError(error)).toBe(true);
  });

  test("should extract from FastAPI/Pydantic format (智谱等供应商)", () => {
    const error = new ProxyError("Test error", 422, {
      body: '{"detail":[{"msg":"Extra inputs are not permitted"}]}',
      parsed: {
        detail: [
          {
            msg: "Extra inputs are not permitted",
          },
        ],
      },
    });

    expect(isNonRetryableClientError(error)).toBe(true);
  });

  test("should handle simple ProxyError without parsed data", () => {
    const error = new ProxyError("blocked by our content filter policy", 400);

    expect(isNonRetryableClientError(error)).toBe(true);
  });
});

describe("Edge Cases and Boundary Conditions", () => {
  test("should handle empty error message", () => {
    const error = new Error("");
    expect(isNonRetryableClientError(error)).toBe(false);
  });

  test("should handle whitespace-only message", () => {
    const error = new Error("   ");
    expect(isNonRetryableClientError(error)).toBe(false);
  });

  test("should handle very long error message", () => {
    const longMessage = "prompt is too long: " + "x".repeat(10000) + " maximum tokens";
    const error = new Error(longMessage);
    expect(isNonRetryableClientError(error)).toBe(true);
  });

  test("should be case-insensitive", () => {
    const error1 = new Error("PROMPT IS TOO LONG: 5000 TOKENS > 4096 MAXIMUM");
    const error2 = new Error("Prompt Is Too Long: 5000 Tokens > 4096 Maximum");
    expect(isNonRetryableClientError(error1)).toBe(true);
    expect(isNonRetryableClientError(error2)).toBe(true);
  });
});

describe("Backward Compatibility with Hardcoded Patterns", () => {
  /**
   * Verify that database-driven detection produces the same results as hardcoded regex
   */
  test("should maintain same behavior as hardcoded version", () => {
    const testCases = [
      // Should match (true)
      { message: "prompt is too long: 5000 tokens > 4096 maximum", expected: true },
      { message: "blocked by our content filter policy", expected: true },
      { message: "PDF has too many pages: 150 > 100 maximum pages", expected: true },
      { message: "thinking block format is invalid", expected: true },
      { message: "Missing required parameter: model", expected: true },
      { message: "非法请求", expected: true },
      { message: "cache_control limit exceeded: 5 blocks", expected: true },

      // Should NOT match (false)
      { message: "Network timeout", expected: false },
      { message: "Internal server error", expected: false },
      { message: "Database connection failed", expected: false },
      { message: "Request timeout", expected: false },
    ];

    for (const { message, expected } of testCases) {
      const error = new Error(message);
      expect(isNonRetryableClientError(error)).toBe(expected);
    }
  });
});

describe("ErrorRuleDetector Cache Status", () => {
  test("should have loaded rules from database", () => {
    const stats = errorRuleDetector.getStats();

    // Should have at least 7 default rules
    expect(stats.totalCount).toBeGreaterThanOrEqual(7);
    expect(stats.lastReloadTime).toBeGreaterThan(0);
    expect(stats.isLoading).toBe(false);
  });

  test("should not be empty", () => {
    expect(errorRuleDetector.isEmpty()).toBe(false);
  });
});
