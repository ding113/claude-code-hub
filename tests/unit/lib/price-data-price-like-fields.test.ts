import { describe, expect, test } from "vitest";
import { hasValidPriceData } from "@/lib/utils/price-data";

describe("hasValidPriceData: generic price-like fields", () => {
  test("treats per-second pricing as valid price data", () => {
    expect(
      hasValidPriceData({
        input_cost_per_second: 0.5,
      })
    ).toBe(true);
  });

  test("treats provider pricing nodes with session/page prices as valid", () => {
    expect(
      hasValidPriceData({
        pricing: {
          openai: {
            code_interpreter_cost_per_session: 3,
            annotation_cost_per_page: 0.2,
          },
        },
      })
    ).toBe(true);
  });

  test("ignores non price-like numeric metadata", () => {
    expect(
      hasValidPriceData({
        max_tokens: 4096,
        output_vector_size: 1024,
      })
    ).toBe(false);
  });
});
