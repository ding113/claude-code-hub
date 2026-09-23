import { describe, expect, test } from "vitest";
import {
  applyOpenCodeGoSessionHeader,
  hasOpenCodeGoSessionHeader,
  looksLikeOpenCodeGoUrl,
  OPENCODE_GO_SESSION_HEADER,
  OPENCODE_GO_SESSION_TEMPLATE,
  shouldPromptOpenCodeGoAdapter,
} from "./opencode-go";

describe("looksLikeOpenCodeGoUrl", () => {
  test("matches https://opencode.ai with any path", () => {
    expect(looksLikeOpenCodeGoUrl("https://opencode.ai")).toBe(true);
    expect(looksLikeOpenCodeGoUrl("https://opencode.ai/")).toBe(true);
    expect(looksLikeOpenCodeGoUrl("https://opencode.ai/zen/go/v1")).toBe(true);
    expect(looksLikeOpenCodeGoUrl("https://opencode.ai/zen/go/v1/chat/completions")).toBe(true);
    expect(looksLikeOpenCodeGoUrl(" HTTPS://OPENCODE.AI/zen/go ")).toBe(true);
  });

  test("rejects non-https, subdomains, and other hosts", () => {
    expect(looksLikeOpenCodeGoUrl("http://opencode.ai/zen/go")).toBe(false);
    expect(looksLikeOpenCodeGoUrl("https://console.opencode.ai/zen/go")).toBe(false);
    expect(looksLikeOpenCodeGoUrl("https://opencode.ai.evil.com/zen/go")).toBe(false);
    expect(looksLikeOpenCodeGoUrl("https://api.anthropic.com/v1")).toBe(false);
    expect(looksLikeOpenCodeGoUrl("")).toBe(false);
    expect(looksLikeOpenCodeGoUrl(null)).toBe(false);
    expect(looksLikeOpenCodeGoUrl("not a url")).toBe(false);
  });
});

describe("OpenCode Go session header helpers", () => {
  test("detects the session header case-insensitively", () => {
    expect(hasOpenCodeGoSessionHeader(null)).toBe(false);
    expect(hasOpenCodeGoSessionHeader({ "x-tenant": "acme" })).toBe(false);
    expect(
      hasOpenCodeGoSessionHeader({ [OPENCODE_GO_SESSION_HEADER]: OPENCODE_GO_SESSION_TEMPLATE })
    ).toBe(true);
    expect(hasOpenCodeGoSessionHeader({ "X-OpenCode-Session": "already-set" })).toBe(true);
  });

  test("injects x-opencode-session without overwriting an existing value", () => {
    expect(applyOpenCodeGoSessionHeader(null)).toEqual({
      [OPENCODE_GO_SESSION_HEADER]: OPENCODE_GO_SESSION_TEMPLATE,
    });
    expect(applyOpenCodeGoSessionHeader({ "x-tenant": "acme" })).toEqual({
      "x-tenant": "acme",
      [OPENCODE_GO_SESSION_HEADER]: OPENCODE_GO_SESSION_TEMPLATE,
    });
    expect(applyOpenCodeGoSessionHeader({ "X-OpenCode-Session": "keep-me" })).toEqual({
      "X-OpenCode-Session": "keep-me",
    });
  });

  test("prompts only when the URL is OpenCode Go and the header is missing", () => {
    expect(shouldPromptOpenCodeGoAdapter("https://opencode.ai/zen/go/v1", null)).toBe(true);
    expect(
      shouldPromptOpenCodeGoAdapter("https://opencode.ai/zen/go/v1", {
        [OPENCODE_GO_SESSION_HEADER]: OPENCODE_GO_SESSION_TEMPLATE,
      })
    ).toBe(false);
    expect(shouldPromptOpenCodeGoAdapter("https://api.anthropic.com/v1", null)).toBe(false);
  });
});
