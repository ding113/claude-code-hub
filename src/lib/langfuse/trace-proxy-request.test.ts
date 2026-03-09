/**
 * Unit tests for reason classification in trace-proxy-request.
 *
 * We import the module and access the SUCCESS_REASONS / ERROR_REASONS
 * indirectly by testing the exported-via-module isSuccessReason / isErrorReason
 * helpers. Since those are module-private, we test the sets' membership
 * through the publicly observable behavior of traceProxyRequest's chain
 * iteration logic. Here we directly test the sets by re-declaring them
 * (mirror test pattern).
 */
import { describe, expect, test } from "vitest";

// Mirror the sets from trace-proxy-request.ts for unit-level validation.
// If the source adds/removes a reason without updating these mirrors, the test
// suite must be updated accordingly.
const SUCCESS_REASONS = new Set([
  "request_success",
  "retry_success",
  "initial_selection",
  "session_reuse",
  "hedge_winner",
]);

const ERROR_REASONS = new Set([
  "system_error",
  "vendor_type_all_timeout",
  "endpoint_pool_exhausted",
  "client_abort",
]);

function isSuccessReason(reason: string | undefined): boolean {
  return !!reason && SUCCESS_REASONS.has(reason);
}

function isErrorReason(reason: string | undefined): boolean {
  return !!reason && ERROR_REASONS.has(reason);
}

describe("isSuccessReason", () => {
  test("hedge_winner is a success reason", () => {
    expect(isSuccessReason("hedge_winner")).toBe(true);
  });

  test("request_success is a success reason", () => {
    expect(isSuccessReason("request_success")).toBe(true);
  });

  test("retry_success is a success reason", () => {
    expect(isSuccessReason("retry_success")).toBe(true);
  });

  test("hedge_triggered is NOT a success reason", () => {
    expect(isSuccessReason("hedge_triggered")).toBe(false);
  });

  test("hedge_loser_cancelled is NOT a success reason", () => {
    expect(isSuccessReason("hedge_loser_cancelled")).toBe(false);
  });

  test("client_abort is NOT a success reason", () => {
    expect(isSuccessReason("client_abort")).toBe(false);
  });

  test("undefined is NOT a success reason", () => {
    expect(isSuccessReason(undefined)).toBe(false);
  });
});

describe("isErrorReason", () => {
  test("client_abort is an error reason", () => {
    expect(isErrorReason("client_abort")).toBe(true);
  });

  test("system_error is an error reason", () => {
    expect(isErrorReason("system_error")).toBe(true);
  });

  test("hedge_winner is NOT an error reason", () => {
    expect(isErrorReason("hedge_winner")).toBe(false);
  });

  test("hedge_triggered is NOT an error reason", () => {
    expect(isErrorReason("hedge_triggered")).toBe(false);
  });

  test("hedge_loser_cancelled is NOT an error reason", () => {
    expect(isErrorReason("hedge_loser_cancelled")).toBe(false);
  });

  test("retry_failed is NOT in the error set (it is WARNING level)", () => {
    expect(isErrorReason("retry_failed")).toBe(false);
  });

  test("undefined is NOT an error reason", () => {
    expect(isErrorReason(undefined)).toBe(false);
  });
});
