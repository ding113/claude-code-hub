import { describe, expect, test } from "vitest";
import { calculateRequestCost } from "@/lib/utils/cost-calculation";

describe("calculateRequestCost: image token pricing (Gemini image generation)", () => {
  test("output_image_tokens 应使用 output_cost_per_image_token 计费", () => {
    const cost = calculateRequestCost(
      { output_image_tokens: 2000 },
      {
        output_cost_per_token: 0.000012,
        output_cost_per_image_token: 0.00012,
      }
    );

    // 2000 * 0.00012 = 0.24
    expect(cost.toString()).toBe("0.24");
  });

  test("output_image_tokens 未配置 image 价格时应回退到 output_cost_per_token", () => {
    const cost = calculateRequestCost(
      { output_image_tokens: 2000 },
      {
        output_cost_per_token: 0.000012,
      }
    );

    // 2000 * 0.000012 = 0.024
    expect(cost.toString()).toBe("0.024");
  });

  test("input_image_tokens 应使用 input_cost_per_image_token 计费", () => {
    const cost = calculateRequestCost(
      { input_image_tokens: 560 },
      {
        input_cost_per_token: 0.000002,
        input_cost_per_image_token: 0.00000196,
      }
    );

    // 560 * 0.00000196 = 0.0010976
    expect(cost.toNumber()).toBeCloseTo(0.0010976, 6);
  });

  test("input_image_tokens 未配置 image 价格时应回退到 input_cost_per_token", () => {
    const cost = calculateRequestCost(
      { input_image_tokens: 560 },
      {
        input_cost_per_token: 0.000002,
      }
    );

    // 560 * 0.000002 = 0.00112
    expect(cost.toString()).toBe("0.00112");
  });

  test("混合响应：text + image tokens 应分别计费", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 326,
        output_tokens: 340,
        output_image_tokens: 2000,
      },
      {
        input_cost_per_token: 0.000002,
        output_cost_per_token: 0.000012,
        output_cost_per_image_token: 0.00012,
      }
    );

    // input: 326 * 0.000002 = 0.000652
    // output text: 340 * 0.000012 = 0.00408
    // output image: 2000 * 0.00012 = 0.24
    // total: 0.000652 + 0.00408 + 0.24 = 0.244732
    expect(cost.toNumber()).toBeCloseTo(0.244732, 6);
  });

  test("完整 Gemini image 响应计费示例", () => {
    const cost = calculateRequestCost(
      {
        input_tokens: 326,
        output_tokens: 340,
        output_image_tokens: 2000,
      },
      {
        input_cost_per_token: 0.000002,
        output_cost_per_token: 0.000012,
        output_cost_per_image_token: 0.00012,
      }
    );

    // Google 官方价格验证
    // input: 326 * $0.000002 = $0.000652
    // output text: 340 * $0.000012 = $0.00408
    // output image: 2000 * $0.00012 = $0.24 (4K image = 2000 tokens)
    // total: $0.244732
    expect(cost.toNumber()).toBeCloseTo(0.244732, 6);
  });

  test("倍率应同时作用于 image token 费用", () => {
    const cost = calculateRequestCost(
      { output_image_tokens: 2000 },
      {
        output_cost_per_image_token: 0.00012,
      },
      2
    );

    // 2000 * 0.00012 * 2 = 0.48
    expect(cost.toString()).toBe("0.48");
  });

  test("output_image_tokens 为 0 时不应产生费用", () => {
    const cost = calculateRequestCost(
      { output_image_tokens: 0 },
      {
        output_cost_per_image_token: 0.00012,
      }
    );

    expect(cost.toString()).toBe("0");
  });

  test("output_image_tokens 为 undefined 时不应产生费用", () => {
    const cost = calculateRequestCost(
      { output_tokens: 1000 },
      {
        output_cost_per_token: 0.000012,
        output_cost_per_image_token: 0.00012,
      }
    );

    // 只计算 output_tokens: 1000 * 0.000012 = 0.012
    expect(cost.toString()).toBe("0.012");
  });

  test("同时有 input_image_tokens 和 output_image_tokens", () => {
    const cost = calculateRequestCost(
      {
        input_image_tokens: 560,
        output_image_tokens: 2000,
      },
      {
        input_cost_per_image_token: 0.00000196,
        output_cost_per_image_token: 0.00012,
      }
    );

    // input: 560 * 0.00000196 = 0.0010976
    // output: 2000 * 0.00012 = 0.24
    // total: 0.2410976
    expect(cost.toNumber()).toBeCloseTo(0.2410976, 6);
  });
});
