import { describe, expect, it } from "vitest";
import { looksLikeAnthropicProxyUrl, resolveAnthropicAuthHeaders } from "@/app/v1/_lib/headers";

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
});
