import { strFromU8, unzipSync } from "fflate";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const getSessionMock = vi.fn();
const findUsageLogsWithDetailsMock = vi.fn();
const findUsageLogsBatchMock = vi.fn();
const findUsageLogsStatsMock = vi.fn();
const exportStatusStore = new Map<string, unknown>();
const exportResultStore = new Map<string, string>();

vi.mock("@/lib/auth", () => ({ getSession: getSessionMock }));

vi.mock("@/lib/utils/timezone-resolver", () => ({
  resolveSystemTimezone: vi.fn(async () => "Asia/Shanghai"),
}));

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
        exportResultStore.set(key, value as string);
      }
      return true;
    }
    async get(key: string) {
      if (this.prefix.includes(":status:")) {
        return (exportStatusStore.get(key) as T | undefined) ?? null;
      }
      return ((exportResultStore.get(key) as T | undefined) ?? null) as T | null;
    }
    async delete(key: string) {
      if (this.prefix.includes(":status:")) {
        return exportStatusStore.delete(key);
      }
      return exportResultStore.delete(key);
    }
  },
}));

vi.mock("@/repository/usage-logs", () => ({
  findUsageLogSessionIdSuggestions: vi.fn(async () => []),
  findUsageLogsBatch: findUsageLogsBatchMock,
  findUsageLogsStats: findUsageLogsStatsMock,
  findUsageLogsWithDetails: findUsageLogsWithDetailsMock,
  getUsedEndpoints: vi.fn(async () => []),
  getUsedModels: vi.fn(async () => []),
  getUsedStatusCodes: vi.fn(async () => []),
}));

function summary(totalRequests = 0) {
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

function log(overrides: Record<string, unknown> = {}) {
  return {
    createdAt: new Date("2026-03-16T01:00:00.000Z"),
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
    costUsd: "1.500000000000000",
    durationMs: 10,
    sessionId: "s1",
    providerChain: null,
    ...overrides,
  };
}

describe("Usage logs XLSX export", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    vi.useRealTimers();
    exportStatusStore.clear();
    exportResultStore.clear();
    getSessionMock.mockResolvedValue({ user: { id: 1, role: "admin" } });
    findUsageLogsWithDetailsMock.mockResolvedValue({ logs: [], total: 1, summary: summary(1) });
    findUsageLogsBatchMock.mockResolvedValue({ logs: [], nextCursor: null, hasMore: false });
    findUsageLogsStatsMock.mockResolvedValue(summary());
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test("async xlsx job completes and downloads a base64 workbook with two sheets", async () => {
    vi.useFakeTimers();
    findUsageLogsBatchMock.mockResolvedValueOnce({
      logs: [log({ sessionId: "job-session" })],
      nextCursor: null,
      hasMore: false,
    });

    const { downloadUsageLogsExport, getUsageLogsExportStatus, startUsageLogsExport } =
      await import("@/actions/usage-logs");

    const startResult = await startUsageLogsExport({ format: "xlsx" });
    expect(startResult.ok).toBe(true);
    if (!startResult.ok) throw new Error("start failed");
    const jobId = startResult.data.jobId;

    const queued = await getUsageLogsExportStatus(jobId);
    expect(queued.ok).toBe(true);
    if (!queued.ok) throw new Error("status failed");
    expect(queued.data.format).toBe("xlsx");

    await vi.runAllTimersAsync();

    const completed = await getUsageLogsExportStatus(jobId);
    expect(completed.ok && completed.data.status).toBe("completed");

    const download = await downloadUsageLogsExport(jobId);
    expect(download.ok).toBe(true);
    if (!download.ok) throw new Error("download failed");
    expect(download.data.format).toBe("xlsx");
    expect(download.data.encoding).toBe("base64");
    expect(download.data.filename).toMatch(/\.xlsx$/);

    const bytes = Buffer.from(download.data.content, "base64");
    // PK zip signature
    expect(bytes[0]).toBe(0x50);
    expect(bytes[1]).toBe(0x4b);

    const files = unzipSync(new Uint8Array(bytes));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining(["xl/worksheets/sheet1.xml", "xl/worksheets/sheet2.xml"])
    );
    const sheet1 = strFromU8(files["xl/worksheets/sheet1.xml"]);
    // 01:00 UTC -> 09:00 Asia/Shanghai, header carries the timezone
    expect(sheet1).toContain("Time (Asia/Shanghai)");
    // cost rendered as a numeric cell, normalized
    expect(sheet1).toContain("<v>1.5</v>");
  });

  test("sync export rejects xlsx (async job only)", async () => {
    const { exportUsageLogs } = await import("@/actions/usage-logs");
    const result = await exportUsageLogs({ format: "xlsx" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected rejection");
    expect(result.error).toMatch(/XLSX/);
  });

  test("sync csv export returns CSV text", async () => {
    findUsageLogsBatchMock.mockResolvedValueOnce({
      logs: [log()],
      nextCursor: null,
      hasMore: false,
    });
    const { exportUsageLogs } = await import("@/actions/usage-logs");
    const result = await exportUsageLogs({ format: "csv" });
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error("export failed");
    expect(result.data).toContain("Session ID");
    expect(result.data.startsWith("﻿")).toBe(true);
  });
});
