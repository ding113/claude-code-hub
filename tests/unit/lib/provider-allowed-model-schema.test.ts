import { describe, expect, it } from "vitest";
import {
  PROVIDER_ALLOWED_MODEL_RULE_INPUT_LIST_SCHEMA,
  PROVIDER_ALLOWED_MODEL_RULE_SCHEMA,
} from "@/lib/provider-allowed-model-schema";

const MAX_PROVIDER_RULES = 100_000;
const MAX_PROVIDER_RULE_TEXT_LENGTH = 4_096;

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
});
