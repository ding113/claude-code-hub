import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ErrorCategory,
  ProxyError,
  categorizeErrorAsync,
  isProviderLocalModelUnavailableError,
} from "@/app/v1/_lib/proxy/errors";
import type { ErrorDetectionResult } from "@/lib/error-rule-detector";

const mocks = vi.hoisted(() => ({
  detectAsync: vi.fn<(content: string) => Promise<ErrorDetectionResult>>(),
}));

vi.mock("@/lib/error-rule-detector", () => ({
  errorRuleDetector: { detectAsync: mocks.detectAsync },
}));

describe("provider-local model availability errors", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.detectAsync.mockResolvedValue({ matched: true });
  });

  it("switches Provider when an account group does not support the requested model", async () => {
    const body = JSON.stringify({
      error: {
        message: 'Model "gpt-5.6-sol" is not supported by any configured account in this group',
        type: "model_not_found",
      },
    });
    const response = new Response(body, {
      status: 404,
      headers: { "content-type": "application/json" },
    });
    const error = await ProxyError.fromUpstreamResponse(response, {
      id: 96,
      name: "provider-a",
    });

    expect(isProviderLocalModelUnavailableError(error)).toBe(true);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
    expect(mocks.detectAsync).not.toHaveBeenCalled();
  });

  it("matches the provider-local marker case-insensitively in the extracted message", async () => {
    const error = new ProxyError(
      "MODEL IS NOT SUPPORTED BY ANY CONFIGURED ACCOUNT IN THIS GROUP",
      404,
      {
        body: "{}",
        providerId: 96,
        providerName: "provider-a",
      }
    );

    expect(isProviderLocalModelUnavailableError(error)).toBe(true);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
    expect(mocks.detectAsync).not.toHaveBeenCalled();
  });

  it("recognizes the marker from the raw upstream body", async () => {
    const error = new ProxyError("model_not_found", 404, {
      body: "{}",
      rawBody: "not supported by any configured account in this group",
      providerId: 96,
      providerName: "provider-a",
    });

    expect(isProviderLocalModelUnavailableError(error)).toBe(true);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.RESOURCE_NOT_FOUND);
    expect(mocks.detectAsync).not.toHaveBeenCalled();
  });

  it("keeps ordinary model_not_found responses non-retryable", async () => {
    const error = new ProxyError("The requested model was not found", 404, {
      body: JSON.stringify({
        error: {
          code: "model_not_found",
          message: "The requested model was not found",
        },
      }),
      providerId: 96,
      providerName: "provider-a",
    });

    expect(isProviderLocalModelUnavailableError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
    expect(mocks.detectAsync).toHaveBeenCalledOnce();
  });

  it("does not match a near-miss account-group message", async () => {
    const error = new ProxyError(
      "Model is not supported by every configured account in this group",
      404,
      {
        body: '{"error":"model_not_found"}',
        providerId: 96,
        providerName: "provider-a",
      }
    );

    expect(isProviderLocalModelUnavailableError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
    expect(mocks.detectAsync).toHaveBeenCalledOnce();
  });

  it("does not override the same wording on a non-404 client error", async () => {
    const error = new ProxyError(
      "Model is not supported by any configured account in this group",
      400,
      {
        body: "invalid request",
        providerId: 96,
        providerName: "provider-a",
      }
    );

    expect(isProviderLocalModelUnavailableError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
    expect(mocks.detectAsync).toHaveBeenCalledOnce();
  });

  it("does not override a synthetic 404 inferred from a fake-200 response", async () => {
    const error = new ProxyError("not supported by any configured account in this group", 404, {
      body: '{"error":"model_not_found"}',
      statusCodeInferred: true,
      providerId: 96,
      providerName: "provider-a",
    });

    expect(isProviderLocalModelUnavailableError(error)).toBe(false);
    expect(await categorizeErrorAsync(error)).toBe(ErrorCategory.NON_RETRYABLE_CLIENT_ERROR);
    expect(mocks.detectAsync).toHaveBeenCalledOnce();
  });
});
