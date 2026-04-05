import { describe, expect, it } from "vitest";
import {
  PROVIDER_ALLOWED_MODEL_RULE_SCHEMA,
  PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA,
} from "@/lib/provider-allowed-model-schema";

describe("PROVIDER_ALLOWED_MODEL_RULE_SCHEMA", () => {
  it("accepts valid exact rule", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "exact",
      pattern: "claude-opus-4-5",
    });
    expect(result.success).toBe(true);
  });

  it("accepts valid regex rule", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "regex",
      pattern: "^claude-.*$",
    });
    expect(result.success).toBe(true);
  });

  it("trims pattern whitespace", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "exact",
      pattern: "  claude-opus  ",
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.pattern).toBe("claude-opus");
    }
  });

  it("rejects empty pattern", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "exact",
      pattern: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects pattern exceeding 255 chars", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "exact",
      pattern: "a".repeat(256),
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid matchType", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "wildcard",
      pattern: "test",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid regex syntax", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "regex",
      pattern: "[invalid",
    });
    expect(result.success).toBe(false);
  });

  it("rejects ReDoS-risk regex", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "regex",
      pattern: "(a+)+$",
    });
    expect(result.success).toBe(false);
  });

  it("does not validate regex for non-regex match types", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "contains",
      pattern: "[not-a-valid-regex",
    });
    expect(result.success).toBe(true);
  });
});

describe("PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA", () => {
  it("accepts valid rule list", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA.safeParse([
      { matchType: "exact", pattern: "claude-opus" },
      { matchType: "prefix", pattern: "gpt-" },
    ]);
    expect(result.success).toBe(true);
  });

  it("accepts empty list", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA.safeParse([]);
    expect(result.success).toBe(true);
  });

  it("rejects list exceeding 100 rules", () => {
    const rules = Array.from({ length: 101 }, (_, i) => ({
      matchType: "exact" as const,
      pattern: `model-${i}`,
    }));
    const result = PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA.safeParse(rules);
    expect(result.success).toBe(false);
  });

  it("rejects duplicate matchType+pattern", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA.safeParse([
      { matchType: "exact", pattern: "claude" },
      { matchType: "exact", pattern: "claude" },
    ]);
    expect(result.success).toBe(false);
  });

  it("allows same pattern with different match types", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA.safeParse([
      { matchType: "exact", pattern: "claude" },
      { matchType: "prefix", pattern: "claude" },
    ]);
    expect(result.success).toBe(true);
  });

  it("rejects duplicate case-insensitively", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_LIST_SCHEMA.safeParse([
      { matchType: "exact", pattern: "Claude" },
      { matchType: "exact", pattern: "claude" },
    ]);
    expect(result.success).toBe(false);
  });
});
