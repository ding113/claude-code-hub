import { describe, expect, it, vi } from "vitest";
import {
  looksLikeAnthropicProxyUrl,
  looksLikeAwsExternalAnthropicUrl,
  resolveAnthropicAuthHeaders,
} from "@/app/v1/_lib/headers";
import { logger } from "@/lib/logger";

describe("Anthropic auth header helpers", () => {
  it("treats official Anthropic domains as direct endpoints", () => {
    expect(looksLikeAnthropicProxyUrl("https://api.anthropic.com/v1/messages")).toBe(false);
    expect(looksLikeAnthropicProxyUrl("https://console.claude.ai/v1/messages")).toBe(false);
  });

  it("treats non-proxy lookalike domains as direct-compatible endpoints", () => {
    expect(looksLikeAnthropicProxyUrl("https://proxyanthropic.com/v1/messages")).toBe(false);
    expect(
      resolveAnthropicAuthHeaders("sk-test", "https://proxyanthropic.com/v1/messages")
    ).toEqual({
      Authorization: "Bearer sk-test",
      "x-api-key": "sk-test",
    });
  });

  it("returns bearer-only auth for proxy-like Anthropic endpoints", () => {
    expect(
      resolveAnthropicAuthHeaders("sk-test", "https://openrouter.example.com/v1/messages")
    ).toEqual({
      Authorization: "Bearer sk-test",
    });
  });

  it("honors forceBearerOnly for claude-auth style callsites", () => {
    expect(
      resolveAnthropicAuthHeaders("sk-test", "https://api.anthropic.com/v1/messages", {
        forceBearerOnly: true,
      })
    ).toEqual({
      Authorization: "Bearer sk-test",
    });
  });

  describe("AWS External Anthropic (Claude Platform on AWS)", () => {
    it("recognises aws-external-anthropic regional hosts", () => {
      expect(
        looksLikeAwsExternalAnthropicUrl(
          "https://aws-external-anthropic.us-east-1.api.aws/v1/messages"
        )
      ).toBe(true);
      expect(
        looksLikeAwsExternalAnthropicUrl("https://aws-external-anthropic.us-west-2.api.aws")
      ).toBe(true);
      expect(
        looksLikeAwsExternalAnthropicUrl(
          "HTTPS://AWS-EXTERNAL-ANTHROPIC.EU-WEST-1.API.AWS/v1/messages"
        )
      ).toBe(true);
    });

    it("rejects unrelated hostnames including bedrock and api.anthropic.com", () => {
      expect(looksLikeAwsExternalAnthropicUrl("https://api.anthropic.com/v1/messages")).toBe(false);
      expect(
        looksLikeAwsExternalAnthropicUrl("https://bedrock-runtime.us-east-1.amazonaws.com")
      ).toBe(false);
      expect(looksLikeAwsExternalAnthropicUrl("https://bedrock-mantle.us-east-1.api.aws")).toBe(
        false
      );
      expect(looksLikeAwsExternalAnthropicUrl("https://my-aws-external-anthropic.com")).toBe(false);
      expect(looksLikeAwsExternalAnthropicUrl(undefined)).toBe(false);
      expect(looksLikeAwsExternalAnthropicUrl("not a url")).toBe(false);
    });

    it("sends only x-api-key when proxying to aws-external-anthropic", () => {
      expect(
        resolveAnthropicAuthHeaders(
          "sk-test",
          "https://aws-external-anthropic.us-east-1.api.aws/v1/messages"
        )
      ).toEqual({
        "x-api-key": "sk-test",
      });
    });

    it("keeps x-api-key only even when forceBearerOnly is requested for AWS", () => {
      // AWS External Anthropic does not accept `Authorization: Bearer`; an upstream
      // hard constraint must win over the claude-auth provider preference.
      expect(
        resolveAnthropicAuthHeaders("sk-test", "https://aws-external-anthropic.us-east-1.api.aws", {
          forceBearerOnly: true,
        })
      ).toEqual({
        "x-api-key": "sk-test",
      });
    });

    it("warns when forceBearerOnly is silently overridden by the AWS guard", () => {
      const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});
      try {
        resolveAnthropicAuthHeaders("sk-test", "https://aws-external-anthropic.us-east-1.api.aws", {
          forceBearerOnly: true,
        });
        expect(warnSpy).toHaveBeenCalledTimes(1);
        expect(warnSpy.mock.calls[0]?.[0]).toContain("forceBearerOnly");

        warnSpy.mockClear();
        resolveAnthropicAuthHeaders("sk-test", "https://aws-external-anthropic.us-east-1.api.aws");
        expect(warnSpy).not.toHaveBeenCalled();
      } finally {
        warnSpy.mockRestore();
      }
    });
  });
});
