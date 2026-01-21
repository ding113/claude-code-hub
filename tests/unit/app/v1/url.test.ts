import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    error: vi.fn(),
  },
}));

import { buildProxyUrl } from "@/app/v1/_lib/url";

describe("buildProxyUrl", () => {
  test("标准拼接：baseUrl 无路径时使用 requestPath + search", () => {
    const out = buildProxyUrl(
      "https://api.example.com",
      new URL("https://dummy.com/v1/messages?x=1")
    );

    expect(out).toBe("https://api.example.com/v1/messages?x=1");
  });

  test("避免重复拼接：baseUrl 已包含 /responses 时不追加 /v1/responses", () => {
    const out = buildProxyUrl(
      "https://example.com/openai/responses",
      new URL("https://dummy.com/v1/responses?x=1")
    );

    expect(out).toBe("https://example.com/openai/responses?x=1");
  });

  test("子路径不丢失：baseUrl=/v1/messages + request=/v1/messages/count_tokens", () => {
    const out = buildProxyUrl(
      "https://api.example.com/v1/messages",
      new URL("https://dummy.com/v1/messages/count_tokens")
    );

    expect(out).toBe("https://api.example.com/v1/messages/count_tokens");
  });

  test("带前缀路径的 baseUrl：/openai/messages + /v1/messages/count_tokens", () => {
    const out = buildProxyUrl(
      "https://example.com/openai/messages",
      new URL("https://dummy.com/v1/messages/count_tokens")
    );

    expect(out).toBe("https://example.com/openai/messages/count_tokens");
  });

  test("query 以 requestUrl 为准（覆盖 baseUrl 自带 query）", () => {
    const out = buildProxyUrl(
      "https://api.example.com/v1/messages?from=base",
      new URL("https://dummy.com/v1/messages?from=request")
    );

    expect(out).toBe("https://api.example.com/v1/messages?from=request");
  });
});
