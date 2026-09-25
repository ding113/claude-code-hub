import { describe, expect, it } from "vitest";
import { NEW_API_QUOTA_PER_USD } from "@/lib/provider-balance/endpoints";
import {
  hasBalanceData,
  isNewApiFailureEnvelope,
  parseNewApiUserSelf,
  parseSub2ApiUsage,
  readDateTime,
} from "@/lib/provider-balance/parsers";

// 响应结构取自 Sub2API backend/internal/handler/gateway_handler.go 的 Usage 处理函数
const sub2ApiUsageStats = {
  today: { requests: 2, total_tokens: 1200, cost: 0.4, actual_cost: 0.2 },
  total: { requests: 30, total_tokens: 90_000, cost: 9, actual_cost: 4.5 },
  average_duration_ms: 1500,
  rpm: 0,
  tpm: 0,
};

describe("readDateTime", () => {
  it("解析 ISO 8601 字符串", () => {
    expect(readDateTime("2026-12-31T00:00:00Z")).toBe(Date.parse("2026-12-31T00:00:00Z"));
    expect(readDateTime("2026-12-31T00:00:00+08:00")).toBe(Date.parse("2026-12-30T16:00:00Z"));
  });

  it("数字与数字字符串按秒或毫秒时间戳处理", () => {
    expect(readDateTime(1_790_000_000)).toBe(1_790_000_000_000);
    expect(readDateTime("1790000000")).toBe(1_790_000_000_000);
    expect(readDateTime(1_790_000_000_000)).toBe(1_790_000_000_000);
  });

  it("Go 零值时间、非法字符串与空值视为未设置", () => {
    expect(readDateTime("0001-01-01T00:00:00Z")).toBeUndefined();
    expect(readDateTime("not a date")).toBeUndefined();
    expect(readDateTime("")).toBeUndefined();
    expect(readDateTime(null)).toBeUndefined();
    expect(readDateTime(0)).toBeUndefined();
  });
});

describe("parseSub2ApiUsage", () => {
  it("钱包模式取账户钱包余额与密钥累计实际扣费", () => {
    const patch = parseSub2ApiUsage({
      mode: "unrestricted",
      isValid: true,
      planName: "钱包余额",
      remaining: 12.5,
      unit: "USD",
      balance: 12.5,
      usage: sub2ApiUsageStats,
    });

    expect(patch).toEqual({ balance: 12.5, currency: "USD", totalUsed: 4.5 });
  });

  it("钱包余额为负数时如实展示", () => {
    expect(
      parseSub2ApiUsage({ mode: "unrestricted", isValid: true, remaining: -0.3, balance: -0.3 })
    ).toEqual({ balance: -0.3, currency: "USD" });
  });

  it("密钥设置了总额度时取密钥额度的剩余、上限与已用", () => {
    const patch = parseSub2ApiUsage({
      mode: "quota_limited",
      isValid: true,
      status: "active",
      quota: { limit: 20, used: 3.5, remaining: 16.5, unit: "USD" },
      remaining: 16.5,
      unit: "USD",
      expires_at: "2026-12-31T00:00:00Z",
      days_until_expiry: 97,
      usage: sub2ApiUsageStats,
    });

    expect(patch).toEqual({
      balance: 16.5,
      currency: "USD",
      totalGranted: 20,
      totalUsed: 3.5,
      expiresAt: Date.parse("2026-12-31T00:00:00Z"),
    });
  });

  it("密钥额度超用时余额按 0 展示", () => {
    const patch = parseSub2ApiUsage({
      mode: "quota_limited",
      isValid: false,
      status: "quota_exhausted",
      quota: { limit: 5, used: 5.2, remaining: -0.2, unit: "USD" },
    });

    expect(patch.balance).toBe(0);
    expect(patch.totalGranted).toBe(5);
  });

  it("密钥只配置了速率限制时展示密钥累计用量", () => {
    const patch = parseSub2ApiUsage({
      mode: "quota_limited",
      isValid: true,
      status: "active",
      rate_limits: [{ window: "5h", limit: 5, used: 1, remaining: 4 }],
      usage: sub2ApiUsageStats,
    });

    expect(patch).toEqual({ currency: "USD", totalUsed: 4.5 });
    expect(hasBalanceData(patch)).toBe(true);
  });

  it("订阅模式取各周期限额中最小的剩余额度与订阅到期时间", () => {
    const patch = parseSub2ApiUsage({
      mode: "unrestricted",
      isValid: true,
      planName: "Pro",
      unit: "USD",
      remaining: 7.5,
      subscription: {
        daily_usage_usd: 2.5,
        weekly_usage_usd: 10,
        monthly_usage_usd: 30,
        daily_limit_usd: 10,
        weekly_limit_usd: 50,
        monthly_limit_usd: 150,
        expires_at: "2026-10-01T00:00:00Z",
      },
      usage: sub2ApiUsageStats,
    });

    expect(patch).toEqual({
      balance: 7.5,
      currency: "USD",
      totalUsed: 4.5,
      expiresAt: Date.parse("2026-10-01T00:00:00Z"),
    });
  });

  it("订阅没有配置限额时 remaining 为 -1，判定为不限量", () => {
    const patch = parseSub2ApiUsage({
      mode: "unrestricted",
      isValid: true,
      planName: "Unlimited",
      unit: "USD",
      remaining: -1,
      subscription: { expires_at: "2026-10-01T00:00:00Z" },
    });

    expect(patch.unlimited).toBe(true);
    expect(patch.balance).toBeUndefined();
  });

  it("兼容 2026-03 之前没有 mode 字段的钱包响应", () => {
    expect(
      parseSub2ApiUsage({
        isValid: true,
        planName: "钱包余额",
        remaining: 3,
        unit: "USD",
        balance: 3,
      })
    ).toEqual({ balance: 3, currency: "USD" });
  });

  it("不带布尔型 isValid 的响应不是 Sub2API", () => {
    expect(parseSub2ApiUsage({ remaining: 3, balance: 3 })).toEqual({});
    expect(parseSub2ApiUsage({ isValid: "true", balance: 3 })).toEqual({});
    expect(parseSub2ApiUsage({ object: "list", data: [] })).toEqual({});
    expect(parseSub2ApiUsage([])).toEqual({});
    expect(parseSub2ApiUsage(null)).toEqual({});
  });
});

describe("isNewApiFailureEnvelope", () => {
  it("success 为 false 时判定为失败信封", () => {
    expect(isNewApiFailureEnvelope({ success: false, message: "无权进行此操作" })).toBe(true);
  });

  it("成功响应与非对象都不是失败信封", () => {
    expect(isNewApiFailureEnvelope({ success: true, data: {} })).toBe(false);
    expect(isNewApiFailureEnvelope({ data: {} })).toBe(false);
    expect(isNewApiFailureEnvelope("false")).toBe(false);
    expect(isNewApiFailureEnvelope(null)).toBe(false);
  });
});

describe("parseNewApiUserSelf", () => {
  it("quota 是账户剩余额度，used_quota 是累计已用额度", () => {
    const patch = parseNewApiUserSelf({
      success: true,
      message: "",
      data: {
        id: 1,
        username: "root",
        group: "default",
        quota: 5 * NEW_API_QUOTA_PER_USD,
        used_quota: NEW_API_QUOTA_PER_USD,
        request_count: 10,
      },
    });

    expect(patch).toEqual({ balance: 5, currency: "USD", totalUsed: 1, totalGranted: 6 });
  });

  it("没有 used_quota 时只展示余额", () => {
    expect(parseNewApiUserSelf({ success: true, data: { quota: 250_000 } })).toEqual({
      balance: 0.5,
      currency: "USD",
    });
  });

  it("负数额度按 0 处理", () => {
    expect(parseNewApiUserSelf({ success: true, data: { quota: -100, used_quota: 0 } })).toEqual({
      balance: 0,
      currency: "USD",
      totalUsed: 0,
      totalGranted: 0,
    });
  });

  it("缺少 data.quota 时判定为没有数据", () => {
    expect(parseNewApiUserSelf({ success: true, data: { username: "root" } })).toEqual({});
    expect(parseNewApiUserSelf({ success: true })).toEqual({});
    expect(parseNewApiUserSelf(null)).toEqual({});
  });
});
