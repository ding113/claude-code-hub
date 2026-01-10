import { describe, expect, test } from "vitest";
import { hasValidPriceData } from "@/lib/utils/price-data";

describe("hasValidPriceData: input_cost_per_request", () => {
  test("仅配置按次调用价格时，应视为有效价格数据", () => {
    expect(
      hasValidPriceData({
        input_cost_per_request: 0.005,
      })
    ).toBe(true);
  });

  test("按次调用价格为 0 时，应视为有效价格数据", () => {
    expect(
      hasValidPriceData({
        input_cost_per_request: 0,
      })
    ).toBe(true);
  });

  test("按次调用价格为负数时，不应视为有效价格数据", () => {
    expect(
      hasValidPriceData({
        input_cost_per_request: -0.005,
      })
    ).toBe(false);
  });

  test("按次调用价格为 NaN/Infinity 时，不应视为有效价格数据", () => {
    expect(
      hasValidPriceData({
        input_cost_per_request: Number.NaN,
      })
    ).toBe(false);

    expect(
      hasValidPriceData({
        input_cost_per_request: Number.POSITIVE_INFINITY,
      })
    ).toBe(false);
  });
});
