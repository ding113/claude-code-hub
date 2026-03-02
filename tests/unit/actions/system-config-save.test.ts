import { beforeEach, describe, expect, it, vi } from "vitest";
import { locales } from "@/i18n/config";

// Mock dependencies
const getSessionMock = vi.fn();
const revalidatePathMock = vi.fn();
const publishSystemSettingsCacheInvalidationMock = vi.fn();
const updateSystemSettingsMock = vi.fn();
const getSystemSettingsMock = vi.fn();

vi.mock("@/lib/auth", () => ({
  getSession: () => getSessionMock(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: (...args: unknown[]) => revalidatePathMock(...args),
}));

vi.mock("@/lib/config", () => ({
  publishSystemSettingsCacheInvalidation: () => publishSystemSettingsCacheInvalidationMock(),
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

vi.mock("@/lib/utils/timezone.server", () => ({
  resolveSystemTimezone: vi.fn(async () => "UTC"),
  isValidIANATimezone: vi.fn(() => true),
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: () => getSystemSettingsMock(),
  updateSystemSettings: (...args: unknown[]) => updateSystemSettingsMock(...args),
}));

// Import the action after mocks are set up
import { saveSystemSettings } from "@/actions/system-config";

describe("saveSystemSettings", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: admin session
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    // Default: successful update
    updateSystemSettingsMock.mockResolvedValue({
      id: 1,
      siteTitle: "Test Site",
      allowGlobalUsageView: false,
      currencyDisplay: "CNY",
      billingModelSource: "original",
      timezone: null,
      enableAutoCleanup: false,
      cleanupRetentionDays: 30,
      cleanupSchedule: "0 3 * * *",
      cleanupBatchSize: 1000,
      enableClientVersionCheck: false,
      verboseProviderError: false,
      enableHttp2: false,
      interceptAnthropicWarmupRequests: false,
      enableThinkingSignatureRectifier: false,
      enableThinkingBudgetRectifier: false,
      enableBillingHeaderRectifier: true,
      enableCodexSessionIdCompletion: false,
      enableClaudeMetadataUserIdInjection: false,
      enableResponseFixer: false,
      responseFixerConfig: {
        fixEncoding: false,
        fixStreamingJson: false,
        fixEmptyResponse: false,
        fixContentBlockDelta: false,
        maxRetries: 3,
        timeout: 5000,
      },
      quotaDbRefreshIntervalSeconds: 60,
      quotaLeasePercent5h: 0.05,
      quotaLeasePercentDaily: 0.05,
      quotaLeasePercentWeekly: 0.05,
      quotaLeasePercentMonthly: 0.05,
      quotaLeaseCapUsd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  });

  it("should return error when user is not admin", async () => {
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "user" } });

    const result = await saveSystemSettings({ siteTitle: "New Title" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("无权限");
    expect(updateSystemSettingsMock).not.toHaveBeenCalled();
  });

  it("should return error when user is not logged in", async () => {
    getSessionMock.mockResolvedValue(null);

    const result = await saveSystemSettings({ siteTitle: "New Title" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("无权限");
    expect(updateSystemSettingsMock).not.toHaveBeenCalled();
  });

  it("should call updateSystemSettings with validated data", async () => {
    const result = await saveSystemSettings({
      siteTitle: "New Site Title",
      verboseProviderError: true,
    });

    expect(result.ok).toBe(true);
    expect(updateSystemSettingsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        siteTitle: "New Site Title",
        verboseProviderError: true,
      })
    );
  });

  it("should publish system settings cache invalidation after successful save", async () => {
    await saveSystemSettings({ siteTitle: "New Title" });

    expect(publishSystemSettingsCacheInvalidationMock).toHaveBeenCalled();
  });

  describe("revalidatePath locale coverage", () => {
    it("should revalidate paths for ALL supported locales", async () => {
      await saveSystemSettings({ siteTitle: "New Title" });

      // Collect all revalidatePath calls
      const calls = revalidatePathMock.mock.calls.map((call) => call[0]);

      // Check that each locale's settings/config path is revalidated
      for (const locale of locales) {
        const expectedSettingsPath = `/${locale}/settings/config`;
        expect(calls).toContain(expectedSettingsPath);
      }
    });

    it("should revalidate dashboard paths for ALL supported locales", async () => {
      await saveSystemSettings({ siteTitle: "New Title" });

      const calls = revalidatePathMock.mock.calls.map((call) => call[0]);

      // Check that each locale's dashboard path is revalidated
      for (const locale of locales) {
        const expectedDashboardPath = `/${locale}/dashboard`;
        expect(calls).toContain(expectedDashboardPath);
      }
    });

    it("should revalidate root layout", async () => {
      await saveSystemSettings({ siteTitle: "New Title" });

      // Check that root layout is revalidated
      expect(revalidatePathMock).toHaveBeenCalledWith("/", "layout");
    });

    it("should call revalidatePath at least 2 * locales.length + 1 times", async () => {
      await saveSystemSettings({ siteTitle: "New Title" });

      // 2 paths per locale (settings/config + dashboard) + 1 for root layout
      const expectedMinCalls = locales.length * 2 + 1;
      expect(revalidatePathMock).toHaveBeenCalledTimes(expectedMinCalls);
    });
  });

  it("should return updated settings on success", async () => {
    const mockUpdated = {
      id: 1,
      siteTitle: "Updated Title",
      allowGlobalUsageView: true,
      currencyDisplay: "USD",
      billingModelSource: "original",
      timezone: "America/New_York",
      enableAutoCleanup: false,
      cleanupRetentionDays: 30,
      cleanupSchedule: "0 3 * * *",
      cleanupBatchSize: 1000,
      enableClientVersionCheck: false,
      verboseProviderError: true,
      enableHttp2: true,
      interceptAnthropicWarmupRequests: false,
      enableThinkingSignatureRectifier: false,
      enableThinkingBudgetRectifier: false,
      enableBillingHeaderRectifier: true,
      enableCodexSessionIdCompletion: false,
      enableClaudeMetadataUserIdInjection: false,
      enableResponseFixer: false,
      responseFixerConfig: {
        fixEncoding: false,
        fixStreamingJson: false,
        fixEmptyResponse: false,
        fixContentBlockDelta: false,
        maxRetries: 3,
        timeout: 5000,
      },
      quotaDbRefreshIntervalSeconds: 60,
      quotaLeasePercent5h: 0.05,
      quotaLeasePercentDaily: 0.05,
      quotaLeasePercentWeekly: 0.05,
      quotaLeasePercentMonthly: 0.05,
      quotaLeaseCapUsd: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    updateSystemSettingsMock.mockResolvedValue(mockUpdated);

    const result = await saveSystemSettings({
      siteTitle: "Updated Title",
      allowGlobalUsageView: true,
      currencyDisplay: "USD",
      timezone: "America/New_York",
      verboseProviderError: true,
      enableHttp2: true,
    });

    expect(result.ok).toBe(true);
    expect(result.data).toEqual(mockUpdated);
  });

  it("should handle repository errors gracefully", async () => {
    updateSystemSettingsMock.mockRejectedValue(new Error("Database error"));

    const result = await saveSystemSettings({ siteTitle: "New Title" });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("Database error");
  });
});
