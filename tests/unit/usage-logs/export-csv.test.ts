import { describe, expect, test } from "vitest";
import type { UsageLogRow } from "@/repository/usage-logs";
import { buildCsvHeaderLine, buildCsvRows, escapeCsvField } from "@/lib/usage-logs/export/csv";
import { buildDetailHeaders } from "@/lib/usage-logs/export/columns";

function makeLog(overrides: Partial<UsageLogRow> = {}): UsageLogRow {
  return {
    id: 1,
    createdAt: new Date("2026-06-03T12:34:56.000Z"),
    sessionId: "s1",
    requestSequence: 1,
    userName: "alice",
    keyName: "key-1",
    providerName: "anthropic",
    model: "claude",
    originalModel: "claude-orig",
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
    costUsd: "1.500000000000000",
    costMultiplier: null,
    groupCostMultiplier: null,
    costBreakdown: null,
    durationMs: 123,
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

const HEADER = buildDetailHeaders("UTC");
const TIME_IDX = 0;
const STATUS_IDX = HEADER.indexOf("Status Code");
const COST_IDX = HEADER.indexOf("Cost (USD)");
const DURATION_IDX = HEADER.indexOf("Duration (ms)");

describe("buildCsvHeaderLine", () => {
  test("annotates the time column with the timezone", () => {
    expect(buildCsvHeaderLine("Asia/Shanghai").split(",")[TIME_IDX]).toBe("Time (Asia/Shanghai)");
    expect(buildCsvHeaderLine("UTC").split(",")[TIME_IDX]).toBe("Time (UTC)");
  });
});

describe("buildCsvRows", () => {
  test("renders the timestamp in the requested timezone (no UTC Z suffix)", () => {
    const [row] = buildCsvRows([makeLog()], "Asia/Shanghai");
    const cells = row.split(",");
    // 12:34:56 UTC -> 20:34:56 in Asia/Shanghai (+08:00)
    expect(cells[TIME_IDX]).toBe("2026-06-03 20:34:56");
    expect(cells[TIME_IDX]).not.toContain("Z");
  });

  test("normalizes the cost so Excel reads it as a number (trailing zeros gone)", () => {
    const [row] = buildCsvRows([makeLog({ costUsd: "1.500000000000000" })], "UTC");
    expect(row.split(",")[COST_IDX]).toBe("1.5");
  });

  test("caps 16-significant-digit costs to Excel's 15-digit ceiling", () => {
    const [row] = buildCsvRows([makeLog({ costUsd: "1.234567890123456" })], "UTC");
    expect(row.split(",")[COST_IDX]).toBe("1.23456789012346");
  });

  test("blank status code / duration stay blank; null cost becomes 0", () => {
    const [row] = buildCsvRows(
      [makeLog({ statusCode: null, durationMs: null, costUsd: null })],
      "UTC"
    );
    const cells = row.split(",");
    expect(cells[STATUS_IDX]).toBe("");
    expect(cells[DURATION_IDX]).toBe("");
    expect(cells[COST_IDX]).toBe("0");
  });

  test("null timestamp renders as an empty cell", () => {
    const [row] = buildCsvRows([makeLog({ createdAt: null })], "UTC");
    expect(row.split(",")[TIME_IDX]).toBe("");
  });

  test("invalid Date timestamp renders empty (no RangeError crash)", () => {
    const [row] = buildCsvRows([makeLog({ createdAt: new Date(Number.NaN) })], "UTC");
    expect(row.split(",")[TIME_IDX]).toBe("");
  });

  test("retry count is derived from the provider chain", () => {
    const retryIdx = HEADER.indexOf("Retry Count");
    const [row] = buildCsvRows(
      [
        makeLog({
          providerChain: [
            { reason: "initial_selection" },
            { reason: "retry_failed", attemptNumber: 1 },
            { reason: "retry_success", statusCode: 200, attemptNumber: 1 },
          ] as UsageLogRow["providerChain"],
        }),
      ],
      "UTC"
    );
    expect(row.split(",")[retryIdx]).toBe("1");
  });
});

describe("escapeCsvField", () => {
  test("neutralizes formula injection regardless of leading whitespace", () => {
    expect(escapeCsvField("=1+1")).toBe("'=1+1");
    // a tab does not trigger CSV quoting, so only the leading-quote guard applies
    expect(escapeCsvField(" \t@SUM(A1:A2)")).toBe("' \t@SUM(A1:A2)");
    expect(escapeCsvField("+2+2")).toBe("'+2+2");
  });

  test("quotes fields containing commas or quotes", () => {
    expect(escapeCsvField("a,b")).toBe('"a,b"');
    expect(escapeCsvField('a"b')).toBe('"a""b"');
    expect(escapeCsvField("plain")).toBe("plain");
  });
});
