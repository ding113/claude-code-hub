import { describe, expect, it, vi } from "vitest";

vi.mock("@/repository/error-rules", () => ({
  getActiveErrorRules: vi.fn(async () => [
    {
      id: 17,
      pattern: "ValidationException",
      matchType: "contains",
      category: "validation_error",
      description: "AWS/Bedrock validation error (non-retryable)",
      overrideResponse: null,
      overrideStatusCode: null,
      isEnabled: true,
      isDefault: true,
      priority: 93,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
    {
      id: 18,
      pattern: "unknown model|model.*not.*found|model.*does.*not.*exist",
      matchType: "regex",
      category: "model_error",
      description: "Unknown or non-existent model",
      overrideResponse: null,
      overrideStatusCode: null,
      isEnabled: true,
      isDefault: true,
      priority: 87,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ]),
}));

import { ErrorCategory, ProxyError, categorizeErrorAsync } from "@/app/v1/_lib/proxy/errors";

describe("categorizeErrorAsync - upstream HTTP status precedence", () => {
  it("should categorize upstream 503 model errors as PROVIDER_ERROR", async () => {
    const error = new ProxyError("Provider returned 503: model not found", 503, {
      body: JSON.stringify({
        error: {
          code: "model_not_found",
          message: "No available channel for model gpt-5.6-sol",
        },
      }),
      providerId: 1,
      providerName: "test-provider",
    });

    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });

  it("should categorize upstream 503 transport-like messages as PROVIDER_ERROR", async () => {
    const error = new ProxyError("Provider returned 503: fetch failed", 503, {
      body: JSON.stringify({ error: { message: "fetch failed" } }),
      providerId: 1,
      providerName: "test-provider",
    });

    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });

  it("should categorize upstream 503 abort-like messages as PROVIDER_ERROR", async () => {
    const error = new ProxyError("The user aborted a request", 503, {
      body: JSON.stringify({ error: { message: "The user aborted a request" } }),
      providerId: 1,
      providerName: "test-provider",
    });

    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });

  it("should keep native transport errors as SYSTEM_ERROR", async () => {
    expect(await categorizeErrorAsync(new Error("fetch failed"))).toBe(ErrorCategory.SYSTEM_ERROR);
  });

  it("should keep fake-200 fallback 502 validation errors non-retryable", async () => {
    const error = new ProxyError("FAKE_200_JSON_ERROR_MESSAGE_NON_EMPTY", 502, {
      body: "ValidationException: invalid request payload",
      providerId: 1,
      providerName: "test-provider",
      rawBody: JSON.stringify({
        error: { message: "ValidationException: invalid request payload" },
      }),
      statusCodeInferred: false,
    });

    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });

  it("should keep upstream 404 model errors as NON_RETRYABLE_CLIENT_ERROR", async () => {
    const error = new ProxyError("Provider returned 404: model not found", 404, {
      body: JSON.stringify({
        error: {
          code: "model_not_found",
          message: "The requested model was not found",
        },
      }),
      providerId: 1,
      providerName: "test-provider",
    });

    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });
});
