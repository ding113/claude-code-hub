import { describe, expect, it } from "vitest";
import {
  detectThinkingBudgetRectifierTrigger,
  rectifyThinkingBudget,
} from "@/app/v1/_lib/proxy/thinking-budget-rectifier";

describe("ThinkingBudgetRectifier", () => {
  describe("detectThinkingBudgetRectifierTrigger", () => {
    it("should detect budget_tokens_too_low from typical Anthropic error", () => {
      const trigger = detectThinkingBudgetRectifierTrigger(
        "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024"
      );
      expect(trigger).toBe("budget_tokens_too_low");
    });

    it("should return null for unrelated errors", () => {
      const trigger = detectThinkingBudgetRectifierTrigger("rate limit exceeded");
      expect(trigger).toBeNull();
    });

    it("should return null for null/undefined input", () => {
      expect(detectThinkingBudgetRectifierTrigger(null)).toBeNull();
      expect(detectThinkingBudgetRectifierTrigger(undefined)).toBeNull();
    });
  });

  describe("rectifyThinkingBudget", () => {
    it("should rectify standard thinking budget", () => {
      const message: Record<string, unknown> = {
        model: "claude-opus-4-6",
        max_tokens: 4000,
        thinking: { type: "enabled", budget_tokens: 500 },
      };

      const result = rectifyThinkingBudget(message);
      expect(result.applied).toBe(true);
      expect(result.after.thinkingBudgetTokens).toBe(32000);
      expect(result.after.thinkingType).toBe("enabled");
    });

    it("should skip rectification when thinking.type is adaptive", () => {
      const message: Record<string, unknown> = {
        model: "claude-opus-4-6",
        max_tokens: 8000,
        thinking: { type: "adaptive" },
      };

      const result = rectifyThinkingBudget(message);
      expect(result.applied).toBe(false);
      expect(result.before.thinkingType).toBe("adaptive");
      expect(result.after.thinkingType).toBe("adaptive");
    });
  });
});
