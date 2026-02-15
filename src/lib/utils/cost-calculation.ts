import {
  CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER,
  CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER,
  CONTEXT_1M_TOKEN_THRESHOLD,
} from "@/lib/special-attributes";
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
  // 图片 modality tokens（从 candidatesTokensDetails/promptTokensDetails 提取）
  input_image_tokens?: number;
  output_image_tokens?: number;
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
 * 计算阶梯定价费用（用于1M上下文窗口）
 * 超过阈值的token使用溢价费率
 * @param tokens - token数量
 * @param baseCostPerToken - 基础单价
 * @param premiumMultiplier - 溢价倍数
 * @param threshold - 阈值（默认200k）
 * @returns 费用
 */
function calculateTieredCost(
  tokens: number,
  baseCostPerToken: number,
  premiumMultiplier: number,
  threshold: number = CONTEXT_1M_TOKEN_THRESHOLD
): Decimal {
  if (tokens <= 0) {
    return new Decimal(0);
  }

  const baseCostDecimal = new Decimal(baseCostPerToken);

  if (tokens <= threshold) {
    return new Decimal(tokens).mul(baseCostDecimal);
  }

  // 阈值内的token按基础费率计算
  const baseCost = new Decimal(threshold).mul(baseCostDecimal);
  // 超出阈值的token按溢价费率计算
  const premiumTokens = tokens - threshold;
  const premiumCost = new Decimal(premiumTokens).mul(baseCostDecimal).mul(premiumMultiplier);

  return baseCost.add(premiumCost);
}

/**
 * 使用独立价格字段计算分层费用（适用于 Gemini 等模型）
 * @param tokens - token 数量
 * @param baseCostPerToken - 基础单价（<=200K 部分）
 * @param premiumCostPerToken - 溢价单价（>200K 部分）
 * @param threshold - 阈值（默认 200K）
 * @returns 费用
 */
function calculateTieredCostWithSeparatePrices(
  tokens: number,
  baseCostPerToken: number,
  premiumCostPerToken: number,
  threshold: number = CONTEXT_1M_TOKEN_THRESHOLD
): Decimal {
  if (tokens <= 0) {
    return new Decimal(0);
  }

  const baseCostDecimal = new Decimal(baseCostPerToken);
  const premiumCostDecimal = new Decimal(premiumCostPerToken);

  if (tokens <= threshold) {
    return new Decimal(tokens).mul(baseCostDecimal);
  }

  // 阈值内的 token 按基础费率计算
  const baseCost = new Decimal(threshold).mul(baseCostDecimal);
  // 超出阈值的 token 按溢价费率计算
  const premiumTokens = tokens - threshold;
  const premiumCost = new Decimal(premiumTokens).mul(premiumCostDecimal);

  return baseCost.add(premiumCost);
}

export interface CostBreakdown {
  input: number;
  output: number;
  cache_creation: number;
  cache_read: number;
  total: number;
}

/**
 * Calculate cost breakdown by category (always raw cost, multiplier=1.0).
 * Returns per-category costs as plain numbers.
 */
export function calculateRequestCostBreakdown(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  context1mApplied: boolean = false
): CostBreakdown {
  let inputBucket = new Decimal(0);
  let outputBucket = new Decimal(0);
  let cacheCreationBucket = new Decimal(0);
  let cacheReadBucket = new Decimal(0);

  const inputCostPerToken = priceData.input_cost_per_token;
  const outputCostPerToken = priceData.output_cost_per_token;
  const inputCostPerRequest = priceData.input_cost_per_request;

  // Per-request cost -> input bucket
  if (
    typeof inputCostPerRequest === "number" &&
    Number.isFinite(inputCostPerRequest) &&
    inputCostPerRequest >= 0
  ) {
    const requestCost = toDecimal(inputCostPerRequest);
    if (requestCost) {
      inputBucket = inputBucket.add(requestCost);
    }
  }

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

  const inputAbove200k = priceData.input_cost_per_token_above_200k_tokens;
  const outputAbove200k = priceData.output_cost_per_token_above_200k_tokens;

  // Input tokens -> input bucket
  if (context1mApplied && inputCostPerToken != null && usage.input_tokens != null) {
    inputBucket = inputBucket.add(
      calculateTieredCost(
        usage.input_tokens,
        inputCostPerToken,
        CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER
      )
    );
  } else if (inputAbove200k != null && inputCostPerToken != null && usage.input_tokens != null) {
    inputBucket = inputBucket.add(
      calculateTieredCostWithSeparatePrices(usage.input_tokens, inputCostPerToken, inputAbove200k)
    );
  } else {
    inputBucket = inputBucket.add(multiplyCost(usage.input_tokens, inputCostPerToken));
  }

  // Output tokens -> output bucket
  if (context1mApplied && outputCostPerToken != null && usage.output_tokens != null) {
    outputBucket = outputBucket.add(
      calculateTieredCost(
        usage.output_tokens,
        outputCostPerToken,
        CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER
      )
    );
  } else if (outputAbove200k != null && outputCostPerToken != null && usage.output_tokens != null) {
    outputBucket = outputBucket.add(
      calculateTieredCostWithSeparatePrices(
        usage.output_tokens,
        outputCostPerToken,
        outputAbove200k
      )
    );
  } else {
    outputBucket = outputBucket.add(multiplyCost(usage.output_tokens, outputCostPerToken));
  }

  // Cache costs
  const cacheCreationAbove200k = priceData.cache_creation_input_token_cost_above_200k_tokens;
  const cacheReadAbove200k = priceData.cache_read_input_token_cost_above_200k_tokens;
  const hasRealCacheCreationBase = priceData.cache_creation_input_token_cost != null;
  const hasRealCacheReadBase = priceData.cache_read_input_token_cost != null;

  // Cache creation 5m -> cache_creation bucket
  if (context1mApplied && cacheCreation5mCost != null && cache5mTokens != null) {
    cacheCreationBucket = cacheCreationBucket.add(
      calculateTieredCost(cache5mTokens, cacheCreation5mCost, CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else if (
    hasRealCacheCreationBase &&
    cacheCreationAbove200k != null &&
    cacheCreation5mCost != null &&
    cache5mTokens != null
  ) {
    cacheCreationBucket = cacheCreationBucket.add(
      calculateTieredCostWithSeparatePrices(
        cache5mTokens,
        cacheCreation5mCost,
        cacheCreationAbove200k
      )
    );
  } else {
    cacheCreationBucket = cacheCreationBucket.add(multiplyCost(cache5mTokens, cacheCreation5mCost));
  }

  // Cache creation 1h -> cache_creation bucket
  if (context1mApplied && cacheCreation1hCost != null && cache1hTokens != null) {
    cacheCreationBucket = cacheCreationBucket.add(
      calculateTieredCost(cache1hTokens, cacheCreation1hCost, CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else if (
    hasRealCacheCreationBase &&
    cacheCreationAbove200k != null &&
    cacheCreation1hCost != null &&
    cache1hTokens != null
  ) {
    cacheCreationBucket = cacheCreationBucket.add(
      calculateTieredCostWithSeparatePrices(
        cache1hTokens,
        cacheCreation1hCost,
        cacheCreationAbove200k
      )
    );
  } else {
    cacheCreationBucket = cacheCreationBucket.add(multiplyCost(cache1hTokens, cacheCreation1hCost));
  }

  // Cache read -> cache_read bucket
  if (
    hasRealCacheReadBase &&
    cacheReadAbove200k != null &&
    cacheReadCost != null &&
    usage.cache_read_input_tokens != null
  ) {
    cacheReadBucket = cacheReadBucket.add(
      calculateTieredCostWithSeparatePrices(
        usage.cache_read_input_tokens,
        cacheReadCost,
        cacheReadAbove200k
      )
    );
  } else {
    cacheReadBucket = cacheReadBucket.add(
      multiplyCost(usage.cache_read_input_tokens, cacheReadCost)
    );
  }

  // Image tokens -> respective buckets
  if (usage.output_image_tokens != null && usage.output_image_tokens > 0) {
    const imageCostPerToken =
      priceData.output_cost_per_image_token ?? priceData.output_cost_per_token;
    outputBucket = outputBucket.add(multiplyCost(usage.output_image_tokens, imageCostPerToken));
  }

  if (usage.input_image_tokens != null && usage.input_image_tokens > 0) {
    const imageCostPerToken =
      priceData.input_cost_per_image_token ?? priceData.input_cost_per_token;
    inputBucket = inputBucket.add(multiplyCost(usage.input_image_tokens, imageCostPerToken));
  }

  const total = inputBucket.add(outputBucket).add(cacheCreationBucket).add(cacheReadBucket);

  return {
    input: inputBucket.toDecimalPlaces(COST_SCALE).toNumber(),
    output: outputBucket.toDecimalPlaces(COST_SCALE).toNumber(),
    cache_creation: cacheCreationBucket.toDecimalPlaces(COST_SCALE).toNumber(),
    cache_read: cacheReadBucket.toDecimalPlaces(COST_SCALE).toNumber(),
    total: total.toDecimalPlaces(COST_SCALE).toNumber(),
  };
}

/**
 * 计算单次请求的费用
 * @param usage - token使用量
 * @param priceData - 模型价格数据
 * @param multiplier - 成本倍率（默认 1.0，表示官方价格）
 * @param context1mApplied - 是否应用了1M上下文窗口（启用阶梯定价）
 * @returns 费用（美元），保留 15 位小数
 */
export function calculateRequestCost(
  usage: UsageMetrics,
  priceData: ModelPriceData,
  multiplier: number = 1.0,
  context1mApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];

  const inputCostPerToken = priceData.input_cost_per_token;
  const outputCostPerToken = priceData.output_cost_per_token;
  const inputCostPerRequest = priceData.input_cost_per_request;

  if (
    typeof inputCostPerRequest === "number" &&
    Number.isFinite(inputCostPerRequest) &&
    inputCostPerRequest >= 0
  ) {
    const requestCost = toDecimal(inputCostPerRequest);
    if (requestCost) {
      segments.push(requestCost);
    }
  }

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

  // 检查是否有 200K 分层价格（Gemini 等模型）
  const inputAbove200k = priceData.input_cost_per_token_above_200k_tokens;
  const outputAbove200k = priceData.output_cost_per_token_above_200k_tokens;

  // 计算 input 费用：优先级 context1mApplied > 200K分层 > 普通
  if (context1mApplied && inputCostPerToken != null && usage.input_tokens != null) {
    // Claude 1M context: 使用倍数计算
    segments.push(
      calculateTieredCost(
        usage.input_tokens,
        inputCostPerToken,
        CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER
      )
    );
  } else if (inputAbove200k != null && inputCostPerToken != null && usage.input_tokens != null) {
    // Gemini 等: 使用独立价格字段
    segments.push(
      calculateTieredCostWithSeparatePrices(usage.input_tokens, inputCostPerToken, inputAbove200k)
    );
  } else {
    // 普通计算
    segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  }

  // 计算 output 费用：优先级 context1mApplied > 200K分层 > 普通
  if (context1mApplied && outputCostPerToken != null && usage.output_tokens != null) {
    // Claude 1M context: 使用倍数计算
    segments.push(
      calculateTieredCost(
        usage.output_tokens,
        outputCostPerToken,
        CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER
      )
    );
  } else if (outputAbove200k != null && outputCostPerToken != null && usage.output_tokens != null) {
    // Gemini 等: 使用独立价格字段
    segments.push(
      calculateTieredCostWithSeparatePrices(
        usage.output_tokens,
        outputCostPerToken,
        outputAbove200k
      )
    );
  } else {
    // 普通计算
    segments.push(multiplyCost(usage.output_tokens, outputCostPerToken));
  }

  // 缓存相关费用
  // 检查是否有 200K 分层的缓存价格
  // 注意：只有当价格表中的原始基础价格存在时才启用分层计费，避免派生价格与分层价格混用导致误计费
  const cacheCreationAbove200k = priceData.cache_creation_input_token_cost_above_200k_tokens;
  const cacheReadAbove200k = priceData.cache_read_input_token_cost_above_200k_tokens;
  const hasRealCacheCreationBase = priceData.cache_creation_input_token_cost != null;
  const hasRealCacheReadBase = priceData.cache_read_input_token_cost != null;

  // 缓存创建费用（5分钟 TTL）：优先级 context1mApplied > 200K分层 > 普通
  if (context1mApplied && cacheCreation5mCost != null && cache5mTokens != null) {
    // Claude 1M context: 使用 input 倍数计算（cache creation 属于 input 类别）
    segments.push(
      calculateTieredCost(cache5mTokens, cacheCreation5mCost, CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else if (
    hasRealCacheCreationBase &&
    cacheCreationAbove200k != null &&
    cacheCreation5mCost != null &&
    cache5mTokens != null
  ) {
    // Gemini 等: 使用独立价格字段
    segments.push(
      calculateTieredCostWithSeparatePrices(
        cache5mTokens,
        cacheCreation5mCost,
        cacheCreationAbove200k
      )
    );
  } else {
    // 普通计算
    segments.push(multiplyCost(cache5mTokens, cacheCreation5mCost));
  }

  // 缓存创建费用（1小时 TTL）：优先级 context1mApplied > 200K分层 > 普通
  if (context1mApplied && cacheCreation1hCost != null && cache1hTokens != null) {
    // Claude 1M context: 使用 input 倍数计算（cache creation 属于 input 类别）
    segments.push(
      calculateTieredCost(cache1hTokens, cacheCreation1hCost, CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else if (
    hasRealCacheCreationBase &&
    cacheCreationAbove200k != null &&
    cacheCreation1hCost != null &&
    cache1hTokens != null
  ) {
    // Gemini 等: 使用独立价格字段
    segments.push(
      calculateTieredCostWithSeparatePrices(
        cache1hTokens,
        cacheCreation1hCost,
        cacheCreationAbove200k
      )
    );
  } else {
    // 普通计算
    segments.push(multiplyCost(cache1hTokens, cacheCreation1hCost));
  }

  // 缓存读取费用
  if (
    hasRealCacheReadBase &&
    cacheReadAbove200k != null &&
    cacheReadCost != null &&
    usage.cache_read_input_tokens != null
  ) {
    segments.push(
      calculateTieredCostWithSeparatePrices(
        usage.cache_read_input_tokens,
        cacheReadCost,
        cacheReadAbove200k
      )
    );
  } else {
    segments.push(multiplyCost(usage.cache_read_input_tokens, cacheReadCost));
  }

  // 图片 token 费用（Gemini image generation models）
  // 输出图片 token：优先使用 output_cost_per_image_token，否则回退到 output_cost_per_token
  if (usage.output_image_tokens != null && usage.output_image_tokens > 0) {
    const imageCostPerToken =
      priceData.output_cost_per_image_token ?? priceData.output_cost_per_token;
    segments.push(multiplyCost(usage.output_image_tokens, imageCostPerToken));
  }

  // 输入图片 token：优先使用 input_cost_per_image_token，否则回退到 input_cost_per_token
  if (usage.input_image_tokens != null && usage.input_image_tokens > 0) {
    const imageCostPerToken =
      priceData.input_cost_per_image_token ?? priceData.input_cost_per_token;
    segments.push(multiplyCost(usage.input_image_tokens, imageCostPerToken));
  }

  const total = segments.reduce((acc, segment) => acc.plus(segment), new Decimal(0));

  // 应用倍率
  const multiplierDecimal = new Decimal(multiplier);
  return total.mul(multiplierDecimal).toDecimalPlaces(COST_SCALE);
}
