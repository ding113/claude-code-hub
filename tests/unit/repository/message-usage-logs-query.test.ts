import { beforeEach, describe, expect, test, vi } from "vitest";
import { messageRequest, usageLedger } from "@/drizzle/schema";
import { findUsageLogs } from "@/repository/message";
import { createDrizzleQuery, sqlText } from "./message-query-test-support";

const boundary = vi.hoisted(() => {
  const writerDb = { execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>() };
  return {
    select: vi.fn<(selection?: unknown) => unknown>(),
    execute: vi.fn<(query: unknown) => Promise<readonly unknown[]>>(),
    ledgerOnly: vi.fn<() => Promise<boolean>>(),
    getWriterDb: vi.fn(() => writerDb),
  };
});

vi.mock("@/drizzle/db", () => ({
  db: { select: boundary.select, execute: boundary.execute },
  getMessageWriterDb: boundary.getWriterDb,
}));
vi.mock("@/lib/config/env.schema", () => ({
  getEnvConfig: () => ({ MESSAGE_REQUEST_WRITE_MODE: "sync" }),
  isDevelopment: () => false,
}));
vi.mock("@/lib/ledger-fallback", () => ({ isLedgerOnlyMode: boundary.ledgerOnly }));

type MessageRow = typeof messageRequest.$inferSelect;
type PrimaryRow = Pick<
  MessageRow,
  | "id"
  | "providerId"
  | "userId"
  | "key"
  | "model"
  | "durationMs"
  | "costUsd"
  | "costMultiplier"
  | "sessionId"
  | "requestSequence"
  | "statusCode"
  | "inputTokens"
  | "outputTokens"
  | "cacheTtlApplied"
  | "createdAt"
  | "updatedAt"
  | "deletedAt"
>;

const createdAt = new Date("2026-05-03T12:00:00.000Z");
const updatedAt = new Date("2026-05-03T12:00:01.000Z");
const primaryRow = {
  id: 41,
  providerId: 7,
  userId: 9,
  key: "key-primary",
  model: "model-primary",
  durationMs: 120,
  costUsd: "0.125000000000",
  costMultiplier: "1.5",
  sessionId: "session-primary",
  requestSequence: 4,
  statusCode: 200,
  inputTokens: 80,
  outputTokens: 20,
  cacheTtlApplied: "1h",
  createdAt,
  updatedAt,
  deletedAt: null,
} satisfies PrimaryRow;

describe("message repository findUsageLogs", () => {
  beforeEach(() => {
    boundary.select.mockReset();
    boundary.execute.mockReset();
    boundary.ledgerOnly.mockReset();
  });

  test("returns primary message logs with filters and offset pagination", async () => {
    const count = createDrizzleQuery([{ count: 7 }]);
    const rows = createDrizzleQuery([primaryRow]);
    boundary.select.mockReturnValueOnce(count).mockReturnValueOnce(rows);

    const result = await findUsageLogs({
      userId: 9,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-04T00:00:00.000Z"),
      model: "model-primary",
      page: 3,
      pageSize: 25,
    });

    expect(result.total).toBe(7);
    expect(result.logs).toEqual([
      expect.objectContaining({
        id: 41,
        providerId: 7,
        userId: 9,
        model: "model-primary",
        costUsd: "0.125000000000000",
        costMultiplier: 1.5,
        sessionId: "session-primary",
        requestSequence: 4,
        cacheTtlApplied: "1h",
        createdAt,
        updatedAt,
      }),
    ]);
    expect(count.trace.from).toEqual([messageRequest]);
    expect(rows.trace.from).toEqual([messageRequest]);
    expect(sqlText(rows.trace.where)).toContain("deleted_at");
    expect(sqlText(rows.trace.where)).toContain("2026-05-01t00:00:00.000z");
    expect(sqlText(rows.trace.where)).toContain("model-primary");
    expect(sqlText(rows.trace.orderBy)).toContain("created_at desc");
    expect(rows.trace.limit).toEqual([25]);
    expect(rows.trace.offset).toEqual([50]);
    expect(boundary.ledgerOnly).not.toHaveBeenCalled();
  });

  test("returns the empty primary page when ledger fallback mode is disabled", async () => {
    const count = createDrizzleQuery<readonly { readonly count: number }[]>([]);
    const rows = createDrizzleQuery<readonly PrimaryRow[]>([]);
    boundary.select.mockReturnValueOnce(count).mockReturnValueOnce(rows);
    boundary.ledgerOnly.mockResolvedValueOnce(false);

    const result = await findUsageLogs({});

    expect(result).toEqual({ logs: [], total: 0 });
    expect(boundary.select).toHaveBeenCalledTimes(2);
    expect(boundary.ledgerOnly).toHaveBeenCalledOnce();
  });

  test("falls back to ledger rows with equivalent filters and pagination", async () => {
    const primaryCount = createDrizzleQuery([{ count: 0 }]);
    const primaryRows = createDrizzleQuery<readonly PrimaryRow[]>([]);
    const ledgerCount = createDrizzleQuery([{ count: 3 }]);
    const ledgerRows = createDrizzleQuery([
      {
        requestId: 88,
        finalProviderId: 12,
        userId: 9,
        key: "key-ledger",
        model: "model-ledger",
        originalModel: "model-original",
        endpoint: "/v1/messages",
        statusCode: 201,
        costUsd: "0.750000000000",
        costMultiplier: "1.25",
        inputTokens: 90,
        outputTokens: 30,
        cacheCreationInputTokens: 10,
        cacheReadInputTokens: 15,
        cacheCreation5mInputTokens: 4,
        cacheCreation1hInputTokens: 6,
        cacheTtlApplied: "mixed",
        context1mApplied: true,
        swapCacheTtlApplied: false,
        durationMs: 250,
        ttfbMs: 40,
        sessionId: "session-ledger",
        createdAt,
      },
    ]);
    boundary.select
      .mockReturnValueOnce(primaryCount)
      .mockReturnValueOnce(primaryRows)
      .mockReturnValueOnce(ledgerCount)
      .mockReturnValueOnce(ledgerRows);
    boundary.ledgerOnly.mockResolvedValueOnce(true);

    const result = await findUsageLogs({
      userId: 9,
      startDate: new Date("2026-05-01T00:00:00.000Z"),
      endDate: new Date("2026-05-04T00:00:00.000Z"),
      model: "model-ledger",
      page: 2,
      pageSize: 10,
    });

    expect(result.total).toBe(3);
    expect(result.logs).toEqual([
      expect.objectContaining({
        id: 88,
        providerId: 12,
        key: "key-ledger",
        model: "model-ledger",
        originalModel: "model-original",
        sessionId: "session-ledger",
        userAgent: null,
        costMultiplier: 1.25,
        cacheTtlApplied: "mixed",
        createdAt,
        updatedAt: createdAt,
      }),
    ]);
    expect(ledgerCount.trace.from).toEqual([usageLedger]);
    expect(ledgerRows.trace.from).toEqual([usageLedger]);
    expect(sqlText(ledgerRows.trace.where)).toContain("blocked_by");
    expect(sqlText(ledgerRows.trace.where)).toContain("model-ledger");
    expect(sqlText(ledgerRows.trace.orderBy)).toContain("created_at desc");
    expect(sqlText(ledgerRows.trace.orderBy)).toContain("request_id desc");
    expect(ledgerRows.trace.limit).toEqual([10]);
    expect(ledgerRows.trace.offset).toEqual([10]);
  });
});
