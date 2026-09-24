import { describe, expect, it } from "vitest";
import { NEW_API_QUOTA_PER_USD } from "@/lib/provider-balance/endpoints";
import {
  hasBalanceData,
  normalizeTimestamp,
  parseChatGptWhamUsage,
  parseDeepSeekBalance,
  parseKimiBalance,
  parseNewApiTokenUsage,
  parseOpenAiBilling,
  quotaToUsd,
  readCurrency,
  readNumber,
  unwrapEnvelope,
} from "@/lib/provider-balance/parsers";

describe("readNumber", () => {
  it("接受数值与数值字符串", () => {
    expect(readNumber(12.5)).toBe(12.5);
    expect(readNumber("110.00")).toBe(110);
    expect(readNumber(0)).toBe(0);
  });

  it("拒绝空串、非数值与非有限值", () => {
    expect(readNumber("")).toBeUndefined();
    expect(readNumber("  ")).toBeUndefined();
    expect(readNumber("abc")).toBeUndefined();
    expect(readNumber(Number.NaN)).toBeUndefined();
    expect(readNumber(Number.POSITIVE_INFINITY)).toBeUndefined();
    expect(readNumber(null)).toBeUndefined();
  });
});

describe("unwrapEnvelope", () => {
  it("剥掉 data 信封", () => {
    expect(unwrapEnvelope({ data: { quota: 1 } })).toEqual({ quota: 1 });
  });

  it("没有 data 信封时原样返回", () => {
    expect(unwrapEnvelope({ quota: 1 })).toEqual({ quota: 1 });
  });

  it("非对象返回空对象", () => {
    expect(unwrapEnvelope(null)).toEqual({});
    expect(unwrapEnvelope([1, 2])).toEqual({});
    expect(unwrapEnvelope("x")).toEqual({});
  });
});

describe("readCurrency", () => {
  it("归一化大小写并回落到默认币种", () => {
    expect(readCurrency("usd", "CNY")).toBe("USD");
    expect(readCurrency(" CNY ", "USD")).toBe("CNY");
    expect(readCurrency("BTC", "USD")).toBe("USD");
    expect(readCurrency(undefined, "CNY")).toBe("CNY");
  });
});

describe("normalizeTimestamp", () => {
  it("把秒级时间戳换算成毫秒", () => {
    expect(normalizeTimestamp(1776556800)).toBe(1776556800000);
  });

  it("毫秒级时间戳保持不变", () => {
    expect(normalizeTimestamp(1776556800000)).toBe(1776556800000);
  });

  it("非正值与非数值返回 undefined", () => {
    expect(normalizeTimestamp(0)).toBeUndefined();
    expect(normalizeTimestamp(-1)).toBeUndefined();
    expect(normalizeTimestamp("later")).toBeUndefined();
  });
});

describe("quotaToUsd", () => {
  it("按 500000 quota = 1 USD 换算", () => {
    expect(quotaToUsd(NEW_API_QUOTA_PER_USD)).toBe(1);
    expect(quotaToUsd(5_000_000)).toBe(10);
  });

  it("负值按 0 处理", () => {
    expect(quotaToUsd(-1)).toBe(0);
  });
});

describe("parseNewApiTokenUsage", () => {
  it("把额度单位换算成美元", () => {
    const patch = parseNewApiTokenUsage({
      success: true,
      data: {
        total_granted: 5_000_000,
        total_used: 1_250_000,
        total_available: 3_750_000,
        expires_at: 1776556800,
      },
    });

    expect(patch).toEqual({
      currency: "USD",
      balance: 7.5,
      totalUsed: 2.5,
      totalGranted: 10,
      expiresAt: 1776556800000,
    });
  });

  it("unlimited_quota 为 true 时不给出余额", () => {
    const patch = parseNewApiTokenUsage({
      data: { unlimited_quota: true, total_used: 500_000, total_available: 0 },
    });

    expect(patch.unlimited).toBe(true);
    expect(patch.balance).toBeUndefined();
    expect(patch.totalGranted).toBeUndefined();
    expect(patch.totalUsed).toBe(1);
  });

  it("授予额度为负数同样视为不限量", () => {
    const patch = parseNewApiTokenUsage({ data: { total_granted: -1, total_used: 0 } });
    expect(patch.unlimited).toBe(true);
    expect(patch.balance).toBeUndefined();
  });

  it("三个额度字段都缺失时返回空对象", () => {
    expect(parseNewApiTokenUsage({ data: { object: "billing" } })).toEqual({});
    expect(parseNewApiTokenUsage(null)).toEqual({});
  });
});

describe("parseOpenAiBilling", () => {
  it("subscription 直接给出 balance 时优先使用", () => {
    expect(parseOpenAiBilling({ balance: 42.5 }, {})).toEqual({ balance: 42.5, currency: "USD" });
  });

  it("用 hard_limit_usd 减去 usage 得到余额，用量单位是美分", () => {
    const patch = parseOpenAiBilling({ hard_limit_usd: 120 }, { total_usage: 4500 });
    expect(patch).toEqual({
      currency: "USD",
      balance: 75,
      totalGranted: 120,
      totalUsed: 45,
    });
  });

  it("用量超过额度时余额不为负", () => {
    const patch = parseOpenAiBilling({ hard_limit_usd: 10 }, { total_usage: 2000 });
    expect(patch.balance).toBe(0);
  });

  it("哨兵额度不当作可消费余额", () => {
    const patch = parseOpenAiBilling({ hard_limit_usd: 99_999_999 }, { total_usage: 1500 });
    expect(patch).toEqual({ totalUsed: 15, currency: "USD", unlimited: true });
  });

  it("两个端点都没有可用字段时返回空对象", () => {
    expect(parseOpenAiBilling({ object: "billing_subscription" }, {})).toEqual({});
  });
});

describe("parseDeepSeekBalance", () => {
  it("取第一条余额非零的记录", () => {
    const patch = parseDeepSeekBalance({
      is_available: true,
      balance_infos: [
        { currency: "USD", total_balance: "0.00", granted_balance: "0.00" },
        { currency: "CNY", total_balance: "110.00", granted_balance: "10.00" },
      ],
    });

    expect(patch).toEqual({ balance: 110, currency: "CNY", totalGranted: 10 });
  });

  it("全部为零时取第一条", () => {
    const patch = parseDeepSeekBalance({
      balance_infos: [{ currency: "CNY", total_balance: "0.00" }],
    });

    expect(patch).toEqual({ balance: 0, currency: "CNY" });
  });

  it("币种缺失时回落到 CNY", () => {
    const patch = parseDeepSeekBalance({ balance_infos: [{ total_balance: 5 }] });
    expect(patch.currency).toBe("CNY");
  });

  it("没有 balance_infos 数组时返回空对象", () => {
    expect(parseDeepSeekBalance({ is_available: true })).toEqual({});
    expect(parseDeepSeekBalance({ balance_infos: [] })).toEqual({});
  });
});

describe("parseKimiBalance", () => {
  it("读取可用余额与代金券余额", () => {
    const patch = parseKimiBalance(
      {
        status: true,
        code: 0,
        data: { available_balance: 88.8, voucher_balance: 8.8, cash_balance: 80 },
      },
      "CNY"
    );

    expect(patch).toEqual({ balance: 88.8, currency: "CNY", totalGranted: 8.8 });
  });

  it("响应未标记成功时返回空对象", () => {
    expect(
      parseKimiBalance({ status: false, code: 0, data: { available_balance: 1 } }, "CNY")
    ).toEqual({});
    expect(
      parseKimiBalance({ status: true, code: 1, data: { available_balance: 1 } }, "CNY")
    ).toEqual({});
  });

  it("缺少可用余额时返回空对象", () => {
    expect(parseKimiBalance({ status: true, code: "0", data: {} }, "USD")).toEqual({});
  });
});

describe("parseChatGptWhamUsage", () => {
  it("读取账号剩余额度", () => {
    const patch = parseChatGptWhamUsage({
      credits: { has_credits: true, unlimited: false, balance: "12.34" },
    });

    expect(patch).toEqual({ balance: 12.34, currency: "USD" });
  });

  it("unlimited 为 true 时不给出余额", () => {
    const patch = parseChatGptWhamUsage({ credits: { unlimited: true, balance: null } });
    expect(patch).toEqual({ unlimited: true, currency: "USD" });
  });

  it("没有 credits 字段时返回空对象", () => {
    expect(parseChatGptWhamUsage({ rate_limit: { allowed: true } })).toEqual({});
    expect(parseChatGptWhamUsage(null)).toEqual({});
  });
});

describe("hasBalanceData", () => {
  it("任一可展示字段存在即判定为有数据", () => {
    expect(hasBalanceData({ balance: 0 })).toBe(true);
    expect(hasBalanceData({ totalUsed: 1 })).toBe(true);
    expect(hasBalanceData({ totalGranted: 1 })).toBe(true);
    expect(hasBalanceData({ unlimited: true })).toBe(true);
  });

  it("只有币种时判定为没有数据", () => {
    expect(hasBalanceData({ currency: "USD" })).toBe(false);
    expect(hasBalanceData({})).toBe(false);
  });
});
