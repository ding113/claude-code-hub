import { describe, expect, it } from "vitest";
import {
  globPatternToRegexSource,
  resolveProviderPatternRegex,
} from "@/lib/provider-pattern-regex";

describe("globPatternToRegexSource", () => {
  it.each<[string, string]>([
    ["*", ".*"],
    ["*.", ".*\\."],
    ["*-foo", ".*-foo"],
    ["?", "."],
    ["claude-*", "claude-.*"],
    ["claude-?-opus", "claude-.-opus"],
    ["a+b", "a\\+b"],
    ["a.b", "a\\.b"],
    ["(group)", "\\(group\\)"],
  ])("converts %s to %s", (pattern, expected) => {
    expect(globPatternToRegexSource(pattern)).toBe(expected);
  });
});

describe("resolveProviderPatternRegex", () => {
  it("returns the original regex when pattern is already valid", () => {
    const result = resolveProviderPatternRegex("^claude-.*$");
    expect(result).not.toBeNull();
    expect(result?.source).toBe("^claude-.*$");
    expect(result?.regex.test("claude-opus-4-1")).toBe(true);
  });

  it("preserves legal regex semantics for ambiguous patterns like a*", () => {
    const result = resolveProviderPatternRegex("a*");
    expect(result).not.toBeNull();
    expect(result?.source).toBe("a*");
    expect(result?.regex.test("")).toBe(true);
    expect(result?.regex.test("aaa")).toBe(true);
  });

  it("falls back to anchored glob when bare * is used", () => {
    const result = resolveProviderPatternRegex("*");
    expect(result).not.toBeNull();
    expect(result?.source).toBe("^.*$");
    expect(result?.regex.test("claude-opus-4-1")).toBe(true);
    expect(result?.regex.test("")).toBe(true);
  });

  it("anchors glob fallback to avoid substring matches", () => {
    const result = resolveProviderPatternRegex("*.foo");
    expect(result?.source).toBe("^.*\\.foo$");
    expect(result?.regex.test("claude.foo")).toBe(true);
    // 不应匹配 `bar.foo.baz` —— shell glob 用户预期“以 .foo 结尾”，
    // 而不是子串包含。
    expect(result?.regex.test("bar.foo.baz")).toBe(false);
  });

  it("falls back to anchored glob for *.style patterns", () => {
    const result = resolveProviderPatternRegex("*.");
    expect(result?.source).toBe("^.*\\.$");
    expect(result?.regex.test("claude-opus-4-1.")).toBe(true);
    expect(result?.regex.test("claude.opus")).toBe(false);
  });

  it("returns null for patterns that are neither valid regex nor glob-fixable", () => {
    expect(resolveProviderPatternRegex("[")).toBeNull();
    expect(resolveProviderPatternRegex("(")).toBeNull();
  });

  it("documents divergence: `claude-*` is valid regex and keeps regex semantics", () => {
    // `claude-*` 是合法正则（claud + 零个或多个 e + 零个或多个 `-`，且不锚定），
    // 因此走 regex 路径，与 shell glob 的“以 claude- 开头”略有差异。
    const result = resolveProviderPatternRegex("claude-*");
    expect(result?.source).toBe("claude-*");
    expect(result?.regex.test("claude-opus-4-1")).toBe(true);
    expect(result?.regex.test("gpt-4")).toBe(false);
  });

  it("falls back to anchored glob when `*` makes the pattern non-regex", () => {
    // `*claude*` 在正则里非法，会走 glob 路径并锚定，语义贴近 shell glob 的
    // “整串包含 claude”。
    const result = resolveProviderPatternRegex("*claude*");
    expect(result?.source).toBe("^.*claude.*$");
    expect(result?.regex.test("myclaudemodel")).toBe(true);
    expect(result?.regex.test("gpt-4")).toBe(false);
  });

  it("memoizes results across repeated calls for the same input", () => {
    const a = resolveProviderPatternRegex("^claude-.*$");
    const b = resolveProviderPatternRegex("^claude-.*$");
    expect(a).toBe(b);
  });
});
