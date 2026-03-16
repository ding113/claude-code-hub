import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const findUsageLogsWithDetailsMock = vi.fn();

vi.mock("@/lib/auth", () => {
  return {
    getSession: getSessionMock,
  };
});

vi.mock("@/repository/usage-logs", () => {
  return {
    findUsageLogSessionIdSuggestions: vi.fn(async () => []),
    findUsageLogsBatch: vi.fn(async () => ({ logs: [], nextCursor: null, hasMore: false })),
    findUsageLogsStats: vi.fn(async () => ({
      totalRequests: 0,
      totalCost: 0,
      totalTokens: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheCreationTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreation5mTokens: 0,
      totalCacheCreation1hTokens: 0,
    })),
    findUsageLogsWithDetails: findUsageLogsWithDetailsMock,
    getUsedEndpoints: vi.fn(async () => []),
    getUsedModels: vi.fn(async () => []),
    getUsedStatusCodes: vi.fn(async () => []),
  };
});

describe("Usage logs CSV export retryCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  test("exportUsageLogs: Retry Count 应为 provider_chain.length - 2（最小为 0）", async () => {
    findUsageLogsWithDetailsMock.mockResolvedValue({
      logs: [
        {
          createdAt: new Date("2026-03-16T00:00:00.000Z"),
          userName: "u",
          keyName: "k",
          providerName: "p",
          model: "m",
          originalModel: "om",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 2,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 3,
          costUsd: "0",
          durationMs: 10,
          sessionId: "s1",
          providerChain: [
            { reason: "initial_selection" },
            { reason: "request_success", statusCode: 200 },
          ],
        },
        {
          createdAt: new Date("2026-03-16T00:00:01.000Z"),
          userName: "u",
          keyName: "k",
          providerName: "p",
          model: "m",
          originalModel: "om",
          endpoint: "/v1/messages",
          statusCode: 200,
          inputTokens: 1,
          outputTokens: 2,
          cacheCreation5mInputTokens: 0,
          cacheCreation1hInputTokens: 0,
          cacheReadInputTokens: 0,
          totalTokens: 3,
          costUsd: "0",
          durationMs: 10,
          sessionId: "s2",
          providerChain: [
            { reason: "initial_selection" },
            { reason: "retry_failed", attemptNumber: 1 },
            { reason: "retry_success", statusCode: 200, attemptNumber: 1 },
          ],
        },
      ],
      total: 2,
      summary: {
        totalRequests: 2,
        totalCost: 0,
        totalTokens: 6,
        totalInputTokens: 2,
        totalOutputTokens: 4,
        totalCacheCreationTokens: 0,
        totalCacheReadTokens: 0,
        totalCacheCreation5mTokens: 0,
        totalCacheCreation1hTokens: 0,
      },
    });

    const { exportUsageLogs } = await import("@/actions/usage-logs");
    const result = await exportUsageLogs({});

    expect(result.ok).toBe(true);
    const csv = result.data;
    const csvNoBom = csv.replace(/^\uFEFF/, "");
    const lines = csvNoBom.trim().split("\n");

    expect(lines).toHaveLength(3);
    const row1 = lines[1]?.split(",") ?? [];
    const row2 = lines[2]?.split(",") ?? [];
    expect(row1[row1.length - 1]).toBe("0");
    expect(row2[row2.length - 1]).toBe("1");
  });
});
