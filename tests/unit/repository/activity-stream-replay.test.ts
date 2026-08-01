import { PgDialect } from "drizzle-orm/pg-core";
import { afterEach, describe, expect, it, vi } from "vitest";

const activeSessionIdsMock = vi.fn<() => Promise<string[]>>();

vi.mock("@/lib/session-tracker", () => ({
  SessionTracker: {
    getObservedActiveSessions: activeSessionIdsMock,
  },
}));

function installDbBoundary(rows: readonly unknown[] | readonly (readonly unknown[])[]) {
  const whereConditions: unknown[] = [];
  let selectIndex = 0;
  const select = vi.fn(() => {
    const selectedRows = Array.isArray(rows[0])
      ? ((rows as readonly (readonly unknown[])[])[selectIndex++] ?? [])
      : (rows as readonly unknown[]);
    const query = {
      from: vi.fn(() => query),
      leftJoin: vi.fn(() => query),
      where: vi.fn((condition: unknown) => {
        whereConditions.push(condition);
        return query;
      }),
      orderBy: vi.fn(() => query),
      limit: vi.fn(async () => selectedRows),
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

  it("matches observed Sessions only through the canonical identity", async () => {
    activeSessionIdsMock.mockResolvedValueOnce(["pfx:scope:fingerprint"]);
    const boundary = installDbBoundary([
      { ...REQUEST_ROW, sessionId: "pfx:scope:fingerprint", rowNum: 1 },
    ]);
    const { findRecentActivityStream } = await import("@/repository/activity-stream");

    await findRecentActivityStream(1);

    const condition = new PgDialect().sqlToQuery(boundary.whereConditions[0] as never);
    const normalizedSql = condition.sql.toLowerCase();
    expect(normalizedSql).toContain(
      'coalesce("message_request"."session_identity", "message_request"."session_id") in'
    );
    expect(normalizedSql).not.toContain('or "message_request"."session_id" in');
    expect(activeSessionIdsMock).toHaveBeenCalledOnce();
  });

  it("does not exclude fallback rows through the physical session ID", async () => {
    activeSessionIdsMock.mockResolvedValueOnce(["pfx:scope:fingerprint"]);
    const boundary = installDbBoundary([
      [{ ...REQUEST_ROW, sessionId: "pfx:scope:fingerprint", rowNum: 1 }],
      [],
    ]);
    const { findRecentActivityStream } = await import("@/repository/activity-stream");

    await findRecentActivityStream(2);

    const condition = new PgDialect().sqlToQuery(boundary.whereConditions[1] as never);
    expect(condition.sql.toLowerCase()).toContain("coalesce");
    expect(condition.sql).not.toContain('and "message_request"."session_id" not in');
  });
});
