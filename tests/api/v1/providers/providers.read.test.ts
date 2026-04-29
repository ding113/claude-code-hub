import type { AuthSession } from "@/lib/auth";
import type { ProviderDisplay } from "@/types/provider";
import { beforeEach, describe, expect, test, vi } from "vitest";

const getProvidersMock = vi.hoisted(() => vi.fn());
const getUnmaskedProviderKeyMock = vi.hoisted(() => vi.fn());
const getProvidersHealthStatusMock = vi.hoisted(() => vi.fn());
const resetProviderCircuitMock = vi.hoisted(() => vi.fn());
const resetProviderTotalUsageMock = vi.hoisted(() => vi.fn());
const batchResetProviderCircuitsMock = vi.hoisted(() => vi.fn());
const getProviderLimitUsageMock = vi.hoisted(() => vi.fn());
const getProviderLimitUsageBatchMock = vi.hoisted(() => vi.fn());
const getAvailableProviderGroupsMock = vi.hoisted(() => vi.fn());
const getProviderGroupsWithCountMock = vi.hoisted(() => vi.fn());
const autoSortProviderPriorityMock = vi.hoisted(() => vi.fn());
const batchUpdateProvidersMock = vi.hoisted(() => vi.fn());
const batchDeleteProvidersMock = vi.hoisted(() => vi.fn());
const undoProviderDeleteMock = vi.hoisted(() => vi.fn());
const previewProviderBatchPatchMock = vi.hoisted(() => vi.fn());
const applyProviderBatchPatchMock = vi.hoisted(() => vi.fn());
const undoProviderPatchMock = vi.hoisted(() => vi.fn());
const testProviderProxyMock = vi.hoisted(() => vi.fn());
const testProviderUnifiedMock = vi.hoisted(() => vi.fn());
const testProviderAnthropicMessagesMock = vi.hoisted(() => vi.fn());
const testProviderOpenAIChatCompletionsMock = vi.hoisted(() => vi.fn());
const testProviderOpenAIResponsesMock = vi.hoisted(() => vi.fn());
const testProviderGeminiMock = vi.hoisted(() => vi.fn());
const getProviderTestPresetsMock = vi.hoisted(() => vi.fn());
const fetchUpstreamModelsMock = vi.hoisted(() => vi.fn());
const getModelSuggestionsByProviderGroupMock = vi.hoisted(() => vi.fn());
const reclusterProviderVendorsMock = vi.hoisted(() => vi.fn());
const addProviderMock = vi.hoisted(() => vi.fn());
const editProviderMock = vi.hoisted(() => vi.fn());
const removeProviderMock = vi.hoisted(() => vi.fn());
const validateAuthTokenMock = vi.hoisted(() => vi.fn());

vi.mock("@/actions/providers", () => ({
  getProviders: getProvidersMock,
  getUnmaskedProviderKey: getUnmaskedProviderKeyMock,
  getProvidersHealthStatus: getProvidersHealthStatusMock,
  resetProviderCircuit: resetProviderCircuitMock,
  resetProviderTotalUsage: resetProviderTotalUsageMock,
  batchResetProviderCircuits: batchResetProviderCircuitsMock,
  getProviderLimitUsage: getProviderLimitUsageMock,
  getProviderLimitUsageBatch: getProviderLimitUsageBatchMock,
  getAvailableProviderGroups: getAvailableProviderGroupsMock,
  getProviderGroupsWithCount: getProviderGroupsWithCountMock,
  autoSortProviderPriority: autoSortProviderPriorityMock,
  batchUpdateProviders: batchUpdateProvidersMock,
  batchDeleteProviders: batchDeleteProvidersMock,
  undoProviderDelete: undoProviderDeleteMock,
  previewProviderBatchPatch: previewProviderBatchPatchMock,
  applyProviderBatchPatch: applyProviderBatchPatchMock,
  undoProviderPatch: undoProviderPatchMock,
  testProviderProxy: testProviderProxyMock,
  testProviderUnified: testProviderUnifiedMock,
  testProviderAnthropicMessages: testProviderAnthropicMessagesMock,
  testProviderOpenAIChatCompletions: testProviderOpenAIChatCompletionsMock,
  testProviderOpenAIResponses: testProviderOpenAIResponsesMock,
  testProviderGemini: testProviderGeminiMock,
  getProviderTestPresets: getProviderTestPresetsMock,
  fetchUpstreamModels: fetchUpstreamModelsMock,
  getModelSuggestionsByProviderGroup: getModelSuggestionsByProviderGroupMock,
  reclusterProviderVendors: reclusterProviderVendorsMock,
  addProvider: addProviderMock,
  editProvider: editProviderMock,
  removeProvider: removeProviderMock,
}));

vi.mock("@/lib/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/auth")>();
  return {
    ...actual,
    validateAuthToken: validateAuthTokenMock,
  };
});

const { callV1Route } = await import("../test-utils");

const adminSession = {
  user: { id: 1, role: "admin", isEnabled: true },
  key: { id: 1, userId: 1, key: "admin-token", canLoginWebUi: true },
} as AuthSession;

function provider(overrides: Partial<ProviderDisplay> = {}): ProviderDisplay {
  return {
    id: 1,
    name: "Anthropic primary",
    url: "https://main-user:main-pass@api.anthropic.com",
    maskedKey: "sk-...1234",
    isEnabled: true,
    weight: 1,
    priority: 0,
    groupPriorities: null,
    costMultiplier: 1,
    groupTag: "default",
    providerType: "claude",
    providerVendorId: 1,
    preserveClientIp: false,
    disableSessionReuse: false,
    modelRedirects: null,
    activeTimeStart: null,
    activeTimeEnd: null,
    allowedModels: null,
    allowedClients: [],
    blockedClients: [],
    mcpPassthroughType: "none",
    mcpPassthroughUrl: "https://mcp-user:mcp-pass@mcp.example.com/bridge",
    limit5hUsd: null,
    limit5hResetMode: "rolling",
    limitDailyUsd: null,
    dailyResetMode: "fixed",
    dailyResetTime: "00:00",
    limitWeeklyUsd: null,
    limitMonthlyUsd: null,
    limitTotalUsd: null,
    totalCostResetAt: null,
    limitConcurrentSessions: 0,
    maxRetryAttempts: null,
    circuitBreakerFailureThreshold: 5,
    circuitBreakerOpenDuration: 60_000,
    circuitBreakerHalfOpenSuccessThreshold: 1,
    proxyUrl: "http://proxy-user:proxy-pass@proxy.example.com:8080",
    proxyFallbackToDirect: false,
    customHeaders: {
      "cf-aig-authorization": "Bearer upstream-secret",
      "x-trace-id": "trace-safe",
    },
    firstByteTimeoutStreamingMs: 30_000,
    streamingIdleTimeoutMs: 300_000,
    requestTimeoutNonStreamingMs: 600_000,
    websiteUrl: "https://web-user:web-pass@anthropic.example.com",
    faviconUrl: null,
    cacheTtlPreference: "inherit",
    swapCacheTtlBilling: false,
    context1mPreference: null,
    codexReasoningEffortPreference: null,
    codexReasoningSummaryPreference: null,
    codexTextVerbosityPreference: null,
    codexParallelToolCallsPreference: null,
    codexServiceTierPreference: null,
    anthropicMaxTokensPreference: null,
    anthropicThinkingBudgetPreference: null,
    anthropicAdaptiveThinking: null,
    geminiGoogleSearchPreference: null,
    tpm: null,
    rpm: null,
    rpd: null,
    cc: null,
    createdAt: "2026-04-28",
    updatedAt: "2026-04-28",
    ...overrides,
  };
}

describe("v1 providers read endpoints", () => {
  beforeEach(() => {
    validateAuthTokenMock.mockResolvedValue(adminSession);
    getProvidersMock.mockResolvedValue([
      provider(),
      provider({
        id: 2,
        name: "Legacy hidden",
        providerType: "claude-auth",
        url: "https://legacy.example.com",
      }),
      provider({
        id: 3,
        name: "OpenAI compatible",
        providerType: "openai-compatible",
        url: "https://openai.example.com",
      }),
    ]);
    getUnmaskedProviderKeyMock.mockResolvedValue({ ok: true, data: { key: "sk-real-secret" } });
    getProvidersHealthStatusMock.mockResolvedValue({
      1: { circuitState: "closed", failureCount: 0 },
      2: { circuitState: "open", failureCount: 10 },
    });
    resetProviderCircuitMock.mockResolvedValue({ ok: true });
    resetProviderTotalUsageMock.mockResolvedValue({ ok: true });
    batchResetProviderCircuitsMock.mockResolvedValue({ ok: true, data: { resetCount: 1 } });
    getProviderLimitUsageMock.mockResolvedValue({
      ok: true,
      data: { costDaily: { current: 1, limit: 10 } },
    });
    getProviderLimitUsageBatchMock.mockResolvedValue(
      new Map([[1, { costDaily: { current: 1, limit: 10 } }]])
    );
    getAvailableProviderGroupsMock.mockResolvedValue(["default"]);
    getProviderGroupsWithCountMock.mockResolvedValue({
      ok: true,
      data: [{ group: "default", providerCount: 1 }],
    });
    autoSortProviderPriorityMock.mockResolvedValue({
      ok: true,
      data: {
        groups: [],
        changes: [],
        summary: { totalProviders: 1, changedCount: 0, groupCount: 1 },
        applied: false,
      },
    });
    batchUpdateProvidersMock.mockResolvedValue({ ok: true, data: { updatedCount: 1 } });
    batchDeleteProvidersMock.mockResolvedValue({
      ok: true,
      data: { deletedCount: 1, undoToken: "undo-delete", operationId: "op-delete" },
    });
    undoProviderDeleteMock.mockResolvedValue({
      ok: true,
      data: { operationId: "op-delete", restoredAt: "2026-04-28T00:00:00.000Z", restoredCount: 1 },
    });
    previewProviderBatchPatchMock.mockResolvedValue({
      ok: true,
      data: { previewToken: "preview", previewRevision: "rev", rows: [] },
    });
    applyProviderBatchPatchMock.mockResolvedValue({
      ok: true,
      data: { operationId: "op-patch", undoToken: "undo-patch", updatedCount: 1 },
    });
    undoProviderPatchMock.mockResolvedValue({
      ok: true,
      data: { operationId: "op-patch", revertedAt: "2026-04-28T00:00:00.000Z", revertedCount: 1 },
    });
    testProviderProxyMock.mockResolvedValue({ ok: true, data: { success: true } });
    testProviderUnifiedMock.mockResolvedValue({
      ok: true,
      data: { success: true, status: "green" },
    });
    testProviderAnthropicMessagesMock.mockResolvedValue({ ok: true, data: { success: true } });
    testProviderOpenAIChatCompletionsMock.mockResolvedValue({ ok: true, data: { success: true } });
    testProviderOpenAIResponsesMock.mockResolvedValue({ ok: true, data: { success: true } });
    testProviderGeminiMock.mockResolvedValue({ ok: true, data: { success: true } });
    getProviderTestPresetsMock.mockResolvedValue({
      ok: true,
      data: [
        {
          id: "cc_base",
          description: "Codex",
          defaultSuccessContains: "Hello",
          defaultModel: "gpt-5.3-codex",
        },
      ],
    });
    fetchUpstreamModelsMock.mockResolvedValue({
      ok: true,
      data: { models: ["gpt-5.3-codex"], source: "upstream" },
    });
    getModelSuggestionsByProviderGroupMock.mockResolvedValue({
      ok: true,
      data: ["claude-sonnet-4-6"],
    });
    reclusterProviderVendorsMock.mockResolvedValue({
      ok: true,
      data: {
        preview: { providersMoved: 0, vendorsCreated: 0, vendorsToDelete: 0, skippedInvalidUrl: 0 },
        changes: [],
        applied: false,
      },
    });
    addProviderMock.mockResolvedValue({ ok: true });
    editProviderMock.mockResolvedValue({
      ok: true,
      data: { undoToken: "undo-1", operationId: "op-1" },
    });
    removeProviderMock.mockResolvedValue({
      ok: true,
      data: { undoToken: "undo-2", operationId: "op-2" },
    });
  });

  test("searches providers and filters hidden provider types", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers?q=anthropic",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(200);
    expect(json).toMatchObject({
      items: [{ id: 1, name: "Anthropic primary", providerType: "claude" }],
    });
    expect(JSON.stringify(json)).not.toContain("claude-auth");
    expect(JSON.stringify(json)).not.toContain("tpm");
  });

  test("rejects bearer user API keys for admin routes when API key admin access is disabled", async () => {
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers",
      headers: { Authorization: "Bearer db-admin-key" },
    });

    expect(response.status).toBe(403);
    expect(json).toMatchObject({ errorCode: "auth.api_key_admin_disabled" });
    expect(getProvidersMock).not.toHaveBeenCalled();
  });

  test("returns problem+json instead of an empty list when provider loading fails", async () => {
    getProvidersMock.mockResolvedValueOnce({
      ok: false,
      error: "Provider repository unavailable",
      errorCode: "PROVIDER_LOAD_FAILED",
    });

    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers?q=anthropic",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(400);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(json).toMatchObject({
      errorCode: "PROVIDER_LOAD_FAILED",
      detail: "Bad request",
    });
  });

  test("redacts secondary provider secrets from list and detail responses", async () => {
    const list = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(list.response.status).toBe(200);
    const firstProvider = (list.json as { items: Array<Record<string, unknown>> }).items[0];
    expect(firstProvider).toMatchObject({
      url: "https://REDACTED:REDACTED@api.anthropic.com/",
      proxyUrl: "http://REDACTED:REDACTED@proxy.example.com:8080/",
      customHeaders: {
        "cf-aig-authorization": "[REDACTED]",
        "x-trace-id": "trace-safe",
      },
      mcpPassthroughUrl: "https://REDACTED:REDACTED@mcp.example.com/bridge",
      websiteUrl: "https://REDACTED:REDACTED@anthropic.example.com/",
    });
    expect(JSON.stringify(list.json)).not.toContain("upstream-secret");
    expect(JSON.stringify(list.json)).not.toContain("proxy-pass");
    expect(JSON.stringify(list.json)).not.toContain("mcp-pass");
    expect(JSON.stringify(list.json)).not.toContain("main-pass");
    expect(JSON.stringify(list.json)).not.toContain("web-pass");

    const detail = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(detail.response.status).toBe(200);
    expect(detail.json).toMatchObject({
      url: "https://REDACTED:REDACTED@api.anthropic.com/",
      proxyUrl: "http://REDACTED:REDACTED@proxy.example.com:8080/",
      customHeaders: {
        "cf-aig-authorization": "[REDACTED]",
        "x-trace-id": "trace-safe",
      },
      mcpPassthroughUrl: "https://REDACTED:REDACTED@mcp.example.com/bridge",
      websiteUrl: "https://REDACTED:REDACTED@anthropic.example.com/",
    });
    expect(JSON.stringify(detail.json)).not.toContain("upstream-secret");
    expect(JSON.stringify(detail.json)).not.toContain("proxy-pass");
    expect(JSON.stringify(detail.json)).not.toContain("mcp-pass");
    expect(JSON.stringify(detail.json)).not.toContain("main-pass");
    expect(JSON.stringify(detail.json)).not.toContain("web-pass");
  });

  test("preserves stored provider secrets when redacted read values are echoed in PATCH", async () => {
    const patched = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Renamed provider",
        url: "https://REDACTED:REDACTED@api.anthropic.com/",
        proxy_url: "http://REDACTED:REDACTED@proxy.example.com:8080/",
        website_url: "https://REDACTED:REDACTED@anthropic.example.com/",
        mcp_passthrough_url: "https://REDACTED:REDACTED@mcp.example.com/bridge",
        custom_headers: {
          "CF-AIG-Authorization": "[REDACTED]",
          "x-trace-id": "trace-updated",
        },
      },
    });

    expect(patched.response.status).toBe(200);
    expect(editProviderMock).toHaveBeenCalledWith(1, {
      name: "Renamed provider",
      custom_headers: {
        "CF-AIG-Authorization": "Bearer upstream-secret",
        "x-trace-id": "trace-updated",
      },
    });
  });

  test("gets provider detail and hides deprecated provider records", async () => {
    const visible = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(visible.response.status).toBe(200);
    expect(visible.json).toMatchObject({ id: 1, providerType: "claude" });

    const hidden = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/2",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(hidden.response.status).toBe(404);
    expect(hidden.json).toMatchObject({ errorCode: "provider.not_found" });
  });

  test("reveals the real provider key only for visible providers", async () => {
    const revealed = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/1/key:reveal",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(revealed.response.status).toBe(200);
    expect(revealed.response.headers.get("Cache-Control")).toContain("no-store");
    expect(revealed.response.headers.get("Pragma")).toBe("no-cache");
    expect(revealed.json).toEqual({ key: "sk-real-secret" });
    expect(getUnmaskedProviderKeyMock).toHaveBeenCalledWith(1);

    const hidden = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/2/key:reveal",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(hidden.response.status).toBe(404);
    expect(hidden.json).toMatchObject({ errorCode: "provider.not_found" });
  });

  test("returns problem+json when provider actions fail", async () => {
    getUnmaskedProviderKeyMock.mockResolvedValueOnce({ ok: false, error: "供应商不存在" });
    const { response, json } = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/1/key:reveal",
      headers: { Authorization: "Bearer admin-token" },
    });

    expect(response.status).toBe(404);
    expect(response.headers.get("content-type")).toContain("application/problem+json");
    expect(json).toMatchObject({ errorCode: "provider.not_found" });
  });

  test("creates, updates, and deletes visible providers with REST semantics", async () => {
    getProvidersMock
      .mockResolvedValueOnce([
        provider({
          id: 4,
          name: "New provider",
          providerType: "openai-compatible",
          url: "https://new.example.com",
        }),
      ])
      .mockResolvedValueOnce([provider({ id: 1, name: "Anthropic primary" })])
      .mockResolvedValueOnce([provider({ id: 1, name: "Updated provider" })]);

    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "New provider",
        url: "https://new.example.com",
        key: "sk-new",
        provider_type: "openai-compatible",
      },
    });
    expect(created.response.status).toBe(201);
    expect(created.response.headers.get("Location")).toBe("/api/v1/providers/4");
    expect(addProviderMock).toHaveBeenCalledWith(
      expect.objectContaining({ provider_type: "openai-compatible" })
    );

    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
      body: { name: "Updated provider" },
    });
    expect(updated.response.status).toBe(200);
    expect(updated.response.headers.get("X-CCH-Undo-Token")).toBe("undo-1");
    expect(updated.response.headers.get("X-CCH-Operation-Id")).toBe("op-1");
    expect(updated.json).toMatchObject({ id: 1, name: "Updated provider" });
    expect(editProviderMock).toHaveBeenCalledWith(1, { name: "Updated provider" });

    const deleted = await callV1Route({
      method: "DELETE",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(deleted.response.status).toBe(204);
    expect(deleted.response.headers.get("X-CCH-Undo-Token")).toBe("undo-2");
    expect(deleted.response.headers.get("X-CCH-Operation-Id")).toBe("op-2");
    expect(removeProviderMock).toHaveBeenCalledWith(1);
  });

  test("rejects redacted placeholders when creating providers", async () => {
    const created = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Broken provider",
        url: "https://REDACTED:REDACTED@api.example.com/v1",
        key: "[REDACTED]",
        provider_type: "openai-compatible",
      },
    });

    expect(created.response.status).toBe(422);
    expect(created.json).toMatchObject({
      errorCode: "provider.redacted_placeholder_rejected",
    });
    expect(addProviderMock).not.toHaveBeenCalled();
  });

  test("rejects redacted placeholders in provider key updates", async () => {
    const updated = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        key: "sk-a...[REDACTED]...xxxx",
      },
    });

    expect(updated.response.status).toBe(422);
    expect(updated.json).toMatchObject({
      errorCode: "provider.redacted_placeholder_rejected",
    });
    expect(editProviderMock).not.toHaveBeenCalled();
  });

  test("rejects hidden provider types and deprecated provider fields on writes", async () => {
    const hiddenType = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        name: "Legacy",
        url: "https://legacy.example.com",
        key: "sk-legacy",
        provider_type: "claude-auth",
      },
    });
    expect(hiddenType.response.status).toBe(400);
    expect(addProviderMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ provider_type: "claude-auth" })
    );

    const deprecatedField = await callV1Route({
      method: "PATCH",
      pathname: "/api/v1/providers/1",
      headers: { Authorization: "Bearer admin-token" },
      body: { tpm: 123 },
    });
    expect(deprecatedField.response.status).toBe(400);
    expect(deprecatedField.json).toMatchObject({ errorCode: "request.validation_failed" });
  });

  test("exposes provider health circuit usage group and batch operations", async () => {
    const health = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/health",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(health.response.status).toBe(200);
    expect(health.json).toEqual({ "1": { circuitState: "closed", failureCount: 0 } });
    expect(getProvidersHealthStatusMock).toHaveBeenCalled();

    const resetCircuit = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/1/circuit:reset",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(resetCircuit.response.status).toBe(200);
    expect(resetProviderCircuitMock).toHaveBeenCalledWith(1);

    const resetUsage = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/1/usage:reset",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(resetUsage.response.status).toBe(200);
    expect(resetProviderTotalUsageMock).toHaveBeenCalledWith(1);

    const limitUsage = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/1/limit-usage",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(limitUsage.response.status).toBe(200);
    expect(getProviderLimitUsageMock).toHaveBeenCalledWith(1);

    const limitBatch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/limit-usage:batch",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [1] },
    });
    expect(limitBatch.response.status).toBe(200);
    expect(getProviderLimitUsageBatchMock).toHaveBeenCalledWith([
      expect.objectContaining({ id: 1 }),
    ]);

    const groups = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/groups?include=count",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(groups.response.status).toBe(200);
    expect(getProviderGroupsWithCountMock).toHaveBeenCalled();

    const invalidGroups = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/groups?userId=not-a-number",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(invalidGroups.response.status).toBe(400);
    expect(invalidGroups.json).toMatchObject({ errorCode: "request.validation_failed" });

    const autoSort = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:autoSortPriority",
      headers: { Authorization: "Bearer admin-token" },
      body: { confirm: false },
    });
    expect(autoSort.response.status).toBe(200);
    expect(autoSortProviderPriorityMock).toHaveBeenCalledWith({ confirm: false });

    const batchUpdate = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchUpdate",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [1], updates: { is_enabled: false } },
    });
    expect(batchUpdate.response.status).toBe(200);
    expect(batchUpdateProvidersMock).toHaveBeenCalledWith({
      providerIds: [1],
      updates: { is_enabled: false },
    });

    const rejectedLegacyBatchUpdate = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchUpdate",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [1], updates: { is_enabled: false, provider_type: "claude-auth" } },
    });
    expect(rejectedLegacyBatchUpdate.response.status).toBe(400);
    expect(batchUpdateProvidersMock).toHaveBeenCalledTimes(1);

    const hiddenBatchUpdate = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchUpdate",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [2], updates: { is_enabled: false } },
    });
    expect(hiddenBatchUpdate.response.status).toBe(404);

    const batchDelete = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchDelete",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [1] },
    });
    expect(batchDelete.response.status).toBe(200);
    expect(batchDeleteProvidersMock).toHaveBeenCalledWith({ providerIds: [1] });

    const hiddenBatchDelete = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchDelete",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [2] },
    });
    expect(hiddenBatchDelete.response.status).toBe(404);

    const batchReset = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/circuits:batchReset",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [1] },
    });
    expect(batchReset.response.status).toBe(200);
    expect(batchResetProviderCircuitsMock).toHaveBeenCalledWith({ providerIds: [1] });

    const hiddenBatchReset = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/circuits:batchReset",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [2] },
    });
    expect(hiddenBatchReset.response.status).toBe(404);
  });

  test("exposes provider patch undo and model discovery operations", async () => {
    const preview = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchPatch:preview",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [1], patch: { priority: { set: 1 } } },
    });
    expect(preview.response.status).toBe(200);
    expect(previewProviderBatchPatchMock).toHaveBeenCalledWith({
      providerIds: [1],
      patch: { priority: { set: 1 } },
    });

    const hiddenPreview = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchPatch:preview",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerIds: [2], patch: { priority: { set: 1 } } },
    });
    expect(hiddenPreview.response.status).toBe(404);

    const apply = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchPatch:apply",
      headers: { Authorization: "Bearer admin-token" },
      body: { previewToken: "preview", previewRevision: "rev", providerIds: [1], patch: {} },
    });
    expect(apply.response.status).toBe(200);
    expect(applyProviderBatchPatchMock).toHaveBeenCalledWith({
      previewToken: "preview",
      previewRevision: "rev",
      providerIds: [1],
      patch: {},
    });

    const hiddenApply = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchPatch:apply",
      headers: { Authorization: "Bearer admin-token" },
      body: { previewToken: "preview", previewRevision: "rev", providerIds: [2], patch: {} },
    });
    expect(hiddenApply.response.status).toBe(404);

    const undoPatch = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:undoPatch",
      headers: { Authorization: "Bearer admin-token" },
      body: { undoToken: "undo-patch", operationId: "op-patch" },
    });
    expect(undoPatch.response.status).toBe(200);
    expect(undoProviderPatchMock).toHaveBeenCalledWith({
      undoToken: "undo-patch",
      operationId: "op-patch",
    });

    const undoDelete = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:undoDelete",
      headers: { Authorization: "Bearer admin-token" },
      body: { undoToken: "undo-delete", operationId: "op-delete" },
    });
    expect(undoDelete.response.status).toBe(200);
    expect(undoProviderDeleteMock).toHaveBeenCalledWith({
      undoToken: "undo-delete",
      operationId: "op-delete",
    });

    undoProviderPatchMock.mockResolvedValueOnce({
      ok: false,
      error: "undo token expired",
      errorCode: "UNDO_EXPIRED",
    });
    const expiredUndo = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:undoPatch",
      headers: { Authorization: "Bearer admin-token" },
      body: { undoToken: "expired", operationId: "op-patch" },
    });
    expect(expiredUndo.response.status).toBe(410);

    applyProviderBatchPatchMock.mockResolvedValueOnce({
      ok: false,
      error: "preview stale",
      errorCode: "PREVIEW_STALE",
    });
    const staleApply = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers:batchPatch:apply",
      headers: { Authorization: "Bearer admin-token" },
      body: { previewToken: "preview", previewRevision: "old", providerIds: [1], patch: {} },
    });
    expect(staleApply.response.status).toBe(409);

    const upstream = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/upstream-models:fetch",
      headers: { Authorization: "Bearer admin-token" },
      body: {
        providerUrl: "https://api.openai.com",
        apiKey: "sk-test",
        providerType: "openai-compatible",
      },
    });
    expect(upstream.response.status).toBe(200);
    expect(fetchUpstreamModelsMock).toHaveBeenCalledWith({
      providerUrl: "https://api.openai.com",
      apiKey: "sk-test",
      providerType: "openai-compatible",
    });

    const suggestions = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/model-suggestions?providerGroup=default",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(suggestions.response.status).toBe(200);
    expect(getModelSuggestionsByProviderGroupMock).toHaveBeenCalledWith("default");

    const recluster = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/vendors:recluster",
      headers: { Authorization: "Bearer admin-token" },
      body: { confirm: false },
    });
    expect(recluster.response.status).toBe(200);
    expect(reclusterProviderVendorsMock).toHaveBeenCalledWith({ confirm: false });
  });

  test("exposes provider API test operations", async () => {
    const apiBody = {
      providerUrl: "https://api.example.com",
      apiKey: "sk-test",
      model: "model-a",
    };

    const proxy = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/test:proxy",
      headers: { Authorization: "Bearer admin-token" },
      body: { providerUrl: "https://api.example.com" },
    });
    expect(proxy.response.status).toBe(200);
    expect(testProviderProxyMock).toHaveBeenCalledWith({ providerUrl: "https://api.example.com" });

    const unified = await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/test:unified",
      headers: { Authorization: "Bearer admin-token" },
      body: { ...apiBody, providerType: "openai-compatible" },
    });
    expect(unified.response.status).toBe(200);
    expect(testProviderUnifiedMock).toHaveBeenCalledWith({
      ...apiBody,
      providerType: "openai-compatible",
    });

    await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/test:anthropic-messages",
      headers: { Authorization: "Bearer admin-token" },
      body: apiBody,
    });
    expect(testProviderAnthropicMessagesMock).toHaveBeenCalledWith(apiBody);

    await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/test:openai-chat-completions",
      headers: { Authorization: "Bearer admin-token" },
      body: apiBody,
    });
    expect(testProviderOpenAIChatCompletionsMock).toHaveBeenCalledWith(apiBody);

    await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/test:openai-responses",
      headers: { Authorization: "Bearer admin-token" },
      body: apiBody,
    });
    expect(testProviderOpenAIResponsesMock).toHaveBeenCalledWith(apiBody);

    await callV1Route({
      method: "POST",
      pathname: "/api/v1/providers/test:gemini",
      headers: { Authorization: "Bearer admin-token" },
      body: apiBody,
    });
    expect(testProviderGeminiMock).toHaveBeenCalledWith(apiBody);

    const presets = await callV1Route({
      method: "GET",
      pathname: "/api/v1/providers/test:presets?providerType=codex",
      headers: { Authorization: "Bearer admin-token" },
    });
    expect(presets.response.status).toBe(200);
    expect(getProviderTestPresetsMock).toHaveBeenCalledWith("codex");
  });
});
