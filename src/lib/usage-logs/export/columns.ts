/**
 * Single source of truth for the usage-logs export detail columns, shared by
 * the CSV and XLSX renderers so they can never drift apart.
 */

import { getRetryCount } from "@/lib/utils/provider-chain-formatter";
import type { UsageLogRow } from "@/repository/usage-logs";

export type DetailColumnKind = "text" | "number" | "datetime";

export interface DetailColumn {
  /** Stable English header (datetime columns get the timezone appended). */
  header: string;
  kind: DetailColumnKind;
  /**
   * Raw extracted value: string for text columns, number|null for number
   * columns, Date|null for datetime columns.
   */
  get: (log: UsageLogRow) => string | number | Date | null;
  /** number columns only: emit 0 (instead of blank) when the value is null. */
  zeroWhenNull?: boolean;
  /** ExcelJS number/date format string. */
  numFmt?: string;
}

export const COST_NUM_FMT = "0.00######";
export const INT_NUM_FMT = "0";
export const DATETIME_NUM_FMT = "yyyy-mm-dd hh:mm:ss";

function retryCountOf(log: UsageLogRow): number {
  return log.providerChain ? getRetryCount(log.providerChain) : 0;
}

export const DETAIL_COLUMNS: DetailColumn[] = [
  { header: "Time", kind: "datetime", numFmt: DATETIME_NUM_FMT, get: (log) => log.createdAt },
  { header: "User", kind: "text", get: (log) => log.userName },
  { header: "Key", kind: "text", get: (log) => log.keyName },
  { header: "Provider", kind: "text", get: (log) => log.providerName ?? "" },
  { header: "Model", kind: "text", get: (log) => log.model ?? "" },
  { header: "Original Model", kind: "text", get: (log) => log.originalModel ?? "" },
  { header: "Endpoint", kind: "text", get: (log) => log.endpoint ?? "" },
  { header: "Status Code", kind: "number", numFmt: INT_NUM_FMT, get: (log) => log.statusCode },
  {
    header: "Input Tokens",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.inputTokens,
  },
  {
    header: "Output Tokens",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.outputTokens,
  },
  {
    header: "Reasoning Tokens",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.reasoningOutputTokens ?? null,
  },
  {
    header: "Cache Write 5m",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.cacheCreation5mInputTokens,
  },
  {
    header: "Cache Write 1h",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.cacheCreation1hInputTokens,
  },
  {
    header: "Cache Read",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.cacheReadInputTokens,
  },
  {
    header: "Total Tokens",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.totalTokens,
  },
  {
    header: "Cost (USD)",
    kind: "number",
    numFmt: COST_NUM_FMT,
    zeroWhenNull: true,
    get: (log) => log.costUsd,
  },
  { header: "Duration (ms)", kind: "number", numFmt: INT_NUM_FMT, get: (log) => log.durationMs },
  { header: "Session ID", kind: "text", get: (log) => log.sessionId ?? "" },
  {
    header: "Retry Count",
    kind: "number",
    numFmt: INT_NUM_FMT,
    zeroWhenNull: true,
    get: retryCountOf,
  },
];

/**
 * Detail-sheet headers, with the timezone appended to datetime columns so the
 * cells stay clean datetimes (e.g. "Time (Asia/Shanghai)").
 */
export function buildDetailHeaders(timezone: string): string[] {
  return DETAIL_COLUMNS.map((column) =>
    column.kind === "datetime" ? `${column.header} (${timezone})` : column.header
  );
}

/** A cell value that should render blank (null, undefined, or whitespace-only). */
export function isBlankValue(value: string | number | Date | null | undefined): boolean {
  return (
    value === null || value === undefined || (typeof value === "string" && value.trim() === "")
  );
}
