import { describe, expect, it } from "vitest";
import {
  applyAnthropicProviderOverrides,
  applyAnthropicProviderOverridesWithAudit,
} from "@/lib/anthropic/provider-overrides";

describe("Anthropic Provider Overrides", () => {
  describe("Provider type filtering", () => {
    it("should return unchanged request for non-claude/claude-auth providers (codex)", () => {
      const provider = {
        providerType: "codex",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "10240",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toBe(input);
      expect(output).toEqual(input);
    });

    it("should return unchanged request for non-claude/claude-auth providers (gemini)", () => {
      const provider = {
        providerType: "gemini",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "10240",
      };

      const input: Record<string, unknown> = {
        model: "gemini-pro",
        messages: [],
        max_tokens: 8000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toBe(input);
    });

    it("should return unchanged request for non-claude/claude-auth providers (openai-compatible)", () => {
      const provider = {
        providerType: "openai-compatible",
        anthropicMaxTokensPreference: "16000",
      };

      const input: Record<string, unknown> = {
        model: "gpt-4",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toBe(input);
    });

    it("should apply overrides for 'claude' provider type", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(32000);
    });

    it("should apply overrides for 'claude-auth' provider type", () => {
      const provider = {
        providerType: "claude-auth",
        anthropicMaxTokensPreference: "16000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-sonnet-20240229",
        messages: [],
        max_tokens: 4000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(16000);
    });
  });

  describe("max_tokens override", () => {
    it("should not change request when preference is 'inherit'", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "inherit",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should not change request when preference is null", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: null,
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should not change request when preference is undefined", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: undefined,
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should set max_tokens to numeric value when preference is valid string '32000'", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(32000);
    });

    it("should overwrite existing max_tokens value", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "64000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 4000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(64000);
      expect(input.max_tokens).toBe(4000);
    });

    it("should not change max_tokens for invalid numeric string", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "invalid",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });
  });

  describe("thinking.budget_tokens override", () => {
    it("should not change request when preference is 'inherit'", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "inherit",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        thinking: { type: "enabled", budget_tokens: 5000 },
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should not change request when preference is null", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: null,
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        thinking: { type: "enabled", budget_tokens: 5000 },
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should not change request when preference is undefined", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: undefined,
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        thinking: { type: "enabled", budget_tokens: 5000 },
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should set thinking.budget_tokens and thinking.type when preference is valid '10240'", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "10240",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toEqual({
        type: "enabled",
        budget_tokens: 10240,
      });
    });

    it("should preserve existing thinking properties not overridden", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "8000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
        thinking: {
          type: "disabled",
          budget_tokens: 2000,
          custom_field: "preserve_me",
        },
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.type).toBe("enabled");
      expect(thinking.budget_tokens).toBe(8000);
      expect(thinking.custom_field).toBe("preserve_me");
    });

    it("should create thinking object if not present", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "5000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 10000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toBeDefined();
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.type).toBe("enabled");
      expect(thinking.budget_tokens).toBe(5000);
    });

    it("should handle non-object thinking value by replacing it", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "6000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
        thinking: "invalid_string_value",
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toEqual({
        type: "enabled",
        budget_tokens: 6000,
      });
    });
  });

  describe("Clamping logic", () => {
    it("should clamp budget_tokens to max_tokens - 1 when budget_tokens >= max_tokens (overridden max_tokens)", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "10000",
        anthropicThinkingBudgetPreference: "15000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(10000);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(9999);
    });

    it("should clamp budget_tokens to max_tokens - 1 when budget_tokens >= max_tokens (request-provided max_tokens)", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "20000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 16000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(15999);
    });

    it("should clamp budget_tokens when exactly equal to max_tokens", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "8000",
        anthropicThinkingBudgetPreference: "8000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(8000);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(7999);
    });

    it("should not clamp when budget_tokens < max_tokens", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "10000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(32000);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(10000);
    });

    it("should not clamp when max_tokens is not set", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "50000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(50000);
    });

    it("should skip thinking override when clamped budget_tokens would be below 1024 (API minimum)", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "500",
        anthropicThinkingBudgetPreference: "10000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(500);
      expect(output.thinking).toBeUndefined();
    });

    it("should skip thinking override when budget_tokens preference itself is below 1024", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "500",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toBeUndefined();
    });

    it("should skip thinking override when max_tokens is exactly 1024 (clamped would be 1023)", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "1024",
        anthropicThinkingBudgetPreference: "2000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(1024);
      expect(output.thinking).toBeUndefined();
    });

    it("should apply thinking override when clamped budget_tokens is exactly 1024", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "1025",
        anthropicThinkingBudgetPreference: "2000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(1025);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(1024);
      expect(thinking.type).toBe("enabled");
    });

    it("should apply thinking override when budget_tokens is exactly 1024 and no clamping needed", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "1024",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.budget_tokens).toBe(1024);
      expect(thinking.type).toBe("enabled");
    });
  });

  describe("Audit function", () => {
    it("should return null audit when provider type is not claude/claude-auth", () => {
      const provider = {
        id: 123,
        name: "codex-provider",
        providerType: "codex",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "10240",
      };

      const input: Record<string, unknown> = {
        model: "gpt-4",
        messages: [],
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.request).toBe(input);
      expect(result.audit).toBeNull();
    });

    it("should return null audit when all preferences are inherit/null/undefined", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "inherit",
        anthropicThinkingBudgetPreference: null,
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.request).toBe(input);
      expect(result.audit).toBeNull();
    });

    it("should return null audit when preferences are invalid numeric strings", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "invalid",
        anthropicThinkingBudgetPreference: "not_a_number",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.request).toBe(input);
      expect(result.audit).toBeNull();
    });

    it("should return audit with hit=true when max_tokens override is applied", () => {
      const provider = {
        id: 1,
        name: "claude-provider",
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.hit).toBe(true);
      expect(result.audit?.providerId).toBe(1);
      expect(result.audit?.providerName).toBe("claude-provider");
    });

    it("should return audit with hit=true when thinking override is applied", () => {
      const provider = {
        id: 2,
        name: "anthropic-direct",
        providerType: "claude-auth",
        anthropicThinkingBudgetPreference: "10240",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.hit).toBe(true);
      expect(result.audit?.providerId).toBe(2);
      expect(result.audit?.providerName).toBe("anthropic-direct");
    });

    it("should track before/after values correctly for max_tokens", () => {
      const provider = {
        id: 1,
        name: "test-provider",
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      const maxTokensChange = result.audit?.changes.find((c) => c.path === "max_tokens");
      expect(maxTokensChange?.before).toBe(8000);
      expect(maxTokensChange?.after).toBe(32000);
      expect(maxTokensChange?.changed).toBe(true);
    });

    it("should track before/after values correctly for thinking fields", () => {
      const provider = {
        id: 1,
        name: "test-provider",
        providerType: "claude",
        anthropicThinkingBudgetPreference: "10000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 32000,
        thinking: { type: "disabled", budget_tokens: 5000 },
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);

      const typeChange = result.audit?.changes.find((c) => c.path === "thinking.type");
      expect(typeChange?.before).toBe("disabled");
      expect(typeChange?.after).toBe("enabled");
      expect(typeChange?.changed).toBe(true);

      const budgetChange = result.audit?.changes.find((c) => c.path === "thinking.budget_tokens");
      expect(budgetChange?.before).toBe(5000);
      expect(budgetChange?.after).toBe(10000);
      expect(budgetChange?.changed).toBe(true);
    });

    it("should set changed=false when override value equals existing value", () => {
      const provider = {
        id: 1,
        name: "test-provider",
        providerType: "claude",
        anthropicMaxTokensPreference: "8000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      const maxTokensChange = result.audit?.changes.find((c) => c.path === "max_tokens");
      expect(maxTokensChange?.before).toBe(8000);
      expect(maxTokensChange?.after).toBe(8000);
      expect(maxTokensChange?.changed).toBe(false);
    });

    it("should set audit.changed=true only when at least one value actually changed", () => {
      const provider = {
        id: 1,
        name: "test-provider",
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "10240",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.changed).toBe(true);
    });

    it("should set audit.changed=false when no values actually changed", () => {
      const provider = {
        id: 1,
        name: "test-provider",
        providerType: "claude",
        anthropicMaxTokensPreference: "8000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
        max_tokens: 8000,
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.hit).toBe(true);
      expect(result.audit?.changed).toBe(false);
    });

    it("should include correct metadata in audit", () => {
      const provider = {
        id: 42,
        name: "my-claude-provider",
        providerType: "claude",
        anthropicMaxTokensPreference: "16000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.type).toBe("provider_parameter_override");
      expect(result.audit?.scope).toBe("provider");
      expect(result.audit?.providerId).toBe(42);
      expect(result.audit?.providerName).toBe("my-claude-provider");
      expect(result.audit?.providerType).toBe("claude");
    });

    it("should handle missing provider id and name gracefully", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "16000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.providerId).toBeNull();
      expect(result.audit?.providerName).toBeNull();
    });

    it("should track null before values when fields do not exist", () => {
      const provider = {
        id: 1,
        name: "test",
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "10000",
      };

      const input: Record<string, unknown> = {
        model: "claude-3-opus-20240229",
        messages: [],
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);

      const maxTokensChange = result.audit?.changes.find((c) => c.path === "max_tokens");
      expect(maxTokensChange?.before).toBeNull();
      expect(maxTokensChange?.after).toBe(32000);

      const typeChange = result.audit?.changes.find((c) => c.path === "thinking.type");
      expect(typeChange?.before).toBeNull();
      expect(typeChange?.after).toBe("enabled");

      const budgetChange = result.audit?.changes.find((c) => c.path === "thinking.budget_tokens");
      expect(budgetChange?.before).toBeNull();
      expect(budgetChange?.after).toBe(10000);
    });
  });

  describe("Adaptive thinking mode", () => {
    it("should apply adaptive thinking for matching model (all models mode)", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "high" as const,
          modelMatchMode: "all" as const,
          models: [],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
        max_tokens: 8000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toEqual({ type: "adaptive" });
      expect(output.output_config).toEqual({ effort: "high" });
    });

    it("should apply adaptive thinking for matching model (specific models mode)", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "max" as const,
          modelMatchMode: "specific" as const,
          models: ["claude-opus-4-6"],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toEqual({ type: "adaptive" });
      expect(output.output_config).toEqual({ effort: "max" });
    });

    it("should passthrough for non-matching model (specific models mode)", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "high" as const,
          modelMatchMode: "specific" as const,
          models: ["claude-opus-4-6"],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-sonnet-4-5",
        messages: [],
        max_tokens: 8000,
        thinking: { type: "enabled", budget_tokens: 5000 },
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should preserve existing output_config properties", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "medium" as const,
          modelMatchMode: "all" as const,
          models: [],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
        output_config: { some_other_field: "preserve" },
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      const outputConfig = output.output_config as Record<string, unknown>;
      expect(outputConfig.effort).toBe("medium");
      expect(outputConfig.some_other_field).toBe("preserve");
    });

    it("should apply adaptive with effort 'low'", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "low" as const,
          modelMatchMode: "all" as const,
          models: [],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.output_config).toEqual({ effort: "low" });
    });

    it("should remove budget_tokens from existing thinking when applying adaptive", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "high" as const,
          modelMatchMode: "all" as const,
          models: [],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
        thinking: { type: "enabled", budget_tokens: 10240 },
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      const thinking = output.thinking as Record<string, unknown>;
      expect(thinking.type).toBe("adaptive");
      expect(thinking.budget_tokens).toBeUndefined();
    });

    it("should passthrough when adaptive config is null (defensive)", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: null,
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
        max_tokens: 8000,
      };
      const snapshot = structuredClone(input);

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output).toEqual(snapshot);
    });

    it("should apply adaptive + max_tokens override together", () => {
      const provider = {
        providerType: "claude",
        anthropicMaxTokensPreference: "32000",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "high" as const,
          modelMatchMode: "all" as const,
          models: [],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
        max_tokens: 8000,
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.max_tokens).toBe(32000);
      expect(output.thinking).toEqual({ type: "adaptive" });
      expect(output.output_config).toEqual({ effort: "high" });
    });

    it("should match model prefix (claude-opus-4-6 matches claude-opus-4-6-20250514)", () => {
      const provider = {
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "high" as const,
          modelMatchMode: "specific" as const,
          models: ["claude-opus-4-6"],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6-20250514",
        messages: [],
      };

      const output = applyAnthropicProviderOverrides(provider, input);
      expect(output.thinking).toEqual({ type: "adaptive" });
      expect(output.output_config).toEqual({ effort: "high" });
    });

    it("should track output_config.effort in audit for adaptive mode", () => {
      const provider = {
        id: 1,
        name: "adaptive-provider",
        providerType: "claude",
        anthropicThinkingBudgetPreference: "adaptive",
        anthropicAdaptiveThinking: {
          effort: "high" as const,
          modelMatchMode: "all" as const,
          models: [],
        },
      };

      const input: Record<string, unknown> = {
        model: "claude-opus-4-6",
        messages: [],
      };

      const result = applyAnthropicProviderOverridesWithAudit(provider, input);
      expect(result.audit?.hit).toBe(true);
      expect(result.audit?.changed).toBe(true);

      const effortChange = result.audit?.changes.find((c) => c.path === "output_config.effort");
      expect(effortChange?.before).toBeNull();
      expect(effortChange?.after).toBe("high");
      expect(effortChange?.changed).toBe(true);

      const thinkingTypeChange = result.audit?.changes.find((c) => c.path === "thinking.type");
      expect(thinkingTypeChange?.after).toBe("adaptive");
    });
  });
});
