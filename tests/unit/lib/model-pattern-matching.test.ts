import { describe, expect, it } from "vitest";
import { matchPattern } from "@/lib/model-pattern-matching";

describe("matchPattern", () => {
  // -- exact --
  describe("exact match", () => {
    it("matches identical strings", () => {
      expect(matchPattern("claude-opus-4-5", "exact", "claude-opus-4-5")).toBe(true);
    });

    it("is case-sensitive", () => {
      expect(matchPattern("Claude-Opus", "exact", "claude-opus")).toBe(false);
    });

    it("rejects non-identical strings", () => {
      expect(matchPattern("claude-opus-4-5", "exact", "claude-opus")).toBe(false);
    });

    it("matches empty pattern against empty value", () => {
      expect(matchPattern("", "exact", "")).toBe(true);
    });

    it("rejects empty pattern against non-empty value", () => {
      expect(matchPattern("claude", "exact", "")).toBe(false);
    });
  });

  // -- prefix --
  describe("prefix match", () => {
    it("matches when value starts with pattern", () => {
      expect(matchPattern("claude-opus-4-5-20251001", "prefix", "claude-opus")).toBe(true);
    });

    it("rejects when value does not start with pattern", () => {
      expect(matchPattern("gpt-4o", "prefix", "claude")).toBe(false);
    });

    it("matches when value equals pattern exactly", () => {
      expect(matchPattern("claude", "prefix", "claude")).toBe(true);
    });
  });

  // -- suffix --
  describe("suffix match", () => {
    it("matches when value ends with pattern", () => {
      expect(matchPattern("claude-opus-4-5-20251001", "suffix", "20251001")).toBe(true);
    });

    it("rejects when value does not end with pattern", () => {
      expect(matchPattern("claude-opus-4-5", "suffix", "20251001")).toBe(false);
    });

    it("matches when value equals pattern exactly", () => {
      expect(matchPattern("20251001", "suffix", "20251001")).toBe(true);
    });
  });

  // -- contains --
  describe("contains match", () => {
    it("matches when value includes pattern", () => {
      expect(matchPattern("claude-opus-4-5-20251001", "contains", "opus")).toBe(true);
    });

    it("matches pattern at start", () => {
      expect(matchPattern("claude-opus", "contains", "claude")).toBe(true);
    });

    it("matches pattern at end", () => {
      expect(matchPattern("claude-opus", "contains", "opus")).toBe(true);
    });

    it("rejects when value does not include pattern", () => {
      expect(matchPattern("gpt-4o", "contains", "opus")).toBe(false);
    });
  });

  // -- regex --
  describe("regex match", () => {
    it("matches valid regex pattern", () => {
      expect(matchPattern("claude-opus-4-5", "regex", "^claude-opus-4-.*$")).toBe(true);
    });

    it("rejects non-matching regex", () => {
      expect(matchPattern("gpt-4o", "regex", "^claude-.*$")).toBe(false);
    });

    it("returns false for invalid regex", () => {
      expect(matchPattern("anything", "regex", "[invalid")).toBe(false);
    });

    it("handles special regex chars in model names", () => {
      expect(matchPattern("model.v2+latest", "regex", "model\\.v2\\+latest")).toBe(true);
    });

    it("supports partial matching without anchors", () => {
      expect(matchPattern("my-claude-opus-model", "regex", "claude-opus")).toBe(true);
    });
  });

  // -- unknown matchType --
  describe("unknown matchType", () => {
    it("returns false for unknown match type", () => {
      // @ts-expect-error testing runtime safety
      expect(matchPattern("test", "unknown_type", "test")).toBe(false);
    });
  });
});
