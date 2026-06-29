import { strFromU8, unzipSync } from "fflate";
import { describe, expect, test } from "vitest";
import type { UsageLogRow } from "@/repository/usage-logs";
import { buildUsageLogsXlsx, columnRef } from "@/lib/usage-logs/export/xlsx";

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
    reasoningOutputTokens: 8,
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

function unzip(bytes: Uint8Array): Record<string, string> {
  const files = unzipSync(bytes);
  const out: Record<string, string> = {};
  for (const [name, content] of Object.entries(files)) {
    out[name] = strFromU8(content);
  }
  return out;
}

/** Extract the inner XML of a cell by its A1 reference. */
function cell(sheetXml: string, ref: string): string | null {
  const match = sheetXml.match(new RegExp(`<c r="${ref}"[^>]*?(?:/>|>(.*?)</c>)`));
  if (!match) return null;
  return match[0];
}

const COST_COL = columnRef(15); // P
const TIME_COL = columnRef(0); // A
const MODEL_COL = columnRef(4); // E
const STATUS_COL = columnRef(7); // H

describe("buildUsageLogsXlsx", () => {
  test("includes reasoning tokens in the detail header", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog()], "UTC"));
    expect(files["xl/worksheets/sheet1.xml"]).toContain("Reasoning Tokens");
  });

  test("produces a valid two-sheet workbook package", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog()], "UTC"));
    expect(Object.keys(files)).toEqual(
      expect.arrayContaining([
        "[Content_Types].xml",
        "_rels/.rels",
        "xl/workbook.xml",
        "xl/_rels/workbook.xml.rels",
        "xl/styles.xml",
        "xl/worksheets/sheet1.xml",
        "xl/worksheets/sheet2.xml",
      ])
    );
    expect(files["xl/workbook.xml"]).toContain('name="Usage Logs"');
  });

  test("cost is a numeric cell (not text) and normalized for Excel", async () => {
    const files = unzip(
      await buildUsageLogsXlsx([makeLog({ costUsd: "1.500000000000000" })], "UTC")
    );
    const costCell = cell(files["xl/worksheets/sheet1.xml"], `${COST_COL}2`) ?? "";
    expect(costCell).toContain("<v>1.5</v>");
    expect(costCell).not.toContain("inlineStr");
  });

  test("16-significant-digit cost is capped to 15 digits", async () => {
    const files = unzip(
      await buildUsageLogsXlsx([makeLog({ costUsd: "1.234567890123456" })], "UTC")
    );
    const costCell = cell(files["xl/worksheets/sheet1.xml"], `${COST_COL}2`) ?? "";
    expect(costCell).toContain("<v>1.23456789012346</v>");
  });

  test("model name is a text (inlineStr) cell, not interpreted as a formula", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog({ model: "=1+1" })], "UTC"));
    const modelCell = cell(files["xl/worksheets/sheet1.xml"], `${MODEL_COL}2`) ?? "";
    expect(modelCell).toContain("inlineStr");
    expect(modelCell).toContain("=1+1");
  });

  test("status code is an integer numeric cell", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog({ statusCode: 200 })], "UTC"));
    const statusCell = cell(files["xl/worksheets/sheet1.xml"], `${STATUS_COL}2`) ?? "";
    expect(statusCell).toContain("<v>200</v>");
    expect(statusCell).not.toContain("inlineStr");
  });

  test("timestamp is a real Excel date serial reflecting the system timezone", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog()], "Asia/Shanghai"));
    const sheet1 = files["xl/worksheets/sheet1.xml"];
    // header carries the timezone
    expect(sheet1).toContain("Time (Asia/Shanghai)");

    const timeCell = cell(sheet1, `${TIME_COL}2`) ?? "";
    const serial = Number(timeCell.match(/<v>([^<]+)<\/v>/)?.[1]);
    expect(Number.isFinite(serial)).toBe(true);

    // serial -> wall clock; 12:34:56 UTC is 20:34:56 in Asia/Shanghai (+08:00)
    const ms = Math.round(((serial - 25569) * 86_400_000) / 1000) * 1000;
    const wall = new Date(ms);
    expect(wall.getUTCFullYear()).toBe(2026);
    expect(wall.getUTCMonth()).toBe(5); // June
    expect(wall.getUTCDate()).toBe(3);
    expect(wall.getUTCHours()).toBe(20);
    expect(wall.getUTCMinutes()).toBe(34);
    expect(wall.getUTCSeconds()).toBe(56);
  });

  test("single-day data yields an hourly summary sheet", async () => {
    const files = unzip(
      await buildUsageLogsXlsx(
        [
          makeLog({ createdAt: new Date("2026-06-03T12:00:00.000Z"), costUsd: "0.5" }),
          makeLog({ createdAt: new Date("2026-06-03T12:30:00.000Z"), costUsd: "0.5" }),
        ],
        "UTC"
      )
    );
    expect(files["xl/workbook.xml"]).toContain('name="Hourly Summary"');
    const summary = files["xl/worksheets/sheet2.xml"];
    expect(summary).toContain("Period");
    expect(summary).toContain("2026-06-03 12:00");
    expect(summary).toContain("Reasoning Tokens");
    expect(summary).toContain("<v>16</v>");
    expect(summary).toContain("Total");
  });

  test("multi-day data yields a daily summary sheet", async () => {
    const files = unzip(
      await buildUsageLogsXlsx(
        [
          makeLog({ createdAt: new Date("2026-06-03T12:00:00.000Z") }),
          makeLog({ createdAt: new Date("2026-06-04T12:00:00.000Z") }),
        ],
        "UTC"
      )
    );
    expect(files["xl/workbook.xml"]).toContain('name="Daily Summary"');
    const summary = files["xl/worksheets/sheet2.xml"];
    expect(summary).toContain("2026-06-03");
    expect(summary).toContain("2026-06-04");
  });

  test("does not crash on empty input", async () => {
    const files = unzip(await buildUsageLogsXlsx([], "UTC"));
    expect(files["xl/worksheets/sheet1.xml"]).toContain("Time (UTC)");
    expect(files["xl/worksheets/sheet2.xml"]).toContain("Total");
  });

  test("invalid Date timestamp yields an empty cell (no crash)", async () => {
    const files = unzip(
      await buildUsageLogsXlsx([makeLog({ createdAt: new Date(Number.NaN) })], "UTC")
    );
    const timeCell = cell(files["xl/worksheets/sheet1.xml"], `${TIME_COL}2`) ?? "";
    expect(timeCell).toBe(`<c r="${TIME_COL}2"/>`);
  });

  test("strips illegal XML characters from text cells", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog({ model: "gpt\uFFFE\uFFFF-x" })], "UTC"));
    const modelCell = cell(files["xl/worksheets/sheet1.xml"], `${MODEL_COL}2`) ?? "";
    expect(modelCell).toContain("gpt-x");
    expect(modelCell).not.toContain("\uFFFE");
    expect(modelCell).not.toContain("\uFFFF");
  });

  test("styles.xml declares the two OOXML-reserved fills", async () => {
    const files = unzip(await buildUsageLogsXlsx([makeLog()], "UTC"));
    expect(files["xl/styles.xml"]).toContain('<fills count="2">');
    expect(files["xl/styles.xml"]).toContain('patternType="gray125"');
  });
});
