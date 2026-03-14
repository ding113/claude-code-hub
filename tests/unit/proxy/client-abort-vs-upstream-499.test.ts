/**
 * Client Abort vs Upstream 499 Detection Tests
 *
 * Validates that isClientAbortError() and categorizeErrorAsync() correctly
 * distinguish between:
 * - Local client disconnection (CCH synthesized 499) -> CLIENT_ABORT
 * - Upstream HTTP 499 response -> PROVIDER_ERROR (triggers fallback/circuit-breaker)
 */
import { describe, expect, it } from "vitest";
import {
  ErrorCategory,
  ProxyError,
  categorizeErrorAsync,
  isClientAbortError,
} from "@/app/v1/_lib/proxy/errors";

describe("isClientAbortError - 499 source awareness", () => {
  // Scenario 1: Local abort (isLocalAbort=true) -> CLIENT_ABORT
  it("should detect ProxyError(499) with isLocalAbort=true as client abort", () => {
    const error = new ProxyError("Request aborted by client", 499, undefined, true);
    expect(isClientAbortError(error)).toBe(true);
  });

  // Scenario 2: Upstream 499 (default isLocalAbort=false) -> NOT client abort
  it("should NOT detect ProxyError(499) without isLocalAbort as client abort", () => {
    const error = new ProxyError("Provider returned 499", 499);
    expect(isClientAbortError(error)).toBe(false);
  });

  // Scenario 3: Upstream 499 with upstreamError details -> NOT client abort
  it("should NOT detect ProxyError(499) from upstream response as client abort", () => {
    const error = new ProxyError("Provider returned 499: Client Closed Request", 499, {
      body: '{"error": "client closed"}',
      parsed: { error: "client closed" },
      providerId: 1,
      providerName: "test-provider",
    });
    expect(isClientAbortError(error)).toBe(false);
  });

  // Scenario 4: Native AbortError (.name check) -> CLIENT_ABORT
  it("should detect native AbortError by name", () => {
    const error = new Error("The operation was aborted");
    error.name = "AbortError";
    expect(isClientAbortError(error)).toBe(true);
  });

  // Scenario 5: Native ResponseAborted (.name check) -> CLIENT_ABORT
  it("should detect native ResponseAborted by name", () => {
    const error = new Error("Response was aborted");
    error.name = "ResponseAborted";
    expect(isClientAbortError(error)).toBe(true);
  });

  // Scenario 6: Standard abort message -> CLIENT_ABORT
  it('should detect "This operation was aborted" message', () => {
    const error = new Error("This operation was aborted");
    expect(isClientAbortError(error)).toBe(true);
  });

  // Scenario 7: Browser standard abort message -> CLIENT_ABORT
  it('should detect "The user aborted a request" message', () => {
    const error = new Error("The user aborted a request");
    expect(isClientAbortError(error)).toBe(true);
  });

  // Scenario 8: Server-side abort message should NOT match (removed broad "aborted" match)
  it('should NOT detect "Transaction aborted by server" as client abort', () => {
    const error = new Error("Transaction aborted by server");
    expect(isClientAbortError(error)).toBe(false);
  });

  // Scenario 9: Non-499 ProxyError with isLocalAbort=true should NOT match (only 499 matters)
  it("should NOT detect non-499 ProxyError as client abort even with isLocalAbort=true", () => {
    const error = new ProxyError("Bad Gateway", 502, undefined, true);
    expect(isClientAbortError(error)).toBe(false);
  });
});

describe("categorizeErrorAsync - 499 source awareness", () => {
  // Scenario 1: Local 499 -> CLIENT_ABORT
  it("should categorize local 499 (isLocalAbort=true) as CLIENT_ABORT", async () => {
    const error = new ProxyError("Request aborted by client", 499, undefined, true);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.CLIENT_ABORT);
  });

  // Scenario 2: Upstream 499 (default) -> PROVIDER_ERROR
  it("should categorize upstream 499 (isLocalAbort=false) as PROVIDER_ERROR", async () => {
    const error = new ProxyError("Provider returned 499", 499);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });

  // Scenario 3: Upstream 499 with upstreamError -> PROVIDER_ERROR
  it("should categorize upstream 499 with error details as PROVIDER_ERROR", async () => {
    const error = new ProxyError("Provider returned 499: Client Closed Request", 499, {
      body: '{"error": "client closed"}',
      parsed: { error: "client closed" },
      providerId: 1,
      providerName: "test-provider",
    });
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });
});

describe("ProxyError.fromUpstreamResponse - isLocalAbort default", () => {
  // Scenario 9: fromUpstreamResponse should produce isLocalAbort=false
  it("should create ProxyError with isLocalAbort=false from upstream 499 response", async () => {
    const fakeResponse = new Response('{"error": "client closed"}', {
      status: 499,
      statusText: "Client Closed Request",
      headers: { "content-type": "application/json" },
    });
    const error = await ProxyError.fromUpstreamResponse(fakeResponse, {
      id: 1,
      name: "test-provider",
    });
    expect(error.statusCode).toBe(499);
    expect(error.isLocalAbort).toBe(false);
    expect(isClientAbortError(error)).toBe(false);
  });
});

describe("ProxyError.isLocalAbort property", () => {
  it("should default isLocalAbort to false when not specified", () => {
    const error = new ProxyError("test", 499);
    expect(error.isLocalAbort).toBe(false);
  });

  it("should set isLocalAbort to true when explicitly passed", () => {
    const error = new ProxyError("test", 499, undefined, true);
    expect(error.isLocalAbort).toBe(true);
  });

  it("should set isLocalAbort to false when explicitly passed", () => {
    const error = new ProxyError("test", 499, undefined, false);
    expect(error.isLocalAbort).toBe(false);
  });
});
