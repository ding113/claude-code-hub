import { describe, expect, test } from "vitest";
import { getCurrencySymbol, CURRENCY_CONFIG, type CurrencyCode } from "@/lib/utils/currency";

describe("getCurrencySymbol", () => {
  test("returns correct symbol for valid currency codes", () => {
    expect(getCurrencySymbol("USD")).toBe("$");
    expect(getCurrencySymbol("CNY")).toBe("\u00a5");
    expect(getCurrencySymbol("EUR")).toBe("\u20ac");
    expect(getCurrencySymbol("JPY")).toBe("\u00a5");
    expect(getCurrencySymbol("GBP")).toBe("\u00a3");
    expect(getCurrencySymbol("HKD")).toBe("HK$");
    expect(getCurrencySymbol("TWD")).toBe("NT$");
    expect(getCurrencySymbol("KRW")).toBe("\u20a9");
    expect(getCurrencySymbol("SGD")).toBe("S$");
  });

  test("returns USD symbol for undefined", () => {
    expect(getCurrencySymbol()).toBe("$");
    expect(getCurrencySymbol(undefined)).toBe("$");
  });

  test("returns USD symbol for invalid currency code", () => {
    expect(getCurrencySymbol("INVALID")).toBe("$");
    expect(getCurrencySymbol("")).toBe("$");
    expect(getCurrencySymbol("usd")).toBe("$"); // case-sensitive
  });

  test("all CURRENCY_CONFIG entries have valid symbols", () => {
    const codes: CurrencyCode[] = ["USD", "CNY", "EUR", "JPY", "GBP", "HKD", "TWD", "KRW", "SGD"];
    for (const code of codes) {
      const symbol = getCurrencySymbol(code);
      expect(symbol).toBe(CURRENCY_CONFIG[code].symbol);
      expect(symbol.length).toBeGreaterThan(0);
    }
  });
});
