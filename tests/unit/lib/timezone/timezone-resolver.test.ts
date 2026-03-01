/**
 * Timezone Resolver Tests (Task 2)
 *
 * TDD tests for the system timezone resolver:
 * - Fallback chain: DB timezone -> env TZ -> UTC
 * - Validation of resolved timezone
 * - Integration with cached system settings
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// Mock the system settings cache
vi.mock("@/lib/config/system-settings-cache", () => ({
  getCachedSystemSettings: vi.fn(),
}));

// Mock env config
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: vi.fn(),
  isDevelopment: vi.fn(() => false),
}));

// Mock logger
vi.mock("@/lib/logger", () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
  },
}));

import { getCachedSystemSettings } from "@/lib/config/system-settings-cache";
import { getEnvConfig } from "@/lib/config/env.schema";
import type { SystemSettings } from "@/types/system-config";

const getCachedSystemSettingsMock = vi.mocked(getCachedSystemSettings);
const getEnvConfigMock = vi.mocked(getEnvConfig);

function createSettings(overrides: Partial<SystemSettings> = {}): SystemSettings {
  return {
    id: 1,
    siteTitle: "Claude Code Hub",
    allowGlobalUsageView: false,
    currencyDisplay: "USD",
    billingModelSource: "original",
    timezone: null,
    enableAutoCleanup: false,
    cleanupRetentionDays: 30,
    cleanupSchedule: "0 2 * * *",
    cleanupBatchSize: 10000,
    enableClientVersionCheck: false,
    verboseProviderError: false,
    enableHttp2: false,
    interceptAnthropicWarmupRequests: false,
    enableThinkingSignatureRectifier: true,
    enableCodexSessionIdCompletion: true,
    enableResponseFixer: true,
    responseFixerConfig: {
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 200,
      maxFixSize: 1024 * 1024,
    },
    quotaDbRefreshIntervalSeconds: 10,
    quotaLeasePercent5h: 0.05,
    quotaLeasePercentDaily: 0.05,
    quotaLeasePercentWeekly: 0.05,
    quotaLeasePercentMonthly: 0.05,
    quotaLeaseCapUsd: null,
    createdAt: new Date("2026-01-01T00:00:00.000Z"),
    updatedAt: new Date("2026-01-01T00:00:00.000Z"),
    ...overrides,
  };
}

function mockEnvConfig(tz = "Asia/Shanghai") {
  getEnvConfigMock.mockReturnValue({
    NODE_ENV: "test",
    TZ: tz,
    PORT: 23000,
    AUTO_MIGRATE: true,
    ENABLE_RATE_LIMIT: true,
    ENABLE_SECURE_COOKIES: true,
    SESSION_TTL: 300,
    STORE_SESSION_MESSAGES: false,
    DEBUG_MODE: false,
    LOG_LEVEL: "info",
    ENABLE_CIRCUIT_BREAKER_ON_NETWORK_ERRORS: false,
    ENABLE_PROVIDER_CACHE: true,
    MAX_RETRY_ATTEMPTS_DEFAULT: 2,
    FETCH_BODY_TIMEOUT: 600000,
    FETCH_HEADERS_TIMEOUT: 600000,
    FETCH_CONNECT_TIMEOUT: 30000,
    REDIS_TLS_REJECT_UNAUTHORIZED: true,
  } as ReturnType<typeof getEnvConfig>);
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("resolveSystemTimezone", () => {
  it("should return DB timezone when set and valid", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockResolvedValue(createSettings({ timezone: "America/New_York" }));
    mockEnvConfig("Asia/Shanghai");

    const result = await resolveSystemTimezone();
    expect(result).toBe("America/New_York");
  });

  it("should fallback to env TZ when DB timezone is null", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockResolvedValue(createSettings({ timezone: null }));
    mockEnvConfig("Europe/London");

    const result = await resolveSystemTimezone();
    expect(result).toBe("Europe/London");
  });

  it("should fallback to env TZ when DB timezone is invalid", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockResolvedValue(
      createSettings({ timezone: "Invalid/Timezone_Zone" })
    );
    mockEnvConfig("Asia/Tokyo");

    const result = await resolveSystemTimezone();
    expect(result).toBe("Asia/Tokyo");
  });

  it("should fallback to UTC when both DB timezone and env TZ are invalid", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockResolvedValue(createSettings({ timezone: "Invalid/Zone" }));
    // Empty string TZ won't pass isValidIANATimezone
    mockEnvConfig("");

    const result = await resolveSystemTimezone();
    expect(result).toBe("UTC");
  });

  it("should fallback to UTC when getCachedSystemSettings throws", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockRejectedValue(new Error("DB connection failed"));
    mockEnvConfig("Asia/Shanghai");

    const result = await resolveSystemTimezone();
    // Should still try env TZ fallback
    expect(result).toBe("Asia/Shanghai");
  });

  it("should fallback to UTC when getCachedSystemSettings throws and env TZ is empty", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockRejectedValue(new Error("DB connection failed"));
    mockEnvConfig("");

    const result = await resolveSystemTimezone();
    expect(result).toBe("UTC");
  });

  it("should handle empty string DB timezone as null", async () => {
    const { resolveSystemTimezone } = await import("@/lib/utils/timezone.server");

    getCachedSystemSettingsMock.mockResolvedValue(
      createSettings({ timezone: "" as unknown as null })
    );
    mockEnvConfig("Europe/Paris");

    const result = await resolveSystemTimezone();
    expect(result).toBe("Europe/Paris");
  });
});
