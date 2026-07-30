import { describe, expect, it } from "vitest";
import { computeTokensPerSecond } from "@/lib/public-status/aggregation-core";

describe("computeTokensPerSecond", () => {
  it("以 TTFT 为生成窗口起点", () => {
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: 1000, ttftMs: 500 })).toBe(100);
  });

  it("ttftMs 缺失返回 null（旧 timing 语义不参与 TPS）", () => {
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: 1000, ttftMs: null })).toBeNull();
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: 1000 })).toBeNull();
  });

  it("TTFT 越接近总耗时，计算出的生成速率越高", () => {
    const lateTtft = computeTokensPerSecond({
      outputTokens: 50,
      durationMs: 1000,
      ttftMs: 900,
    });
    const earlyTtft = computeTokensPerSecond({
      outputTokens: 50,
      durationMs: 1000,
      ttftMs: 200,
    });

    expect(lateTtft).toBe(500);
    expect(earlyTtft).toBe(62.5);
  });

  it("生成窗口非正、无 token、无耗时都返回 null", () => {
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: 1000, ttftMs: 1000 })).toBeNull();
    expect(computeTokensPerSecond({ outputTokens: 0, durationMs: 1000, ttftMs: 100 })).toBeNull();
    expect(computeTokensPerSecond({ outputTokens: 50, durationMs: null, ttftMs: 100 })).toBeNull();
  });
});
