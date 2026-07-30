import { describe, expect, it } from "vitest";
import { calculateOutputRate, shouldHideOutputRate } from "./performance-formatter";

describe("calculateOutputRate", () => {
  it("以 TTFT 为生成窗口起点", () => {
    // 1000ms 总耗时，TTFT 500ms => 生成窗口 0.5s，50 tokens => 100 tok/s
    expect(calculateOutputRate(50, 1000, 500)).toBe(100);
  });

  it("ttftMs 缺失返回 null，不再回退到总耗时", () => {
    // 旧 timing 语义无法还原 TTFT。用总耗时兜底会把上游排队算进生成时间。
    expect(calculateOutputRate(50, 1000, null)).toBeNull();
  });

  it("TTFT 越接近总耗时，计算出的生成速率越高", () => {
    const lateTtft = calculateOutputRate(50, 1000, 900);
    const earlyTtft = calculateOutputRate(50, 1000, 200);

    expect(lateTtft).toBe(500);
    expect(earlyTtft).toBe(62.5);
    expect(earlyTtft!).toBeLessThan(lateTtft!);
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

  it("缺少速率或 ttftMs 时不隐藏（由 calculateOutputRate 决定是否展示）", () => {
    expect(shouldHideOutputRate(null, 1000, 950)).toBe(false);
    expect(shouldHideOutputRate(6000, 1000, null)).toBe(false);
    expect(shouldHideOutputRate(Number.POSITIVE_INFINITY, 1000, 950)).toBe(false);
  });
});
