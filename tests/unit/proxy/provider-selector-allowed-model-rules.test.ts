import { describe, expect, test } from "vitest";
import type { AllowedModelRule, Provider } from "@/types/provider";
import { providerSupportsModel } from "@/app/v1/_lib/proxy/provider-selector";

function createProvider(allowedModels: Provider["allowedModels"]): Provider {
  return {
    id: 1,
    name: "provider-1",
    isEnabled: true,
    providerType: "claude",
    groupTag: null,
    weight: 1,
    priority: 0,
    costMultiplier: 1,
    allowedModels,
  } as Provider;
}

describe("providerSupportsModel", () => {
  test("supports advanced rule-based model whitelist matching", () => {
    const allowedModels: AllowedModelRule[] = [
      { matchType: "prefix", pattern: "claude-opus-" },
      { matchType: "suffix", pattern: "-latest" },
    ];

    expect(providerSupportsModel(createProvider(allowedModels), "claude-opus-4-1")).toBe(true);
    expect(providerSupportsModel(createProvider(allowedModels), "gpt-4o-latest")).toBe(true);
    expect(providerSupportsModel(createProvider(allowedModels), "claude-sonnet-4-1")).toBe(false);
  });

  test("keeps backward compatibility with legacy string arrays", () => {
    const legacyAllowedModels = ["claude-opus-4-1"] as unknown as Provider["allowedModels"];

    expect(providerSupportsModel(createProvider(legacyAllowedModels), "claude-opus-4-1")).toBe(
      true
    );
    expect(providerSupportsModel(createProvider(legacyAllowedModels), "claude-opus-4-2")).toBe(
      false
    );
  });
});
