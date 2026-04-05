import { describe, expect, it } from "vitest";
import type { ProviderAllowedModelRule } from "@/types/provider";
import {
  isProviderAllowedModelRule,
  isProviderAllowedModelRuleList,
  normalizeAllowedModelRules,
  modelMatchesAllowedRules,
  hasAllowedModelRules,
} from "@/lib/provider-allowed-models";

describe("provider allowed model rules", () => {
  // -- Type guards --
  describe("isProviderAllowedModelRule", () => {
    it("accepts valid rule", () => {
      expect(isProviderAllowedModelRule({ matchType: "exact", pattern: "claude-opus" })).toBe(true);
    });

    it("rejects missing matchType", () => {
      expect(isProviderAllowedModelRule({ pattern: "claude" })).toBe(false);
    });

    it("rejects missing pattern", () => {
      expect(isProviderAllowedModelRule({ matchType: "exact" })).toBe(false);
    });

    it("rejects invalid matchType", () => {
      expect(isProviderAllowedModelRule({ matchType: "invalid", pattern: "x" })).toBe(false);
    });

    it("rejects empty pattern", () => {
      expect(isProviderAllowedModelRule({ matchType: "exact", pattern: "  " })).toBe(false);
    });

    it("rejects non-object", () => {
      expect(isProviderAllowedModelRule("string")).toBe(false);
      expect(isProviderAllowedModelRule(null)).toBe(false);
      expect(isProviderAllowedModelRule(42)).toBe(false);
    });
  });

  describe("isProviderAllowedModelRuleList", () => {
    it("accepts valid rule list", () => {
      expect(
        isProviderAllowedModelRuleList([
          { matchType: "exact", pattern: "claude-opus" },
          { matchType: "prefix", pattern: "gpt" },
        ])
      ).toBe(true);
    });

    it("accepts empty array", () => {
      expect(isProviderAllowedModelRuleList([])).toBe(true);
    });

    it("rejects array with invalid items", () => {
      expect(isProviderAllowedModelRuleList([{ matchType: "exact", pattern: "" }])).toBe(false);
    });

    it("rejects non-array", () => {
      expect(isProviderAllowedModelRuleList("not-array")).toBe(false);
    });
  });

  // -- Normalization --
  describe("normalizeAllowedModelRules", () => {
    it("returns null for null", () => {
      expect(normalizeAllowedModelRules(null)).toBeNull();
    });

    it("returns null for undefined", () => {
      expect(normalizeAllowedModelRules(undefined)).toBeNull();
    });

    it("passes through valid rule list with trimming", () => {
      const rules: ProviderAllowedModelRule[] = [{ matchType: "prefix", pattern: "  claude  " }];
      const result = normalizeAllowedModelRules(rules);
      expect(result).toEqual([{ matchType: "prefix", pattern: "claude" }]);
    });

    it("converts legacy string[] to exact rules", () => {
      const legacy = ["claude-opus-4-5", "gpt-4o"];
      const result = normalizeAllowedModelRules(legacy);
      expect(result).toEqual([
        { matchType: "exact", pattern: "claude-opus-4-5" },
        { matchType: "exact", pattern: "gpt-4o" },
      ]);
    });

    it("filters out empty strings from legacy format", () => {
      const legacy = ["claude", "", "  ", "gpt"];
      const result = normalizeAllowedModelRules(legacy);
      expect(result).toEqual([
        { matchType: "exact", pattern: "claude" },
        { matchType: "exact", pattern: "gpt" },
      ]);
    });

    it("returns null for unrecognized types", () => {
      expect(normalizeAllowedModelRules(42)).toBeNull();
      expect(normalizeAllowedModelRules("string")).toBeNull();
      expect(normalizeAllowedModelRules({ key: "value" })).toBeNull();
    });
  });

  // -- hasAllowedModelRules --
  describe("hasAllowedModelRules", () => {
    it("returns false for null", () => {
      expect(hasAllowedModelRules(null)).toBe(false);
    });

    it("returns false for undefined", () => {
      expect(hasAllowedModelRules(undefined)).toBe(false);
    });

    it("returns false for empty array", () => {
      expect(hasAllowedModelRules([])).toBe(false);
    });

    it("returns true for non-empty array", () => {
      expect(hasAllowedModelRules([{ matchType: "exact", pattern: "x" }])).toBe(true);
    });
  });

  // -- modelMatchesAllowedRules --
  describe("modelMatchesAllowedRules", () => {
    it("returns true when rules are null (allow all)", () => {
      expect(modelMatchesAllowedRules("any-model", null)).toBe(true);
    });

    it("returns true when rules are undefined (allow all)", () => {
      expect(modelMatchesAllowedRules("any-model", undefined)).toBe(true);
    });

    it("returns true when rules are empty (allow all)", () => {
      expect(modelMatchesAllowedRules("any-model", [])).toBe(true);
    });

    it("returns true when model matches an exact rule", () => {
      const rules: ProviderAllowedModelRule[] = [
        { matchType: "exact", pattern: "claude-opus-4-5" },
      ];
      expect(modelMatchesAllowedRules("claude-opus-4-5", rules)).toBe(true);
    });

    it("returns false when model does not match any rule", () => {
      const rules: ProviderAllowedModelRule[] = [
        { matchType: "exact", pattern: "claude-opus-4-5" },
        { matchType: "prefix", pattern: "gpt-" },
      ];
      expect(modelMatchesAllowedRules("gemini-pro", rules)).toBe(false);
    });

    it("supports prefix matching", () => {
      const rules: ProviderAllowedModelRule[] = [{ matchType: "prefix", pattern: "claude-" }];
      expect(modelMatchesAllowedRules("claude-sonnet-4-5", rules)).toBe(true);
      expect(modelMatchesAllowedRules("gpt-4o", rules)).toBe(false);
    });

    it("supports suffix matching", () => {
      const rules: ProviderAllowedModelRule[] = [{ matchType: "suffix", pattern: "-latest" }];
      expect(modelMatchesAllowedRules("claude-opus-latest", rules)).toBe(true);
      expect(modelMatchesAllowedRules("claude-opus-4-5", rules)).toBe(false);
    });

    it("supports contains matching", () => {
      const rules: ProviderAllowedModelRule[] = [{ matchType: "contains", pattern: "opus" }];
      expect(modelMatchesAllowedRules("claude-opus-4-5", rules)).toBe(true);
      expect(modelMatchesAllowedRules("claude-sonnet", rules)).toBe(false);
    });

    it("supports regex matching", () => {
      const rules: ProviderAllowedModelRule[] = [
        { matchType: "regex", pattern: "^claude-(opus|sonnet)-4" },
      ];
      expect(modelMatchesAllowedRules("claude-opus-4-5", rules)).toBe(true);
      expect(modelMatchesAllowedRules("claude-sonnet-4-5", rules)).toBe(true);
      expect(modelMatchesAllowedRules("gpt-4o", rules)).toBe(false);
    });

    it("returns true on first matching rule (short-circuit)", () => {
      const rules: ProviderAllowedModelRule[] = [
        { matchType: "exact", pattern: "no-match" },
        { matchType: "contains", pattern: "opus" },
        { matchType: "exact", pattern: "also-no-match" },
      ];
      expect(modelMatchesAllowedRules("claude-opus-4-5", rules)).toBe(true);
    });
  });
});
