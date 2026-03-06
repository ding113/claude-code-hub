import {
  CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER,
  CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER,
  CONTEXT_1M_TOKEN_THRESHOLD,
} from "@/lib/special-attributes";
import type { ModelPriceData } from "@/types/model-price";
import { COST_SCALE, Decimal, toDecimal } from "./currency";

const OPENAI_LONG_CONTEXT_TOKEN_THRESHOLD = 272000;

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
function _calculateTieredCost(
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

  return new Decimal(tokens).mul(baseCostDecimal).mul(premiumMultiplier);
}

/**
 * 使用独立价格字段计算分层费用（适用于 Gemini 等模型）
 * @param tokens - token 数量
 * @param baseCostPerToken - 基础单价（<=200K 部分）
 * @param premiumCostPerToken - 溢价单价（>200K 部分）
 * @param threshold - 阈值（默认 200K）
 * @returns 费用
 */
function __calculateTieredCostWithSeparatePrices(
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

  return new Decimal(tokens).mul(premiumCostDecimal);
}

function resolveLongContextThreshold(priceData: ModelPriceData): number {
  const has272kFields =
    typeof priceData.input_cost_per_token_above_272k_tokens === "number" ||
    typeof priceData.output_cost_per_token_above_272k_tokens === "number" ||
    typeof priceData.cache_creation_input_token_cost_above_272k_tokens === "number" ||
    typeof priceData.cache_read_input_token_cost_above_272k_tokens === "number" ||
    typeof priceData.cache_creation_input_token_cost_above_1hr_above_272k_tokens === "number";

  const modelFamily = typeof priceData.model_family === "string" ? priceData.model_family : "";
  if (has272kFields || modelFamily === "gpt" || modelFamily === "gpt-pro") {
    return OPENAI_LONG_CONTEXT_TOKEN_THRESHOLD;
  }

  return CONTEXT_1M_TOKEN_THRESHOLD;
}

function getRequestInputContextTokens(
  usage: UsageMetrics,
  cache5mTokens?: number,
  cache1hTokens?: number
): number {
  const cacheCreationInputTokens =
    typeof usage.cache_creation_input_tokens === "number"
      ? usage.cache_creation_input_tokens
      : (cache5mTokens ?? 0) + (cache1hTokens ?? 0);

  return (
    (usage.input_tokens ?? 0) +
    cacheCreationInputTokens +
    (usage.cache_read_input_tokens ?? 0) +
    (usage.input_image_tokens ?? 0)
  );
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
  context1mApplied: boolean = false,
  priorityServiceTierApplied: boolean = false
): CostBreakdown {
  let inputBucket = new Decimal(0);
  let outputBucket = new Decimal(0);
  let cacheCreationBucket = new Decimal(0);
  let cacheReadBucket = new Decimal(0);

  const baseInputCostPerToken = priceData.input_cost_per_token;
  const baseOutputCostPerToken = priceData.output_cost_per_token;
  const inputCostPerToken =
    priorityServiceTierApplied && typeof priceData.input_cost_per_token_priority === "number"
      ? priceData.input_cost_per_token_priority
      : baseInputCostPerToken;
  const outputCostPerToken =
    priorityServiceTierApplied && typeof priceData.output_cost_per_token_priority === "number"
      ? priceData.output_cost_per_token_priority
      : baseOutputCostPerToken;
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
    (baseInputCostPerToken != null ? baseInputCostPerToken * 1.25 : undefined);

  const cacheCreation1hCost =
    priceData.cache_creation_input_token_cost_above_1hr ??
    (baseInputCostPerToken != null ? baseInputCostPerToken * 2 : undefined) ??
    cacheCreation5mCost;

  const cacheReadCost =
    (priorityServiceTierApplied &&
    typeof priceData.cache_read_input_token_cost_priority === "number"
      ? priceData.cache_read_input_token_cost_priority
      : priceData.cache_read_input_token_cost) ??
    (baseInputCostPerToken != null
      ? baseInputCostPerToken * 0.1
      : baseOutputCostPerToken != null
        ? baseOutputCostPerToken * 0.1
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

  const inputAboveThreshold =
    priceData.input_cost_per_token_above_272k_tokens ??
    priceData.input_cost_per_token_above_200k_tokens;
  const outputAboveThreshold =
    priceData.output_cost_per_token_above_272k_tokens ??
    priceData.output_cost_per_token_above_200k_tokens;
  const cacheCreationAboveThreshold =
    priceData.cache_creation_input_token_cost_above_272k_tokens ??
    priceData.cache_creation_input_token_cost_above_200k_tokens;
  const cacheCreation1hAboveThreshold =
    priceData.cache_creation_input_token_cost_above_1hr_above_272k_tokens ??
    priceData.cache_creation_input_token_cost_above_1hr_above_200k_tokens ??
    cacheCreationAboveThreshold;
  const cacheReadAboveThreshold =
    priceData.cache_read_input_token_cost_above_272k_tokens ??
    priceData.cache_read_input_token_cost_above_200k_tokens;
  const longContextThreshold = resolveLongContextThreshold(priceData);
  const longContextThresholdExceeded =
    getRequestInputContextTokens(usage, cache5mTokens, cache1hTokens) > longContextThreshold;
  const hasRealCacheCreationBase = priceData.cache_creation_input_token_cost != null;
  const hasRealCacheReadBase = priceData.cache_read_input_token_cost != null;

  // Input tokens -> input bucket
  // 注意：一旦请求的“输入上下文总量”超过阈值，供应商官方定价按整次请求的全量 token
  // 应用 long-context 价格，而不是仅对超过阈值的部分加价。
  if (longContextThresholdExceeded && inputAboveThreshold != null && usage.input_tokens != null) {
    inputBucket = inputBucket.add(multiplyCost(usage.input_tokens, inputAboveThreshold));
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    inputCostPerToken != null &&
    usage.input_tokens != null
  ) {
    inputBucket = inputBucket.add(
      multiplyCost(usage.input_tokens, inputCostPerToken * CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    inputBucket = inputBucket.add(multiplyCost(usage.input_tokens, inputCostPerToken));
  }

  // Output tokens -> output bucket
  // 与 input 相同：阈值判断基于整次请求的输入上下文，而不是 output bucket 自己的 token 数。
  if (longContextThresholdExceeded && outputAboveThreshold != null && usage.output_tokens != null) {
    outputBucket = outputBucket.add(multiplyCost(usage.output_tokens, outputAboveThreshold));
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    outputCostPerToken != null &&
    usage.output_tokens != null
  ) {
    outputBucket = outputBucket.add(
      multiplyCost(usage.output_tokens, outputCostPerToken * CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    outputBucket = outputBucket.add(multiplyCost(usage.output_tokens, outputCostPerToken));
  }

  // Cache costs

  // Cache creation 5m -> cache_creation bucket
  if (
    longContextThresholdExceeded &&
    hasRealCacheCreationBase &&
    cacheCreationAboveThreshold != null &&
    cache5mTokens != null
  ) {
    cacheCreationBucket = cacheCreationBucket.add(
      multiplyCost(cache5mTokens, cacheCreationAboveThreshold)
    );
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    cacheCreation5mCost != null &&
    cache5mTokens != null
  ) {
    cacheCreationBucket = cacheCreationBucket.add(
      multiplyCost(cache5mTokens, cacheCreation5mCost * CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    cacheCreationBucket = cacheCreationBucket.add(multiplyCost(cache5mTokens, cacheCreation5mCost));
  }

  // Cache creation 1h -> cache_creation bucket
  if (
    longContextThresholdExceeded &&
    hasRealCacheCreationBase &&
    cacheCreation1hAboveThreshold != null &&
    cache1hTokens != null
  ) {
    cacheCreationBucket = cacheCreationBucket.add(
      multiplyCost(cache1hTokens, cacheCreation1hAboveThreshold)
    );
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    cacheCreation1hCost != null &&
    cache1hTokens != null
  ) {
    cacheCreationBucket = cacheCreationBucket.add(
      multiplyCost(cache1hTokens, cacheCreation1hCost * CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    cacheCreationBucket = cacheCreationBucket.add(multiplyCost(cache1hTokens, cacheCreation1hCost));
  }

  // Cache read -> cache_read bucket
  if (
    longContextThresholdExceeded &&
    hasRealCacheReadBase &&
    cacheReadAboveThreshold != null &&
    usage.cache_read_input_tokens != null
  ) {
    cacheReadBucket = cacheReadBucket.add(
      multiplyCost(usage.cache_read_input_tokens, cacheReadAboveThreshold)
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
  context1mApplied: boolean = false,
  priorityServiceTierApplied: boolean = false
): Decimal {
  const segments: Decimal[] = [];

  const baseInputCostPerToken = priceData.input_cost_per_token;
  const baseOutputCostPerToken = priceData.output_cost_per_token;
  const inputCostPerToken =
    priorityServiceTierApplied && typeof priceData.input_cost_per_token_priority === "number"
      ? priceData.input_cost_per_token_priority
      : baseInputCostPerToken;
  const outputCostPerToken =
    priorityServiceTierApplied && typeof priceData.output_cost_per_token_priority === "number"
      ? priceData.output_cost_per_token_priority
      : baseOutputCostPerToken;
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
    (baseInputCostPerToken != null ? baseInputCostPerToken * 1.25 : undefined);

  const cacheCreation1hCost =
    priceData.cache_creation_input_token_cost_above_1hr ??
    (baseInputCostPerToken != null ? baseInputCostPerToken * 2 : undefined) ??
    cacheCreation5mCost;

  const cacheReadCost =
    (priorityServiceTierApplied &&
    typeof priceData.cache_read_input_token_cost_priority === "number"
      ? priceData.cache_read_input_token_cost_priority
      : priceData.cache_read_input_token_cost) ??
    (baseInputCostPerToken != null
      ? baseInputCostPerToken * 0.1
      : baseOutputCostPerToken != null
        ? baseOutputCostPerToken * 0.1
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

  const inputAboveThreshold =
    priceData.input_cost_per_token_above_272k_tokens ??
    priceData.input_cost_per_token_above_200k_tokens;
  const outputAboveThreshold =
    priceData.output_cost_per_token_above_272k_tokens ??
    priceData.output_cost_per_token_above_200k_tokens;
  const cacheCreationAboveThreshold =
    priceData.cache_creation_input_token_cost_above_272k_tokens ??
    priceData.cache_creation_input_token_cost_above_200k_tokens;
  const cacheCreation1hAboveThreshold =
    priceData.cache_creation_input_token_cost_above_1hr_above_272k_tokens ??
    priceData.cache_creation_input_token_cost_above_1hr_above_200k_tokens ??
    cacheCreationAboveThreshold;
  const cacheReadAboveThreshold =
    priceData.cache_read_input_token_cost_above_272k_tokens ??
    priceData.cache_read_input_token_cost_above_200k_tokens;
  const longContextThreshold = resolveLongContextThreshold(priceData);
  const longContextThresholdExceeded =
    getRequestInputContextTokens(usage, cache5mTokens, cache1hTokens) > longContextThreshold;
  const hasRealCacheCreationBase = priceData.cache_creation_input_token_cost != null;
  const hasRealCacheReadBase = priceData.cache_read_input_token_cost != null;

  // Input tokens
  // 注意：阈值命中后按整次请求的全量 token 应用 long-context 价格。
  if (longContextThresholdExceeded && inputAboveThreshold != null && usage.input_tokens != null) {
    segments.push(multiplyCost(usage.input_tokens, inputAboveThreshold));
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    inputCostPerToken != null &&
    usage.input_tokens != null
  ) {
    segments.push(
      multiplyCost(usage.input_tokens, inputCostPerToken * CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    segments.push(multiplyCost(usage.input_tokens, inputCostPerToken));
  }

  // Output tokens
  if (longContextThresholdExceeded && outputAboveThreshold != null && usage.output_tokens != null) {
    segments.push(multiplyCost(usage.output_tokens, outputAboveThreshold));
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    outputCostPerToken != null &&
    usage.output_tokens != null
  ) {
    segments.push(
      multiplyCost(usage.output_tokens, outputCostPerToken * CONTEXT_1M_OUTPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    segments.push(multiplyCost(usage.output_tokens, outputCostPerToken));
  }

  // 缓存相关费用
  // 检查是否有 200K 分层的缓存价格
  // 注意：只有当价格表中的原始基础价格存在时才启用分层计费，避免派生价格与分层价格混用导致误计费

  // 缓存创建费用（5分钟 TTL）：优先级 explicit long-context > context1m fallback > 普通
  if (
    longContextThresholdExceeded &&
    hasRealCacheCreationBase &&
    cacheCreationAboveThreshold != null &&
    cache5mTokens != null
  ) {
    segments.push(multiplyCost(cache5mTokens, cacheCreationAboveThreshold));
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    cacheCreation5mCost != null &&
    cache5mTokens != null
  ) {
    segments.push(
      multiplyCost(cache5mTokens, cacheCreation5mCost * CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    segments.push(multiplyCost(cache5mTokens, cacheCreation5mCost));
  }

  // 缓存创建费用（1小时 TTL）：优先级 explicit long-context > context1m fallback > 普通
  if (
    longContextThresholdExceeded &&
    hasRealCacheCreationBase &&
    cacheCreation1hAboveThreshold != null &&
    cache1hTokens != null
  ) {
    segments.push(multiplyCost(cache1hTokens, cacheCreation1hAboveThreshold));
  } else if (
    longContextThresholdExceeded &&
    context1mApplied &&
    !priorityServiceTierApplied &&
    cacheCreation1hCost != null &&
    cache1hTokens != null
  ) {
    segments.push(
      multiplyCost(cache1hTokens, cacheCreation1hCost * CONTEXT_1M_INPUT_PREMIUM_MULTIPLIER)
    );
  } else {
    segments.push(multiplyCost(cache1hTokens, cacheCreation1hCost));
  }

  // 缓存读取费用
  if (
    longContextThresholdExceeded &&
    hasRealCacheReadBase &&
    cacheReadAboveThreshold != null &&
    usage.cache_read_input_tokens != null
  ) {
    segments.push(multiplyCost(usage.cache_read_input_tokens, cacheReadAboveThreshold));
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
