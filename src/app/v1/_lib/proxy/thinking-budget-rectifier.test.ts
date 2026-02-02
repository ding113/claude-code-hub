import { describe, expect, it } from "vitest";
import {
  detectThinkingBudgetRectifierTrigger,
  rectifyThinkingBudget,
} from "./thinking-budget-rectifier";

describe("Thinking Budget Rectifier", () => {
  describe("detectThinkingBudgetRectifierTrigger", () => {
    it("should return null for null/undefined input", () => {
      expect(detectThinkingBudgetRectifierTrigger(null)).toBeNull();
      expect(detectThinkingBudgetRectifierTrigger(undefined)).toBeNull();
    });

    it("should return null for empty string", () => {
      expect(detectThinkingBudgetRectifierTrigger("")).toBeNull();
    });

    it("should detect exact error message from Anthropic API", () => {
      const errorMessage =
        "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024";
      expect(detectThinkingBudgetRectifierTrigger(errorMessage)).toBe("budget_tokens_too_low");
    });

    it("should detect error message wrapped in JSON", () => {
      const jsonError = JSON.stringify({
        error: {
          type: "invalid_request_error",
          message: "thinking.enabled.budget_tokens: Input should be greater than or equal to 1024",
        },
      });
      expect(detectThinkingBudgetRectifierTrigger(jsonError)).toBe("budget_tokens_too_low");
    });

    it("should detect case-insensitive variations", () => {
      const upperCase =
        "THINKING.ENABLED.BUDGET_TOKENS: INPUT SHOULD BE GREATER THAN OR EQUAL TO 1024";
      expect(detectThinkingBudgetRectifierTrigger(upperCase)).toBe("budget_tokens_too_low");
    });

    it("should detect with >= 1024 format", () => {
      const errorMessage = "thinking budget_tokens must be >= 1024";
      expect(detectThinkingBudgetRectifierTrigger(errorMessage)).toBe("budget_tokens_too_low");
    });

    it("should return null for unrelated 400 errors", () => {
      expect(
        detectThinkingBudgetRectifierTrigger("invalid_request_error: model not found")
      ).toBeNull();
      expect(detectThinkingBudgetRectifierTrigger("max_tokens must be greater than 0")).toBeNull();
    });

    it("should return null for thinking signature errors (different rectifier)", () => {
      expect(
        detectThinkingBudgetRectifierTrigger("invalid signature in thinking block")
      ).toBeNull();
      expect(
        detectThinkingBudgetRectifierTrigger("assistant message must start with a thinking block")
      ).toBeNull();
    });

    it("should return null when only partial match (missing 1024)", () => {
      expect(
        detectThinkingBudgetRectifierTrigger(
          "thinking.enabled.budget_tokens: Input should be greater than 0"
        )
      ).toBeNull();
    });

    it("should return null when only partial match (missing thinking)", () => {
      expect(
        detectThinkingBudgetRectifierTrigger(
          "budget_tokens: Input should be greater than or equal to 1024"
        )
      ).toBeNull();
    });
  });

  describe("rectifyThinkingBudget", () => {
    it("should set thinking.budget_tokens to 32000 when missing", () => {
      const message: Record<string, unknown> = { max_tokens: 50000 };
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(true);
      expect(result.before.thinkingBudgetTokens).toBeNull();
      expect(result.after.thinkingBudgetTokens).toBe(32000);
      expect((message.thinking as Record<string, unknown>).budget_tokens).toBe(32000);
    });

    it("should set thinking.budget_tokens to 32000 when below 1024", () => {
      const message: Record<string, unknown> = {
        max_tokens: 50000,
        thinking: { type: "enabled", budget_tokens: 500 },
      };
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(true);
      expect(result.before.thinkingBudgetTokens).toBe(500);
      expect(result.after.thinkingBudgetTokens).toBe(32000);
    });

    it("should set thinking.type to enabled", () => {
      const message: Record<string, unknown> = {
        max_tokens: 50000,
        thinking: { type: "disabled", budget_tokens: 500 },
      };
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(true);
      expect(result.before.thinkingType).toBe("disabled");
      expect(result.after.thinkingType).toBe("enabled");
      expect((message.thinking as Record<string, unknown>).type).toBe("enabled");
    });

    it("should set max_tokens to 64000 when missing", () => {
      const message: Record<string, unknown> = {};
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(true);
      expect(result.before.maxTokens).toBeNull();
      expect(result.after.maxTokens).toBe(64000);
      expect(message.max_tokens).toBe(64000);
    });

    it("should set max_tokens to 64000 when below 32001", () => {
      const message: Record<string, unknown> = { max_tokens: 1000 };
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(true);
      expect(result.before.maxTokens).toBe(1000);
      expect(result.after.maxTokens).toBe(64000);
    });

    it("should NOT change max_tokens when already >= 32001", () => {
      const message: Record<string, unknown> = { max_tokens: 50000 };
      const result = rectifyThinkingBudget(message);

      expect(result.after.maxTokens).toBe(50000);
      expect(message.max_tokens).toBe(50000);
    });

    it("should handle non-object thinking value by replacing it", () => {
      const message: Record<string, unknown> = {
        max_tokens: 50000,
        thinking: "invalid",
      };
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(true);
      expect(typeof message.thinking).toBe("object");
      expect((message.thinking as Record<string, unknown>).budget_tokens).toBe(32000);
    });

    it("should preserve other thinking properties", () => {
      const message: Record<string, unknown> = {
        max_tokens: 50000,
        thinking: { type: "enabled", budget_tokens: 500, custom_field: "preserved" },
      };
      rectifyThinkingBudget(message);

      expect((message.thinking as Record<string, unknown>).custom_field).toBe("preserved");
    });

    it("should return applied=false when values already at target", () => {
      const message: Record<string, unknown> = {
        max_tokens: 64000,
        thinking: { type: "enabled", budget_tokens: 32000 },
      };
      const result = rectifyThinkingBudget(message);

      expect(result.applied).toBe(false);
      expect(result.before).toEqual(result.after);
    });

    it("should handle edge case: max_tokens exactly 32001", () => {
      const message: Record<string, unknown> = { max_tokens: 32001 };
      const result = rectifyThinkingBudget(message);

      expect(result.after.maxTokens).toBe(32001);
      expect(message.max_tokens).toBe(32001);
    });

    it("should handle edge case: max_tokens exactly 32000 (needs upgrade)", () => {
      const message: Record<string, unknown> = { max_tokens: 32000 };
      const result = rectifyThinkingBudget(message);

      expect(result.after.maxTokens).toBe(64000);
      expect(message.max_tokens).toBe(64000);
    });

    it("should track before/after values correctly for audit", () => {
      const message: Record<string, unknown> = {
        max_tokens: 1000,
        thinking: { type: "disabled", budget_tokens: 100 },
      };
      const result = rectifyThinkingBudget(message);

      expect(result.before).toEqual({
        maxTokens: 1000,
        thinkingType: "disabled",
        thinkingBudgetTokens: 100,
      });
      expect(result.after).toEqual({
        maxTokens: 64000,
        thinkingType: "enabled",
        thinkingBudgetTokens: 32000,
      });
    });
  });
});
