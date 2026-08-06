import type { Numeric } from "decimal.js-light";
import Decimal from "decimal.js-light";
import { logger } from "@/lib/logger";

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
 * 格式化货币显示（浏览器环境 - 推荐使用 useFormatCurrency）
 * @param value - 金额数值
 * @param currencyCode - 货币代码（默认 USD）
 * @param fractionDigitsOrLocale - 小数位数或地区代码（向后兼容）
 * @param fractionDigits - 小数位数（当第三参数为 locale 时使用）
 * @returns 格式化后的货币字符串（如 "$100.00" 或 "¥100.00"）
 */
export function formatCurrency(
  value: DecimalInput,
  currencyCode: CurrencyCode = "USD",
  fractionDigitsOrLocale?: number | string,
  fractionDigits?: number
): string {
  const decimal = toDecimal(value) ?? new Decimal(0);
  const config = CURRENCY_CONFIG[currencyCode];

  // 向后兼容：判断第三参数是数字还是字符串
  let finalLocale: string;
  let finalFractionDigits: number;

  if (typeof fractionDigitsOrLocale === "number") {
    // 旧版调用：formatCurrency(value, currency, fractionDigits)
    finalLocale = config.locale;
    finalFractionDigits = fractionDigitsOrLocale;
  } else if (typeof fractionDigitsOrLocale === "string") {
    // 新版调用：formatCurrency(value, currency, locale, fractionDigits)
    finalLocale = fractionDigitsOrLocale;
    finalFractionDigits = fractionDigits ?? 2;
  } else {
    // 默认调用：formatCurrency(value, currency)
    finalLocale = config.locale;
    finalFractionDigits = 2;
  }

  const formatted = decimal
    .toDecimalPlaces(finalFractionDigits)
    .toNumber()
    .toLocaleString(finalLocale, {
      minimumFractionDigits: finalFractionDigits,
      maximumFractionDigits: finalFractionDigits,
    });

  return `${config.symbol}${formatted}`;
}

/**
 * Get currency symbol from currency code
 * @param currencyCode - Currency code (default "USD")
 * @returns Currency symbol (e.g., "$", "¥", "€")
 */
export function getCurrencySymbol(currencyCode?: CurrencyCode | string): string {
  if (!currencyCode || !(currencyCode in CURRENCY_CONFIG)) {
    return CURRENCY_CONFIG.USD.symbol;
  }
  return CURRENCY_CONFIG[currencyCode as CurrencyCode].symbol;
}

/**
 * Format unit price for billing tooltip (@ price / 1M).
 * Small post-multiplier rates must keep significant digits (e.g. 0.0025), not 2dp → 0.00.
 */
export function formatUnitPrice(
  value: DecimalInput,
  currencyCode: CurrencyCode = "USD",
  options?: { maxDecimals?: number; minDecimals?: number }
): string {
  const decimal = toDecimal(value);
  if (!decimal || decimal.isZero()) {
    const config = CURRENCY_CONFIG[currencyCode];
    return `${config.symbol}0`;
  }
  const maxDecimals = options?.maxDecimals ?? 8;
  const minDecimals = options?.minDecimals ?? 0;
  const abs = decimal.abs();
  let decimals = maxDecimals;
  if (abs.gte(1)) {
    decimals = Math.max(minDecimals, 2);
  } else if (abs.gte(0.01)) {
    decimals = Math.max(minDecimals, 4);
  } else if (abs.gte(0.0001)) {
    decimals = Math.max(minDecimals, 6);
  }
  decimals = Math.min(maxDecimals, decimals);
  const config = CURRENCY_CONFIG[currencyCode];
  let num = decimal.toDecimalPlaces(decimals, Decimal.ROUND_HALF_UP).toFixed(decimals);
  if (num.includes(".")) {
    num = num.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
    if (minDecimals > 0) {
      const [intPart, frac = ""] = num.split(".");
      num = `${intPart}.${frac.padEnd(minDecimals, "0")}`;
    }
  }
  return `${config.symbol}${num}`;
}

/** Format provider/group multipliers while preserving small significant values. */
export function formatCostMultiplier(
  value: number | string | null | undefined,
  options?: { maxDecimals?: number; minDecimals?: number }
): string {
  if (value === "" || value == null) return "-";
  const decimal = toDecimal(value);
  if (!decimal || !Number.isFinite(decimal.toNumber())) return "-";
  const maxDecimals = options?.maxDecimals ?? 8;
  const minDecimals = options?.minDecimals ?? 0;
  if (decimal.isZero()) return minDecimals > 0 ? (0).toFixed(minDecimals) : "0";
  const rounded = decimal.toDecimalPlaces(maxDecimals, Decimal.ROUND_HALF_UP);
  let formatted = rounded.toFixed();
  if (formatted.includes(".")) {
    formatted = formatted.replace(/(\.\d*?[1-9])0+$/u, "$1").replace(/\.0+$/u, "");
    if (minDecimals > 0) {
      const [intPart, frac = ""] = formatted.split(".");
      formatted = `${intPart}.${frac.padEnd(minDecimals, "0")}`;
    }
  } else if (minDecimals > 0) {
    formatted = `${formatted}.${"0".repeat(minDecimals)}`;
  }
  return formatted;
}

export { Decimal };
