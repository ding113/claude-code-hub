/**
 * Thinking Budget Rectifier - Reactive rectifier for Anthropic API budget_tokens < 1024 errors.
 * Trigger: "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024"
 * Action: Set thinking.budget_tokens=32000, thinking.type="enabled", max_tokens=64000 (if needed)
 */

export type ThinkingBudgetRectifierTrigger = "budget_tokens_too_low";

export type ThinkingBudgetRectifierResult = {
  applied: boolean;
  before: {
    maxTokens: number | null;
    thinkingType: string | null;
    thinkingBudgetTokens: number | null;
  };
  after: {
    maxTokens: number | null;
    thinkingType: string | null;
    thinkingBudgetTokens: number | null;
  };
};

const MAX_THINKING_BUDGET = 32000;
const MAX_TOKENS_VALUE = 64000;
const MIN_MAX_TOKENS_FOR_BUDGET = MAX_THINKING_BUDGET + 1;

/**
 * Detect if error message indicates thinking budget validation failure.
 * Does NOT rely on error rules - only string matching.
 */
export function detectThinkingBudgetRectifierTrigger(
  errorMessage: string | null | undefined
): ThinkingBudgetRectifierTrigger | null {
  if (!errorMessage) return null;

  const lower = errorMessage.toLowerCase();

  const hasBudgetTokensReference =
    lower.includes("budget_tokens") || lower.includes("budget tokens");
  const hasThinkingReference = lower.includes("thinking");
  const has1024Constraint =
    lower.includes("greater than or equal to 1024") ||
    lower.includes(">= 1024") ||
    (lower.includes("1024") && lower.includes("input should be"));

  if (hasBudgetTokensReference && hasThinkingReference && has1024Constraint) {
    return "budget_tokens_too_low";
  }

  return null;
}

/**
 * Rectify request body by setting thinking budget and max_tokens to maximum values.
 * Modifies message object in place.
 */
export function rectifyThinkingBudget(
  message: Record<string, unknown>
): ThinkingBudgetRectifierResult {
  const currentMaxTokens = typeof message.max_tokens === "number" ? message.max_tokens : null;

  const thinking = message.thinking as Record<string, unknown> | undefined;
  const currentThinkingType = thinking && typeof thinking.type === "string" ? thinking.type : null;
  const currentThinkingBudgetTokens =
    thinking && typeof thinking.budget_tokens === "number" ? thinking.budget_tokens : null;

  const before = {
    maxTokens: currentMaxTokens,
    thinkingType: currentThinkingType,
    thinkingBudgetTokens: currentThinkingBudgetTokens,
  };

  if (!message.thinking || typeof message.thinking !== "object") {
    message.thinking = {};
  }

  const thinkingObj = message.thinking as Record<string, unknown>;
  thinkingObj.type = "enabled";
  thinkingObj.budget_tokens = MAX_THINKING_BUDGET;

  if (currentMaxTokens === null || currentMaxTokens < MIN_MAX_TOKENS_FOR_BUDGET) {
    message.max_tokens = MAX_TOKENS_VALUE;
  }

  const afterMaxTokens = typeof message.max_tokens === "number" ? message.max_tokens : null;
  const afterThinking = message.thinking as Record<string, unknown>;

  const after = {
    maxTokens: afterMaxTokens,
    thinkingType: typeof afterThinking.type === "string" ? afterThinking.type : null,
    thinkingBudgetTokens:
      typeof afterThinking.budget_tokens === "number" ? afterThinking.budget_tokens : null,
  };

  const applied =
    before.maxTokens !== after.maxTokens ||
    before.thinkingType !== after.thinkingType ||
    before.thinkingBudgetTokens !== after.thinkingBudgetTokens;

  return { applied, before, after };
}
