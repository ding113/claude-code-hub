import { beforeEach, describe, expect, it, vi } from "vitest";

const getSessionMock = vi.fn();

const updateProvidersBatchMock = vi.fn();

const publishProviderCacheInvalidationMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  updateProvidersBatch: updateProvidersBatchMock,
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: publishProviderCacheInvalidationMock,
}));

vi.mock("@/lib/logger", () => ({
  logger: {
    trace: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("batchUpdateProviders - advanced field mapping", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    updateProvidersBatchMock.mockResolvedValue(2);
    publishProviderCacheInvalidationMock.mockResolvedValue(undefined);
  });

  it("should still map basic fields correctly (backward compat)", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [1, 2],
      updates: {
        is_enabled: true,
        priority: 3,
        weight: 5,
        cost_multiplier: 1.2,
        group_tag: "legacy",
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.updatedCount).toBe(2);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([1, 2], {
      isEnabled: true,
      priority: 3,
      weight: 5,
      costMultiplier: "1.2",
      groupTag: "legacy",
    });
  });

  it("should map model_redirects to repository modelRedirects", async () => {
    const redirects = { "claude-3-opus": "claude-3.5-sonnet", "gpt-4": "gpt-4o" };

    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [10, 20],
      updates: { model_redirects: redirects },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([10, 20], {
      modelRedirects: redirects,
    });
  });

  it("should map model_redirects=null to repository modelRedirects=null", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [5],
      updates: { model_redirects: null },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([5], {
      modelRedirects: null,
    });
  });

  it("should map allowed_models with values correctly", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [1, 2],
      updates: { allowed_models: ["model-a", "model-b"] },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([1, 2], {
      allowedModels: ["model-a", "model-b"],
    });
  });

  it("should normalize allowed_models=[] to null (allow-all)", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [1],
      updates: { allowed_models: [] },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([1], {
      allowedModels: null,
    });
  });

  it("should map allowed_models=null to repository allowedModels=null", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [3],
      updates: { allowed_models: null },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([3], {
      allowedModels: null,
    });
  });

  it("should map anthropic_thinking_budget_preference correctly", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [7, 8],
      updates: { anthropic_thinking_budget_preference: "10000" },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([7, 8], {
      anthropicThinkingBudgetPreference: "10000",
    });
  });

  it("should map anthropic_thinking_budget_preference=inherit correctly", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [1],
      updates: { anthropic_thinking_budget_preference: "inherit" },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([1], {
      anthropicThinkingBudgetPreference: "inherit",
    });
  });

  it("should map anthropic_thinking_budget_preference=null correctly", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [1],
      updates: { anthropic_thinking_budget_preference: null },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([1], {
      anthropicThinkingBudgetPreference: null,
    });
  });

  it("should map anthropic_adaptive_thinking config correctly", async () => {
    const config = {
      effort: "high" as const,
      modelMatchMode: "all" as const,
      models: [],
    };

    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [4, 5],
      updates: { anthropic_adaptive_thinking: config },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([4, 5], {
      anthropicAdaptiveThinking: config,
    });
  });

  it("should map anthropic_adaptive_thinking=null correctly", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [6],
      updates: { anthropic_adaptive_thinking: null },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([6], {
      anthropicAdaptiveThinking: null,
    });
  });

  it("should handle mix of old and new fields together", async () => {
    const adaptiveConfig = {
      effort: "medium" as const,
      modelMatchMode: "specific" as const,
      models: ["claude-3-opus", "claude-3.5-sonnet"],
    };

    const { batchUpdateProviders } = await import("@/actions/providers");
    const result = await batchUpdateProviders({
      providerIds: [1, 2, 3],
      updates: {
        is_enabled: true,
        priority: 10,
        weight: 3,
        cost_multiplier: 0.8,
        group_tag: "mixed-batch",
        model_redirects: { "old-model": "new-model" },
        allowed_models: ["claude-3-opus"],
        anthropic_thinking_budget_preference: "5000",
        anthropic_adaptive_thinking: adaptiveConfig,
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.updatedCount).toBe(2);
    expect(updateProvidersBatchMock).toHaveBeenCalledWith([1, 2, 3], {
      isEnabled: true,
      priority: 10,
      weight: 3,
      costMultiplier: "0.8",
      groupTag: "mixed-batch",
      modelRedirects: { "old-model": "new-model" },
      allowedModels: ["claude-3-opus"],
      anthropicThinkingBudgetPreference: "5000",
      anthropicAdaptiveThinking: adaptiveConfig,
    });
  });

  it("should detect new fields as valid updates (not reject as empty)", async () => {
    const { batchUpdateProviders } = await import("@/actions/providers");

    // Only new fields, no old fields -- must still be treated as having updates
    const result = await batchUpdateProviders({
      providerIds: [1],
      updates: { anthropic_thinking_budget_preference: "inherit" },
    });

    expect(result.ok).toBe(true);
    expect(updateProvidersBatchMock).toHaveBeenCalledTimes(1);
  });
});
