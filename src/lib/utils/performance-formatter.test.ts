import { describe, expect, it } from "vitest";
import { calculateOutputRate, shouldHideOutputRate } from "./performance-formatter";

describe("calculateOutputRate", () => {
  it("以真 TTFB 为生成窗口起点", () => {
    // 1000ms 总耗时，TTFB 500ms => 生成窗口 0.5s，50 tokens => 100 tok/s
    expect(calculateOutputRate(50, 1000, 500)).toBe(100);
  });

  it("firstByteMs 缺失返回 null，不再回退到总耗时", () => {
    // 门禁上线前的历史行只有 TTFT。用总耗时兜底会把上游排队算进生成时间。
    expect(calculateOutputRate(50, 1000, null)).toBeNull();
  });

  it("TTFB 大于 TTFT 会让 TPS 偏高，TTFB 基准才是准确值", () => {
    const basedOnTtft = calculateOutputRate(50, 1000, 900);
    const basedOnTtfb = calculateOutputRate(50, 1000, 200);

    expect(basedOnTtft).toBe(500);
    expect(basedOnTtfb).toBe(62.5);
    expect(basedOnTtfb!).toBeLessThan(basedOnTtft!);
  });

  it("生成窗口非正、无 token、无耗时都返回 null", () => {
    expect(calculateOutputRate(50, 1000, 1000)).toBeNull();
    expect(calculateOutputRate(50, 1000, 1200)).toBeNull();
    expect(calculateOutputRate(0, 1000, 100)).toBeNull();
    expect(calculateOutputRate(null, 1000, 100)).toBeNull();
    expect(calculateOutputRate(50, null, 100)).toBeNull();
    expect(calculateOutputRate(50, 0, 100)).toBeNull();
  });
});

describe("shouldHideOutputRate", () => {
  it("生成窗口占比 <10% 且速率 >5000 时隐藏", () => {
    expect(shouldHideOutputRate(6000, 1000, 950)).toBe(true);
  });

  it("占比或速率任一不满足则不隐藏", () => {
    expect(shouldHideOutputRate(100, 1000, 500)).toBe(false);
    expect(shouldHideOutputRate(6000, 1000, 500)).toBe(false);
    expect(shouldHideOutputRate(100, 1000, 950)).toBe(false);
  });

  it("缺少速率或 firstByteMs 时不隐藏（由 calculateOutputRate 决定是否展示）", () => {
    expect(shouldHideOutputRate(null, 1000, 950)).toBe(false);
    expect(shouldHideOutputRate(6000, 1000, null)).toBe(false);
    expect(shouldHideOutputRate(Number.POSITIVE_INFINITY, 1000, 950)).toBe(false);
  });
});
