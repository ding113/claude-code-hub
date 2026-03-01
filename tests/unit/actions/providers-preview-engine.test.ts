import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Provider } from "@/types/provider";

const getSessionMock = vi.fn();
const findAllProvidersFreshMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: getSessionMock,
}));

vi.mock("@/repository/provider", () => ({
  findAllProvidersFresh: findAllProvidersFreshMock,
  updateProvidersBatch: vi.fn(),
  deleteProvidersBatch: vi.fn(),
}));

vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: vi.fn(),
}));

vi.mock("@/lib/circuit-breaker", () => ({
  clearProviderState: vi.fn(),
  clearConfigCache: vi.fn(),
  resetCircuit: vi.fn(),
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

function buildTestProvider(overrides: Partial<Provider> = {}): Provider {
  return {
    id: 1,
    name: "Test Provider",
    url: "https://api.example.com",
    key: "test-key",
    providerVendorId: null,
    isEnabled: true,
    weight: 10,
    priority: 1,
    groupPriorities: null,
    costMultiplier: 1.0,
    groupTag: null,
    providerType: "claude",
    preserveClientIp: false,
    modelRedirects: null,
    allowedModels: null,
    mcpPassthroughType: "none",
    mcpPassthroughUrl: null,
    limit5hUsd: null,
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 10,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 1800000,
    circuitBreakerHalfOpenSuccessThreshold: 2,
    proxyUrl: null,
    proxyFallbackToDirect: false,
    firstByteTimeoutStreamingMs: 30000,
    streamingIdleTimeoutMs: 10000,
    requestTimeoutNonStreamingMs: 600000,
    websiteUrl: null,
    faviconUrl: null,
    cacheTtlPreference: null,
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

describe("Provider Batch Preview Engine - Row Generation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  it("generates correct before/after row for single provider single field change", async () => {
    const provider = buildTestProvider({
      id: 5,
      name: "Claude One",
      groupTag: "old-group",
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [5],
      patch: { group_tag: { set: "new-group" } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0]).toEqual({
      providerId: 5,
      providerName: "Claude One",
      field: "group_tag",
      status: "changed",
      before: "old-group",
      after: "new-group",
    });
  });

  it("generates rows for each provider-field combination", async () => {
    const providerA = buildTestProvider({
      id: 1,
      name: "Provider A",
      priority: 5,
      weight: 10,
    });
    const providerB = buildTestProvider({
      id: 2,
      name: "Provider B",
      priority: 3,
      weight: 20,
    });
    findAllProvidersFreshMock.mockResolvedValue([providerA, providerB]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [1, 2],
      patch: {
        priority: { set: 10 },
        weight: { set: 50 },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(4);

    expect(result.data.rows).toContainEqual({
      providerId: 1,
      providerName: "Provider A",
      field: "priority",
      status: "changed",
      before: 5,
      after: 10,
    });
    expect(result.data.rows).toContainEqual({
      providerId: 1,
      providerName: "Provider A",
      field: "weight",
      status: "changed",
      before: 10,
      after: 50,
    });
    expect(result.data.rows).toContainEqual({
      providerId: 2,
      providerName: "Provider B",
      field: "priority",
      status: "changed",
      before: 3,
      after: 10,
    });
    expect(result.data.rows).toContainEqual({
      providerId: 2,
      providerName: "Provider B",
      field: "weight",
      status: "changed",
      before: 20,
      after: 50,
    });
  });

  it("marks anthropic fields as skipped for non-claude providers", async () => {
    const provider = buildTestProvider({
      id: 10,
      name: "OpenAI Compat",
      providerType: "openai-compatible",
      anthropicThinkingBudgetPreference: null,
      anthropicAdaptiveThinking: null,
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [10],
      patch: {
        anthropic_thinking_budget_preference: { set: "8192" },
        anthropic_adaptive_thinking: {
          set: { effort: "high", modelMatchMode: "all", models: [] },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(2);

    const budgetRow = result.data.rows.find(
      (r: { field: string }) => r.field === "anthropic_thinking_budget_preference"
    );
    expect(budgetRow).toEqual({
      providerId: 10,
      providerName: "OpenAI Compat",
      field: "anthropic_thinking_budget_preference",
      status: "skipped",
      before: null,
      after: "8192",
      skipReason: expect.any(String),
    });

    const adaptiveRow = result.data.rows.find(
      (r: { field: string }) => r.field === "anthropic_adaptive_thinking"
    );
    expect(adaptiveRow).toEqual({
      providerId: 10,
      providerName: "OpenAI Compat",
      field: "anthropic_adaptive_thinking",
      status: "skipped",
      before: null,
      after: { effort: "high", modelMatchMode: "all", models: [] },
      skipReason: expect.any(String),
    });
  });

  it("marks anthropic fields as changed for claude providers", async () => {
    const provider = buildTestProvider({
      id: 20,
      name: "Claude Main",
      providerType: "claude",
      anthropicThinkingBudgetPreference: "inherit",
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [20],
      patch: { anthropic_thinking_budget_preference: { set: "16000" } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0]).toEqual({
      providerId: 20,
      providerName: "Claude Main",
      field: "anthropic_thinking_budget_preference",
      status: "changed",
      before: "inherit",
      after: "16000",
    });
  });

  it("marks anthropic fields as changed for claude-auth providers", async () => {
    const provider = buildTestProvider({
      id: 21,
      name: "Claude Auth",
      providerType: "claude-auth",
      anthropicAdaptiveThinking: null,
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [21],
      patch: {
        anthropic_adaptive_thinking: {
          set: { effort: "medium", modelMatchMode: "all", models: [] },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0].status).toBe("changed");
    expect(result.data.rows[0].providerId).toBe(21);
  });

  it("computes correct after values for clear mode", async () => {
    const provider = buildTestProvider({
      id: 30,
      name: "Clear Test",
      providerType: "claude",
      groupTag: "old-tag",
      modelRedirects: { "model-a": "model-b" },
      allowedModels: ["claude-3"],
      anthropicThinkingBudgetPreference: "8192",
      anthropicAdaptiveThinking: {
        effort: "high",
        modelMatchMode: "all",
        models: [],
      },
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [30],
      patch: {
        group_tag: { clear: true },
        model_redirects: { clear: true },
        allowed_models: { clear: true },
        anthropic_thinking_budget_preference: { clear: true },
        anthropic_adaptive_thinking: { clear: true },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(5);

    const groupTagRow = result.data.rows.find((r: { field: string }) => r.field === "group_tag");
    expect(groupTagRow?.before).toBe("old-tag");
    expect(groupTagRow?.after).toBeNull();

    const modelRedirectsRow = result.data.rows.find(
      (r: { field: string }) => r.field === "model_redirects"
    );
    expect(modelRedirectsRow?.before).toEqual({ "model-a": "model-b" });
    expect(modelRedirectsRow?.after).toBeNull();

    const allowedModelsRow = result.data.rows.find(
      (r: { field: string }) => r.field === "allowed_models"
    );
    expect(allowedModelsRow?.before).toEqual(["claude-3"]);
    expect(allowedModelsRow?.after).toBeNull();

    // anthropic_thinking_budget_preference clears to "inherit"
    const budgetRow = result.data.rows.find(
      (r: { field: string }) => r.field === "anthropic_thinking_budget_preference"
    );
    expect(budgetRow?.before).toBe("8192");
    expect(budgetRow?.after).toBe("inherit");

    const adaptiveRow = result.data.rows.find(
      (r: { field: string }) => r.field === "anthropic_adaptive_thinking"
    );
    expect(adaptiveRow?.before).toEqual({
      effort: "high",
      modelMatchMode: "all",
      models: [],
    });
    expect(adaptiveRow?.after).toBeNull();
  });

  it("normalizes empty allowed_models array to null in after value", async () => {
    const provider = buildTestProvider({
      id: 40,
      name: "Models Test",
      allowedModels: ["claude-3"],
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [40],
      patch: { allowed_models: { set: [] } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0].before).toEqual(["claude-3"]);
    expect(result.data.rows[0].after).toBeNull();
  });

  it("includes correct skipCount in summary", async () => {
    const claudeProvider = buildTestProvider({
      id: 50,
      name: "Claude",
      providerType: "claude",
    });
    const openaiProvider = buildTestProvider({
      id: 51,
      name: "OpenAI",
      providerType: "openai-compatible",
    });
    const geminiProvider = buildTestProvider({
      id: 52,
      name: "Gemini",
      providerType: "gemini",
    });
    findAllProvidersFreshMock.mockResolvedValue([claudeProvider, openaiProvider, geminiProvider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [50, 51, 52],
      patch: {
        anthropic_thinking_budget_preference: { set: "8192" },
        group_tag: { set: "new-tag" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 3 providers x 2 fields = 6 rows
    expect(result.data.rows).toHaveLength(6);
    // 2 non-claude providers x 1 anthropic field = 2 skipped
    expect(result.data.summary.skipCount).toBe(2);
    expect(result.data.summary.providerCount).toBe(3);
    expect(result.data.summary.fieldCount).toBe(2);
  });

  it("returns rows in the preview result for snapshot storage", async () => {
    const provider = buildTestProvider({
      id: 60,
      name: "Snapshot Test",
      isEnabled: true,
    });
    findAllProvidersFreshMock.mockResolvedValue([provider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [60],
      patch: { is_enabled: { set: false } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toBeDefined();
    expect(Array.isArray(result.data.rows)).toBe(true);
    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0]).toEqual({
      providerId: 60,
      providerName: "Snapshot Test",
      field: "is_enabled",
      status: "changed",
      before: true,
      after: false,
    });
  });

  it("only generates rows for providers matching requested IDs", async () => {
    const providerA = buildTestProvider({ id: 100, name: "Match" });
    const providerB = buildTestProvider({ id: 200, name: "No Match" });
    findAllProvidersFreshMock.mockResolvedValue([providerA, providerB]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [100],
      patch: { priority: { set: 99 } },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(1);
    expect(result.data.rows[0].providerId).toBe(100);
  });

  it("skips anthropic fields for all non-claude provider types", async () => {
    const codexProvider = buildTestProvider({
      id: 70,
      name: "Codex",
      providerType: "codex",
    });
    const geminiCliProvider = buildTestProvider({
      id: 71,
      name: "Gemini CLI",
      providerType: "gemini-cli",
    });
    findAllProvidersFreshMock.mockResolvedValue([codexProvider, geminiCliProvider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [70, 71],
      patch: {
        anthropic_adaptive_thinking: {
          set: { effort: "low", modelMatchMode: "all", models: [] },
        },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.rows).toHaveLength(2);
    expect(result.data.rows.every((r: { status: string }) => r.status === "skipped")).toBe(true);
    expect(result.data.summary.skipCount).toBe(2);
  });

  it("handles mixed changed and skipped rows across providers", async () => {
    const claudeProvider = buildTestProvider({
      id: 80,
      name: "Claude",
      providerType: "claude",
      groupTag: "alpha",
      anthropicThinkingBudgetPreference: null,
    });
    const openaiProvider = buildTestProvider({
      id: 81,
      name: "OpenAI",
      providerType: "openai-compatible",
      groupTag: "beta",
      anthropicThinkingBudgetPreference: null,
    });
    findAllProvidersFreshMock.mockResolvedValue([claudeProvider, openaiProvider]);

    const { previewProviderBatchPatch } = await import("@/actions/providers");
    const result = await previewProviderBatchPatch({
      providerIds: [80, 81],
      patch: {
        group_tag: { set: "gamma" },
        anthropic_thinking_budget_preference: { set: "4096" },
      },
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // 2 providers x 2 fields = 4 rows
    expect(result.data.rows).toHaveLength(4);

    // group_tag: both changed (universal field)
    const groupTagRows = result.data.rows.filter((r: { field: string }) => r.field === "group_tag");
    expect(groupTagRows).toHaveLength(2);
    expect(groupTagRows.every((r: { status: string }) => r.status === "changed")).toBe(true);

    // anthropic_thinking_budget_preference: claude changed, openai skipped
    const budgetRows = result.data.rows.filter(
      (r: { field: string }) => r.field === "anthropic_thinking_budget_preference"
    );
    expect(budgetRows).toHaveLength(2);

    const claudeBudget = budgetRows.find((r: { providerId: number }) => r.providerId === 80);
    expect(claudeBudget?.status).toBe("changed");

    const openaiBudget = budgetRows.find((r: { providerId: number }) => r.providerId === 81);
    expect(openaiBudget?.status).toBe("skipped");
    expect(openaiBudget?.skipReason).toBeTruthy();

    expect(result.data.summary.skipCount).toBe(1);
  });
});
