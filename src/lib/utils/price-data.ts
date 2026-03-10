import type { ModelPriceData } from "@/types/model-price";

function hasValidNumericPrice(values: unknown[]): boolean {
  return values.some((value) => typeof value === "number" && Number.isFinite(value) && value >= 0);
}

function collectNumericCosts(priceData: ModelPriceData): unknown[] {
  return [
    priceData.input_cost_per_token,
    priceData.output_cost_per_token,
    priceData.input_cost_per_request,
    priceData.cache_creation_input_token_cost,
    priceData.cache_creation_input_token_cost_above_1hr,
    priceData.cache_read_input_token_cost,
    priceData.input_cost_per_token_above_200k_tokens,
    priceData.output_cost_per_token_above_200k_tokens,
    priceData.cache_creation_input_token_cost_above_200k_tokens,
    priceData.cache_read_input_token_cost_above_200k_tokens,
    priceData.cache_creation_input_token_cost_above_1hr_above_200k_tokens,
    priceData.input_cost_per_token_above_200k_tokens_priority,
    priceData.output_cost_per_token_above_200k_tokens_priority,
    priceData.cache_read_input_token_cost_above_200k_tokens_priority,
    priceData.input_cost_per_token_above_272k_tokens,
    priceData.output_cost_per_token_above_272k_tokens,
    priceData.cache_creation_input_token_cost_above_272k_tokens,
    priceData.cache_read_input_token_cost_above_272k_tokens,
    priceData.cache_creation_input_token_cost_above_1hr_above_272k_tokens,
    priceData.input_cost_per_token_above_272k_tokens_priority,
    priceData.output_cost_per_token_above_272k_tokens_priority,
    priceData.cache_read_input_token_cost_above_272k_tokens_priority,
    priceData.input_cost_per_token_priority,
    priceData.output_cost_per_token_priority,
    priceData.cache_read_input_token_cost_priority,
    priceData.output_cost_per_image,
  ];
}

/**
 * 判断价格数据是否包含至少一个可用于计费的价格字段。
 * 避免把数据库中的 `{}` 或仅包含元信息的记录当成有效价格。
 */
export function hasValidPriceData(priceData: ModelPriceData): boolean {
  if (hasValidNumericPrice(collectNumericCosts(priceData))) {
    return true;
  }

  const pricing = priceData.pricing;
  if (pricing && typeof pricing === "object" && !Array.isArray(pricing)) {
    for (const value of Object.values(pricing)) {
      if (value && typeof value === "object" && !Array.isArray(value)) {
        if (hasValidNumericPrice(Object.values(value))) {
          return true;
        }
      }
    }
  }

  const searchCosts = priceData.search_context_cost_per_query;
  if (searchCosts) {
    const searchCostFields = [
      searchCosts.search_context_size_high,
      searchCosts.search_context_size_low,
      searchCosts.search_context_size_medium,
    ];
    return hasValidNumericPrice(searchCostFields);
  }

  return false;
}
