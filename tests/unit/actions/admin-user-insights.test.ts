import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetSession = vi.hoisted(() => vi.fn());
const mockFindUserById = vi.hoisted(() => vi.fn());
const mockGetStatisticsWithCache = vi.hoisted(() => vi.fn());
const mockGetUserOverviewMetrics = vi.hoisted(() => vi.fn());
const mockGetUserModelBreakdown = vi.hoisted(() => vi.fn());
const mockGetUserProviderBreakdown = vi.hoisted(() => vi.fn());
const mockGetSystemSettings = vi.hoisted(() => vi.fn());

vi.mock("@/lib/auth", () => ({
  getSession: mockGetSession,
}));

vi.mock("@/repository/user", () => ({
  findUserById: mockFindUserById,
}));

vi.mock("@/lib/redis/statistics-cache", () => ({
  getStatisticsWithCache: mockGetStatisticsWithCache,
}));

vi.mock("@/repository/admin-user-insights", () => ({
  getUserOverviewMetrics: mockGetUserOverviewMetrics,
  getUserModelBreakdown: mockGetUserModelBreakdown,
  getUserProviderBreakdown: mockGetUserProviderBreakdown,
}));

vi.mock("@/repository/system-config", () => ({
  getSystemSettings: mockGetSystemSettings,
}));

function createAdminSession() {
  return {
    user: { id: 1, name: "Admin", role: "admin" },
    key: { id: 1, key: "sk-admin" },
  };
}

function createUserSession() {
  return {
    user: { id: 2, name: "User", role: "user" },
    key: { id: 2, key: "sk-user" },
  };
}

function createMockUser() {
  return {
    id: 10,
    name: "Target User",
    description: "",
    role: "user" as const,
    rpm: null,
    dailyQuota: null,
    providerGroup: "default",
    isEnabled: true,
    expiresAt: null,
    dailyResetMode: "fixed" as const,
    dailyResetTime: "00:00",
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockOverview() {
  return {
    requestCount: 50,
    totalCost: 5.5,
    avgResponseTime: 200,
    errorRate: 2.0,
  };
}

function createMockSettings() {
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
    enableThinkingBudgetRectifier: true,
    enableBillingHeaderRectifier: true,
    enableCodexSessionIdCompletion: true,
    enableClaudeMetadataUserIdInjection: true,
    enableResponseFixer: true,
    responseFixerConfig: {
      fixTruncatedJson: true,
      fixSseFormat: true,
      fixEncoding: true,
      maxJsonDepth: 50,
      maxFixSize: 1048576,
    },
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function createMockBreakdown() {
  return [
    {
      model: "claude-sonnet-4-20250514",
      requests: 30,
      cost: 3.5,
      inputTokens: 10000,
      outputTokens: 5000,
      cacheCreationTokens: 2000,
      cacheReadTokens: 8000,
    },
    {
      model: "claude-opus-4-20250514",
      requests: 20,
      cost: 2.0,
      inputTokens: 8000,
      outputTokens: 3000,
      cacheCreationTokens: 1000,
      cacheReadTokens: 5000,
    },
  ];
}

describe("getUserInsightsOverview", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized for non-admin", async () => {
    mockGetSession.mockResolvedValueOnce(createUserSession());

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
    expect(mockFindUserById).not.toHaveBeenCalled();
  });

  it("returns unauthorized when not logged in", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
  });

  it("returns error for non-existent user", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockFindUserById.mockResolvedValueOnce(null);

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(999);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("User not found");
    }
    expect(mockFindUserById).toHaveBeenCalledWith(999);
  });

  it("returns overview data for valid admin request", async () => {
    const user = createMockUser();
    const overview = createMockOverview();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockFindUserById.mockResolvedValueOnce(user);
    mockGetUserOverviewMetrics.mockResolvedValueOnce(overview);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(10, "2026-03-01", "2026-03-09");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.user).toEqual(user);
      expect(result.data.overview).toEqual(overview);
      expect(result.data.currencyCode).toBe("USD");
    }
    expect(mockFindUserById).toHaveBeenCalledWith(10);
    expect(mockGetUserOverviewMetrics).toHaveBeenCalledWith(10, "2026-03-01", "2026-03-09");
  });

  it("rejects invalid startDate format", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(10, "not-a-date", "2026-03-09");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("startDate");
    }
    expect(mockGetUserOverviewMetrics).not.toHaveBeenCalled();
  });

  it("rejects invalid endDate format", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(10, "2026-03-01", "03/09/2026");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("endDate");
    }
    expect(mockGetUserOverviewMetrics).not.toHaveBeenCalled();
  });

  it("rejects startDate after endDate", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsOverview } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsOverview(10, "2026-03-09", "2026-03-01");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("startDate must not be after endDate");
    }
    expect(mockGetUserOverviewMetrics).not.toHaveBeenCalled();
  });
});

describe("getUserInsightsKeyTrend", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized for non-admin", async () => {
    mockGetSession.mockResolvedValueOnce(createUserSession());

    const { getUserInsightsKeyTrend } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsKeyTrend(10, "today");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
    expect(mockGetStatisticsWithCache).not.toHaveBeenCalled();
  });

  it("validates timeRange parameter", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsKeyTrend } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsKeyTrend(10, "invalidRange");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("Invalid timeRange");
    }
    expect(mockGetStatisticsWithCache).not.toHaveBeenCalled();
  });

  it("returns trend data for valid request", async () => {
    const mockStats = [
      { key_id: 1, key_name: "sk-key-1", date: "2026-03-09", api_calls: 10, total_cost: 1.5 },
      { key_id: 2, key_name: "sk-key-2", date: "2026-03-08", api_calls: 15, total_cost: 2.0 },
    ];

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetStatisticsWithCache.mockResolvedValueOnce(mockStats);

    const { getUserInsightsKeyTrend } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsKeyTrend(10, "7days");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toHaveLength(2);
      expect(result.data[0].date).toBe("2026-03-09");
      expect(result.data[0].key_id).toBe(1);
      expect(result.data[0].key_name).toBe("sk-key-1");
      expect(result.data[0].api_calls).toBe(10);
      expect(result.data[1].date).toBe("2026-03-08");
    }
    expect(mockGetStatisticsWithCache).toHaveBeenCalledWith("7days", "keys", 10);
  });

  it("normalizes Date objects to ISO strings", async () => {
    const mockStats = [
      {
        key_id: 1,
        key_name: "sk-key-1",
        date: new Date("2026-03-09T12:00:00Z"),
        api_calls: 10,
        total_cost: 1.5,
      },
    ];

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetStatisticsWithCache.mockResolvedValueOnce(mockStats);

    const { getUserInsightsKeyTrend } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsKeyTrend(10, "today");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(typeof result.data[0].date).toBe("string");
      expect(result.data[0].date).toContain("2026-03-09");
    }
  });

  it("accepts all valid timeRange values", async () => {
    const validRanges = ["today", "7days", "30days", "thisMonth"];

    for (const range of validRanges) {
      vi.clearAllMocks();
      mockGetSession.mockResolvedValueOnce(createAdminSession());
      mockGetStatisticsWithCache.mockResolvedValueOnce([]);

      const { getUserInsightsKeyTrend } = await import("@/actions/admin-user-insights");
      const result = await getUserInsightsKeyTrend(10, range);

      expect(result.ok).toBe(true);
    }
  });
});

describe("getUserInsightsModelBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized for non-admin", async () => {
    mockGetSession.mockResolvedValueOnce(createUserSession());

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsModelBreakdown(10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
    expect(mockGetUserModelBreakdown).not.toHaveBeenCalled();
  });

  it("returns breakdown data for valid request", async () => {
    const breakdown = createMockBreakdown();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetUserModelBreakdown.mockResolvedValueOnce(breakdown);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsModelBreakdown(10);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.breakdown).toEqual(breakdown);
      expect(result.data.currencyCode).toBe("USD");
    }
    expect(mockGetUserModelBreakdown).toHaveBeenCalledWith(10, undefined, undefined, undefined);
  });

  it("passes date range to getUserModelBreakdown", async () => {
    const breakdown = createMockBreakdown();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetUserModelBreakdown.mockResolvedValueOnce(breakdown);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsModelBreakdown(10, "2026-03-01", "2026-03-09");

    expect(result.ok).toBe(true);
    expect(mockGetUserModelBreakdown).toHaveBeenCalledWith(
      10,
      "2026-03-01",
      "2026-03-09",
      undefined
    );
  });

  it("passes filter params to getUserModelBreakdown", async () => {
    const breakdown = createMockBreakdown();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetUserModelBreakdown.mockResolvedValueOnce(breakdown);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const filters = { keyId: 5, providerId: 3 };
    const result = await getUserInsightsModelBreakdown(10, "2026-03-01", "2026-03-09", filters);

    expect(result.ok).toBe(true);
    expect(mockGetUserModelBreakdown).toHaveBeenCalledWith(10, "2026-03-01", "2026-03-09", filters);
  });

  it("rejects invalid startDate format", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsModelBreakdown(10, "not-a-date");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("startDate");
    }
    expect(mockGetUserModelBreakdown).not.toHaveBeenCalled();
  });

  it("rejects invalid endDate format", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsModelBreakdown(10, "2026-03-01", "03/09/2026");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("endDate");
    }
    expect(mockGetUserModelBreakdown).not.toHaveBeenCalled();
  });

  it("rejects startDate after endDate", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsModelBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsModelBreakdown(10, "2026-03-09", "2026-03-01");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("startDate must not be after endDate");
    }
    expect(mockGetUserModelBreakdown).not.toHaveBeenCalled();
  });
});

function createMockProviderBreakdown() {
  return [
    {
      providerId: 1,
      providerName: "Provider A",
      requests: 40,
      cost: 4.0,
      inputTokens: 12000,
      outputTokens: 6000,
      cacheCreationTokens: 2500,
      cacheReadTokens: 9000,
    },
    {
      providerId: 2,
      providerName: "Provider B",
      requests: 10,
      cost: 1.5,
      inputTokens: 6000,
      outputTokens: 2000,
      cacheCreationTokens: 500,
      cacheReadTokens: 4000,
    },
  ];
}

describe("getUserInsightsProviderBreakdown", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns unauthorized for non-admin", async () => {
    mockGetSession.mockResolvedValueOnce(createUserSession());

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
    expect(mockGetUserProviderBreakdown).not.toHaveBeenCalled();
  });

  it("returns unauthorized when not logged in", async () => {
    mockGetSession.mockResolvedValueOnce(null);

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toBe("Unauthorized");
    }
  });

  it("returns breakdown data for valid request", async () => {
    const breakdown = createMockProviderBreakdown();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetUserProviderBreakdown.mockResolvedValueOnce(breakdown);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.breakdown).toEqual(breakdown);
      expect(result.data.breakdown[0].providerName).toBe("Provider A");
      expect(result.data.currencyCode).toBe("USD");
    }
    expect(mockGetUserProviderBreakdown).toHaveBeenCalledWith(10, undefined, undefined, undefined);
  });

  it("passes date range to getUserProviderBreakdown", async () => {
    const breakdown = createMockProviderBreakdown();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetUserProviderBreakdown.mockResolvedValueOnce(breakdown);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10, "2026-03-01", "2026-03-09");

    expect(result.ok).toBe(true);
    expect(mockGetUserProviderBreakdown).toHaveBeenCalledWith(
      10,
      "2026-03-01",
      "2026-03-09",
      undefined
    );
  });

  it("passes filter params to getUserProviderBreakdown", async () => {
    const breakdown = createMockProviderBreakdown();
    const settings = createMockSettings();

    mockGetSession.mockResolvedValueOnce(createAdminSession());
    mockGetUserProviderBreakdown.mockResolvedValueOnce(breakdown);
    mockGetSystemSettings.mockResolvedValueOnce(settings);

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const filters = { keyId: 5, model: "claude-sonnet-4-20250514" };
    const result = await getUserInsightsProviderBreakdown(10, "2026-03-01", "2026-03-09", filters);

    expect(result.ok).toBe(true);
    expect(mockGetUserProviderBreakdown).toHaveBeenCalledWith(
      10,
      "2026-03-01",
      "2026-03-09",
      filters
    );
  });

  it("rejects invalid startDate format", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10, "not-a-date");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("startDate");
    }
    expect(mockGetUserProviderBreakdown).not.toHaveBeenCalled();
  });

  it("rejects invalid endDate format", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10, "2026-03-01", "03/09/2026");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("endDate");
    }
    expect(mockGetUserProviderBreakdown).not.toHaveBeenCalled();
  });

  it("rejects startDate after endDate", async () => {
    mockGetSession.mockResolvedValueOnce(createAdminSession());

    const { getUserInsightsProviderBreakdown } = await import("@/actions/admin-user-insights");
    const result = await getUserInsightsProviderBreakdown(10, "2026-03-09", "2026-03-01");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("startDate must not be after endDate");
    }
    expect(mockGetUserProviderBreakdown).not.toHaveBeenCalled();
  });
});
