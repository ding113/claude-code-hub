import { describe, expect, test } from "vitest";
import type { UsageLogRow } from "@/repository/usage-logs";
import { buildUsageLogsSummary } from "@/lib/usage-logs/export/summary";

function makeLog(overrides: Partial<UsageLogRow> = {}): UsageLogRow {
  return {
    id: 1,
    createdAt: new Date("2026-06-03T12:00:00.000Z"),
    sessionId: "s1",
    requestSequence: 1,
    userName: "alice",
    keyName: "key-1",
    providerName: "anthropic",
    model: "claude",
    originalModel: null,
    actualResponseModel: null,
    endpoint: "/v1/messages",
    statusCode: 200,
    inputTokens: 10,
    outputTokens: 20,
    cacheCreationInputTokens: 0,
    cacheReadInputTokens: 5,
    cacheCreation5mInputTokens: 1,
    cacheCreation1hInputTokens: 2,
    cacheTtlApplied: null,
    totalTokens: 38,
    costUsd: "0.5",
    costMultiplier: null,
    groupCostMultiplier: null,
    costBreakdown: null,
    durationMs: 100,
    ttfbMs: null,
    errorMessage: null,
    providerChain: null,
    blockedBy: null,
    blockedReason: null,
    userAgent: null,
    clientIp: null,
    messagesCount: null,
    context1mApplied: null,
    swapCacheTtlApplied: null,
    specialSettings: null,
    ...overrides,
  };
}

describe("buildUsageLogsSummary", () => {
  test("single-day data is bucketed by hour (in the system timezone)", () => {
    const logs = [
      // 12:00 UTC -> 20:00 Asia/Shanghai
      makeLog({ createdAt: new Date("2026-06-03T12:00:00.000Z"), costUsd: "0.5" }),
      makeLog({ createdAt: new Date("2026-06-03T12:30:00.000Z"), costUsd: "0.5" }),
      // 13:10 UTC -> 21:10 Asia/Shanghai
      makeLog({ createdAt: new Date("2026-06-03T13:10:00.000Z"), costUsd: "1" }),
    ];
    const summary = buildUsageLogsSummary(logs, "Asia/Shanghai");

    expect(summary.granularity).toBe("hourly");
    expect(summary.rows.map((r) => r.period)).toEqual(["2026-06-03 20:00", "2026-06-03 21:00"]);
    expect(summary.rows[0].requests).toBe(2);
    expect(summary.rows[0].cost).toBeCloseTo(1, 10);
    expect(summary.rows[1].requests).toBe(1);
    expect(summary.total.requests).toBe(3);
    expect(summary.total.cost).toBeCloseTo(2, 10);
    expect(summary.total.inputTokens).toBe(30);
    expect(summary.total.totalTokens).toBe(114);
  });

  test("multi-day data is bucketed by day", () => {
    const logs = [
      makeLog({ createdAt: new Date("2026-06-03T12:00:00.000Z") }),
      makeLog({ createdAt: new Date("2026-06-04T12:00:00.000Z") }),
      makeLog({ createdAt: new Date("2026-06-04T18:00:00.000Z") }),
    ];
    const summary = buildUsageLogsSummary(logs, "UTC");

    expect(summary.granularity).toBe("daily");
    expect(summary.rows.map((r) => r.period)).toEqual(["2026-06-03", "2026-06-04"]);
    expect(summary.rows[1].requests).toBe(2);
    expect(summary.total.requests).toBe(3);
  });

  test("day boundaries follow the timezone, not UTC", () => {
    // 23:30 UTC on 06-03 is 07:30 on 06-04 in Asia/Shanghai -> two distinct days
    const logs = [
      makeLog({ createdAt: new Date("2026-06-03T12:00:00.000Z") }),
      makeLog({ createdAt: new Date("2026-06-03T23:30:00.000Z") }),
    ];
    const summary = buildUsageLogsSummary(logs, "Asia/Shanghai");
    expect(summary.granularity).toBe("daily");
    expect(summary.rows.map((r) => r.period)).toEqual(["2026-06-03", "2026-06-04"]);
  });

  test("empty input yields a zeroed total and no rows", () => {
    const summary = buildUsageLogsSummary([], "UTC");
    expect(summary.granularity).toBe("hourly");
    expect(summary.rows).toEqual([]);
    expect(summary.total.requests).toBe(0);
    expect(summary.total.cost).toBe(0);
  });
});
