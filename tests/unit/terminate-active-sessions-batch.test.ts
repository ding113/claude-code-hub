import { describe, expect, test } from "vitest";
import {
  type AggregateSessionStatsEntry,
  summarizeTerminateSessionsBatch,
} from "@/actions/active-sessions-utils";

let sessionIndex = 0;

function buildSessionEntry(
  overrides: Partial<AggregateSessionStatsEntry>
): AggregateSessionStatsEntry {
  const sessionId = overrides.sessionId ?? `session-${sessionIndex++}`;
  return {
    sessionId,
    requestCount: overrides.requestCount ?? 1,
    totalCostUsd: overrides.totalCostUsd ?? "0",
    totalInputTokens: overrides.totalInputTokens ?? 0,
    totalOutputTokens: overrides.totalOutputTokens ?? 0,
    totalCacheCreationTokens: overrides.totalCacheCreationTokens ?? 0,
    totalCacheReadTokens: overrides.totalCacheReadTokens ?? 0,
    totalDurationMs: overrides.totalDurationMs ?? 0,
    firstRequestAt: overrides.firstRequestAt ?? null,
    lastRequestAt: overrides.lastRequestAt ?? null,
    providers: overrides.providers ?? [],
    models: overrides.models ?? [],
    userName: overrides.userName ?? "user",
    userId: overrides.userId ?? 1,
    keyName: overrides.keyName ?? "default-key",
    keyId: overrides.keyId ?? 1,
    userAgent: overrides.userAgent ?? null,
    apiType: overrides.apiType ?? "chat",
  };
}

describe("Session 批量终止摘要", () => {
  test("普通用户应该正确分类允许/未授权/缺失的 Session", () => {
    const requestedIds = ["sess-1", "sess-1", "sess-2", "sess-3"];
    const sessionsData = [
      buildSessionEntry({ sessionId: "sess-1", userId: 10 }),
      buildSessionEntry({ sessionId: "sess-2", userId: 99 }),
    ];

    const summary = summarizeTerminateSessionsBatch(requestedIds, sessionsData, 10, false);

    expect(summary.uniqueRequestedIds).toEqual(["sess-1", "sess-2", "sess-3"]);
    expect(summary.allowedSessionIds).toEqual(["sess-1"]);
    expect(summary.unauthorizedSessionIds).toEqual(["sess-2"]);
    expect(summary.missingSessionIds).toEqual(["sess-3"]);
  });

  test("管理员应该对所有找到的 Session 有权限（仍追踪缺失的）", () => {
    const requestedIds = ["sess-4", "sess-5"];
    const sessionsData = [buildSessionEntry({ sessionId: "sess-4", userId: 200 })];

    const summary = summarizeTerminateSessionsBatch(requestedIds, sessionsData, 1, true);

    expect(summary.allowedSessionIds).toEqual(["sess-4"]);
    expect(summary.unauthorizedSessionIds).toEqual([]);
    expect(summary.missingSessionIds).toEqual(["sess-5"]);
  });
});
