import type { ProviderParameterOverrideSpecialSetting } from "@/types/special-settings";

type AnthropicProviderOverrideConfig = {
  id?: number;
  name?: string;
  providerType?: string;
  anthropicMaxTokensPreference?: string | null;
  anthropicThinkingBudgetPreference?: string | null;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toAuditValue(value: unknown): string | number | boolean | null {
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  return null;
}

function normalizeNumericPreference(value: string | null | undefined): number | null {
  if (!value || value === "inherit") return null;
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

/**
 * Apply Anthropic provider overrides to request body.
 *
 * Conventions:
 * - providerType !== "claude" && providerType !== "claude-auth" -> no processing
 * - Preference value null/undefined/"inherit" means "follow client"
 * - Overrides only affect:
 *   - max_tokens
 *   - thinking.type / thinking.budget_tokens
 */
export function applyAnthropicProviderOverrides(
  provider: AnthropicProviderOverrideConfig,
  request: Record<string, unknown>
): Record<string, unknown> {
  if (provider.providerType !== "claude" && provider.providerType !== "claude-auth") {
    return request;
  }

  let output: Record<string, unknown> = request;
  const ensureCloned = () => {
    if (output === request) {
      output = { ...request };
    }
  };

  const maxTokens = normalizeNumericPreference(provider.anthropicMaxTokensPreference);
  if (maxTokens !== null) {
    ensureCloned();
    output.max_tokens = maxTokens;
  }

  const thinkingBudget = normalizeNumericPreference(provider.anthropicThinkingBudgetPreference);
  if (thinkingBudget !== null) {
    ensureCloned();
    const existingThinking = isPlainObject(output.thinking) ? output.thinking : {};
    let budgetTokens = thinkingBudget;
    const currentMaxTokens = typeof output.max_tokens === "number" ? output.max_tokens : null;
    // Anthropic API requires budget_tokens >= 1024
    const MIN_BUDGET_TOKENS = 1024;
    if (currentMaxTokens !== null && budgetTokens >= currentMaxTokens) {
      budgetTokens = currentMaxTokens - 1;
    }
    // If clamping would result in budget_tokens < 1024, skip thinking override entirely
    // to avoid invalid API requests
    if (budgetTokens < MIN_BUDGET_TOKENS) {
      return output;
    }
    const nextThinking: Record<string, unknown> = {
      ...existingThinking,
      type: "enabled",
      budget_tokens: budgetTokens,
    };
    output.thinking = nextThinking;
  }

  return output;
}

export function applyAnthropicProviderOverridesWithAudit(
  provider: AnthropicProviderOverrideConfig,
  request: Record<string, unknown>
): { request: Record<string, unknown>; audit: ProviderParameterOverrideSpecialSetting | null } {
  if (provider.providerType !== "claude" && provider.providerType !== "claude-auth") {
    return { request, audit: null };
  }

  const maxTokens = normalizeNumericPreference(provider.anthropicMaxTokensPreference);
  const thinkingBudget = normalizeNumericPreference(provider.anthropicThinkingBudgetPreference);

  const hit = maxTokens !== null || thinkingBudget !== null;

  if (!hit) {
    return { request, audit: null };
  }

  const beforeMaxTokens = toAuditValue(request.max_tokens);
  const beforeThinking = isPlainObject(request.thinking) ? request.thinking : null;
  const beforeThinkingType = toAuditValue(beforeThinking?.type);
  const beforeThinkingBudgetTokens = toAuditValue(beforeThinking?.budget_tokens);

  const nextRequest = applyAnthropicProviderOverrides(provider, request);

  const afterMaxTokens = toAuditValue(nextRequest.max_tokens);
  const afterThinking = isPlainObject(nextRequest.thinking) ? nextRequest.thinking : null;
  const afterThinkingType = toAuditValue(afterThinking?.type);
  const afterThinkingBudgetTokens = toAuditValue(afterThinking?.budget_tokens);

  const changes: ProviderParameterOverrideSpecialSetting["changes"] = [
    {
      path: "max_tokens",
      before: beforeMaxTokens,
      after: afterMaxTokens,
      changed: !Object.is(beforeMaxTokens, afterMaxTokens),
    },
    {
      path: "thinking.type",
      before: beforeThinkingType,
      after: afterThinkingType,
      changed: !Object.is(beforeThinkingType, afterThinkingType),
    },
    {
      path: "thinking.budget_tokens",
      before: beforeThinkingBudgetTokens,
      after: afterThinkingBudgetTokens,
      changed: !Object.is(beforeThinkingBudgetTokens, afterThinkingBudgetTokens),
    },
  ];

  const audit: ProviderParameterOverrideSpecialSetting = {
    type: "provider_parameter_override",
    scope: "provider",
    providerId: provider.id ?? null,
    providerName: provider.name ?? null,
    providerType: provider.providerType ?? null,
    hit: true,
    changed: changes.some((c) => c.changed),
    changes,
  };

  return { request: nextRequest, audit };
}
