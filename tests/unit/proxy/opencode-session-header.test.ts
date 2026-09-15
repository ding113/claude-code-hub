import { describe, expect, it } from "vitest";
import { resolveOpencodeSessionId, looksLikeOpencodeUrl } from "@/app/v1/_lib/headers";

describe("looksLikeOpencodeUrl", () => {
  it("matches opencode hosts", () => {
    expect(looksLikeOpencodeUrl("https://opencode.ai/zen/go/v1")).toBe(true);
    expect(looksLikeOpencodeUrl("https://api.opencode.ai/v1/messages")).toBe(true);
  });

  it("rejects lookalike hosts and unusable inputs", () => {
    expect(looksLikeOpencodeUrl("https://opencode.ai.evil.com/v1")).toBe(false);
    expect(looksLikeOpencodeUrl("https://notopencode.ai/v1")).toBe(false);
    expect(looksLikeOpencodeUrl("https://api.openai.com/v1")).toBe(false);
    expect(looksLikeOpencodeUrl("not-a-url")).toBe(false);
    expect(looksLikeOpencodeUrl(null)).toBe(false);
  });
});

describe("resolveOpencodeSessionId", () => {
  it("falls back to a random id when there is no session seed", () => {
    expect(resolveOpencodeSessionId()).not.toBe(resolveOpencodeSessionId());
    expect(resolveOpencodeSessionId(null)).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("derives a stable uuid-shaped id that hides the seed", () => {
    const seed = "sess_abc_123";
    const derived = resolveOpencodeSessionId(seed);

    expect(derived).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(derived).toBe(resolveOpencodeSessionId(seed));
    expect(derived).not.toContain(seed);
    expect(derived).not.toBe(resolveOpencodeSessionId("sess_abc_124"));
  });
});
