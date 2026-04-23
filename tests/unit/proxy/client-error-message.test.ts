import { describe, expect, test } from "vitest";
import { deriveClientSafeUpstreamErrorMessage } from "@/app/v1/_lib/proxy/client-error-message";

describe("deriveClientSafeUpstreamErrorMessage", () => {
  test("extracts sanitized upstream message from JSON without secrets or origin data", () => {
    const message = deriveClientSafeUpstreamErrorMessage({
      rawText: JSON.stringify({
        error: {
          message:
            "Quota exceeded for key sk-test-1234567890abcdef at https://api.vendor.example/v1/messages request_id=req_abc123",
        },
      }),
    });

    expect(message).toContain("Quota exceeded");
    expect(message).not.toContain("sk-test");
    expect(message).not.toContain("https://");
    expect(message).not.toContain("api.vendor.example");
    expect(message).not.toContain("req_abc123");
  });

  test("extracts sanitized upstream message from SSE data", () => {
    const message = deriveClientSafeUpstreamErrorMessage({
      rawText: 'event: error\ndata: {"error":{"message":"Upstream overload"}}\n\n',
    });

    expect(message).toBe("Upstream overload");
  });

  test("rejects provider and internal details", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "Provider Anthropic returned: overload",
        providerName: "Anthropic",
      })
    ).toBeNull();
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "FAKE_200_JSON_ERROR_NON_EMPTY",
      })
    ).toBeNull();
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "HTTP 500",
      })
    ).toBeNull();
  });

  test("rejects raw JSON blob instead of returning object text", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: '{"error":{"message":"Quota exceeded"}}',
      })
    ).toBeNull();
  });

  test("rejects candidates that become empty after redaction", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "https://api.vendor.example/v1/messages request_id=req_abc123",
      })
    ).toBeNull();
  });

  test("falls back to candidateMessage when rawText is unsafe but secondary candidate is safe", () => {
    const message = deriveClientSafeUpstreamErrorMessage({
      rawText: JSON.stringify({
        error: {
          message:
            "Provider Anthropic returned: overload at gateway.internal:443 request_id=req_abc",
        },
      }),
      candidateMessage: "Quota exceeded",
      providerName: "Anthropic",
    });

    expect(message).toBe("Quota exceeded");
  });

  test("rejects host-like and internal routing labels without scheme", () => {
    expect(
      deriveClientSafeUpstreamErrorMessage({
        candidateMessage: "gateway.internal:443 region-us-east-1a",
      })
    ).toBeNull();
  });
});
