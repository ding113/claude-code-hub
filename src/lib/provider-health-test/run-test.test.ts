import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  executeProviderTest: vi.fn(),
  findProvidersForScheduledHealthTest: vi.fn(),
  findLatestPriceByModel: vi.fn(),
  recordProviderHealthTestResult: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/app/v1/_lib/gemini/auth", () => ({
  GeminiAuth: {
    getAccessToken: vi.fn(),
    isJson: vi.fn(),
  },
}));
vi.mock("@/lib/provider-testing/test-service", () => ({
  executeProviderTest: mocks.executeProviderTest,
}));
vi.mock("@/lib/cache/provider-cache", () => ({
  publishProviderCacheInvalidation: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("@/repository/model-price", () => ({
  findLatestPriceByModel: mocks.findLatestPriceByModel,
}));
vi.mock("@/repository/provider-health-test", () => ({
  findProvidersForScheduledHealthTest: mocks.findProvidersForScheduledHealthTest,
  recordProviderHealthTestResult: mocks.recordProviderHealthTestResult,
}));

import { runDueScheduledHealthTests, runProviderHealthTest } from "./run-test";

describe("runProviderHealthTest runtime settings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findProvidersForScheduledHealthTest.mockResolvedValue([]);
    mocks.findLatestPriceByModel.mockResolvedValue(null);
    mocks.recordProviderHealthTestResult.mockResolvedValue({
      onlineRate: 1,
      avgFirstByteMs: 10,
      recentResults: [],
    });
    mocks.executeProviderTest.mockResolvedValue({
      success: true,
      status: "green",
      model: "grok-4.5",
      firstByteMs: 10,
      latencyMs: 20,
      httpStatusCode: 200,
      usage: undefined,
    });
  });

  it("passes the configured scheduled timeout to the provider test service", async () => {
    await runProviderHealthTest({
      provider: {
        id: 1,
        name: "test-provider",
        url: "https://api.example.com",
        key: "sk-test-key",
        providerType: "openai-compatible",
        proxyUrl: null,
        proxyFallbackToDirect: false,
        customHeaders: null,
        costMultiplier: 1,
        healthTestModel: "grok-4.5",
      },
      source: "scheduled",
      timeoutMs: 120_000,
    });

    expect(mocks.executeProviderTest).toHaveBeenCalledWith(
      expect.objectContaining({
        timeoutMs: 120_000,
        firstByteTimeoutMs: undefined,
      })
    );
  });

  it("notifies the scheduler after a scheduled provider finishes", async () => {
    mocks.findProvidersForScheduledHealthTest.mockResolvedValue([
      {
        id: 42,
        name: "scheduled-provider",
        url: "https://api.example.com",
        key: "sk-test-key",
        providerType: "openai-compatible",
        proxyUrl: null,
        proxyFallbackToDirect: false,
        customHeaders: null,
        lastHealthTestAt: new Date(Date.now() - 2_000),
        scheduledHealthTestEnabled: true,
        isEnabled: true,
        costMultiplier: 1,
        groupTag: "grok",
        healthTestModel: "grok-4.5",
      },
    ]);
    const onProviderFinished = vi.fn();

    const dispatch = await runDueScheduledHealthTests({
      intervalMs: 1_000,
      timeoutMs: 120_000,
      onProviderFinished,
    });

    expect(dispatch.started).toBe(1);
    await vi.waitFor(() => expect(onProviderFinished).toHaveBeenCalledTimes(1));
  });
});
