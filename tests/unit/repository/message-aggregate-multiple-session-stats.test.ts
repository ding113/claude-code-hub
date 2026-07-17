import { beforeEach, describe, expect, test, vi } from "vitest";
import { providers, usageLedger } from "@/drizzle/schema";
import { aggregateMultipleSessionStats } from "@/repository/message";
import { createDrizzleQuery, sqlText } from "./message-query-test-support";

const boundary = vi.hoisted(() => {
  const writerDb = { execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>() };
  return {
    select: vi.fn<(selection?: unknown) => unknown>(),
    selectDistinct: vi.fn<(selection?: unknown) => unknown>(),
    execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>(),
    ledgerOnly: vi.fn<() => Promise<boolean>>(),
    getWriterDb: vi.fn(() => writerDb),
  };
});

vi.mock("@/drizzle/db", () => ({
  db: {
    select: boundary.select,
    selectDistinct: boundary.selectDistinct,
    execute: boundary.execute,
  },
  getMessageWriterDb: boundary.getWriterDb,
}));
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" }),
  isDevelopment: () => false,
}));
vi.mock("@/lib/ledger-fallback", () => ({ isLedgerOnlyMode: boundary.ledgerOnly }));

type StatsRow = {
  readonly sessionId: string;
  readonly requestCount: number;
  readonly totalCostUsd: string;
  readonly totalInputTokens: number;
  readonly totalOutputTokens: number;
  readonly totalCacheCreationTokens: number;
  readonly totalCacheReadTokens: number;
  readonly totalDurationMs: number;
  readonly firstRequestAt: Date;
  readonly lastRequestAt: Date;
};

const firstRequestAt = new Date("2026-05-02T08:00:00.000Z");
const lastRequestAt = new Date("2026-05-02T09:00:00.000Z");

function statsRow(sessionId: string, ordinal: number): StatsRow {
  return {
    sessionId,
    requestCount: ordinal,
    totalCostUsd: `${ordinal}.000000000000`,
    totalInputTokens: ordinal * 10,
    totalOutputTokens: ordinal * 5,
    totalCacheCreationTokens: ordinal * 3,
    totalCacheReadTokens: ordinal * 7,
    totalDurationMs: ordinal * 100,
    firstRequestAt,
    lastRequestAt,
  };
}

describe("message repository aggregateMultipleSessionStats", () => {
  beforeEach(() => {
    boundary.select.mockReset();
    boundary.selectDistinct.mockReset();
    boundary.execute.mockReset();
    boundary.ledgerOnly.mockReset();
  });

  test("returns an empty batch without querying the database", async () => {
    const result = await aggregateMultipleSessionStats([]);

    expect(result).toEqual([]);
    expect(boundary.select).not.toHaveBeenCalled();
    expect(boundary.selectDistinct).not.toHaveBeenCalled();
    expect(boundary.execute).not.toHaveBeenCalled();
  });

  test("groups related rows and returns sessions in requested order", async () => {
    const stats = createDrizzleQuery([
      statsRow("session-a", 1),
      statsRow("session-b", 2),
      statsRow("session-without-owner", 3),
    ]);
    const providerList = createDrizzleQuery([
      { sessionId: "session-b", providerId: 21, providerName: "Provider B1" },
      { sessionId: "session-a", providerId: 11, providerName: null },
      { sessionId: "session-b", providerId: 22, providerName: "Provider B2" },
      { sessionId: null, providerId: 99, providerName: "Ignored" },
    ]);
    const modelList = createDrizzleQuery([
      { sessionId: "session-a", model: "model-a" },
      { sessionId: "session-b", model: "model-b1" },
      { sessionId: "session-b", model: "model-b2" },
    ]);
    const cacheTtlList = createDrizzleQuery([
      { sessionId: "session-b", cacheTtl: "5m" },
      { sessionId: "session-b", cacheTtl: "1h" },
      { sessionId: "session-a", cacheTtl: null },
    ]);

    boundary.select.mockReturnValueOnce(stats);
    boundary.selectDistinct
      .mockReturnValueOnce(providerList)
      .mockReturnValueOnce(modelList)
      .mockReturnValueOnce(cacheTtlList);
    boundary.execute.mockResolvedValueOnce([
      {
        session_id: "session-a",
        user_name: "Alice",
        user_id: 1,
        key_name: "Key A",
        key_id: 101,
        user_agent: null,
        api_type: "claude",
      },
      {
        session_id: "session-b",
        user_name: "Bob",
        user_id: 2,
        key_name: "Key B",
        key_id: 202,
        user_agent: "codex-cli/1.0",
        api_type: "codex",
      },
    ]);

    const result = await aggregateMultipleSessionStats([
      "session-b",
      "session-without-owner",
      "session-a",
    ]);

    expect(result).toEqual([
      {
        sessionId: "session-b",
        requestCount: 2,
        totalCostUsd: "2.000000000000",
        totalInputTokens: 20,
        totalOutputTokens: 10,
        totalCacheCreationTokens: 6,
        totalCacheReadTokens: 14,
        totalDurationMs: 200,
        firstRequestAt,
        lastRequestAt,
        providers: [
          { id: 21, name: "Provider B1" },
          { id: 22, name: "Provider B2" },
        ],
        models: ["model-b1", "model-b2"],
        userName: "Bob",
        userId: 2,
        keyName: "Key B",
        keyId: 202,
        userAgent: "codex-cli/1.0",
        apiType: "codex",
        cacheTtlApplied: "mixed",
      },
      {
        sessionId: "session-a",
        requestCount: 1,
        totalCostUsd: "1.000000000000",
        totalInputTokens: 10,
        totalOutputTokens: 5,
        totalCacheCreationTokens: 3,
        totalCacheReadTokens: 7,
        totalDurationMs: 100,
        firstRequestAt,
        lastRequestAt,
        providers: [{ id: 11, name: "Provider #11" }],
        models: ["model-a"],
        userName: "Alice",
        userId: 1,
        keyName: "Key A",
        keyId: 101,
        userAgent: null,
        apiType: "claude",
        cacheTtlApplied: null,
      },
    ]);
    expect(stats.trace.from).toEqual([usageLedger]);
    expect(sqlText(stats.trace.where)).toContain("session-without-owner");
    expect(sqlText(stats.trace.groupBy)).toContain("session_id");
    expect(providerList.trace.leftJoins.map(({ source }) => source)).toEqual([providers]);
    expect(modelList.trace.from).toEqual([usageLedger]);
    expect(cacheTtlList.trace.from).toEqual([usageLedger]);
    expect(sqlText(boundary.execute.mock.calls.at(0)?.at(0))).toContain("unnest");
    expect(sqlText(boundary.execute.mock.calls.at(0)?.at(0))).toContain("order by created_at");
  });
});
