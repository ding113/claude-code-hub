import { describe, expect, it } from "vitest";
import { PROVIDER_RULE_LIMITS } from "@/lib/constants/provider.constants";
import {
  PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA,
  PROVIDER_MODEL_REDIRECT_RULE_SCHEMA,
} from "@/lib/provider-model-redirect-schema";

const { MAX_ITEMS: MAX_PROVIDER_RULES, MAX_TEXT_LENGTH: MAX_PROVIDER_RULE_TEXT_LENGTH } =
  PROVIDER_RULE_LIMITS;

function buildRedirectRules(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    matchType: "exact" as const,
    source: `source-${index}`,
    target: `target-${index}`,
  }));
}

describe("provider-model-redirect-schema", () => {
  it("accepts source and target values longer than 255 characters when still within the new cap", () => {
    const result = PROVIDER_MODEL_REDIRECT_RULE_SCHEMA.safeParse({
      matchType: "exact",
      source: "s".repeat(MAX_PROVIDER_RULE_TEXT_LENGTH),
      target: "t".repeat(MAX_PROVIDER_RULE_TEXT_LENGTH),
    });

    expect(result.success).toBe(true);
  });

  it("accepts up to 100000 redirect rules", () => {
    const result = PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA.safeParse(
      buildRedirectRules(MAX_PROVIDER_RULES)
    );

    expect(result.success).toBe(true);
  });

  it("rejects more than 100000 redirect rules", () => {
    const result = PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA.safeParse(
      buildRedirectRules(MAX_PROVIDER_RULES + 1)
    );

    expect(result.success).toBe(false);
  });

  it("允许 exact redirect 同时包含 GLM-5 和 glm-5 两个 source", () => {
    const result = PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA.safeParse([
      { matchType: "exact", source: "GLM-5", target: "GLM-5" },
      { matchType: "exact", source: "glm-5", target: "GLM-5" },
    ]);

    expect(result.success).toBe(true);
  });
});
