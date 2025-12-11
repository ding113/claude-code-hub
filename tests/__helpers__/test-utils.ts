/**
 * Common Test Utilities
 *
 * Provides helper functions for common test patterns:
 * - Async utilities (wait, retry)
 * - Mock request/response helpers
 * - Assertion helpers
 * - Time manipulation
 */

import { expect } from "bun:test";

// ============================================================================
// Async Utilities
// ============================================================================

/**
 * Wait for a specified duration
 */
export function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Wait for a condition to be true
 * Useful for waiting on async state changes
 */
export async function waitFor(
  condition: () => boolean | Promise<boolean>,
  options: { timeout?: number; interval?: number } = {}
): Promise<void> {
  const { timeout = 5000, interval = 100 } = options;
  const startTime = Date.now();

  while (Date.now() - startTime < timeout) {
    if (await condition()) {
      return;
    }
    await wait(interval);
  }

  throw new Error(`waitFor timed out after ${timeout}ms`);
}

/**
 * Retry an async function until it succeeds or max retries reached
 */
export async function retry<T>(
  fn: () => Promise<T>,
  options: { maxRetries?: number; delay?: number } = {}
): Promise<T> {
  const { maxRetries = 3, delay = 100 } = options;
  let lastError: Error | undefined;

  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error as Error;
      if (i < maxRetries - 1) {
        await wait(delay);
      }
    }
  }

  throw lastError ?? new Error("Retry failed");
}

// ============================================================================
// Request/Response Helpers
// ============================================================================

/**
 * Create a mock HTTP request
 */
export function createMockRequest(
  url: string,
  options: RequestInit = {}
): Request {
  return new Request(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...options.headers,
    },
    ...options,
  });
}

/**
 * Create a mock Claude API request body
 */
export function createClaudeRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-sonnet-4-20250514",
    max_tokens: 1024,
    messages: [
      {
        role: "user",
        content: "Hello, Claude!",
      },
    ],
    ...overrides,
  };
}

/**
 * Create a mock OpenAI API request body
 */
export function createOpenAIRequestBody(overrides: Record<string, unknown> = {}) {
  return {
    model: "gpt-4o",
    messages: [
      {
        role: "user",
        content: "Hello, GPT!",
      },
    ],
    ...overrides,
  };
}

/**
 * Parse JSON from a Response, handling streaming responses
 */
export async function parseResponseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  return JSON.parse(text) as T;
}

/**
 * Collect streaming response chunks
 */
export async function collectStreamChunks(response: Response): Promise<string[]> {
  const reader = response.body?.getReader();
  if (!reader) {
    throw new Error("Response body is not readable");
  }

  const chunks: string[] = [];
  const decoder = new TextDecoder();

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(decoder.decode(value, { stream: true }));
  }

  return chunks;
}

// ============================================================================
// Assertion Helpers
// ============================================================================

/**
 * Assert that a function throws an error with a specific message
 */
export async function expectToThrow(
  fn: () => Promise<unknown>,
  expectedMessage?: string | RegExp
): Promise<void> {
  let thrown = false;
  let error: Error | undefined;

  try {
    await fn();
  } catch (e) {
    thrown = true;
    error = e as Error;
  }

  expect(thrown).toBe(true);

  if (expectedMessage && error) {
    if (typeof expectedMessage === "string") {
      expect(error.message).toContain(expectedMessage);
    } else {
      expect(error.message).toMatch(expectedMessage);
    }
  }
}

/**
 * Assert that a value is within a range
 */
export function expectInRange(value: number, min: number, max: number): void {
  expect(value).toBeGreaterThanOrEqual(min);
  expect(value).toBeLessThanOrEqual(max);
}

/**
 * Assert that two dates are approximately equal (within tolerance)
 */
export function expectDatesApproximatelyEqual(
  actual: Date,
  expected: Date,
  toleranceMs = 1000
): void {
  const diff = Math.abs(actual.getTime() - expected.getTime());
  expect(diff).toBeLessThanOrEqual(toleranceMs);
}

/**
 * Assert that an array contains items matching a predicate
 */
export function expectArrayContainsWhere<T>(
  array: T[],
  predicate: (item: T) => boolean
): void {
  const found = array.some(predicate);
  expect(found).toBe(true);
}

// ============================================================================
// Time Manipulation
// ============================================================================

/**
 * Mock Date.now() to return a specific timestamp
 * Returns a cleanup function to restore the original
 */
export function mockDateNow(timestamp: number): () => void {
  const originalDateNow = Date.now;
  Date.now = () => timestamp;
  return () => {
    Date.now = originalDateNow;
  };
}

/**
 * Advance time by a specific duration (for timer-based tests)
 * Note: This only works with Bun's fake timers
 */
export function advanceTime(ms: number): void {
  // @ts-expect-error - Bun's fake timer API
  if (typeof Bun.sleep === "function") {
    // Use Bun's built-in timer advancement if available
  }
  // For now, we use real timeouts - consider adding Bun fake timer support
}

// ============================================================================
// Test Data Generators
// ============================================================================

/**
 * Generate a random string of specified length
 */
export function randomString(length: number): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

/**
 * Generate a random API key hash
 */
export function randomApiKeyHash(): string {
  return `hash_${randomString(32)}`;
}

/**
 * Generate a random UUID
 */
export function randomUuid(): string {
  return crypto.randomUUID();
}

/**
 * Generate a random integer between min and max (inclusive)
 */
export function randomInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

/**
 * Generate a random decimal string with specified precision
 */
export function randomDecimal(min: number, max: number, precision = 6): string {
  const value = Math.random() * (max - min) + min;
  return value.toFixed(precision);
}
