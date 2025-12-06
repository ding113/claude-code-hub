import type { ModelPriceData } from "@/types/model-price";
import { COST_SCALE, Decimal, toDecimal } from "./currency";

type UsageMetrics = {
  input_tokens?: number;
  output_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  // 差异化缓存计费：5分钟和1小时缓存创建 token 数
  cache_creation_5m_input_tokens?: number;
  cache_creation_1h_input_tokens?: number;
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

  // 缓存读取成本（统一费率）
  const cacheReadCost =
    priceData.cache_read_input_token_cost ??
    (outputCostPerToken != null ? outputCostPerToken * 0.1 : undefined);

  segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  segments.push(multiplyCost(usage.output_tokens, outputCostPerToken));
  segments.push(multiplyCost(usage.cache_read_input_tokens, cacheReadCost));

  // 差异化缓存创建计费
  // 优先使用细分的 5分钟/1小时 缓存数据（如果可用）
  if (
    usage.cache_creation_5m_input_tokens != null ||
    usage.cache_creation_1h_input_tokens != null
  ) {
    // 5分钟缓存：使用标准缓存创建费率
    const cache5mCost =
      priceData.cache_creation_input_token_cost ??
      (inputCostPerToken != null ? inputCostPerToken * 0.1 : undefined);

    // 1小时缓存：使用扩展缓存费率（若无则回退到标准费率）
    const cache1hCost =
      priceData.cache_creation_input_token_cost_above_1hr ??
      priceData.cache_creation_input_token_cost ??
      (inputCostPerToken != null ? inputCostPerToken * 0.1 : undefined);

    segments.push(multiplyCost(usage.cache_creation_5m_input_tokens, cache5mCost));
    segments.push(multiplyCost(usage.cache_creation_1h_input_tokens, cache1hCost));
  } else {
    // 兼容旧数据：使用统一的缓存创建成本
    const cacheCreationCost =
      priceData.cache_creation_input_token_cost ??
      (inputCostPerToken != null ? inputCostPerToken * 0.1 : undefined);

    segments.push(multiplyCost(usage.cache_creation_input_tokens, cacheCreationCost));
  }

  const total = segments.reduce((acc, segment) => acc.plus(segment), new Decimal(0));

  // 应用倍率
  const multiplierDecimal = new Decimal(multiplier);
  return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
}
