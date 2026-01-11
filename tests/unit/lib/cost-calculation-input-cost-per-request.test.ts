import { describe, expect, test } from "vitest";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";

describe("calculateRequestCost: input_cost_per_request", () => {
  test("仅配置按次调用价格时，应计入单次成本", () => {
    const cost = calculateRequestCost(
      {},
      {
        input_cost_per_request: 0.005,
      }
    );

    expect(cost.toString()).toBe("0.005");
  });

  test("按次调用价格应与 token 计费叠加", () => {
    const cost = calculateRequestCost(
      { input_tokens: 1000, output_tokens: 2000 },
      {
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
        input_cost_per_request: 0.005,
      }
    );

    expect(cost.toString()).toBe("0.01");
  });

  test("倍率应同时作用于按次费用与 token 费用", () => {
    const cost = calculateRequestCost(
      { input_tokens: 1000, output_tokens: 2000 },
      {
        input_cost_per_token: 0.000001,
        output_cost_per_token: 0.000002,
        input_cost_per_request: 0.005,
      },
      2
    );

    expect(cost.toString()).toBe("0.02");
  });

  test("无效的按次费用（负数/非有限）应被忽略", () => {
    const negativeCost = calculateRequestCost(
      {},
      {
        input_cost_per_request: -0.005,
      }
    );

    expect(negativeCost.toString()).toBe("0");

    const nanCost = calculateRequestCost(
      {},
      {
        input_cost_per_request: Number.NaN,
      }
    );

    expect(nanCost.toString()).toBe("0");
  });
});
