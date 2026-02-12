import { describe, expect, it } from "vitest";
import { createInitialState } from "@/app/[locale]/settings/providers/_components/forms/provider-form/provider-form-context";
import type { ProviderDisplay } from "@/types/provider";

function makeProvider(overrides?: Partial<ProviderDisplay>): ProviderDisplay {
  return {
    id: 1,
    name: "TestProvider",
    url: "https://api.example.com",
    maskedKey: "sk-****1234",
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: { groupA: 10, groupB: 20 },
    costMultiplier: 1.0,
    groupTag: "groupA,groupB",
    providerType: "claude",
    providerVendorId: null,
    preserveClientIp: false,
    modelRedirects: { "claude-3": "claude-3.5" },
    allowedModels: ["claude-3", "claude-3.5"],
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 3,
    circuitBreakerOpenDuration: 60000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 60000,
    requestTimeoutNonStreamingMs: 120000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: {
      effort: "high",
      modelMatchMode: "specific",
      models: ["claude-opus-4-6"],
    },
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    ...overrides,
  } as ProviderDisplay;
}

describe("createInitialState deep-copy safety", () => {
  describe("clone mode", () => {
    it("modelRedirects is a distinct object with equal values", () => {
      const source = makeProvider();
      const state = createInitialState("create", undefined, source);
      expect(state.routing.modelRedirects).toEqual(source.modelRedirects);
      expect(state.routing.modelRedirects).not.toBe(source.modelRedirects);
    });

    it("allowedModels is a distinct array with equal values", () => {
      const source = makeProvider();
      const state = createInitialState("create", undefined, source);
      expect(state.routing.allowedModels).toEqual(source.allowedModels);
      expect(state.routing.allowedModels).not.toBe(source.allowedModels);
    });

    it("groupPriorities is a distinct object with equal values", () => {
      const source = makeProvider();
      const state = createInitialState("create", undefined, source);
      expect(state.routing.groupPriorities).toEqual(source.groupPriorities);
      expect(state.routing.groupPriorities).not.toBe(source.groupPriorities);
    });

    it("anthropicAdaptiveThinking is a distinct object with distinct models array", () => {
      const source = makeProvider();
      const state = createInitialState("create", undefined, source);
      expect(state.routing.anthropicAdaptiveThinking).toEqual(source.anthropicAdaptiveThinking);
      expect(state.routing.anthropicAdaptiveThinking).not.toBe(source.anthropicAdaptiveThinking);
      expect(state.routing.anthropicAdaptiveThinking!.models).not.toBe(
        source.anthropicAdaptiveThinking!.models
      );
    });

    it("null anthropicAdaptiveThinking stays null", () => {
      const source = makeProvider({ anthropicAdaptiveThinking: null });
      const state = createInitialState("create", undefined, source);
      expect(state.routing.anthropicAdaptiveThinking).toBeNull();
    });

    it("null modelRedirects falls back to empty object", () => {
      const source = makeProvider({ modelRedirects: null });
      const state = createInitialState("create", undefined, source);
      expect(state.routing.modelRedirects).toEqual({});
    });

    it("null allowedModels falls back to empty array", () => {
      const source = makeProvider({ allowedModels: null });
      const state = createInitialState("create", undefined, source);
      expect(state.routing.allowedModels).toEqual([]);
    });

    it("null groupPriorities falls back to empty object", () => {
      const source = makeProvider({ groupPriorities: null });
      const state = createInitialState("create", undefined, source);
      expect(state.routing.groupPriorities).toEqual({});
    });

    it("name gets _Copy suffix", () => {
      const source = makeProvider({ name: "MyProvider" });
      const state = createInitialState("create", undefined, source);
      expect(state.basic.name).toBe("MyProvider_Copy");
    });

    it("key is always empty", () => {
      const source = makeProvider();
      const state = createInitialState("create", undefined, source);
      expect(state.basic.key).toBe("");
    });
  });

  describe("edit mode", () => {
    it("nested objects are isolated from source provider", () => {
      const source = makeProvider();
      const state = createInitialState("edit", source);
      expect(state.routing.modelRedirects).toEqual(source.modelRedirects);
      expect(state.routing.modelRedirects).not.toBe(source.modelRedirects);
      expect(state.routing.allowedModels).not.toBe(source.allowedModels);
      expect(state.routing.groupPriorities).not.toBe(source.groupPriorities);
      expect(state.routing.anthropicAdaptiveThinking).not.toBe(source.anthropicAdaptiveThinking);
    });
  });

  describe("create mode without clone source", () => {
    it("nested objects use fresh defaults", () => {
      const state = createInitialState("create");
      expect(state.routing.modelRedirects).toEqual({});
      expect(state.routing.allowedModels).toEqual([]);
      expect(state.routing.groupPriorities).toEqual({});
      expect(state.routing.anthropicAdaptiveThinking).toBeNull();
    });
  });
});
