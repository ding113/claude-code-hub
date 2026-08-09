import { describe, expect, it } from "vitest";
import {
  firstProviderGroupHealthTestModel,
  normalizeProviderGroupHealthTestModels,
  providerHasConfiguredHealthTestModel,
  PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_COUNT,
  PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_LENGTH,
  resolveProviderGroupHealthTestModelFallback,
  resolveProviderHealthTestModelForRequest,
} from "@/lib/provider-health-test/model-config";

describe("provider group health-test model config", () => {
  it("trims, deduplicates, truncates, and caps configured models", () => {
    const longModel = "x".repeat(PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_LENGTH + 10);
    expect(
      normalizeProviderGroupHealthTestModels([" model-a ", "model-a", longModel, "model-c"])
    ).toEqual(["model-a", "x".repeat(PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_LENGTH), "model-c"]);
    expect(PROVIDER_GROUP_HEALTH_TEST_MODEL_MAX_COUNT).toBe(20);
  });

  it("uses the legacy field only when the new list is absent", () => {
    expect(normalizeProviderGroupHealthTestModels(null, "legacy-model")).toEqual(["legacy-model"]);
    expect(normalizeProviderGroupHealthTestModels(undefined, "legacy-model")).toEqual([
      "legacy-model",
    ]);
    expect(normalizeProviderGroupHealthTestModels([], "legacy-model")).toEqual([]);
    expect(firstProviderGroupHealthTestModel(["new-model"], "legacy-model")).toBe("new-model");
  });

  it("resolves a missing or invalid fallback to the first configured model", () => {
    expect(resolveProviderGroupHealthTestModelFallback(null, ["model-a", "model-b"])).toBe(
      "model-a"
    );
    expect(resolveProviderGroupHealthTestModelFallback("wrong", ["model-a", "model-b"])).toBe(
      "model-a"
    );
    expect(resolveProviderGroupHealthTestModelFallback(" model-b ", ["model-a", "model-b"])).toBe(
      "model-b"
    );
    expect(resolveProviderGroupHealthTestModelFallback("model-a", [])).toBeNull();
  });

  it("prefers an exact configured request model and otherwise uses the group fallback", () => {
    const modelsByGroup = new Map([["grok", ["grok-4", "grok-5"]]]);
    const fallbacksByGroup = new Map([["grok", "grok-5"]]);
    expect(
      resolveProviderHealthTestModelForRequest(
        "grok",
        "grok-4",
        modelsByGroup,
        fallbacksByGroup
      )
    ).toBe("grok-4");
    expect(
      resolveProviderHealthTestModelForRequest(
        "grok",
        "other-model",
        modelsByGroup,
        fallbacksByGroup
      )
    ).toBe("grok-5");
    expect(
      resolveProviderHealthTestModelForRequest("grok", undefined, modelsByGroup, new Map())
    ).toBe("grok-4");
  });

  it("matches a requested model against any parsed provider group", () => {
    const modelsByGroup = new Map([
      ["claude", ["claude-sonnet"]],
      ["grok", ["grok-4"]],
    ]);
    expect(providerHasConfiguredHealthTestModel("claude, grok", "grok-4", modelsByGroup)).toBe(
      true
    );
    expect(providerHasConfiguredHealthTestModel("claude", "grok-4", modelsByGroup)).toBe(false);
    expect(
      providerHasConfiguredHealthTestModel(
        null,
        "default-model",
        new Map([["default", ["default-model"]]])
      )
    ).toBe(true);
  });
});
