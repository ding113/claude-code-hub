/**
 * Error rule category-aware classification tests
 *
 * Validates that isNonRetryableClientErrorAsync (and the sync companion)
 * only classify a matched error as NON_RETRYABLE_CLIENT_ERROR when the
 * matched rule's category is one of the recognised client-input categories.
 *
 * Without this guard, user-added rules with category like "service_error"
 * or "network_error" would be incorrectly white-listed, causing
 * categorizeErrorAsync to short-circuit failover/circuit-breaker logic
 * for upstream/transport problems that should be retried or routed to a
 * different provider.
 *
 * Repro context (CCH 0.7.2 production):
 * - User added rule pattern "529|service.overloaded" with category=service_error
 * - Upstream INSUFFICIENT_BALANCE response body contained substring "529"
 *   (e.g. inside "0.352942" price amount or request id)
 * - Old logic flagged the error as NON_RETRYABLE_CLIENT_ERROR -> stopped
 *   failover -> client received generic "permission_error"
 * - Expected: service_error category should NOT be white-listed; the error
 *   falls back to PROVIDER_ERROR and standard failover applies.
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const listeners = new Map<string, Set<(...args: unknown[]) => void>>();

  return {
    getActiveErrorRules: vi.fn(),
    subscribeCacheInvalidation: vi.fn(async () => undefined),
    eventEmitter: {
      on(event: string, handler: (...args: unknown[]) => void) {
        const current = listeners.get(event) ?? new Set<(...args: unknown[]) => void>();
        current.add(handler);
        listeners.set(event, current);
      },
      emit(event: string, ...args: unknown[]) {
        for (const handler of listeners.get(event) ?? []) {
          handler(...args);
        }
      },
      removeAllListeners() {
        listeners.clear();
      },
    },
    logger: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      trace: vi.fn(),
      error: vi.fn(),
      fatal: vi.fn(),
    },
  };
});

vi.mock("@/repository/error-rules", () => ({
  getActiveErrorRules: mocks.getActiveErrorRules,
}));

vi.mock("@/lib/event-emitter", () => ({
  eventEmitter: mocks.eventEmitter,
}));

vi.mock("@/lib/redis/pubsub", () => ({
  CHANNEL_ERROR_RULES_UPDATED: "errorRulesUpdated",
  subscribeCacheInvalidation: mocks.subscribeCacheInvalidation,
}));

vi.mock("@/lib/logger", () => ({
  logger: mocks.logger,
}));

interface BuildRuleOverrides {
  id?: number;
  pattern?: string;
  matchType?: "regex" | "contains" | "exact";
  category?: string;
  description?: string;
  isEnabled?: boolean;
  isDefault?: boolean;
  priority?: number;
}

function buildRule(overrides: BuildRuleOverrides = {}) {
  return {
    id: 100,
    pattern: "default-pattern",
    matchType: "contains" as const,
    category: "validation_error",
    description: "test rule",
    overrideResponse: undefined,
    overrideStatusCode: undefined,
    isEnabled: true,
    isDefault: false,
    priority: 10,
    createdAt: new Date("2026-04-25T00:00:00.000Z"),
    updatedAt: new Date("2026-04-25T00:00:00.000Z"),
    ...overrides,
  };
}

async function loadDetectorWithRules(rules: ReturnType<typeof buildRule>[]) {
  mocks.getActiveErrorRules.mockResolvedValue(rules);

  const { errorRuleDetector } = await import("@/lib/error-rule-detector");
  await new Promise((resolve) => setTimeout(resolve, 0));
  await errorRuleDetector.reload();

  return errorRuleDetector;
}

describe("isNonRetryableClientErrorAsync - category-aware white-list", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eventEmitter.removeAllListeners();
  });

  afterEach(() => {
    mocks.eventEmitter.removeAllListeners();
  });

  test("matches rule with white-listed category (validation_error) -> NON_RETRYABLE", async () => {
    await loadDetectorWithRules([
      buildRule({ pattern: "ValidationException", category: "validation_error" }),
    ]);

    const { isNonRetryableClientErrorAsync, ProxyError } = await import(
      "@/app/v1/_lib/proxy/errors"
    );
    const error = new ProxyError("ValidationException: bad input", 400, {
      body: '{"error":{"type":"validation","message":"ValidationException"}}',
      parsed: null,
      providerId: 1,
      providerName: "test",
    });

    expect(await isNonRetryableClientErrorAsync(error)).toBe(true);
  });

  test("matches rule with non-white-listed category (service_error) -> NOT NON_RETRYABLE", async () => {
    await loadDetectorWithRules([
      buildRule({
        id: 40,
        pattern: "529|service.overloaded",
        matchType: "regex",
        category: "service_error",
      }),
    ]);

    const { isNonRetryableClientErrorAsync, ProxyError } = await import(
      "@/app/v1/_lib/proxy/errors"
    );
    // Reproduces real-world false positive: substring "529" appears inside
    // the price amount "0.352942" of an INSUFFICIENT_BALANCE response body.
    const error = new ProxyError("Provider returned 403: insufficient balance", 403, {
      body: '{"error":{"type":"new_api_error","message":"insufficient balance, remaining: 0.214220, required: 0.352942"}}',
      parsed: null,
      providerId: 92,
      providerName: "test-upstream",
    });

    expect(await isNonRetryableClientErrorAsync(error)).toBe(false);
  });

  test("matches rule with non-white-listed category (network_error) -> NOT NON_RETRYABLE", async () => {
    await loadDetectorWithRules([
      buildRule({
        id: 38,
        pattern: "ECONNREFUSED|ECONNRESET",
        matchType: "regex",
        category: "network_error",
      }),
    ]);

    const { isNonRetryableClientErrorAsync } = await import("@/app/v1/_lib/proxy/errors");
    const error = new Error("connect ECONNREFUSED 127.0.0.1:8080");

    expect(await isNonRetryableClientErrorAsync(error)).toBe(false);
  });

  test("matches rule with non-white-listed category (rate_limit) -> NOT NON_RETRYABLE", async () => {
    await loadDetectorWithRules([
      buildRule({
        id: 36,
        pattern: "rate_limit_error|rate.limit",
        matchType: "regex",
        category: "rate_limit",
      }),
    ]);

    const { isNonRetryableClientErrorAsync, ProxyError } = await import(
      "@/app/v1/_lib/proxy/errors"
    );
    const error = new ProxyError("Provider returned 429: rate_limit_error", 429, {
      body: '{"error":{"type":"rate_limit_error"}}',
      parsed: null,
      providerId: 1,
      providerName: "test",
    });

    expect(await isNonRetryableClientErrorAsync(error)).toBe(false);
  });

  test("no rule match -> NOT NON_RETRYABLE", async () => {
    await loadDetectorWithRules([
      buildRule({ pattern: "completely-unrelated-pattern", category: "validation_error" }),
    ]);

    const { isNonRetryableClientErrorAsync } = await import("@/app/v1/_lib/proxy/errors");
    const error = new Error("a totally different error message");

    expect(await isNonRetryableClientErrorAsync(error)).toBe(false);
  });

  test("each white-listed category triggers NON_RETRYABLE classification", async () => {
    const { getNonRetryableClientErrorCategoriesForTesting } = await import(
      "@/app/v1/_lib/proxy/errors"
    );
    const categories = Array.from(getNonRetryableClientErrorCategoriesForTesting());

    expect(categories.length).toBeGreaterThan(0);

    for (let i = 0; i < categories.length; i++) {
      const category = categories[i];
      vi.resetModules();
      vi.clearAllMocks();
      mocks.eventEmitter.removeAllListeners();

      const sentinel = `__sentinel_${i}_${category}__`;
      await loadDetectorWithRules([
        buildRule({
          id: 200 + i,
          pattern: sentinel,
          matchType: "contains",
          category,
        }),
      ]);

      const { isNonRetryableClientErrorAsync: detect } = await import("@/app/v1/_lib/proxy/errors");
      const error = new Error(`upstream said: ${sentinel}`);

      expect(
        await detect(error),
        `category="${category}" should be classified as NON_RETRYABLE`
      ).toBe(true);
    }
  });
});

describe("categorizeErrorAsync - regression: service_error rule must not stop failover", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eventEmitter.removeAllListeners();
  });

  afterEach(() => {
    mocks.eventEmitter.removeAllListeners();
  });

  test("substring match on user-added service_error rule still produces PROVIDER_ERROR", async () => {
    // User-added rule with substring-prone pattern (no \b boundary).
    await loadDetectorWithRules([
      buildRule({
        id: 41,
        pattern: "503|service.unavailable",
        matchType: "regex",
        category: "service_error",
      }),
    ]);

    const { ErrorCategory, categorizeErrorAsync, ProxyError } = await import(
      "@/app/v1/_lib/proxy/errors"
    );

    // INSUFFICIENT_BALANCE 403 response body where "503" appears as a
    // substring inside the request-id token.
    const error = new ProxyError("Provider returned 403: insufficient balance", 403, {
      body: '{"error":{"message":"insufficient balance (request id: 202604250550399959166838268d9d6K9sUhgdW)"}}',
      parsed: null,
      providerId: 85,
      providerName: "synai996_Aws",
    });

    // Without the fix, this would return NON_RETRYABLE_CLIENT_ERROR
    // because the rule's `matched=true` short-circuits classification.
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });

  test("network_error rule on Error instance still produces SYSTEM_ERROR", async () => {
    await loadDetectorWithRules([
      buildRule({
        id: 37,
        pattern: "timeout|timed.out|ETIMEDOUT",
        matchType: "regex",
        category: "network_error",
      }),
    ]);

    const { ErrorCategory, categorizeErrorAsync } = await import("@/app/v1/_lib/proxy/errors");

    const error = new Error("ETIMEDOUT: connection timed out after 30000ms");
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.SYSTEM_ERROR);
  });

  test("validation_error rule (white-listed) still produces NON_RETRYABLE_CLIENT_ERROR", async () => {
    await loadDetectorWithRules([
      buildRule({
        id: 5,
        pattern: "ValidationException",
        matchType: "contains",
        category: "validation_error",
      }),
    ]);

    const { ErrorCategory, categorizeErrorAsync, ProxyError } = await import(
      "@/app/v1/_lib/proxy/errors"
    );
    const error = new ProxyError("Provider returned 400: ValidationException", 400, {
      body: '{"error":"ValidationException: invalid model"}',
      parsed: null,
      providerId: 1,
      providerName: "test",
    });

    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });
});

describe("isNonRetryableClientError (sync) - category-aware white-list", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.eventEmitter.removeAllListeners();
  });

  afterEach(() => {
    mocks.eventEmitter.removeAllListeners();
  });

  test("sync version respects white-list when cache hit", async () => {
    await loadDetectorWithRules([
      buildRule({
        id: 40,
        pattern: "service-overloaded-token",
        matchType: "contains",
        category: "service_error",
      }),
    ]);

    const { isNonRetryableClientError, isNonRetryableClientErrorAsync } = await import(
      "@/app/v1/_lib/proxy/errors"
    );

    const error = new Error("upstream said: service-overloaded-token");
    // Prime the cache via async path first so sync path hits the cached entry.
    await isNonRetryableClientErrorAsync(error);
    expect(isNonRetryableClientError(error)).toBe(false);
  });
});
