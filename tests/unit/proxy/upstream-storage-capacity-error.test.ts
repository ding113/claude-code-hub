import { describe, expect, it, vi } from "vitest";

vi.mock("@/repository/error-rules", () => ({
  getActiveErrorRules: vi.fn(async () => [
    {
      id: 29,
      pattern: "非法请求|illegal request|invalid request",
      matchType: "regex",
      category: "invalid_request",
      description: "Invalid request format",
      overrideResponse: null,
      overrideStatusCode: null,
      isEnabled: true,
      isDefault: true,
      priority: 50,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    },
  ]),
}));

import {
  categorizeErrorAsync,
  ErrorCategory,
  isRetryableUpstreamStorageCapacityError,
  ProxyError,
} from "@/app/v1/_lib/proxy/errors";

const STORAGE_ERROR_BODY =
  '{"error":{"type":"invalid_request_error","message":"disk storage creation failed: failed to write to temp file; disk free-space floor reached"}}';

function createStorageError(
  body: string = STORAGE_ERROR_BODY,
  upstreamError: Record<string, unknown> = {},
  message = "invalid request: upstream storage failure"
): ProxyError {
  return new ProxyError(message, 400, {
    body,
    providerId: 80,
    providerName: "test-provider",
    ...upstreamError,
  });
}

describe("upstream storage-capacity 400 classification", () => {
  it("prioritizes the known provider failure over the broad invalid-request rule", async () => {
    const error = createStorageError();

    expect(isRetryableUpstreamStorageCapacityError(error)).toBe(true);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.PROVIDER_ERROR);
  });

  it("keeps ordinary invalid-request 400 responses non-retryable", async () => {
    const error = createStorageError('{"error":{"message":"invalid request: malformed JSON"}}');

    expect(isRetryableUpstreamStorageCapacityError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });

  it("requires both stable storage markers instead of retrying every 400 with one marker", async () => {
    const error = createStorageError(
      '{"error":{"message":"invalid request: disk storage creation failed"}}'
    );

    expect(isRetryableUpstreamStorageCapacityError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });

  it("excludes a fake-200 message prefix without relying on inferred status", async () => {
    const error = createStorageError(
      STORAGE_ERROR_BODY.replace("disk storage", "invalid request: disk storage"),
      {
        statusCodeInferred: false,
      },
      "FAKE_200_JSON_ERROR_NON_EMPTY"
    );

    expect(isRetryableUpstreamStorageCapacityError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });

  it("excludes an inferred status without relying on a fake-200 message prefix", async () => {
    const error = createStorageError(
      STORAGE_ERROR_BODY.replace("disk storage", "invalid request: disk storage"),
      {
        statusCodeInferred: true,
      }
    );

    expect(isRetryableUpstreamStorageCapacityError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
  });
});
