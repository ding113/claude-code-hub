import { describe, expect, test } from "vitest";
import type { ProviderGroupModelMatchRule } from "@/lib/provider-groups/model-match-rules";
import type { AllowedModelRule, Provider } from "@/types/provider";
import {
  providerSupportsModel,
  resolveEffectiveProviderGroup,
} from "@/app/v1/_lib/proxy/provider-selector";

function createProvider(
  allowedModels: Provider["allowedModels"],
  groupTag: Provider["groupTag"] = null
): Provider {
  return {
    id: 1,
    name: "provider-1",
    isEnabled: true,
    providerType: "claude",
    groupTag,
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

  test("applies group model rules in addition to provider rules", () => {
    const groupRules = new Map<string, ProviderGroupModelMatchRule[]>([
      ["codex", [{ matchType: "prefix", pattern: "gpt-" }]],
    ]);
    const provider = createProvider([{ matchType: "suffix", pattern: "-latest" }], "codex");

    expect(providerSupportsModel(provider, "gpt-4o-latest", groupRules)).toBe(true);
    expect(providerSupportsModel(provider, "gpt-4o", groupRules)).toBe(false);
    expect(providerSupportsModel(provider, "claude-3-latest", groupRules)).toBe(false);
  });
});

describe("resolveEffectiveProviderGroup", () => {
  test("prefers the selected provider group over a multi-group key", () => {
    expect(
      resolveEffectiveProviderGroup({
        providerGroup: "codex",
        key: { providerGroup: "Kimi,account pool,claude,codex,grok,image" },
        user: { providerGroup: "default" },
      })
    ).toBe("codex");
  });

  test("falls back to key, then user, while preserving the default fallback", () => {
    expect(resolveEffectiveProviderGroup({ key: { providerGroup: "codex" } })).toBe("codex");
    expect(resolveEffectiveProviderGroup({ user: { providerGroup: "claude" } })).toBe("claude");
    expect(resolveEffectiveProviderGroup({ key: {} })).toBe("default");
    expect(resolveEffectiveProviderGroup({})).toBeNull();
  });
});
