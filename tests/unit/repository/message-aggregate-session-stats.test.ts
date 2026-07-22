import { beforeEach, describe, expect, test, vi } from "vitest";
import { keys as keysTable, messageRequest, providers, usageLedger, users } from "@/drizzle/schema";
import { aggregateSessionStats } from "@/repository/message";
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

type UserInfoRow = {
  readonly userName: string;
  readonly userId: number;
  readonly keyName: string;
  readonly keyId: number;
  readonly userAgent: string | null;
  readonly apiType: string | null;
};

const firstRequestAt = new Date("2026-05-01T10:00:00.000Z");
const lastRequestAt = new Date("2026-05-01T10:05:00.000Z");
const statsRow = {
  requestCount: 2,
  totalCostUsd: "1.250000000000",
  totalInputTokens: 120,
  totalOutputTokens: 45,
  totalCacheCreationTokens: 30,
  totalCacheReadTokens: 70,
  totalDurationMs: 900,
  firstRequestAt,
  lastRequestAt,
} satisfies StatsRow;
const userInfoRow = {
  userName: "Ada",
  userId: 17,
  keyName: "analytics-key",
  keyId: 23,
  userAgent: "claude-cli/1.0",
  apiType: "claude",
} satisfies UserInfoRow;

function queuePopulatedAggregate(
  cacheTtls: readonly (string | null)[],
  userRows: readonly UserInfoRow[] = [userInfoRow]
) {
  const stats = createDrizzleQuery([statsRow]);
  const providerList = createDrizzleQuery([
    { providerId: 11, providerName: null },
    { providerId: 12, providerName: "Provider Twelve" },
  ]);
  const modelList = createDrizzleQuery([{ model: "model-a" }, { model: "model-b" }]);
  const cacheTtlList = createDrizzleQuery(cacheTtls.map((cacheTtl) => ({ cacheTtl })));
  const userInfo = createDrizzleQuery(userRows);

  boundary.select.mockReturnValueOnce(stats).mockReturnValueOnce(userInfo);
  boundary.selectDistinct
    .mockReturnValueOnce(providerList)
    .mockReturnValueOnce(modelList)
    .mockReturnValueOnce(cacheTtlList);

  return { stats, providerList, modelList, cacheTtlList, userInfo };
}

describe("message repository aggregateSessionStats", () => {
  beforeEach(() => {
    boundary.select.mockReset();
    boundary.selectDistinct.mockReset();
    boundary.execute.mockReset();
    boundary.ledgerOnly.mockReset();
  });

  test("returns null when the session has no billable ledger rows", async () => {
    const stats = createDrizzleQuery<readonly StatsRow[]>([]);
    boundary.select.mockReturnValueOnce(stats);

    const result = await aggregateSessionStats("session-empty");

    expect(result).toBeNull();
    expect(stats.trace.from).toEqual([usageLedger]);
    expect(sqlText(stats.trace.where)).toContain("session-empty");
    expect(sqlText(stats.trace.where)).toContain("blocked_by");
    expect(boundary.selectDistinct).not.toHaveBeenCalled();
  });

  test("returns populated statistics and preserves a single cache TTL", async () => {
    const queries = queuePopulatedAggregate(["1h"]);

    const result = await aggregateSessionStats("session-populated");

    expect(result).toEqual({
      sessionId: "session-populated",
      requestCount: 2,
      totalCostUsd: "1.250000000000",
      totalInputTokens: 120,
      totalOutputTokens: 45,
      totalCacheCreationTokens: 30,
      totalCacheReadTokens: 70,
      totalDurationMs: 900,
      firstRequestAt,
      lastRequestAt,
      providers: [
        { id: 11, name: "Provider #11" },
        { id: 12, name: "Provider Twelve" },
      ],
      models: ["model-a", "model-b"],
      userName: "Ada",
      userId: 17,
      keyName: "analytics-key",
      keyId: 23,
      userAgent: "claude-cli/1.0",
      apiType: "claude",
      cacheTtlApplied: "1h",
    });
    expect(queries.providerList.trace.from).toEqual([usageLedger]);
    expect(queries.providerList.trace.leftJoins.map(({ source }) => source)).toEqual([providers]);
    expect(queries.modelList.trace.from).toEqual([usageLedger]);
    expect(queries.cacheTtlList.trace.from).toEqual([usageLedger]);
    expect(queries.userInfo.trace.from).toEqual([messageRequest]);
    expect(queries.userInfo.trace.innerJoins.map(({ source }) => source)).toEqual([
      users,
      keysTable,
    ]);
    expect(queries.userInfo.trace.limit).toEqual([1]);
  });

  test("returns a null cache TTL when the aggregate row contains only null TTL values", async () => {
    queuePopulatedAggregate([null]);

    const result = await aggregateSessionStats("session-null-ttl");

    expect(result).toMatchObject({ cacheTtlApplied: null });
  });

  test("returns mixed when the session contains multiple cache TTL values", async () => {
    queuePopulatedAggregate(["5m", "1h"]);

    const result = await aggregateSessionStats("session-mixed-ttl");

    expect(result).toMatchObject({ cacheTtlApplied: "mixed" });
  });

  test("returns null when billable stats exist without a corresponding session owner", async () => {
    queuePopulatedAggregate(["5m"], []);

    const result = await aggregateSessionStats("session-without-owner");

    expect(result).toBeNull();
  });
});
