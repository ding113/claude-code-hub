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

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (!char) continue;

    if (inQuotes) {
      if (char === '"') {
        const next = line[i + 1];
        if (next === '"') {
          current += '"';
          i += 1;
          continue;
        }
        inQuotes = false;
        continue;
      }

      current += char;
      continue;
    }

    if (char === ",") {
      fields.push(current);
      current = "";
      continue;
    }

    if (char === '"') {
      inQuotes = true;
      continue;
    }

    current += char;
  }

  fields.push(current);
  return fields;
}

describe("Usage logs CSV export retryCount", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
  });

  test("exportUsageLogs: Retry Count 应对齐 getRetryCount（hedge race 为 0）", async () => {
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
        {
          createdAt: new Date("2026-03-16T00:00:02.000Z"),
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
          sessionId: "s3",
          providerChain: [
            { reason: "initial_selection" },
            { reason: "hedge_triggered" },
            { reason: "hedge_launched" },
            { reason: "hedge_winner", statusCode: 200 },
            { reason: "hedge_loser_cancelled" },
          ],
        },
      ],
      total: 3,
      summary: {
        totalRequests: 3,
        totalCost: 0,
        totalTokens: 9,
        totalInputTokens: 3,
        totalOutputTokens: 6,
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
    const lines = csvNoBom.trim().split("\n").map((line) => line.replace(/\r$/, ""));

    expect(lines).toHaveLength(4);
    const header = parseCsvLine(lines[0] ?? "");
    const retryCountIndex = header.indexOf("Retry Count");
    expect(retryCountIndex).toBeGreaterThanOrEqual(0);

    const row1 = parseCsvLine(lines[1] ?? "");
    const row2 = parseCsvLine(lines[2] ?? "");
    const row3 = parseCsvLine(lines[3] ?? "");
    expect(row1[retryCountIndex]).toBe("0");
    expect(row2[retryCountIndex]).toBe("1");
    expect(row3[retryCountIndex]).toBe("0");
  });
});
