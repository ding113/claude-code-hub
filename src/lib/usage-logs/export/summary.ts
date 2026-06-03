/**
 * Aggregated summary for the XLSX export's second worksheet.
 *
 * - Multi-day exports are summarized per calendar day.
 * - Single-day exports are summarized per hour.
 *
 * Calendar boundaries are evaluated in the resolved system timezone so the
 * buckets line up with what the user sees in the dashboard.
 */

import { formatInTimeZone } from "date-fns-tz";
import type { UsageLogRow } from "@/repository/usage-logs";
import { toFiniteNumber } from "./numeric";

export type SummaryGranularity = "daily" | "hourly";

export interface SummaryRow {
  period: string;
  requests: number;
  inputTokens: number;
  outputTokens: number;
  cacheWrite5m: number;
  cacheWrite1h: number;
  cacheRead: number;
  totalTokens: number;
  cost: number;
}

export interface UsageLogsSummary {
  granularity: SummaryGranularity;
  rows: SummaryRow[];
  total: SummaryRow;
}

export const SUMMARY_HEADERS = [
  "Period",
  "Requests",
  "Input Tokens",
  "Output Tokens",
  "Cache Write 5m",
  "Cache Write 1h",
  "Cache Read",
  "Total Tokens",
  "Cost (USD)",
] as const;

const UNKNOWN_PERIOD = "Unknown";

function emptyRow(period: string): SummaryRow {
  return {
    period,
    requests: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheWrite5m: 0,
    cacheWrite1h: 0,
    cacheRead: 0,
    totalTokens: 0,
    cost: 0,
  };
}

function accumulate(row: SummaryRow, log: UsageLogRow): void {
  row.requests += 1;
  row.inputTokens += log.inputTokens ?? 0;
  row.outputTokens += log.outputTokens ?? 0;
  row.cacheWrite5m += log.cacheCreation5mInputTokens ?? 0;
  row.cacheWrite1h += log.cacheCreation1hInputTokens ?? 0;
  row.cacheRead += log.cacheReadInputTokens ?? 0;
  row.totalTokens += log.totalTokens ?? 0;
  row.cost += toFiniteNumber(log.costUsd) ?? 0;
}

function merge(target: SummaryRow, source: SummaryRow): void {
  target.requests += source.requests;
  target.inputTokens += source.inputTokens;
  target.outputTokens += source.outputTokens;
  target.cacheWrite5m += source.cacheWrite5m;
  target.cacheWrite1h += source.cacheWrite1h;
  target.cacheRead += source.cacheRead;
  target.totalTokens += source.totalTokens;
  target.cost += source.cost;
}

function byPeriod(a: SummaryRow, b: SummaryRow): number {
  return a.period < b.period ? -1 : a.period > b.period ? 1 : 0;
}

/**
 * Incremental summary builder. Logs are folded in one at a time (each timestamp
 * formatted exactly once) so callers can stream batches without retaining the
 * rows. Buckets are kept at hour granularity; `finalize` chooses per-hour vs
 * per-day output from the distinct-day count and rolls hours up when needed.
 * Period labels are zero-padded ISO, so the later lexicographic sort is also
 * chronological.
 */
export interface SummaryAccumulator {
  add(log: UsageLogRow): void;
  finalize(): UsageLogsSummary;
}

export function createSummaryAccumulator(timezone: string): SummaryAccumulator {
  const hourBuckets = new Map<string, SummaryRow>();
  const days = new Set<string>();
  const total = emptyRow("Total");
  let unknown: SummaryRow | null = null;

  return {
    add(log) {
      accumulate(total, log);
      if (!log.createdAt) {
        unknown ??= emptyRow(UNKNOWN_PERIOD);
        accumulate(unknown, log);
        return;
      }
      const hourKey = `${formatInTimeZone(log.createdAt, timezone, "yyyy-MM-dd HH")}:00`;
      days.add(hourKey.slice(0, 10));
      let row = hourBuckets.get(hourKey);
      if (!row) {
        row = emptyRow(hourKey);
        hourBuckets.set(hourKey, row);
      }
      accumulate(row, log);
    },
    finalize() {
      const granularity: SummaryGranularity = days.size <= 1 ? "hourly" : "daily";
      let rows: SummaryRow[];
      if (granularity === "hourly") {
        rows = [...hourBuckets.values()];
      } else {
        const dayBuckets = new Map<string, SummaryRow>();
        for (const hour of hourBuckets.values()) {
          const dayKey = hour.period.slice(0, 10);
          let day = dayBuckets.get(dayKey);
          if (!day) {
            day = emptyRow(dayKey);
            dayBuckets.set(dayKey, day);
          }
          merge(day, hour);
        }
        rows = [...dayBuckets.values()];
      }
      if (unknown) {
        rows.push(unknown);
      }
      rows.sort(byPeriod);
      return { granularity, rows, total };
    },
  };
}

/**
 * Build the per-day or per-hour summary for the given logs (convenience wrapper
 * around {@link createSummaryAccumulator} for callers that already hold all rows).
 */
export function buildUsageLogsSummary(logs: UsageLogRow[], timezone: string): UsageLogsSummary {
  const accumulator = createSummaryAccumulator(timezone);
  for (const log of logs) {
    accumulator.add(log);
  }
  return accumulator.finalize();
}
