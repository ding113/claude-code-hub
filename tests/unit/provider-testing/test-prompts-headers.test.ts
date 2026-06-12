import { describe, expect, it } from "vitest";
import { getTestHeaders } from "@/lib/provider-testing/utils/test-prompts";

describe("provider-testing getTestHeaders — Anthropic auth header selection", () => {
  it("sends both x-api-key and Authorization for direct api.anthropic.com", () => {
    const headers = getTestHeaders("claude", "sk-test", "https://api.anthropic.com");
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.Authorization).toBe("Bearer sk-test");
  });

  it("sends Bearer-only for proxy-like Anthropic relays", () => {
    const headers = getTestHeaders("claude", "sk-test", "https://openrouter.example.com");
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("sends Bearer-only for claude-auth regardless of URL", () => {
    const headers = getTestHeaders("claude-auth", "sk-test", "https://api.anthropic.com");
    expect(headers.Authorization).toBe("Bearer sk-test");
    expect(headers["x-api-key"]).toBeUndefined();
  });

  it("sends x-api-key only (no Authorization) for AWS External Anthropic gateway", () => {
    const headers = getTestHeaders(
      "claude",
      "sk-test",
      "https://aws-external-anthropic.us-east-1.api.aws/v1/messages"
    );
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.Authorization).toBeUndefined();
  });

  it("keeps x-api-key only even when claude-auth + AWS URL combine (upstream wins)", () => {
    const headers = getTestHeaders(
      "claude-auth",
      "sk-test",
      "https://aws-external-anthropic.us-west-2.api.aws"
    );
    expect(headers["x-api-key"]).toBe("sk-test");
    expect(headers.Authorization).toBeUndefined();
  });
});

describe("provider-testing getTestHeaders — Gemini auth header selection", () => {
  it("sends x-goog-api-key by default for gemini", () => {
    const headers = getTestHeaders("gemini", "AIza-test", "https://gemini.example.com");
    expect(headers["x-goog-api-key"]).toBe("AIza-test");
    expect(headers.Authorization).toBeUndefined();
  });

  it("sends Bearer-only when geminiBearerAuth is set (JSON credentials)", () => {
    const headers = getTestHeaders("gemini-cli", "ya29.token", "https://gemini.example.com", {
      geminiBearerAuth: true,
    });
    expect(headers.Authorization).toBe("Bearer ya29.token");
    expect(headers["x-goog-api-key"]).toBeUndefined();
  });
});
