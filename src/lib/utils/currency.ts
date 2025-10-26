import Decimal from "decimal.js-light";
import { logger } from "@/lib/logger";
import type { Numeric } from "decimal.js-light";

Decimal.set({
  precision: 30,
  rounding: Decimal.ROUND_HALF_UP,
  toExpNeg: -30,
  toExpPos: 30,
});

export const COST_SCALE = 15;

/**
 * 支持的货币代码
 */
export type CurrencyCode = "USD" | "CNY" | "EUR" | "JPY" | "GBP" | "HKD" | "TWD" | "KRW" | "SGD";

/**
 * 货币配置
 * - symbol: 货币符号
 * - name: 货币名称
 * - locale: 地区代码（用于数字格式化）
 */
export const CURRENCY_CONFIG: Record<
  CurrencyCode,
  {
    symbol: string;
    name: string;
    locale: string;
  }
> = {
  USD: { symbol: "$", name: "美元", locale: "en-US" },
  CNY: { symbol: "¥", name: "人民币", locale: "zh-CN" },
  EUR: { symbol: "€", name: "欧元", locale: "de-DE" },
  JPY: { symbol: "¥", name: "日元", locale: "ja-JP" },
  GBP: { symbol: "£", name: "英镑", locale: "en-GB" },
  HKD: { symbol: "HK$", name: "港币", locale: "zh-HK" },
  TWD: { symbol: "NT$", name: "新台币", locale: "zh-TW" },
  KRW: { symbol: "₩", name: "韩元", locale: "ko-KR" },
  SGD: { symbol: "S$", name: "新加坡元", locale: "en-SG" },
} as const;

export type DecimalInput = Numeric | null | undefined;

export function toDecimal(value: DecimalInput): Decimal | null {
  if (value === null || value === undefined) {
    return null;
  }

  if (value instanceof Decimal) {
    return value;
  }

  if (typeof value === "string" && value.trim() === "") {
    return null;
  }

  try {
    return new Decimal(value);
  } catch (error) {
    logger.error("Failed to create Decimal from value", { context: value, error });
    return null;
  }
}

export function toCostDecimal(value: DecimalInput): Decimal | null {
  const decimal = toDecimal(value);
  return decimal ? decimal.toDecimalPlaces(COST_SCALE) : null;
}

export function formatCostForStorage(value: DecimalInput): string | null {
  const decimal = toCostDecimal(value);
  return decimal ? decimal.toFixed(COST_SCALE) : null;
}

export function costToNumber(value: DecimalInput, fractionDigits = 6): number {
  const decimal = toDecimal(value) ?? new Decimal(0);
  return Number(decimal.toDecimalPlaces(fractionDigits).toString());
}

export function sumCosts(values: DecimalInput[]): Decimal {
  return values.reduce<Decimal>((acc, current) => {
    const decimal = toDecimal(current);
    return decimal ? acc.plus(decimal) : acc;
  }, new Decimal(0));
}

/**
 * 格式化货币显示
 * @param value - 金额数值
 * @param currencyCode - 货币代码（默认 USD）
 * @param fractionDigits - 小数位数（默认 2）
 * @returns 格式化后的货币字符串（如 "$100.00" 或 "¥100.00"）
 */
export function formatCurrency(
  value: DecimalInput,
  currencyCode: CurrencyCode = "USD",
  fractionDigits = 2
): string {
  const decimal = toDecimal(value) ?? new Decimal(0);
  const config = CURRENCY_CONFIG[currencyCode];

  const formatted = decimal
    .toDecimalPlaces(fractionDigits)
    .toNumber()
    .toLocaleString(config.locale, {
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });

  return `${config.symbol}${formatted}`;
}

export { Decimal };
