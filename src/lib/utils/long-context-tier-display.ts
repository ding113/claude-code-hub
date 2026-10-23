import type { StoredLongContextTier } from "@/types/cost-breakdown";
import { formatTokenAmount } from "./token";

export type LongContextTierDimension =
  | "input"
  | "output"
  | "cacheWrite"
  | "cacheWrite1h"
  | "cacheRead";

export interface LongContextTierMultiplierRow {
  dimension: LongContextTierDimension;
  multiplier: string;
}

export function formatLongContextMultiplier(multiplier: number): string {
  return `×${Number(multiplier.toFixed(4))}`;
}

export function formatLongContextThreshold(thresholdTokens: number): string {
  return formatTokenAmount(thresholdTokens);
}

export function formatLongContextObservedTokens(observedInputTokens: number): string {
  return observedInputTokens.toLocaleString();
}

/**
 * 计费详情中展示的长上下文分段倍率。
 * 1h 缓存写入只在请求实际产生 1h 缓存时展示：没有 1h 缓存价格的模型（如 OpenAI）
 * 其 1h 单价来自回退推导，展示出来只会误导。
 */
export function getLongContextTierMultiplierRows(
  tier: StoredLongContextTier,
  hasCache1hTokens: boolean
): LongContextTierMultiplierRow[] {
  const entries: Array<[LongContextTierDimension, number | undefined]> = [
    ["input", tier.input_multiplier],
    ["output", tier.output_multiplier],
    ["cacheWrite", tier.cache_creation_5m_multiplier],
    ["cacheWrite1h", hasCache1hTokens ? tier.cache_creation_1h_multiplier : undefined],
    ["cacheRead", tier.cache_read_multiplier],
  ];

  return entries
    .filter((entry): entry is [LongContextTierDimension, number] => {
      const value = entry[1];
      return typeof value === "number" && Number.isFinite(value) && value >= 0;
    })
    .map(([dimension, multiplier]) => ({
      dimension,
      multiplier: formatLongContextMultiplier(multiplier),
    }));
}
