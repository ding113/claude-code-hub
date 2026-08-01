import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const activeSessionIdsMock = vi.fn<() => Promise<string[]>>();

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getActiveSessions: activeSessionIdsMock,
  },
}));

function installDbBoundary(rows: readonly unknown[]) {
  const whereConditions: unknown[] = [];
  const select = vi.fn(() => {
    const query = {
      from: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn((condition: unknown) => {
        whereConditions.push(condition);
        return query;
      }),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => rows),
    };
    return query;
  });

  vi.doMock("@/drizzle/db", () => ({ db: { select } }));
  return { whereConditions };
}

function expectReplayExcluded(condition: unknown) {
  const query = new PgDialect().sqlToQuery(condition as never);
  expect(query.sql).toContain('"message_request"."is_replay" = $');
  expect(query.params).toContain(false);
}

const REQUEST_ROW = {
  id: 1,
  sessionId: "session-1",
  userName: "user",
  userId: 1,
  keyId: 2,
  keyName: "key",
  providerId: 3,
  providerName: "provider",
  model: "model",
  originalModel: "model",
  statusCode: 200,
  durationMs: 100,
  costUsd: "0.01",
  createdAt: new Date("2026-08-01T00:00:00.000Z"),
  inputTokens: 1,
  outputTokens: 1,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

describe("activity stream Replay exclusion", () => {
  afterEach(() => {
    vi.doUnmock("@/drizzle/db");
    vi.resetModules();
  });

  it("excludes Replay rows when resolving active Sessions", async () => {
    activeSessionIdsMock.mockResolvedValueOnce(["session-1"]);
    const boundary = installDbBoundary([{ ...REQUEST_ROW, rowNum: 1 }]);
    const { findRecentActivityStream } = await import("@/repository/activity-stream");

    await findRecentActivityStream(1);

    expectReplayExcluded(boundary.whereConditions[0]);
  });

  it("excludes Replay rows from the recent-request fallback", async () => {
    activeSessionIdsMock.mockResolvedValueOnce([]);
    const boundary = installDbBoundary([REQUEST_ROW]);
    const { findRecentActivityStream } = await import("@/repository/activity-stream");

    await findRecentActivityStream(1);

    expectReplayExcluded(boundary.whereConditions[0]);
  });
});
