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

  it("falls back to glob when bare * is used", () => {
    const result = resolveProviderPatternRegex("*");
    expect(result).not.toBeNull();
    expect(result?.source).toBe(".*");
    expect(result?.regex.test("claude-opus-4-1")).toBe(true);
    expect(result?.regex.test("")).toBe(true);
  });

  it("falls back to glob for *.suffix style patterns", () => {
    const result = resolveProviderPatternRegex("*.");
    expect(result).not.toBeNull();
    expect(result?.regex.test("claude-opus-4-1.")).toBe(true);
  });

  it("falls back to glob for prefix-* patterns", () => {
    const result = resolveProviderPatternRegex("claude-*");
    expect(result).not.toBeNull();
    expect(result?.regex.test("claude-opus-4-1")).toBe(true);
    expect(result?.regex.test("gpt-4")).toBe(false);
  });

  it("returns null for patterns that are neither valid regex nor glob-fixable", () => {
    expect(resolveProviderPatternRegex("[")).toBeNull();
    expect(resolveProviderPatternRegex("(")).toBeNull();
  });
});
