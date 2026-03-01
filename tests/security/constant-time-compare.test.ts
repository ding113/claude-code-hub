import { describe, expect, it } from "vitest";
import { constantTimeEqual } from "@/lib/security/constant-time-compare";

describe("constantTimeEqual", () => {
  it("returns true for equal strings", () => {
    expect(constantTimeEqual("hello", "hello")).toBe(true);
  });

  it("returns false for different strings of same length", () => {
    expect(constantTimeEqual("hello", "world")).toBe(false);
  });

  it("returns false for strings of different lengths", () => {
    expect(constantTimeEqual("short", "a-much-longer-string")).toBe(false);
  });

  it("returns true for empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("returns false when one string is empty and the other is not", () => {
    expect(constantTimeEqual("", "nonempty")).toBe(false);
    expect(constantTimeEqual("nonempty", "")).toBe(false);
  });

  it("handles unicode correctly", () => {
    expect(constantTimeEqual("\u00e9", "\u00e9")).toBe(true);
    expect(constantTimeEqual("\u00e9", "e")).toBe(false);
  });

  it("handles long token-like strings", () => {
    const tokenA = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const tokenB = "sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const tokenC = "sk-ant-api03-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    expect(constantTimeEqual(tokenA, tokenB)).toBe(true);
    expect(constantTimeEqual(tokenA, tokenC)).toBe(false);
  });

  it("is reflexive", () => {
    const s = "test-token-value";
    expect(constantTimeEqual(s, s)).toBe(true);
  });
});
