import type { InferSelectModel } from "drizzle-orm";
import type { usageLedger } from "@/drizzle/schema";
import type { TimeRange } from "@/types/statistics";

export type UsageLedgerRow = InferSelectModel<typeof usageLedger>;

export interface LedgerAggregation {
  totalCostUsd: string;
  totalInputTokens: string;
  totalOutputTokens: string;
  requestCount: string;
}

export type LedgerTimeRange = TimeRange;
