import { beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const findUsageLogsWithDetailsMock = vi.fn();
const findUsageLogsBatchMock = vi.fn();
const findUsageLogsStatsMock = vi.fn();
const exportStatusStore = new Map<string, unknown>();
const exportCsvStore = new Map<string, string>();

vi.mock("@/lib/auth", () => {
  return {
    getSession: getSessionMock,
  };
});

vi.mock("@/lib/redis/redis-kv-store", () => ({
  RedisKVStore: class MockRedisKVStore<T> {
    private readonly prefix: string;

    constructor(options: { prefix: string }) {
      this.prefix = options.prefix;
    }

    async set(key: string, value: T) {
      if (this.prefix.includes(":status:")) {
        exportStatusStore.set(key, value);
      } else {
        exportCsvStore.set(key, value as string);
      }
      return true;
    }

    async get(key: string) {
      if (this.prefix.includes(":status:")) {
        return (exportStatusStore.get(key) as T | undefined) ?? null;
      }
      return ((exportCsvStore.get(key) as T | undefined) ?? null) as T | null;
    }

    async getAndDelete(key: string) {
      if (this.prefix.includes(":status:")) {
        const value = (exportStatusStore.get(key) as T | undefined) ?? null;
        exportStatusStore.delete(key);
        return value;
      }
      const value = ((exportCsvStore.get(key) as T | undefined) ?? null) as T | null;
      exportCsvStore.delete(key);
      return value;
    }

    async delete(key: string) {
      if (this.prefix.includes(":status:")) {
        return exportStatusStore.delete(key);
      }
      return exportCsvStore.delete(key);
    }
  },
}));

vi.mock("@/repository/usage-logs", () => {
  return {
    findUsageLogSessionIdSuggestions: vi.fn(async () => []),
    findUsageLogsBatch: findUsageLogsBatchMock,
    findUsageLogsStats: findUsageLogsStatsMock,
    findUsageLogsWithDetails: findUsageLogsWithDetailsMock,
    getUsedEndpoints: vi.fn(async () => []),
    getUsedModels: vi.fn(async () => []),
    getUsedStatusCodes: vi.fn(async () => []),
  };
});

function createSummary(totalRequests = 0) {
  return {
    totalRequests,
    totalCost: 0,
    totalTokens: 0,
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCacheCreationTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheCreation5mTokens: 0,
    totalCacheCreation1hTokens: 0,
  };
}

function createLog(overrides: Record<string, unknown> = {}) {
  return {
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
    providerChain: null,
    ...overrides,
  };
}

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
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    exportStatusStore.clear();
    exportCsvStore.clear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUsageLogsWithDetailsMock.mockResolvedValue({
      logs: [],
      total: 0,
      summary: createSummary(),
    });
    findUsageLogsBatchMock.mockResolvedValue({ logs: [], nextCursor: null, hasMore: false });
    findUsageLogsStatsMock.mockResolvedValue(createSummary());
  });

  test("exportUsageLogs: Retry Count 应对齐 getRetryCount（hedge race 为 0）", async () => {
    findUsageLogsWithDetailsMock.mockResolvedValue({
      logs: [],
      total: 3,
      summary: createSummary(3),
    });
    findUsageLogsBatchMock.mockResolvedValueOnce({
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
      nextCursor: null,
      hasMore: false,
    });

    const { exportUsageLogs } = await import("@/actions/usage-logs");
    const result = await exportUsageLogs({});

    expect(result.ok).toBe(true);
    const csv = result.data;
    const csvNoBom = csv.replace(/^\uFEFF/, "");
    const lines = csvNoBom
      .trim()
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));

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

  test("exportUsageLogs: 按批次全量导出，并拦截前导空白公式注入", async () => {
    findUsageLogsWithDetailsMock.mockResolvedValue({
      logs: [],
      total: 3,
      summary: createSummary(3),
    });
    findUsageLogsBatchMock
      .mockResolvedValueOnce({
        logs: [
          createLog({ sessionId: "s1", model: " =1+1" }),
          createLog({ sessionId: "s2", model: "+2+2" }),
        ],
        nextCursor: { createdAt: "2026-03-16T00:00:01.000000Z", id: 2 },
        hasMore: true,
      })
      .mockResolvedValueOnce({
        logs: [createLog({ sessionId: "s3", endpoint: " \t@SUM(A1:A2)" })],
        nextCursor: null,
        hasMore: false,
      });

    const { exportUsageLogs } = await import("@/actions/usage-logs");
    const result = await exportUsageLogs({});

    expect(result.ok).toBe(true);
    expect(findUsageLogsBatchMock).toHaveBeenCalledTimes(2);

    const csvNoBom = result.data.replace(/^\uFEFF/, "");
    const lines = csvNoBom
      .trim()
      .split("\n")
      .map((line) => line.replace(/\r$/, ""));

    expect(lines).toHaveLength(4);
    const header = parseCsvLine(lines[0] ?? "");
    const modelIndex = header.indexOf("Model");
    const endpointIndex = header.indexOf("Endpoint");
    const row1 = parseCsvLine(lines[1] ?? "");
    const row2 = parseCsvLine(lines[2] ?? "");
    const row3 = parseCsvLine(lines[3] ?? "");

    expect(row1[modelIndex]).toBe("' =1+1");
    expect(row2[modelIndex]).toBe("'+2+2");
    expect(row3[endpointIndex]).toBe("' \t@SUM(A1:A2)");
  });

  test("startUsageLogsExport: 异步导出任务完成后可轮询并下载", async () => {
    vi.useFakeTimers();
    findUsageLogsWithDetailsMock.mockResolvedValue({
      logs: [],
      total: 1,
      summary: createSummary(1),
    });
    findUsageLogsBatchMock.mockResolvedValueOnce({
      logs: [createLog({ sessionId: "job-session" })],
      nextCursor: null,
      hasMore: false,
    });

    const { downloadUsageLogsExport, getUsageLogsExportStatus, startUsageLogsExport } =
      await import("@/actions/usage-logs");

    const startResult = await startUsageLogsExport({});
    expect(startResult.ok).toBe(true);
    const jobId = startResult.data.jobId;

    const queuedStatus = await getUsageLogsExportStatus(jobId);
    expect(queuedStatus.ok).toBe(true);
    expect(queuedStatus.data.status).toBe("queued");

    await vi.runAllTimersAsync();

    const completedStatus = await getUsageLogsExportStatus(jobId);
    expect(completedStatus.ok).toBe(true);
    expect(completedStatus.data.status).toBe("completed");
    expect(completedStatus.data.progressPercent).toBe(100);
    expect(completedStatus.data.processedRows).toBe(1);

    const downloadResult = await downloadUsageLogsExport(jobId);
    expect(downloadResult.ok).toBe(true);
    expect(downloadResult.data).toContain("Session ID");
    expect(downloadResult.data).toContain("job-session");
  });
});
