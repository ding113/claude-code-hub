import { describe, expect, it } from "vitest";
import { computeTokensPerSecond } from "@/lib/public-status/aggregation-core";

describe("computeTokensPerSecond", () => {
  it("以真 TTFB 为生成窗口起点", () => {
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: 1000, firstByteMs: 500 })).toBe(
      100
    );
  });

  it("firstByteMs 缺失返回 null（门禁上线前的历史行不参与 TPS）", () => {
    expect(
      computeTokensPerSecond({ outputTokens: 50, durationMs: 1000, firstByteMs: null })
    ).toBeNull();
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: 1000 })).toBeNull();
  });

  it("TTFB 基准得到的 TPS 低于（被门控放大的）TFFT 基准", () => {
    const basedOnTfft = computeTokensPerSecond({
      outputTokens: 50,
      durationMs: 1000,
      firstByteMs: 900,
    });
    const basedOnTtfb = computeTokensPerSecond({
      outputTokens: 50,
      durationMs: 1000,
      firstByteMs: 200,
    });

    expect(basedOnTfft).toBe(500);
    expect(basedOnTtfb).toBe(62.5);
  });

  it("生成窗口非正、无 token、无耗时都返回 null", () => {
    expect(
      computeTokensPerSecond({ outputTokens: 50, durationMs: 1000, firstByteMs: 1000 })
    ).toBeNull();
    expect(
      computeTokensPerSecond({ outputTokens: 0, durationMs: 1000, firstByteMs: 100 })
    ).toBeNull();
    expect(
      computeTokensPerSecond({ outputTokens: 50, durationMs: null, firstByteMs: 100 })
    ).toBeNull();
  });
});
