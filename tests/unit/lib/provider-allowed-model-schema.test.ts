import { describe, expect, it } from "vitest";
import { PROVIDER_RULE_LIMITS } from "@/lib/constants/provider.constants";
import {
  PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA,
  PROVIDER_ALLOWED_MODEL_RULE_SCHEMA,
} from "@/lib/provider-allowed-model-schema";

const { MAX_ITEMS: MAX_PROVIDER_RULES, MAX_TEXT_LENGTH: MAX_PROVIDER_RULE_TEXT_LENGTH } =
  PROVIDER_RULE_LIMITS;

function buildAllowedModelRules(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    matchType: "exact" as const,
    pattern: `model-${index}`,
  }));
}

describe("provider-allowed-model-schema", () => {
  it("accepts match patterns longer than 255 characters when still within the new cap", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_SCHEMA.safeParse({
      matchType: "exact",
      pattern: "m".repeat(MAX_PROVIDER_RULE_TEXT_LENGTH),
    });

    expect(result.success).toBe(true);
  });

  it("accepts up to 100000 allowlist rules", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA.safeParse(
      buildAllowedModelRules(MAX_PROVIDER_RULES)
    );

    expect(result.success).toBe(true);
  });

  it("rejects more than 100000 allowlist rules", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA.safeParse(
      buildAllowedModelRules(MAX_PROVIDER_RULES + 1)
    );

    expect(result.success).toBe(false);
  });

  it("允许 exact allowlist 同时包含 GLM-5 和 glm-5", () => {
    const result = PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA.safeParse([
      { matchType: "exact", pattern: "GLM-5" },
      { matchType: "exact", pattern: "glm-5" },
    ]);

    expect(result.success).toBe(true);
  });
});
