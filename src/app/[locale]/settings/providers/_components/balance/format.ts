import { type CurrencyCode, formatCurrency } from "@/lib/utils/currency";
import type { ProviderBalanceSnapshot } from "@/types/provider-balance";

/** 余额展示的四种形态，界面据此决定渲染什么 */
export type BalancePresentationKind = "amount" | "unlimited" | "unsupported" | "error" | "empty";

export interface BalancePresentation {
  kind: BalancePresentationKind;
  /** kind 为 amount 时的格式化金额 */
  text: string | null;
  /** kind 为 error 时的失败原因码 */
  errorCode: string | null;
}

/**
 * 把快照映射成界面形态。
 *
 * 金额保留上游返回的币种，不做汇率换算：任何内置汇率都会让展示值和上游账单对不上。
 */
export function presentBalance(snapshot: ProviderBalanceSnapshot | null): BalancePresentation {
  if (!snapshot) {
    return { kind: "empty", text: null, errorCode: null };
  }

  if (snapshot.status === "unsupported") {
    return { kind: "unsupported", text: null, errorCode: null };
  }

  if (snapshot.status === "error") {
    return { kind: "error", text: null, errorCode: snapshot.errorCode };
  }

  if (snapshot.unlimited) {
    return { kind: "unlimited", text: null, errorCode: null };
  }

  if (snapshot.balance === null) {
    return { kind: "empty", text: null, errorCode: null };
  }

  return {
    kind: "amount",
    text: formatCurrency(snapshot.balance, snapshot.currency as CurrencyCode),
    errorCode: null,
  };
}

/** 余额低于该比例时视为紧张，界面上给出警示色 */
const LOW_BALANCE_RATIO = 0.1;
/** 没有授予额度作参照时，低于该金额视为紧张 */
const LOW_BALANCE_ABSOLUTE_USD = 1;

/**
 * 判定余额是否处于紧张状态。
 *
 * 知道授予额度时按剩余比例判定，否则按绝对金额判定。
 */
export function isLowBalance(snapshot: ProviderBalanceSnapshot | null): boolean {
  if (snapshot?.status !== "ok" || snapshot.unlimited) return false;
  if (snapshot.balance === null) return false;
  if (snapshot.balance <= 0) return true;

  if (snapshot.totalGranted !== null && snapshot.totalGranted > 0) {
    return snapshot.balance / snapshot.totalGranted <= LOW_BALANCE_RATIO;
  }

  return snapshot.currency === "USD" && snapshot.balance < LOW_BALANCE_ABSOLUTE_USD;
}

/** 密钥是否已经过期 */
export function isBalanceExpired(snapshot: ProviderBalanceSnapshot | null, now: number): boolean {
  if (!snapshot?.expiresAt) return false;
  const expiresAt = Date.parse(snapshot.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= now;
}
