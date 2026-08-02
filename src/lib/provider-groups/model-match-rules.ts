import { matchesAllowedModelRules, normalizeAllowedModelRules } from "@/lib/allowed-model-rules";
import type { AllowedModelRule } from "@/types/provider";

/** Model patterns stored on a provider group and applied before dispatch. */
export type ProviderGroupModelMatchRule = AllowedModelRule;

export type ProviderGroupModelMatchRulesByName = ReadonlyMap<
  string,
  ProviderGroupModelMatchRule[] | null | undefined
>;

export function normalizeProviderGroupModelMatchRules(
  value: unknown
): ProviderGroupModelMatchRule[] | null {
  const rules = normalizeAllowedModelRules(value);
  return rules && rules.length > 0 ? rules : null;
}

/**
 * Group rules are an additional allowlist on top of provider.allowedModels.
 * A provider with no configured group rules remains unrestricted by this layer.
 * Providers in multiple groups are allowed when any configured group matches.
 */
export function matchesProviderGroupModelMatchRules(
  requestedModel: string,
  providerGroupNames: string[],
  rulesByName: ProviderGroupModelMatchRulesByName
): boolean {
  const configuredRules = providerGroupNames
    .map((groupName) => rulesByName.get(groupName))
    .filter((rules): rules is ProviderGroupModelMatchRule[] => Boolean(rules?.length));

  if (configuredRules.length === 0) return true;
  return configuredRules.some((rules) => matchesAllowedModelRules(requestedModel, rules));
}
