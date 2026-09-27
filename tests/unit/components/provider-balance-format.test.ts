import { describe, expect, it } from "vitest";
import {
  isBalanceExpired,
  isLowBalance,
  presentBalance,
} from "@/app/[locale]/settings/providers/_components/balance/format";
import type { ProviderBalanceSnapshot } from "@/types/provider-balance";

function makeSnapshot(overrides: Partial<ProviderBalanceSnapshot> = {}): ProviderBalanceSnapshot {
  return {
    providerId: 1,
    status: "ok",
    source: "new-api-token-usage",
    balance: 10,
    currency: "USD",
    totalGranted: null,
    totalUsed: null,
    unlimited: false,
    expiresAt: null,
    checkedAt: "2026-09-24T00:00:00.000Z",
    errorCode: null,
    ...overrides,
  };
}

describe("presentBalance", () => {
  it("没有快照时是空态", () => {
    expect(presentBalance(null)).toEqual({ kind: "empty", text: null, errorCode: null });
  });

  it("成功时格式化为上游返回的币种", () => {
    expect(presentBalance(makeSnapshot({ balance: 7.5 })).text).toBe("$7.50");
    expect(presentBalance(makeSnapshot({ balance: 110, currency: "CNY" })).text).toBe("¥110.00");
  });

  it("不限量与不支持分别是独立形态", () => {
    expect(presentBalance(makeSnapshot({ unlimited: true, balance: null })).kind).toBe("unlimited");
    expect(presentBalance(makeSnapshot({ status: "unsupported", balance: null })).kind).toBe(
      "unsupported"
    );
  });

  it("失败时带出原因码", () => {
    const presentation = presentBalance(
      makeSnapshot({ status: "error", balance: null, errorCode: "unauthorized" })
    );

    expect(presentation.kind).toBe("error");
    expect(presentation.errorCode).toBe("unauthorized");
  });

  it("成功但没有数值时是空态", () => {
    expect(presentBalance(makeSnapshot({ balance: null })).kind).toBe("empty");
  });
});

describe("isLowBalance", () => {
  it("知道授予额度时按剩余比例判定", () => {
    expect(isLowBalance(makeSnapshot({ balance: 9, totalGranted: 100 }))).toBe(true);
    expect(isLowBalance(makeSnapshot({ balance: 11, totalGranted: 100 }))).toBe(false);
  });

  it("没有授予额度时按绝对金额判定", () => {
    expect(isLowBalance(makeSnapshot({ balance: 0.5 }))).toBe(true);
    expect(isLowBalance(makeSnapshot({ balance: 5 }))).toBe(false);
  });

  it("余额为零或负数一律判定为紧张", () => {
    expect(isLowBalance(makeSnapshot({ balance: 0 }))).toBe(true);
    expect(isLowBalance(makeSnapshot({ balance: -1 }))).toBe(true);
  });

  it("不限量、失败与空快照都不判定为紧张", () => {
    expect(isLowBalance(makeSnapshot({ unlimited: true, balance: null }))).toBe(false);
    expect(isLowBalance(makeSnapshot({ status: "error", balance: null }))).toBe(false);
    expect(isLowBalance(null)).toBe(false);
  });

  it("非美元且没有授予额度时不按美元阈值判定", () => {
    expect(isLowBalance(makeSnapshot({ balance: 0.5, currency: "CNY" }))).toBe(false);
  });
});

describe("isBalanceExpired", () => {
  const now = Date.parse("2026-09-24T00:00:00.000Z");

  it("过期时间早于当前时间判定为已过期", () => {
    expect(isBalanceExpired(makeSnapshot({ expiresAt: "2026-09-23T00:00:00.000Z" }), now)).toBe(
      true
    );
  });

  it("过期时间晚于当前时间判定为未过期", () => {
    expect(isBalanceExpired(makeSnapshot({ expiresAt: "2026-09-25T00:00:00.000Z" }), now)).toBe(
      false
    );
  });

  it("没有过期时间或时间无法解析时判定为未过期", () => {
    expect(isBalanceExpired(makeSnapshot({ expiresAt: null }), now)).toBe(false);
    expect(isBalanceExpired(makeSnapshot({ expiresAt: "not a date" }), now)).toBe(false);
    expect(isBalanceExpired(null, now)).toBe(false);
  });
});
