/**
 * Client-side currency formatting hook using next-intl
 * Provides locale-aware currency formatting in React components
 */

"use client";

import { useFormatter } from "next-intl";
import type { DecimalInput, CurrencyCode } from "@/lib/utils/currency";
import { toDecimal, CURRENCY_CONFIG } from "@/lib/utils/currency";
import Decimal from "decimal.js-light";

/**
 * Hook for formatting currency with user's locale
 * Uses next-intl's useFormatter for locale-aware number formatting
 */
export function useFormatCurrency() {
  const format = useFormatter();

  /**
   * Format currency value with locale awareness
   * @param value - Amount to format
   * @param currencyCode - Currency code (USD, CNY, etc.)
   * @param fractionDigits - Decimal places (default: 2)
   * @returns Formatted currency string
   */
  const formatCurrency = (
    value: DecimalInput,
    currencyCode: CurrencyCode = "USD",
    fractionDigits = 2
  ): string => {
    const decimal = toDecimal(value) ?? new Decimal(0);
    const config = CURRENCY_CONFIG[currencyCode];
    const amount = decimal.toDecimalPlaces(fractionDigits).toNumber();

    // Use next-intl's number formatter with currency style
    // This automatically handles locale-specific formatting (grouping, decimal separator, etc.)
    try {
      return format.number(amount, {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
    } catch (error) {
      console.warn("Currency formatting failed, falling back to manual formatting", error);
      // Fallback to manual formatting if currency is not supported
      const formatted = amount.toLocaleString(config.locale, {
        minimumFractionDigits: fractionDigits,
        maximumFractionDigits: fractionDigits,
      });
      return `${config.symbol}${formatted}`;
    }
  };

  return { formatCurrency };
}
