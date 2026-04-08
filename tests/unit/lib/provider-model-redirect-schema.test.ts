import { describe, expect, it } from "vitest";
import {
  PROVIDER_MODEL_REDIRECT_RULE_LIST_SCHEMA,
  PROVIDER_MODEL_REDIRECT_RULE_SCHEMA,
} from "@/lib/provider-model-redirect-schema";

const MAX_PROVIDER_RULES = 100_000;
const MAX_PROVIDER_RULE_TEXT_LENGTH = 4_096;

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
});
