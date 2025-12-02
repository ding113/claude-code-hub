import type { ModelPriceData } from "@/types/model-price";
import { COST_SCALE, Decimal, toDecimal } from "./currency";

type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
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

  const cacheCreationCost =
    priceData.cache_creation_input_token_cost ??
    (inputCostPerToken != null ? inputCostPerToken * 0.1 : undefined);

  const cacheReadCost =
    priceData.cache_read_input_token_cost ??
    (outputCostPerToken != null ? outputCostPerToken * 0.1 : undefined);

  segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  segments.push(multiplyCost(usage.output_tokens, outputCostPerToken));
  segments.push(multiplyCost(usage.cache_creation_input_tokens, cacheCreationCost));
  segments.push(multiplyCost(usage.cache_read_input_tokens, cacheReadCost));

  const total = segments.reduce((acc, segment) => acc.plus(segment), new Decimal(0));

  // 应用倍率
  const multiplierDecimal = new Decimal(multiplier);
  return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
}
