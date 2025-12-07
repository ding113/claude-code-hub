import type { ModelPriceData } from "@/types/model-price";
import { COST_SCALE, Decimal, toDecimal } from "./currency";

type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
  cache_ttl?: "5m" | "1h" | "mixed";
  cache_read_input_tokens?: number;
};

function multiplyCost(quantity: number | undefined, unitCost: number | undefined): Decimal {
  const qtyDecimal = quantity != null ? new Decimal(quantity) : null;
  const costDecimal = unitCost != null ? toDecimal(unitCost) : null;

  if (!qtyDecimal || !costDecimal) {
    return new Decimal(0);
  }

  return qtyDecimal.mul(costDecimal);
}

/**
 * 计算单次请求的费用
 * @param usage - token使用量
 * @param priceData - 模型价格数据
 * @param multiplier - 成本倍率（默认 1.0，表示官方价格）
 * @returns 费用（美元），保留 15 位小数
 */
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0
): Decimal {
  const segments: Decimal[] = [];

  const inputCostPerToken = priceData.input_cost_per_token;
  const outputCostPerToken = priceData.output_cost_per_token;

  const cacheCreation5mCost =
    priceData.cache_creation_input_token_cost ??
    (inputCostPerToken != null ? inputCostPerToken * 1.25 : undefined);

  const cacheCreation1hCost =
    priceData.cache_creation_input_token_cost_above_1hr ??
    (inputCostPerToken != null ? inputCostPerToken * 2 : undefined) ??
    cacheCreation5mCost;

  const cacheReadCost =
    priceData.cache_read_input_token_cost ??
    (inputCostPerToken != null
      ? inputCostPerToken * 0.1
      : outputCostPerToken != null
        ? outputCostPerToken * 0.1
        : undefined);

  // Derive cache creation tokens by TTL
  let cache5mTokens = usage.cache_creation_5m_input_tokens;
  let cache1hTokens = usage.cache_creation_1h_input_tokens;

  if (typeof usage.cache_creation_input_tokens === "number") {
    const remaining =
      usage.cache_creation_input_tokens - (cache5mTokens ?? 0) - (cache1hTokens ?? 0);

    if (remaining > 0) {
      const target = usage.cache_ttl === "1h" ? "1h" : "5m";
      if (target === "1h") {
        cache1hTokens = (cache1hTokens ?? 0) + remaining;
      } else {
        cache5mTokens = (cache5mTokens ?? 0) + remaining;
      }
    }
  }

  segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  segments.push(multiplyCost(usage.output_tokens, outputCostPerToken));
  segments.push(multiplyCost(cache5mTokens, cacheCreation5mCost));
  segments.push(multiplyCost(cache1hTokens, cacheCreation1hCost));
  segments.push(multiplyCost(usage.cache_read_input_tokens, cacheReadCost));

  const total = segments.reduce((acc, segment) => acc.plus(segment), new Decimal(0));

  // 应用倍率
  const multiplierDecimal = new Decimal(multiplier);
  return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
}
